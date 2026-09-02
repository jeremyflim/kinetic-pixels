# Architecture and simulation invariants

Kinetic Pixels is a browser-only React application. React owns controls, dialog state, and
low-frequency status. A dedicated module worker owns the canonical 192 × 180 world, advances
it in fixed 60 Hz steps at a selectable wall-clock rate, and renders through a transferred `OffscreenCanvas`. The pure simulation
core has no React, DOM, worker, or canvas dependencies.

## Invariants

- Material IDs are stable, numeric, and resolved through the registry.
- `MATERIAL_PROPERTIES` is the authoritative table for intrinsic physical behavior.
- `MATERIAL_REACTIONS` contains only identity-specific chemistry. Unlisted pairs still exchange
  temperature, moisture, charge, or position through shared property-driven systems.
- The world uses parallel typed arrays for material, per-material progress/lifetime state, electrical charge, status flags,
  temperature, moisture, fuel, liquid mass, 32-bit phase progress, fractional thermal-energy
  remainder, and last-updated tick.
- Simulation randomness comes only from the serialized seeded PRNG.
- Every cell is updated at most once per tick.
- Falling passes scan bottom-to-top; rising passes scan top-to-bottom.
- Horizontal traversal alternates by tick; seeded randomness chooses particle drift and fluid flow.
- Hot update passes use numeric mobility masks and one reusable context object; material identity
  still selects the same data-driven update function and deterministic scan order.
- Painting fills empty cells. Reapplying an energy material refreshes its source temperature and
  lifetime; erasing clears material and transient state.
- Paused worlds perform no recurring physics work, but edits render immediately.
- Saving snapshots a paused tick boundary and never persists interface preferences.
- Import validates metadata, dimensions, byte lengths, and material IDs before mutation.
- Browser reload is the sole way to recreate the startup Wood title.

## Material model

Every material declares a phase (`vacuum`, `solid`, `liquid`, `gas`, or `energy`) and mobility
(`none`, `immovable`, `powder`, `fluid`, or `rising`). Update passes are scheduled from mobility,
which keeps immovable and movable solids distinct without special-casing their IDs.

Gameplay density controls displacement, friction controls particle drift, viscosity controls
liquid reach, gas dispersion controls lateral movement, hardness resists Acid, and corrosiveness scales
corrosion. Separate SI-like thermal fields declare representative mass density `ρ` (kg/m³),
specific heat `c` (J/kg·K), and thermal conductivity `k` (W/m·K).

The solver derives each cell's volumetric capacity from `C = ρc` and stores it in 10 kJ/m³·K
energy units. Injected heat uses `Q = CΔT`. Adjacent cardinal cells exchange equal and opposite
energy using the harmonic mean of their conductivities; exchange is capped below pair equilibrium
for stability. A carried fractional-energy remainder preserves sub-degree transfers instead of
forcing every nonzero edge to move one degree. This is why a one-cell air gap no longer acts like
solid contact. Spatial scale and elapsed physical time are gameplay-accelerated calibration
parameters; the capacity ratios and energy balance remain physically grounded.

Every cell—including empty air—retains an integer Celsius temperature. Empty air also exchanges
8% of its temperature-difference energy with the adjustable room-temperature environment on each 30 Hz thermal
pass. Local air conduction still works, but heat no longer persists across long air chains.

Phase transitions are material properties with directional thresholds and latent energy.
Crossing a threshold moves excess energy into phase progress and pins the cell at the threshold;
conversion completes only after continued heating or cooling supplies the full requirement.
Water/Ice/Steam and Stone/Lava therefore change through energy transfer instead of contact-pair
outcomes. Water retains its real relative capacity while vaporization latent energy is scaled to
18% for playable boil times. Steam has no arbitrary lifetime and uses vapor-volume mass for its
cooling-side latent requirement, so it persists until it condenses. Moisture absorption and diffusion use capacity and permeability properties; finite
Water mass is spent as porous cells become wet. Evaporation consumes temperature.

