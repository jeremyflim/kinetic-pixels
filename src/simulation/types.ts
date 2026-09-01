export const GRID_WIDTH = 192
export const GRID_HEIGHT = 180
export const CELL_COUNT = GRID_WIDTH * GRID_HEIGHT

export interface World {
  width: number
  height: number
  material: Uint8Array
  state: Uint16Array
  status: Uint8Array
  charge: Uint8Array
  temperature: Int16Array
  moisture: Uint8Array
  fuel: Uint8Array
  liquidMass: Uint8Array
  phaseProgress: Uint32Array
  updatedAt: Uint32Array
  temperatureDelta: Int32Array
  thermalRemainder: Int32Array
  moistureDelta: Int16Array
  chargeNext: Uint8Array
  electricalQueue: Int32Array
  electricalActive: boolean
  ambientTemperature: number
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
  viscosity: number
  dispersion: number
  electricalConductivity: number
  chargeSource: number
  chargePulsePeriod: number
  chargePulseDuration: number
  sparkSensitivity: number
  indestructible: boolean
  corrosiveness: number
  initialTemperature: number
  massDensity: number
  specificHeatCapacity: number
  thermalConductivity: number
  heatCapacity: number
  blastResistance: number
  phaseTransitions: readonly PhaseTransition[]
  ignitionTemperature: number | null
  fuel: number
  burnRate: number
  combustionHeat: number
  heatEmission: number
  smokeYield: number
  burnProduct: number | null
  extinguishingPower: number
  plantNutrition: number
  explosionRadius: number
  explosionHeat: number
  explosionPressure: number
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
  charge: Uint8Array
  temperature: Int16Array
  moisture: Uint8Array
  fuel: Uint8Array
  liquidMass: Uint8Array
  phaseProgress: Uint32Array
}

export interface CellInspection {
  x: number
  y: number
  materialId: number
  state: number
  status: number
  charge: number
  temperature: number
  moisture: number
  fuel: number
  liquidMass: number
  phaseProgress: number
}
