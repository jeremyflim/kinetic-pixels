# Try it here!

[Live Site](https://jeremyflim.github.io/kinetic-pixels/)

# Kinetic Pixels

Kinetic Pixels is a desktop-first, browser-only pixel-physics sandbox presented as a
pink-and-lavender molded-plastic console. Its 192 × 180 deterministic world starts with a
two-line wooden title that is made from ordinary Wood cells: pour Sand over it, redirect
Water through it, erase it, or set it on fire.

The application has no server, accounts, analytics, or automatic saving. It provides three
explicit local save slots and portable, validated JSON files.

## Run locally

Requirements: Node.js 24 or later and npm.

```bash
npm ci
npm run dev
```

Vite serves the app at `/kinetic-pixels/` so local and GitHub Pages asset paths behave the
same way.

## Controls

- Choose Sand, Water, Stone, Wood, Fire, Oil, Plant, Acid, Metal, Lava, Ice,
  Spark, or Gunpowder from the Elements rail. Glass, Smoke, and Steam are created by phase changes and combustion.
- Click, hold, or drag on the field to paint; a held pointer continually reapplies the brush.
  The first field click starts the simulation and paints.
- `Space` toggles Play/Pause.
- `E` toggles Eraser and restores the previously selected material when toggled off.
- `I` toggles See Stats. While active, hovering a cell—including air—shows its live state and
  material properties while normal painting remains available.
- Scroll over the field to zoom toward the pointed cell. The vertical field gauge also controls
  zoom from 100–400% and can return the view to 100%.
- `-`, `=`, and `+` change the circular brush radius from 1–20 cells.
- Clear empties the world without restoring the title or changing the current tool, radius,
  or play state.
- Memory Card pauses the simulation and opens three local slots plus JSON import/export.
- `Escape` closes the Memory Card Manager. Other global shortcuts are disabled while it is open.

The simulation remains editable while paused. Reloading the browser is intentionally the only
way to recreate the original wooden title.

## Architecture

React owns controls, dialog state, and low-frequency status only. A dedicated module worker
owns the canonical typed-array world and the transferred `OffscreenCanvas`. It advances physics
at a fixed 60 Hz, caps catch-up work after throttling, and performs no recurring physics work
while paused.

The simulation core under `src/simulation/` is independent of React, workers, and rendering.
Material definitions use stable numeric IDs backed by one exported physical-properties table.
Each entry declares movement, density, thermal conductivity and capacity, phase transitions,
combustion, moisture, blast resistance, conductivity, and corrosion properties.

Temperature persists in every cell, including empty air. A shared, unbounded local diffusion
solver conducts it across every connected chain of cells and drives latent phase transitions
and ignition. Air relaxes toward room temperature in proportion to its temperature difference,
with a slower final approach near ambient, instead of imposing a range cutoff.
A second shared solver absorbs and diffuses moisture through porous materials,
spends finite Water mass, and consumes heat while drying. Combustion consumes fuel and feeds
heat back into the same thermal field, so fire spread emerges from temperature rather than
Wood-to-Wood or Fire-to-Wood pair rules.

The sparse pair registry is reserved for identity-specific chemistry: currently Acid corrosion
and dilution. Parallel typed-array channels keep material identity, lifetime/growth/charge,
temporary statuses, temperature, moisture, fuel, liquid mass, phase progress, and per-tick
update markers separate. A seeded xorshift PRNG is the only source of simulation randomness.

Further invariants and the worker contract are recorded in [docs/architecture.md](docs/architecture.md).
The complete current element-by-element behavior map is recorded in
[docs/reaction-matrix.md](docs/reaction-matrix.md).

## Saves and portable files

Local slots use exactly these versioned keys:

- `kinetic-pixels:save:a`
- `kinetic-pixels:save:b`
- `kinetic-pixels:save:c`

A save records the material, state, status, temperature, moisture, fuel, liquid-mass, and
phase-progress grids, tick, initial seed, current PRNG state, format metadata, name, and timestamp.
It does not record the selected tool, radius, dialog state, play state, startup hint, or pointer preview.

JSON files use format `kinetic-pixels`, version `4`, fixed 192 × 180 dimensions, and Base64
typed-array bytes. Version 2 and 3 saves remain loadable and migrate legacy burning, Wet, and
0–255 heat state into the new fuel, moisture, and Celsius-like temperature channels.
Imports are size-limited and fully validated before replacing the live world; bad JSON, unknown
materials, unsupported versions, invalid dimensions, and decoded-length mismatches leave the
current world untouched.

## Quality checks

```bash
npm run typecheck
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

Vitest covers the title mask, each material behavior, deterministic update ordering, clearing,
and serialization. Playwright covers startup, pointer and keyboard behavior, paused editing,
interpolated strokes, saves, overwrite confirmation, import/export validation, focus behavior,
and screenshots at 1024 × 576, 1366 × 768, and 1920 × 1080.

GitHub Actions runs the full suite on every push and pull request. The Windows runner is
intentional because the checked-in pixel baselines use the same system-font rendering as the
targeted desktop Chromium environment.

## Benchmark

Run the reproducible benchmark with:

```bash
npm run benchmark
```

Development-machine result (AMD Ryzen 9 7940HS, 8 cores / 16 threads; Vitest 4.1.11):

| 192 × 180 scenario | Mean tick | Throughput |
| --- | ---: | ---: |
| Fully occupied stationary grid | 3.30 ms | 302.97 ticks/s |
| Falling Sand | 6.69 ms | 149.39 ticks/s |
| Water spread | 5.55 ms | 180.03 ticks/s |
| Fully occupied Lava / thermal field | 8.66 ms | 115.53 ticks/s |
| Burning Wood / Fire / Smoke | 8.03 ms | 124.54 ticks/s |

These figures are descriptive rather than CI thresholds because shared runners have noisy timing.

## Deployment

The production build uses Vite base path `/kinetic-pixels/`. On accepted changes to `main`, the
Pages workflow repeats type-checking, unit tests, production build, and Chromium Playwright tests,
then publishes `dist/` with the official GitHub Pages actions.

## Compatibility

The project targets current desktop Chromium with `OffscreenCanvas` in a dedicated worker.
Mobile, broad cross-browser fallbacks, audio, WebGPU/WASM acceleration, and automatic saving are
intentionally deferred.

## License

[MIT](LICENSE)