Material identity answers what a cell is. `state` stores material-local lifetime or growth;
`status` stores `Burning` and the display-facing `Charged` flag; separate arrays store charge, temperature, moisture,
remaining fuel, liquid mass, and latent phase progress. For aqueous solution materials, the low
byte of the existing identity-specific `state` channel stores normalized solute concentration;
this preserves version-6 save compatibility. The legacy `Wet` flag exists only for save migration
and is derived from moisture during simulation.

Combustion begins from temperature and dryness, consumes fuel, and returns heat to the shared
field. Fire and burning fuels also inject fixed local energy into neighboring cells; target heat
capacity therefore still determines the resulting temperature rise. A material can configure a
residue and an independent yield. Wood, Plant, Coal, and Rubber therefore leave sparse Ash through
the same combustion path instead of converting occupied space one-for-one. Burning Coal uses a
dedicated ember palette while Wood retains the flame-and-char treatment.
Fire-to-Wood, Wood-to-Wood, Water-to-Fire, and Lava-to-Water pair outcomes are not present.
The sparse registry is limited to identity-specific chemistry. Plant growth remains a biological
behavior driven by a shared nutrition property on Water, Salt Water, and Soil.

Water, Alcohol, Acid, and Salt Water participate in one aqueous-solution system. Water carries zero
solute; adjacent compatible cells equalize concentration while conserving Alcohol fuel. Material
identity records the dominant solute, so no diluted variants enter the palette. Concentration
controls Alcohol flammability and boiling product, Acid corrosion rate, Salt Water phase thresholds
and conductivity, and solution color. Different non-water solutes intentionally do not combine in
one cell, keeping the state model bounded and deterministic.

## Electricity

Electricity has its own canonical `Uint8Array` charge channel. Each launched pulse also owns a
transient fixed-size breadth-first queue and visited map, so visual charge never doubles as
propagation state and overlapping fronts cannot reflect into a permanent loop. A full-strength
current front advances four cardinal cells per 60 Hz pass, splits naturally at branches, visits
each connected cell once, and leaves a brief fading visual trail. There is intentionally no
distance attenuation inside the limited 192 × 180 play space.

Spark is a short-lived ambient-temperature charge source; it does not masquerade as Fire or add a
fixed temperature increase to adjacent Water. Battery launches one traveling pulse every 30 ticks. Metal
and Salt Water provide solid and liquid paths, while Rubber and dry porous solids block it.
Moisture saturation adds conductivity to porous materials, which makes
wet Wood and Soil electrically different from their dry forms. Resistive heat is intentionally
small and capacity-aware. A reusable sensitivity property lets sufficiently charged conductors arc
into Gunpowder, Coal, Alcohol, Alcohol Vapor, or Hydrogen without dedicated Spark pair rules.

Source is an indestructible immovable utility cell. Its ordinary `state` channel stores the first
non-empty neighboring material ID it observes. Every six ticks it chooses one neighboring empty
cell and initializes a fresh copy through the same path used by painting. This keeps generated
lifetimes, fuel, liquid mass, authored temperatures, and electrical sources consistent. Only an
explicit erase command removes Source.

Explosive materials declare radius, heat, and pressure. The generic explosion solver deposits
heat by distance, compares pressure with each target's blast resistance, and leaves hot air when
matter is destroyed. Other explosive cells receive ignition energy instead of being deleted, so
chains use the same data model rather than a Gunpowder-to-Gunpowder pair reaction.

Movement, combustion, and electricity update at 60 Hz, temperature and phase behavior at 30 Hz, and moisture
and active heat emission at 10 Hz of simulation time. Emitted energy is batched without changing
its per-second total. The worker accrues those unchanged fixed steps at `½×`, `1×`, or `2×`
wall-clock rate. Each callback has a 12 ms simulation budget after its first required step. On
overload, excess wall-clock debt is discarded and visual presentation is capped at 30 Hz so the
worker returns to its message queue instead of executing five expensive catch-up steps in one
long task. Version 6 saves serialize charge and 32-bit latent progress with the other canonical arrays.
Versions 2–5 remain accepted; legacy burning, Wet, heat, and 16-bit phase values migrate before
replacement. Fractional thermal remainder and per-pulse traversal history are transient solver
state; saved full-strength fronts are conservatively relaunched when a world is restored.

