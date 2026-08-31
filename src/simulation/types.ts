export const GRID_WIDTH = 192
export const GRID_HEIGHT = 180
export const CELL_COUNT = GRID_WIDTH * GRID_HEIGHT

export interface World {
  width: number
  height: number
  material: Uint8Array
  state: Uint16Array
  status: Uint8Array
  temperature: Int16Array
  moisture: Uint8Array
  fuel: Uint8Array
  liquidMass: Uint8Array
  phaseProgress: Uint16Array
  updatedAt: Uint32Array
  temperatureDelta: Int32Array
  moistureDelta: Int16Array
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

export interface PhaseTransition {
  direction: 'above' | 'below'
  temperature: number
  product: number
  latentHeat: number
}

export interface MaterialProperties {
  phase: MaterialPhase
  mobility: MaterialMobility
  density: number
  hardness: number
  friction: number
  conductivity: boolean
  corrosiveness: number
  initialTemperature: number
  thermalConductivity: number
  heatCapacity: number
  emissivity: number
  phaseTransitions: readonly PhaseTransition[]
  ignitionTemperature: number | null
  fuel: number
  burnRate: number
  combustionHeat: number
  smokeYield: number
  moistureCapacity: number
  moistureAbsorption: number
  moistureDiffusivity: number
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
  temperature: Int16Array
  moisture: Uint8Array
  fuel: Uint8Array
  liquidMass: Uint8Array
  phaseProgress: Uint16Array
}
