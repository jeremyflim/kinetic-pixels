# Architecture and simulation invariants

Kinetic Pixels is a browser-only React application. React owns controls, dialog state, and
low-frequency status. A dedicated module worker owns the canonical 192 × 180 world, advances
it at a fixed 60 Hz, and renders through a transferred `OffscreenCanvas`. The pure simulation
core has no React, DOM, worker, or canvas dependencies.

## Invariants

- Material IDs are stable, numeric, and resolved through the registry.
- `MATERIAL_PROPERTIES` is the authoritative table for intrinsic physical behavior.
- `MATERIAL_REACTIONS` is sparse, ordered, and directional; unlisted pairs do not react.
- The world uses parallel typed arrays for material, state, and last-updated tick.
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

Density controls displacement, friction controls drift and liquid reach, and the combustion
properties control ignition probability, burn progress, and Smoke yield. Hardness,
conductivity, and corrosiveness are normalized properties available to future reactions;
temperature and ignition temperature already gate ignition reactions. Temperatures are degrees
Celsius, while density is a relative simulation value and normalized properties range from 0–1.

Reactions are data entries with an actor, target, optional state/heat conditions, probability,
and effect. Multiple ordered entries may exist for a pair, allowing Fire → Wood to attempt a rare
immediate conversion before ordinary ignition. The registry is intentionally sparse instead of a
dense matrix because most material pairs have no interaction.

## Worker protocol

The UI sends compact commands for initialization, play state, strokes, clearing, snapshots,
and world replacement. The worker returns status changes and serialized snapshots only; it
never mirrors the grid into React. Pointer coordinates are converted to logical cells before
commands are posted, and stroke endpoints are interpolated in the simulation core.

## Rendering

The worker renders one logical pixel per cell to a 192 × 180 offscreen buffer. Material color
variation is a stable hash of material, coordinates, cell state, and seed. CSS scales the canvas
with `image-rendering: pixelated` while preserving the grid's 16:15 aspect ratio.
