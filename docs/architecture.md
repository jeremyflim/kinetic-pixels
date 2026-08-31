# Architecture and simulation invariants

Kinetic Pixels is a browser-only React application. React owns controls, dialog state, and
low-frequency status. A dedicated module worker owns the canonical 192 × 180 world, advances
it at a fixed 60 Hz, and renders through a transferred `OffscreenCanvas`. The pure simulation
core has no React, DOM, worker, or canvas dependencies.

## Invariants

- Material IDs are stable, numeric, and resolved through the registry.
- `MATERIAL_PROPERTIES` is the authoritative table for intrinsic physical behavior.
- `MATERIAL_REACTIONS` contains only identity-specific chemistry. Unlisted pairs still exchange
  temperature, moisture, charge, or position through shared property-driven systems.
- The world uses parallel typed arrays for material, progress/lifetime/charge state, status flags,
  temperature, moisture, fuel, liquid mass, phase progress, and last-updated tick.
- Simulation randomness comes only from the serialized seeded PRNG.
- Every cell is updated at most once per tick.
- Falling passes scan bottom-to-top; rising passes scan top-to-bottom.
- Horizontal traversal alternates by tick; seeded randomness chooses particle drift and fluid flow.
- Painting fills only empty cells; erasing clears material and transient state.
- Paused worlds perform no recurring physics work, but edits render immediately.
- Saving snapshots a paused tick boundary and never persists interface preferences.
- Import validates metadata, dimensions, byte lengths, and material IDs before mutation.
- Browser reload is the sole way to recreate the startup Wood title.

## Material model

Every material declares a phase (`vacuum`, `solid`, `liquid`, `gas`, or `energy`) and mobility
(`none`, `immovable`, `powder`, `fluid`, or `rising`). Update passes are scheduled from mobility,
which keeps immovable and movable solids distinct without special-casing their IDs.

Density controls displacement, friction controls drift and liquid reach, hardness resists Acid,
conductivity routes the current Spark charge behavior, and corrosiveness scales corrosion.
Thermal conductivity, heat capacity, and emissivity drive a shared temperature solver. Every
cell—including empty air—retains a Celsius-like gameplay temperature. Cardinal conduction is
double-buffered; exposed hot surfaces radiate through up to two air cells.

Phase transitions are material properties with directional thresholds and latent progress.
Water/Ice/Steam and Stone/Lava therefore change through energy transfer instead of contact-pair
outcomes. Moisture absorption and diffusion use capacity and permeability properties; finite
Water mass is spent as porous cells become wet. Evaporation consumes temperature.

Material identity answers what a cell is. `state` stores lifetime, growth, or the existing charge
budget; `status` stores `Burning` and `Charged`; separate arrays store temperature, moisture,
remaining fuel, liquid mass, and latent phase progress. The legacy `Wet` flag exists only for
save migration and is derived from moisture during simulation.

Combustion begins from temperature and dryness, consumes fuel, and returns heat to the shared
field. Fire-to-Wood, Wood-to-Wood, Water-to-Fire, and Lava-to-Water pair outcomes are not present.
The sparse registry currently contains only Acid corrosion and dilution. Plant growth remains a
biological material behavior.

Movement and combustion update at 60 Hz, temperature and phase behavior at 20 Hz, and moisture
at 10 Hz. Version 4 saves serialize every canonical array. Version 2 and 3 files remain accepted;
legacy burning, Wet, and heat values migrate into the new channels before replacement.

## Worker protocol

The UI sends compact commands for initialization, play state, strokes, clearing, snapshots,
and world replacement. The worker returns status changes and serialized snapshots only; it
never mirrors the grid into React. Pointer coordinates are converted to logical cells before
commands are posted, and stroke endpoints are interpolated in the simulation core.

## Rendering

The worker renders one logical pixel per cell to a 192 × 180 offscreen buffer. Material color
variation is a stable hash of material, coordinates, cell state, and seed. CSS scales the canvas
with `image-rendering: pixelated` while preserving the grid's 16:15 aspect ratio.
