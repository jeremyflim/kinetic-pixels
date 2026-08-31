export const GRID_WIDTH = 192
export const GRID_HEIGHT = 180
export const CELL_COUNT = GRID_WIDTH * GRID_HEIGHT

export interface World {
  width: number
  height: number
  material: Uint8Array
  state: Uint16Array
  status: Uint8Array
  heat: Uint8Array
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

export type MaterialPhase = 'vacuum' | 'solid' | 'liquid' | 'gas' | 'energy'
export type MaterialMobility = 'none' | 'immovable' | 'powder' | 'fluid' | 'rising'

export interface MaterialProperties {
  phase: MaterialPhase
  mobility: MaterialMobility
  density: number
  hardness: number
  friction: number
  conductivity: boolean
  corrosiveness: number
  initialHeat: number
  heatOutput: number
  heatCapacity: number
  coolingRate: number
  ignitionHeat: number | null
  transitionHeat: number | null
  transitionProduct: number | null
  flammability: number
  burnRate: number
  smokeYield: number
}

export interface MaterialDefinition {
  id: number
  key: string
  label: string
  paintable: boolean
  properties: MaterialProperties
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
  status: Uint8Array
  heat: Uint8Array
}
