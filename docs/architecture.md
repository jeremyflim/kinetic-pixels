# Architecture and simulation invariants

Kinetic Pixels is a browser-only React application. React owns controls, dialog state, and
low-frequency status. A dedicated module worker owns the canonical 320 × 300 world, advances
it at a fixed 60 Hz, and renders through a transferred `OffscreenCanvas`. The pure simulation
core has no React, DOM, worker, or canvas dependencies.

## Invariants

- Material IDs are stable, numeric, and resolved through the registry.
- The world uses parallel typed arrays for material, state, and last-updated tick.
- Simulation randomness comes only from the serialized seeded PRNG.
- Every cell is updated at most once per tick.
- Falling passes scan bottom-to-top; rising passes scan top-to-bottom.
- Horizontal traversal and direction preference alternate by tick.
- Painting fills only empty cells; erasing clears material and transient state.
- Paused worlds perform no recurring physics work, but edits render immediately.
- Saving snapshots a paused tick boundary and never persists interface preferences.
- Import validates metadata, dimensions, byte lengths, and material IDs before mutation.
- Browser reload is the sole way to recreate the startup Wood title.

## Worker protocol

The UI sends compact commands for initialization, play state, strokes, clearing, snapshots,
and world replacement. The worker returns status changes and serialized snapshots only; it
never mirrors the grid into React. Pointer coordinates are converted to logical cells before
commands are posted, and stroke endpoints are interpolated in the simulation core.

## Rendering

The worker renders one logical pixel per cell to a 320 × 300 offscreen buffer. Material color
variation is a stable hash of material, coordinates, cell state, and seed. CSS scales the canvas
with `image-rendering: pixelated` while preserving the grid's 16:15 aspect ratio.
