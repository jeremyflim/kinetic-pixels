# Architecture and simulation invariants

Kinetic Pixels is a browser-only React application. React owns controls, dialog state, and
low-frequency status. A dedicated module worker owns the canonical 192 × 180 world, advances
it at a fixed 60 Hz, and renders through a transferred `OffscreenCanvas`. The pure simulation
core has no React, DOM, worker, or canvas dependencies.

## Invariants

- Material IDs are stable, numeric, and resolved through the registry.
- `MATERIAL_PROPERTIES` is the authoritative table for intrinsic physical behavior.
- `MATERIAL_REACTIONS` is sparse and pair-based; unlisted pairs do not react.
- The world uses parallel typed arrays for material, progress/lifetime state, status flags,
  heat, and last-updated tick.
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
conductivity routes Spark energy, and corrosiveness scales corrosion. Thermal properties define
initial heat, emitted heat, heat capacity, cooling, ignition thresholds, and persistent material
transitions. Heat is an intentionally abstract 0–255 gameplay quantity rather than Celsius.
Flammability, burn rate, and Smoke yield control combustion after ignition.

Material identity answers what a cell is. `state` stores progress or transient lifetime, `status`
stores temporary conditions (`Burning`, `Wet`, and `Charged`), and `heat` stores transferable
thermal exposure. A persistent phase or behavior change receives a new material ID; temporary
conditions do not.

Reactions are unordered material-pair entries with explicit initiators, optional status
conditions, probabilities expressed per second, and effects on either participant. Immediate
rules handle events such as Water extinguishing Fire and Lava flashing Water into Steam. Heat
thresholds handle sustained processes such as Sand becoming Glass and Wood igniting. The
registry is intentionally sparse instead of a dense matrix because most pairs do not interact.

Version 3 saves serialize every canonical array. Version 2 files remain accepted; their packed
Wood burning flag migrates into the status channel and their new heat/status channels initialize
to zero before the world is replaced.

## Worker protocol

The UI sends compact commands for initialization, play state, strokes, clearing, snapshots,
and world replacement. The worker returns status changes and serialized snapshots only; it
never mirrors the grid into React. Pointer coordinates are converted to logical cells before
commands are posted, and stroke endpoints are interpolated in the simulation core.

## Rendering

The worker renders one logical pixel per cell to a 192 × 180 offscreen buffer. Material color
variation is a stable hash of material, coordinates, cell state, and seed. CSS scales the canvas
with `image-rendering: pixelated` while preserving the grid's 16:15 aspect ratio.
