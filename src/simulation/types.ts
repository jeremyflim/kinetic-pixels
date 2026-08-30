export const GRID_WIDTH = 192
export const GRID_HEIGHT = 180
export const CELL_COUNT = GRID_WIDTH * GRID_HEIGHT

export interface World {
  width: number
  height: number
  material: Uint8Array
  state: Uint16Array
  updatedAt: Uint32Array
  tick: number
  seed: number
  randomState: number
}

export interface UpdateContext {
  direction: -1 | 1
  index: number
  x: number
  y: number
}

export type MaterialUpdateFunction = (world: World, context: UpdateContext) => void

export interface MaterialDefinition {
  id: number
  key: string
  label: string
  paintable: boolean
  phase: 'solid' | 'powder' | 'liquid' | 'gas' | 'energy'
  density: number
  colors: readonly string[]
  update: MaterialUpdateFunction
}

export interface Snapshot {
  width: number
  height: number
  tick: number
  seed: number
  randomState: number
  material: Uint8Array
  state: Uint16Array
}