## Worker protocol

The UI sends compact commands for initialization, play state, time rate, strokes, clearing,
snapshots, single-cell inspection, and world replacement. See Stats and Monitor poll one selected cell at
12.5 Hz; the worker returns only that small record and never mirrors the live grid into React.
Pointer coordinates are converted to logical cells before commands are posted, and stroke
endpoints are interpolated in the simulation core. Monitor selection consumes one non-painting
field gesture; after pinning, the normal tool flow resumes without moving the sampled coordinate.

## Rendering

The worker renders one logical pixel per cell to a 192 × 180 offscreen buffer. Material color
variation is a stable hash of material, coordinates, cell state, and seed. CSS scales the canvas
with `image-rendering: pixelated` while preserving the grid's 16:15 aspect ratio. A low-opacity
red/blue thermal tint applies to every cell, including air, so the continuous field is visible.
One persistent `ImageData` remains the only application-owned RGBA buffer. A compact cache of the
previous material, state, status, charge, temperature, moisture, fuel, and animation tick detects
visual changes. Changed cells are recolored and grouped into 12 × 12 dirty tiles; contiguous tiles
on a row share one partial `putImageData` upload, while changes covering more than one quarter of
the field use one full upload. A completely unchanged frame performs neither color calculation
nor canvas upload after the inexpensive state comparison.
The fixed viewport can magnify its canvas from 100–400%; pointer-centered wheel calculations
preserve the sampled world cell while the full-height bezel slider provides keyboard and direct
control without changing the playfield dimensions.

## Thermal references and representative assumptions

The constants are rounded representatives, not claims that broad categories have one exact value:
dry air near 20°C; packed quartz sand; basalt for Stone/Lava; dry medium-density wood; liquid
n-octane for Oil; fresh water-rich biomass for Plant; a 20% hydrochloric-acid solution for Acid;
mild steel for Metal; soda-lime glass; and water ice/steam. Fire is an effective burning cell that
includes its local fuel reservoir, while Spark intentionally has minimal thermal mass and coupling.

Primary and government technical references:

- [NIST Chemistry WebBook: water thermochemistry and phase data](https://webbook.nist.gov/cgi/cbook.cgi?ID=C7732185&Mask=37&Units=SI)
- [NIST standard thermal conductivity of air near room temperature](https://srd.nist.gov/JPCRD/jpcrd283.pdf)
- [NIST Chemistry WebBook: liquid n-octane heat capacity](https://webbook.nist.gov/cgi/cbook.cgi?Mask=E&Source=1993CZA355-359)
- [NIST selected-material thermal conductivity tables](https://nvlpubs.nist.gov/nistpubs/legacy/nsrds/nbsnsrds8.pdf)
- [USDA Wood Handbook: density, heat capacity, and conductivity](https://www.fpl.fs.usda.gov/documnts/fplgtr/fplgtr282/fpl_gtr282.pdf)
- [NIH PubChem: hydrochloric-acid solution density and 20.22% azeotrope boiling data](https://pubchem.ncbi.nlm.nih.gov/compound/Hydrochloric-Acid)
- [NOAA CAMEO: hydrochloric acid produces hydrogen with many metals](https://m.cameochemicals.noaa.gov/chemical/3598)
- [NIST ThermoML: concentration-dependent ethanol/water vapor-liquid equilibrium](https://trc.nist.gov/ThermoML/10.1016/j.fluid.2011.06.009.html)
- [USGS: dissolved road salt lowers water's freezing point](https://pubs.usgs.gov/wri/2001/wri01_4260/)
