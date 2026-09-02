import { AMBIENT_TEMPERATURE, HEAT_EMISSION_INTERVAL, MAXIMUM_TEMPERATURE, MINIMUM_TEMPERATURE, THERMAL_ENERGY_UNIT_J_M3, WATER_BOILING_LATENT_SCALE } from './constants'
import { chance, randomInt } from './random'
import type { MaterialDefinition, MaterialProperties, UpdateContext, World } from './types'
import { ActivityFlag, keepCellActive, markCellActivity } from './activity'

export const MaterialId = {
  Empty: 0, Sand: 1, Water: 2, Stone: 3, Wood: 4, Fire: 5, Smoke: 6,
  Oil: 7, Plant: 8, Acid: 9, Metal: 10, Lava: 11, Ice: 12, Spark: 13,
  Gunpowder: 14, Glass: 15, Steam: 16,
  Salt: 17, SaltWater: 18, Coal: 19, Ash: 20, Rubber: 21, Copper: 22,
  Battery: 23, Mercury: 24, Alcohol: 25, AlcoholVapor: 26, Sodium: 27,
  Hydrogen: 28, Soil: 29, Foam: 30,
  Source: 31,
} as const

export type MaterialIdValue = (typeof MaterialId)[keyof typeof MaterialId]

// Wet remains only for version 2/3 save migration. New behavior derives wetness from moisture.
export const StatusFlag = { Burning: 1 << 0, Wet: 1 << 1, Charged: 1 << 2 } as const
export const FIRE_LIFETIME_MIN = 38
export const FIRE_LIFETIME_MAX = 72
export const SMOKE_LIFETIME_MIN = 90
export const SMOKE_LIFETIME_MAX = 180
export const SOURCE_EMISSION_INTERVAL = 6

function thermal(massDensity: number, specificHeatCapacity: number, thermalConductivity: number) {
  return {
    massDensity,
    specificHeatCapacity,
    thermalConductivity,
    heatCapacity: Math.max(1, Math.round(massDensity * specificHeatCapacity / THERMAL_ENERGY_UNIT_J_M3)),
  }
}

function latent(massDensity: number, latentHeatKJkg: number, gameplayScale = 1): number {
  return Math.round(massDensity * latentHeatKJkg * 1_000 / THERMAL_ENERGY_UNIT_J_M3 * gameplayScale)
}

const inertProperties = {
  hardness: 0, viscosity: 1, dispersion: 0,
  electricalConductivity: 0, chargeSource: 0, chargePulsePeriod: 1, chargePulseDuration: 1,
  sparkSensitivity: 0, indestructible: false, corrosiveness: 0,
  initialTemperature: AMBIENT_TEMPERATURE, ...thermal(1.2, 1_005, 0.026), blastResistance: 0,
  phaseTransitions: [], ignitionTemperature: null, fuel: 0, burnRate: 0,
  combustionHeat: 0, heatEmission: 0, smokeYield: 0, burnProduct: null, ashYield: 0, extinguishingPower: 0, plantNutrition: 0,
  explosionRadius: 0, explosionHeat: 0, explosionPressure: 0,
  moistureCapacity: 0, moistureAbsorption: 0, moistureDiffusivity: 0,
} as const

export const MATERIAL_PROPERTIES: Readonly<Record<MaterialIdValue, MaterialProperties>> = {
  [MaterialId.Empty]: { ...inertProperties, phase: 'gas', mobility: 'none', density: 0, friction: 0 },
  [MaterialId.Sand]: {
    ...inertProperties, phase: 'solid', mobility: 'powder', density: 5, hardness: 0.25, friction: 0.7,
    ...thermal(1_600, 830, 0.27), blastResistance: 0.18,
    phaseTransitions: [{ direction: 'above', temperature: 1_700, product: MaterialId.Glass, latentHeat: latent(1_600, 150) }],
    moistureCapacity: 96, moistureAbsorption: 8, moistureDiffusivity: 18,
  },
  [MaterialId.Water]: {
    ...inertProperties, phase: 'liquid', mobility: 'fluid', density: 2, friction: 0.04, viscosity: 0.1,
    extinguishingPower: 180, plantNutrition: 120,
    ...thermal(998, 4_180, 0.6), blastResistance: 0.12,
    phaseTransitions: [
      { direction: 'above', temperature: 100, product: MaterialId.Steam, latentHeat: latent(998, 2_257, WATER_BOILING_LATENT_SCALE) },
      { direction: 'below', temperature: 0, product: MaterialId.Ice, latentHeat: latent(998, 334) },
    ],
  },
  [MaterialId.Stone]: {
    ...inertProperties, phase: 'solid', mobility: 'immovable', density: 10, hardness: 1, friction: 0.95,
    ...thermal(2_900, 840, 1.7), blastResistance: 0.95,
    phaseTransitions: [{ direction: 'above', temperature: 1_200, product: MaterialId.Lava, latentHeat: latent(2_900, 400) }],
  },
  [MaterialId.Wood]: {
    ...inertProperties, phase: 'solid', mobility: 'immovable', density: 8, hardness: 0.45, friction: 0.8,
    ...thermal(500, 1_300, 0.12), blastResistance: 0.48,
    ignitionTemperature: 160, fuel: 255, burnRate: 3, combustionHeat: 600, heatEmission: 70, smokeYield: 0.012,
    burnProduct: MaterialId.Ash, ashYield: 0.3,
    moistureCapacity: 180, moistureAbsorption: 32, moistureDiffusivity: 24,
  },
  [MaterialId.Fire]: {
    ...inertProperties, phase: 'energy', mobility: 'rising', density: 0.02, friction: 0.05,
    // Fire is an effective burning cell (fuel + hot gas), not a parcel of room-density air.
    initialTemperature: 600, ...thermal(100, 1_200, 0.08), blastResistance: 0, heatEmission: 320,
  },
  [MaterialId.Smoke]: {
    ...inertProperties, phase: 'gas', mobility: 'rising', density: 0.01, friction: 0.12, dispersion: 0.48,
    initialTemperature: 120, ...thermal(1.2, 1_100, 0.04), blastResistance: 0,
  },
  [MaterialId.Oil]: {
    ...inertProperties, phase: 'liquid', mobility: 'fluid', density: 1, friction: 0.025, viscosity: 0.48,
    ...thermal(700, 2_220, 0.13), blastResistance: 0.08,
    ignitionTemperature: 110, fuel: 255, burnRate: 3, combustionHeat: 600, heatEmission: 90, smokeYield: 0.012,
    sparkSensitivity: 210,
  },
  [MaterialId.Plant]: {
    ...inertProperties, phase: 'solid', mobility: 'immovable', density: 4, hardness: 0.1, friction: 0.75,
    ...thermal(700, 3_500, 0.2), blastResistance: 0.16,
    ignitionTemperature: 180, fuel: 180, burnRate: 4, combustionHeat: 600, heatEmission: 60, smokeYield: 0.008,
    burnProduct: MaterialId.Ash, ashYield: 0.18,
    moistureCapacity: 220, moistureAbsorption: 30, moistureDiffusivity: 28,
  },
  [MaterialId.Acid]: {
    ...inertProperties, phase: 'liquid', mobility: 'fluid', density: 2.5, friction: 0.055, viscosity: 0.18,
    corrosiveness: 1, ...thermal(1_100, 3_600, 0.5), blastResistance: 0.08,
    phaseTransitions: [{ direction: 'above', temperature: 108, product: MaterialId.Steam, latentHeat: 200_000 }],
  },
  [MaterialId.Metal]: {
    ...inertProperties, phase: 'solid', mobility: 'immovable', density: 12, hardness: 0.9, friction: 0.98,
    electricalConductivity: 255, ...thermal(7_850, 470, 54), blastResistance: 1.2,
  },
  [MaterialId.Lava]: {
    ...inertProperties, phase: 'liquid', mobility: 'fluid', density: 7, hardness: 0.15, friction: 0.11, viscosity: 0.92,
    initialTemperature: 1_200, ...thermal(2_700, 1_000, 1.5), blastResistance: 0.42,
    phaseTransitions: [{ direction: 'below', temperature: 1_000, product: MaterialId.Stone, latentHeat: latent(2_700, 400) }],
  },
  [MaterialId.Ice]: {
    ...inertProperties, phase: 'solid', mobility: 'powder', density: 1.6, hardness: 0.3, friction: 0.86,
    initialTemperature: -10, ...thermal(917, 2_100, 2.2), blastResistance: 0.34,
    phaseTransitions: [{ direction: 'above', temperature: 0, product: MaterialId.Water, latentHeat: latent(917, 334) }],
  },
  [MaterialId.Spark]: {
    ...inertProperties, phase: 'energy', mobility: 'rising', density: 0.005, friction: 0.02,
    electricalConductivity: 255, chargeSource: 255,
    initialTemperature: AMBIENT_TEMPERATURE, ...thermal(0.1, 1_000, 0.005), blastResistance: 0,
  },
  [MaterialId.Gunpowder]: {
    ...inertProperties, phase: 'solid', mobility: 'powder', density: 4, hardness: 0.15, friction: 0.62,
    ...thermal(1_000, 1_000, 0.1), blastResistance: 0.05,
    ignitionTemperature: 140, fuel: 255, burnRate: 255, combustionHeat: 1_500, smokeYield: 0.02, sparkSensitivity: 245,
    explosionRadius: 5, explosionHeat: 1_600, explosionPressure: 1.35,
    moistureCapacity: 255, moistureAbsorption: 28, moistureDiffusivity: 72,
  },
  [MaterialId.Glass]: {
    ...inertProperties, phase: 'solid', mobility: 'immovable', density: 9, hardness: 0.85, friction: 0.92,
    ...thermal(2_500, 840, 1), blastResistance: 0.2,
  },
  [MaterialId.Steam]: {
    ...inertProperties, phase: 'gas', mobility: 'rising', density: 0.015, friction: 0.035, dispersion: 0.62,
    initialTemperature: 110, ...thermal(0.6, 2_000, 0.025), blastResistance: 0,
    // A vapor cell represents vapor-volume mass; using liquid density here prevented condensation.
    phaseTransitions: [{ direction: 'below', temperature: 95, product: MaterialId.Water, latentHeat: latent(0.6, 2_257) }],
  },
  [MaterialId.Salt]: {
    ...inertProperties, phase: 'solid', mobility: 'powder', density: 5.4, hardness: 0.2, friction: 0.68,
    ...thermal(2_160, 850, 6.5), blastResistance: 0.16, moistureCapacity: 120, moistureAbsorption: 20, moistureDiffusivity: 24,
  },
  [MaterialId.SaltWater]: {
    ...inertProperties, phase: 'liquid', mobility: 'fluid', density: 2.2, friction: 0.045, viscosity: 0.12,
    electricalConductivity: 215, extinguishingPower: 160, plantNutrition: 70,
    ...thermal(1_025, 3_900, 0.62), blastResistance: 0.12,
    phaseTransitions: [
      { direction: 'above', temperature: 103, product: MaterialId.Steam, latentHeat: latent(1_025, 2_200, WATER_BOILING_LATENT_SCALE) },
      { direction: 'below', temperature: -4, product: MaterialId.Ice, latentHeat: latent(1_025, 300) },
    ],
  },
  [MaterialId.Coal]: {
    ...inertProperties, phase: 'solid', mobility: 'powder', density: 5.8, hardness: 0.35, friction: 0.76,
    ...thermal(1_350, 1_260, 0.25), blastResistance: 0.3,
    ignitionTemperature: 260, fuel: 255, burnRate: 1, combustionHeat: 1_050, heatEmission: 105, smokeYield: 0.018,
    burnProduct: MaterialId.Ash, ashYield: 0.5, sparkSensitivity: 80,
  },
  [MaterialId.Ash]: {
    ...inertProperties, phase: 'solid', mobility: 'powder', density: 2.8, hardness: 0.05, friction: 0.82,
    ...thermal(700, 900, 0.16), blastResistance: 0.05, moistureCapacity: 210, moistureAbsorption: 44, moistureDiffusivity: 36,
  },
  [MaterialId.Rubber]: {
    ...inertProperties, phase: 'solid', mobility: 'immovable', density: 7, hardness: 0.35, friction: 0.96,
    ...thermal(1_100, 1_800, 0.14), blastResistance: 0.42,
    ignitionTemperature: 300, fuel: 240, burnRate: 2, combustionHeat: 720, heatEmission: 65, smokeYield: 0.025,
    burnProduct: MaterialId.Ash, ashYield: 0.24,
  },
  [MaterialId.Copper]: {
    ...inertProperties, phase: 'solid', mobility: 'immovable', density: 13, hardness: 0.75, friction: 0.98,
    electricalConductivity: 252, ...thermal(8_960, 385, 401), blastResistance: 0.95,
  },
  [MaterialId.Battery]: {
    ...inertProperties, phase: 'solid', mobility: 'immovable', density: 11, hardness: 0.62, friction: 0.98,
    electricalConductivity: 255, chargeSource: 255, chargePulsePeriod: 30, chargePulseDuration: 1,
    ...thermal(2_800, 900, 4), blastResistance: 0.48,
    ignitionTemperature: 180, fuel: 180, burnRate: 4, combustionHeat: 850, heatEmission: 95, smokeYield: 0.02,
    explosionRadius: 3, explosionHeat: 850, explosionPressure: 0.75,
  },
  [MaterialId.Mercury]: {
    ...inertProperties, phase: 'liquid', mobility: 'fluid', density: 14, friction: 0.08, viscosity: 0.05,
    electricalConductivity: 235, ...thermal(13_534, 140, 8.3), blastResistance: 0.16,
  },
  [MaterialId.Alcohol]: {
    ...inertProperties, phase: 'liquid', mobility: 'fluid', density: 0.82, friction: 0.02, viscosity: 0.04,
    ...thermal(789, 2_440, 0.17), blastResistance: 0.04,
    ignitionTemperature: 363, fuel: 255, burnRate: 7, combustionHeat: 700, heatEmission: 80, smokeYield: 0.004,
    sparkSensitivity: 190,
    phaseTransitions: [{ direction: 'above', temperature: 78, product: MaterialId.AlcoholVapor, latentHeat: latent(789, 841, 0.35) }],
  },
  [MaterialId.AlcoholVapor]: {
    ...inertProperties, phase: 'gas', mobility: 'rising', density: 0.012, friction: 0.025, dispersion: 0.78,
    initialTemperature: 82, ...thermal(1.6, 1_600, 0.018), blastResistance: 0,
    ignitionTemperature: 363, fuel: 220, burnRate: 220, combustionHeat: 1_100, sparkSensitivity: 230,
    explosionRadius: 3, explosionHeat: 900, explosionPressure: 0.72,
    phaseTransitions: [{ direction: 'below', temperature: 70, product: MaterialId.Alcohol, latentHeat: latent(1.6, 841, 0.35) }],
  },
  [MaterialId.Sodium]: {
    ...inertProperties, phase: 'solid', mobility: 'powder', density: 4.4, hardness: 0.12, friction: 0.7,
    electricalConductivity: 170, ...thermal(968, 1_230, 142), blastResistance: 0.08,
  },
  [MaterialId.Hydrogen]: {
    ...inertProperties, phase: 'gas', mobility: 'rising', density: 0.002, friction: 0.015, dispersion: 0.96,
    initialTemperature: AMBIENT_TEMPERATURE, ...thermal(0.09, 14_300, 0.18), blastResistance: 0,
    ignitionTemperature: 45, fuel: 220, burnRate: 220, combustionHeat: 1_300, sparkSensitivity: 245,
    explosionRadius: 4, explosionHeat: 1_250, explosionPressure: 0.92,
  },
  [MaterialId.Soil]: {
    ...inertProperties, phase: 'solid', mobility: 'powder', density: 5.2, hardness: 0.16, friction: 0.84,
    plantNutrition: 255, ...thermal(1_400, 1_480, 0.5), blastResistance: 0.2,
    moistureCapacity: 240, moistureAbsorption: 38, moistureDiffusivity: 44,
  },
  [MaterialId.Foam]: {
    ...inertProperties, phase: 'liquid', mobility: 'fluid', density: 0.55, friction: 0.22, viscosity: 0.72,
    extinguishingPower: 255, ...thermal(120, 2_800, 0.08), blastResistance: 0.02,
  },
  [MaterialId.Source]: {
    ...inertProperties, phase: 'solid', mobility: 'immovable', density: 255, hardness: 1, friction: 1,
    indestructible: true, ...thermal(7_800, 500, 18), blastResistance: 255,
  },
}

const DEFAULT_SOLUTION_CONCENTRATION: Readonly<Partial<Record<MaterialIdValue, number>>> = {
  [MaterialId.Alcohol]: 255,
  [MaterialId.Acid]: 255,
  [MaterialId.SaltWater]: 160,
}

export function isAqueousLiquid(materialId: number): materialId is MaterialIdValue {
  return materialId === MaterialId.Water || DEFAULT_SOLUTION_CONCENTRATION[materialId as MaterialIdValue] !== undefined
}

export function solutionConcentration(materialId: number, state: number): number {
  if (materialId === MaterialId.Water) return 0
  const authored = DEFAULT_SOLUTION_CONCENTRATION[materialId as MaterialIdValue]
  return authored === undefined ? 0 : Math.max(1, Math.min(255, state || authored))
}

export function solutionStrength(materialId: number, state: number): number {
  const authored = DEFAULT_SOLUTION_CONCENTRATION[materialId as MaterialIdValue]
  if (authored === undefined) return materialId === MaterialId.Water ? 0 : 1
  return Math.min(1, solutionConcentration(materialId, state) / authored)
}

function at(world: World, x: number, y: number): number { return y * world.width + x }
function inBounds(world: World, x: number, y: number): boolean { return x >= 0 && x < world.width && y >= 0 && y < world.height }
function hasStatus(world: World, index: number, flag: number): boolean { return Boolean(world.status[index] & flag) }
function addStatus(world: World, index: number, flag: number): void {
  const previous = world.status[index]
  world.status[index] |= flag
  if (world.status[index] !== previous) markCellActivity(world, index, ActivityFlag.Movement | ActivityFlag.Visual)
}
function clearStatus(world: World, index: number, flag: number): void {
  const previous = world.status[index]
  world.status[index] &= ~flag
  if (world.status[index] !== previous) markCellActivity(world, index, ActivityFlag.Movement | ActivityFlag.Visual)
}

function swap(world: World, first: number, second: number): void {
  const material = world.material[first]
  const state = world.state[first]
  const status = world.status[first]
  const charge = world.charge[first]
  const temperature = world.temperature[first]
  const moisture = world.moisture[first]
  const fuel = world.fuel[first]
  const liquidMass = world.liquidMass[first]
  const phaseProgress = world.phaseProgress[first]
  const thermalRemainder = world.thermalRemainder[first]
  world.material[first] = world.material[second]
  world.state[first] = world.state[second]
  world.status[first] = world.status[second]
  world.charge[first] = world.charge[second]
  world.temperature[first] = world.temperature[second]
  world.moisture[first] = world.moisture[second]
  world.fuel[first] = world.fuel[second]
  world.liquidMass[first] = world.liquidMass[second]
  world.phaseProgress[first] = world.phaseProgress[second]
  world.thermalRemainder[first] = world.thermalRemainder[second]
  world.material[second] = material
  world.state[second] = state
  world.status[second] = status
  world.charge[second] = charge
  world.temperature[second] = temperature
  world.moisture[second] = moisture
  world.fuel[second] = fuel
  world.liquidMass[second] = liquidMass
  world.phaseProgress[second] = phaseProgress
  world.thermalRemainder[second] = thermalRemainder
  world.updatedAt[first] = world.tick
  world.updatedAt[second] = world.tick
  markCellActivity(world, first, ActivityFlag.All, true)
  markCellActivity(world, second, ActivityFlag.All, true)
}

function move(world: World, source: number, destination: number): void { swap(world, source, destination) }

export function emptyCell(world: World, index: number): void {
  world.material[index] = MaterialId.Empty
  world.state[index] = 0
  world.status[index] = 0
  world.charge[index] = 0
  world.moisture[index] = 0
  world.fuel[index] = 0
  world.liquidMass[index] = 0
  world.phaseProgress[index] = 0
  world.thermalRemainder[index] = 0
  world.updatedAt[index] = world.tick
  markCellActivity(world, index, ActivityFlag.All, true)
}

export function setMaterialCell(world: World, index: number, materialId: MaterialIdValue, temperature?: number): void {
  if (materialId === MaterialId.Empty) return emptyCell(world, index)
  world.material[index] = materialId
  initializeTransientState(world, index, materialId)
  if (temperature !== undefined) world.temperature[index] = Math.max(MINIMUM_TEMPERATURE, Math.min(MAXIMUM_TEMPERATURE, temperature))
  world.updatedAt[index] = world.tick
}

export function addTemperature(world: World, index: number, energy: number): void {
  if (energy === 0) return
  if ((energy > 0 && world.temperature[index] >= MAXIMUM_TEMPERATURE) || (energy < 0 && world.temperature[index] <= MINIMUM_TEMPERATURE)) {
    world.thermalRemainder[index] = 0
    return
  }
  const capacity = MATERIAL_PROPERTIES[world.material[index] as MaterialIdValue].heatCapacity
  const totalEnergy = world.thermalRemainder[index] + energy
  const change = Math.trunc(totalEnergy / capacity)
  const nextTemperature = Math.max(MINIMUM_TEMPERATURE, Math.min(MAXIMUM_TEMPERATURE, world.temperature[index] + change))
  world.temperature[index] = nextTemperature
  world.thermalRemainder[index] = nextTemperature === MINIMUM_TEMPERATURE || nextTemperature === MAXIMUM_TEMPERATURE
    ? 0
    : totalEnergy - change * capacity
  markCellActivity(world, index, ActivityFlag.Thermal | ActivityFlag.Moisture | ActivityFlag.Visual)
}

function neighbors(world: World, x: number, y: number): number[] {
  const result: number[] = []
  for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
    for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
      if ((offsetX === 0 && offsetY === 0) || !inBounds(world, x + offsetX, y + offsetY)) continue
      result.push(at(world, x + offsetX, y + offsetY))
    }
  }
  return result
}

interface ReactionSideEffect { product?: MaterialIdValue; temperature?: number; concentration?: number }
export interface MaterialReaction {
  materials: readonly [MaterialIdValue, MaterialIdValue]
  initiator: MaterialIdValue | readonly MaterialIdValue[]
  chancePerSecond: number
  scaleByCorrosion?: boolean
  a?: ReactionSideEffect
  b?: ReactionSideEffect
}

// Only identity-specific chemistry belongs here. Thermal, phase, moisture, combustion,
// conductivity, and density interactions are handled by shared property-driven systems.
export const MATERIAL_REACTIONS: readonly MaterialReaction[] = [
  { materials: [MaterialId.Acid, MaterialId.Plant], initiator: MaterialId.Acid, chancePerSecond: 0.85, scaleByCorrosion: true, b: { product: MaterialId.Empty } },
  { materials: [MaterialId.Acid, MaterialId.Wood], initiator: MaterialId.Acid, chancePerSecond: 0.15, scaleByCorrosion: true, b: { product: MaterialId.Empty } },
  { materials: [MaterialId.Acid, MaterialId.Metal], initiator: MaterialId.Acid, chancePerSecond: 0.45, scaleByCorrosion: true, a: { product: MaterialId.SaltWater, concentration: 80 }, b: { product: MaterialId.Hydrogen, temperature: 120 } },
  { materials: [MaterialId.Acid, MaterialId.Copper], initiator: MaterialId.Acid, chancePerSecond: 0.28, scaleByCorrosion: true, a: { product: MaterialId.SaltWater, concentration: 80 }, b: { product: MaterialId.Hydrogen, temperature: 120 } },
  { materials: [MaterialId.Salt, MaterialId.Water], initiator: MaterialId.Salt, chancePerSecond: 0.95, a: { product: MaterialId.SaltWater, concentration: 80 }, b: { product: MaterialId.SaltWater, concentration: 80 } },
  { materials: [MaterialId.Salt, MaterialId.Ice], initiator: MaterialId.Salt, chancePerSecond: 0.9, a: { product: MaterialId.SaltWater, temperature: -2, concentration: 80 }, b: { product: MaterialId.SaltWater, temperature: -2, concentration: 80 } },
  { materials: [MaterialId.Sodium, MaterialId.Water], initiator: MaterialId.Sodium, chancePerSecond: 1, a: { product: MaterialId.Fire, temperature: 900 }, b: { product: MaterialId.Hydrogen, temperature: 500 } },
  { materials: [MaterialId.Sodium, MaterialId.SaltWater], initiator: MaterialId.Sodium, chancePerSecond: 1, a: { product: MaterialId.Fire, temperature: 900 }, b: { product: MaterialId.Hydrogen, temperature: 500 } },
  { materials: [MaterialId.Sodium, MaterialId.Acid], initiator: MaterialId.Sodium, chancePerSecond: 1, a: { product: MaterialId.Fire, temperature: 900 }, b: { product: MaterialId.Hydrogen, temperature: 500 } },
  { materials: [MaterialId.Sodium, MaterialId.Alcohol], initiator: MaterialId.Sodium, chancePerSecond: 0.7, a: { product: MaterialId.Fire, temperature: 700 }, b: { product: MaterialId.Hydrogen, temperature: 350 } },
]

function reactionKey(first: number, second: number): number { return (Math.min(first, second) << 8) | Math.max(first, second) }
const REACTIONS_BY_PAIR: (MaterialReaction[] | undefined)[] = []
const REACTION_TARGET_MASK = new Uint32Array(256)
for (const reaction of MATERIAL_REACTIONS) {
  const key = reactionKey(...reaction.materials)
  const reactions = REACTIONS_BY_PAIR[key] ?? []
  reactions.push(reaction)
  REACTIONS_BY_PAIR[key] = reactions
  const initiators = typeof reaction.initiator === 'number' ? [reaction.initiator] : reaction.initiator
  for (const initiator of initiators) {
    const target = reaction.materials[0] === initiator ? reaction.materials[1] : reaction.materials[0]
    REACTION_TARGET_MASK[initiator] |= (1 << target) >>> 0
  }
}

function isReactionInitiator(reaction: MaterialReaction, materialId: MaterialIdValue): boolean {
  return typeof reaction.initiator === 'number'
    ? reaction.initiator === materialId
    : reaction.initiator.includes(materialId)
}

function applyReactionEffect(world: World, index: number, effect: ReactionSideEffect | undefined): void {
  if (effect?.product === undefined) return
  if (MATERIAL_PROPERTIES[world.material[index] as MaterialIdValue].indestructible) return
  setMaterialCell(world, index, effect.product, effect.temperature ?? world.temperature[index])
  if (effect.concentration !== undefined) world.state[index] = effect.concentration
}

export function reactMaterialPair(world: World, actorIndex: number, targetIndex: number): boolean {
  const actor = world.material[actorIndex] as MaterialIdValue
  const target = world.material[targetIndex] as MaterialIdValue
  if ((REACTION_TARGET_MASK[actor] & ((1 << target) >>> 0)) === 0) return false
  const reactions = REACTIONS_BY_PAIR[reactionKey(actor, target)]
  if (!reactions) return false
  keepCellActive(world, actorIndex, ActivityFlag.Movement)
  keepCellActive(world, targetIndex, ActivityFlag.Movement)
  for (const reaction of reactions) {
    if (!isReactionInitiator(reaction, actor)) continue
    const sameOrder = reaction.materials[0] === actor && reaction.materials[1] === target
    const aIndex = sameOrder ? actorIndex : targetIndex
    const bIndex = sameOrder ? targetIndex : actorIndex
    let probability = 1 - Math.pow(1 - reaction.chancePerSecond, 1 / 60)
    if (reaction.scaleByCorrosion) {
      const aProperties = MATERIAL_PROPERTIES[world.material[aIndex] as MaterialIdValue]
      const bProperties = MATERIAL_PROPERTIES[world.material[bIndex] as MaterialIdValue]
      probability *= Math.max(0, Math.min(1, aProperties.corrosiveness - bProperties.hardness * 0.5))
    }
    if (world.material[aIndex] === MaterialId.Acid) probability *= solutionStrength(MaterialId.Acid, world.state[aIndex])
    if (!chance(world, probability)) continue
    applyReactionEffect(world, aIndex, reaction.a)
    applyReactionEffect(world, bIndex, reaction.b)
    return true
  }
  return false
}

function reactWithNeighbors(world: World, actorIndex: number, x: number, y: number): void {
  const targetMask = REACTION_TARGET_MASK[world.material[actorIndex]]
  if (targetMask === 0) return
  for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
    for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
      if ((offsetX === 0 && offsetY === 0) || !inBounds(world, x + offsetX, y + offsetY)) continue
      const target = at(world, x + offsetX, y + offsetY)
      if ((targetMask & ((1 << world.material[target]) >>> 0)) === 0) continue
      reactMaterialPair(world, actorIndex, target)
      if (world.material[actorIndex] === MaterialId.Empty) return
    }
  }
}

function tryVerticalMove(
  world: World,
  index: number,
  x: number,
  y: number,
  verticalDirection: -1 | 1,
  materialId: MaterialIdValue,
  allowDisplacement: boolean,
): boolean {
  const horizontalDirection = chance(world, 0.5) ? 1 : -1
  const verticalY = y + verticalDirection
  const driftFirst = chance(world, driftChance(materialId))
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const horizontalOffset = driftFirst
      ? (attempt === 0 ? horizontalDirection : attempt === 1 ? 0 : -horizontalDirection)
      : (attempt === 0 ? 0 : attempt === 1 ? horizontalDirection : -horizontalDirection)
    const targetX = x + horizontalOffset
    if (!inBounds(world, targetX, verticalY)) continue
    const target = at(world, targetX, verticalY)
    if (world.material[target] === MaterialId.Empty) {
      move(world, index, target)
      return true
    }
    if (allowDisplacement && canDisplace(materialId, world.material[target] as MaterialIdValue)) {
      swap(world, index, target)
      return true
    }
  }
  return false
}
function driftChance(materialId: MaterialIdValue): number { return 0.15 + (1 - MATERIAL_PROPERTIES[materialId].friction) * 0.3 }
function canDisplace(movingMaterial: MaterialIdValue, targetMaterial: MaterialIdValue): boolean {
  const moving = MATERIAL_PROPERTIES[movingMaterial]
  const target = MATERIAL_PROPERTIES[targetMaterial]
  return (target.phase === 'liquid' || target.phase === 'gas') && moving.density > target.density
}
function updateStatic(world: World, context: UpdateContext): void { world.updatedAt[context.index] = world.tick }

function updateSource(world: World, { index, x, y }: UpdateContext): void {
  const programmedMaterial = world.state[index] as MaterialIdValue
  if (programmedMaterial === MaterialId.Empty) {
    const touchingMaterial = neighbors(world, x, y).find((target) => {
      const materialId = world.material[target] as MaterialIdValue
      return materialId !== MaterialId.Empty && materialId !== MaterialId.Source
    })
    if (touchingMaterial !== undefined) {
      world.state[index] = world.material[touchingMaterial]
      markCellActivity(world, index, ActivityFlag.Movement | ActivityFlag.Visual)
    }
    world.updatedAt[index] = world.tick
    return
  }
  if (!MATERIAL_BY_ID.has(programmedMaterial)) {
    world.state[index] = 0
    markCellActivity(world, index, ActivityFlag.Movement | ActivityFlag.Visual)
    world.updatedAt[index] = world.tick
    return
  }
  keepCellActive(world, index, ActivityFlag.Movement)
  if (world.tick % SOURCE_EMISSION_INTERVAL === 0) {
    const emptyNeighbors = neighbors(world, x, y).filter((target) => world.material[target] === MaterialId.Empty)
    if (emptyNeighbors.length > 0) {
      const target = emptyNeighbors[randomInt(world, 0, emptyNeighbors.length - 1)]
      setMaterialCell(world, target, programmedMaterial)
    }
  }
  world.updatedAt[index] = world.tick
}

function syncSolutionFuel(world: World, index: number, fuelOverride?: number): void {
  if (world.material[index] !== MaterialId.Alcohol) return
  const concentration = solutionConcentration(MaterialId.Alcohol, world.state[index])
  const maximumFuel = concentration < 52 ? 0 : Math.round(MATERIAL_PROPERTIES[MaterialId.Alcohol].fuel * concentration / 255)
  world.fuel[index] = fuelOverride === undefined ? maximumFuel : Math.min(maximumFuel, Math.max(0, Math.round(fuelOverride)))
  if (world.fuel[index] === 0) clearStatus(world, index, StatusFlag.Burning)
}

function setSolutionCell(world: World, index: number, solute: MaterialIdValue | null, concentration: number, fuelOverride?: number): void {
  const nextConcentration = Math.max(0, Math.min(255, Math.round(concentration)))
  world.material[index] = solute === null || nextConcentration === 0 ? MaterialId.Water : solute
  world.state[index] = nextConcentration
  world.phaseProgress[index] = 0
  if (world.material[index] === MaterialId.Water) world.fuel[index] = 0
  else syncSolutionFuel(world, index, fuelOverride)
  world.updatedAt[index] = world.tick
  markCellActivity(world, index, ActivityFlag.All, true)
}

function mixAqueousNeighbor(world: World, index: number, x: number, y: number): void {
  const materialId = world.material[index] as MaterialIdValue
  if (!isAqueousLiquid(materialId)) return
  for (const [offsetX, offsetY] of [[0, 1], [-1, 0], [1, 0], [0, -1]] as const) {
    const targetX = x + offsetX
    const targetY = y + offsetY
    if (!inBounds(world, targetX, targetY)) continue
    const target = at(world, targetX, targetY)
    const targetMaterial = world.material[target] as MaterialIdValue
    if (!isAqueousLiquid(targetMaterial)) continue
    const firstSolute = materialId === MaterialId.Water ? null : materialId
    const secondSolute = targetMaterial === MaterialId.Water ? null : targetMaterial
    if (firstSolute !== null && secondSolute !== null && firstSolute !== secondSolute) continue
    const solute = firstSolute ?? secondSolute
    if (solute === null) continue
    const firstConcentration = solutionConcentration(materialId, world.state[index])
    const secondConcentration = solutionConcentration(targetMaterial, world.state[target])
    if (materialId === targetMaterial && Math.abs(firstConcentration - secondConcentration) <= 1) continue
    const total = firstConcentration + secondConcentration
    const totalFuel = world.fuel[index] + world.fuel[target]
    const firstShare = Math.floor(total / 2)
    const firstFuel = total > 0 ? Math.round(totalFuel * firstShare / total) : 0
    setSolutionCell(world, index, solute, firstShare, firstFuel)
    setSolutionCell(world, target, solute, total - firstShare, totalFuel - firstFuel)
    return
  }
}

function emitSmoke(world: World, x: number, y: number): void {
  const candidates = [[x, y - 1], [x - 1, y - 1], [x + 1, y - 1]] as const
  for (const [targetX, targetY] of candidates) {
    if (!inBounds(world, targetX, targetY)) continue
    const target = at(world, targetX, targetY)
    if (world.material[target] !== MaterialId.Empty) continue
    setMaterialCell(world, target, MaterialId.Smoke)
    break
  }
}

function emitHeat(world: World, x: number, y: number, energyPerCell: number): void {
  if (energyPerCell <= 0 || world.tick % HEAT_EMISSION_INTERVAL !== 0) return
  const emittedEnergy = energyPerCell * HEAT_EMISSION_INTERVAL
  const emitInto = (target: number): void => {
    world.thermalRemainder[target] += emittedEnergy
    markCellActivity(world, target, ActivityFlag.Thermal | ActivityFlag.Visual)
  }
  if (x > 0) emitInto(at(world, x - 1, y))
  if (x + 1 < world.width) emitInto(at(world, x + 1, y))
  if (y > 0) emitInto(at(world, x, y - 1))
  if (y + 1 < world.height) emitInto(at(world, x, y + 1))
}

export function applyExplosion(world: World, originIndex: number, x: number, y: number, source: MaterialProperties): void {
  const originTemperature = Math.max(world.temperature[originIndex], source.explosionHeat)
  setMaterialCell(world, originIndex, MaterialId.Fire, originTemperature)
  const radius = source.explosionRadius
  for (let targetY = Math.max(0, y - radius); targetY <= Math.min(world.height - 1, y + radius); targetY += 1) {
    for (let targetX = Math.max(0, x - radius); targetX <= Math.min(world.width - 1, x + radius); targetX += 1) {
      const distanceSquared = (targetX - x) ** 2 + (targetY - y) ** 2
      if (distanceSquared > radius * radius || distanceSquared === 0) continue
      const target = at(world, targetX, targetY)
      const distance = Math.sqrt(distanceSquared)
      const falloff = Math.max(0, 1 - distance / (radius + 0.5))
      const targetProperties = MATERIAL_PROPERTIES[world.material[target] as MaterialIdValue]
      addTemperature(world, target, Math.round(source.explosionHeat * targetProperties.heatCapacity * falloff))
      if (targetProperties.indestructible) continue
      if (targetProperties.explosionRadius > 0) {
        world.temperature[target] = Math.max(world.temperature[target], targetProperties.ignitionTemperature ?? AMBIENT_TEMPERATURE)
        addStatus(world, target, StatusFlag.Burning)
        continue
      }
      if (world.material[target] === MaterialId.Empty) {
        if (falloff > 0.55 && chance(world, 0.06)) setMaterialCell(world, target, MaterialId.Fire, world.temperature[target])
        continue
      }
      const destructionChance = Math.max(0, Math.min(0.85, (source.explosionPressure * falloff - targetProperties.blastResistance) * 0.7))
      if (chance(world, destructionChance)) emptyCell(world, target)
    }
  }
}

function updateCombustion(world: World, index: number, x: number, y: number, materialId: MaterialIdValue): boolean {
  if (!hasStatus(world, index, StatusFlag.Burning)) return false
  const properties = MATERIAL_PROPERTIES[materialId]
  if (properties.explosionRadius > 0) { applyExplosion(world, index, x, y, properties); return true }
  const saturation = properties.moistureCapacity > 0 ? world.moisture[index] / properties.moistureCapacity : 0
  if (saturation >= 0.15 || world.temperature[index] < (properties.ignitionTemperature ?? 0) * 0.55) {
    clearStatus(world, index, StatusFlag.Burning)
    return false
  }
  const consumed = Math.min(world.fuel[index], properties.burnRate)
  if (consumed <= 0) {
    finishCombustion(world, index, properties)
    return true
  }
  world.fuel[index] -= consumed
  const generatedTemperature = Math.round(properties.combustionHeat * consumed / properties.heatCapacity)
  world.temperature[index] = Math.min(MAXIMUM_TEMPERATURE, world.temperature[index] + generatedTemperature)
  markCellActivity(world, index, ActivityFlag.Movement | ActivityFlag.Thermal | ActivityFlag.Visual)
  emitHeat(world, x, y, properties.heatEmission)
  if (chance(world, properties.smokeYield)) emitSmoke(world, x, y)
  if (world.fuel[index] === 0) {
    finishCombustion(world, index, properties)
    return true
  }
  return false
}

function updateWood(world: World, context: UpdateContext): void {
  updateCombustion(world, context.index, context.x, context.y, MaterialId.Wood)
  world.updatedAt[context.index] = world.tick
}

function finishCombustion(world: World, index: number, properties: MaterialProperties): void {
  if (properties.burnProduct === null || (properties.burnProduct === MaterialId.Ash && !chance(world, properties.ashYield))) {
    emptyCell(world, index)
    return
  }
  setMaterialCell(world, index, properties.burnProduct as MaterialIdValue, world.temperature[index])
}

function updateCombustibleSolid(world: World, context: UpdateContext, materialId: MaterialIdValue): void {
  updateCombustion(world, context.index, context.x, context.y, materialId)
  world.updatedAt[context.index] = world.tick
}

function updatePlant(world: World, context: UpdateContext): void {
  const { index, x, y } = context
  if (updateCombustion(world, index, x, y, MaterialId.Plant)) return
  const nearbyNutrition = neighbors(world, x, y).find((target) => MATERIAL_PROPERTIES[world.material[target] as MaterialIdValue].plantNutrition > 0)
  if (nearbyNutrition === undefined) {
    const nextState = Math.max(0, world.state[index] - 1)
    if (nextState !== world.state[index]) {
      world.state[index] = nextState
      markCellActivity(world, index, ActivityFlag.Movement | ActivityFlag.Visual)
    }
    world.updatedAt[index] = world.tick
    return
  }
  keepCellActive(world, index, ActivityFlag.Movement)
  world.state[index] = Math.min(120, world.state[index] + 1)
  markCellActivity(world, index, ActivityFlag.Movement | ActivityFlag.Visual)
  if (world.state[index] >= 120) {
    const candidates = [[x, y - 1], [x - 1, y], [x + 1, y], [x, y + 1]] as const
    for (const [targetX, targetY] of candidates) {
      if (!inBounds(world, targetX, targetY)) continue
      const target = at(world, targetX, targetY)
      if (world.material[target] !== MaterialId.Empty) continue
      setMaterialCell(world, target, MaterialId.Plant)
      world.state[index] = 0
      if (chance(world, 0.1) && MATERIAL_PROPERTIES[world.material[nearbyNutrition] as MaterialIdValue].phase === 'liquid') emptyCell(world, nearbyNutrition)
      break
    }
  }
  world.updatedAt[index] = world.tick
}

function updatePowder(world: World, context: UpdateContext, materialId: MaterialIdValue): void {
  const { index, x, y } = context
  reactWithNeighbors(world, index, x, y)
  if (world.material[index] !== materialId) return
  if (MATERIAL_PROPERTIES[materialId].fuel > 0 && updateCombustion(world, index, x, y, materialId)) return
  if (y >= world.height - 1) return updateStatic(world, context)
  if (tryVerticalMove(world, index, x, y, 1, materialId, true)) return
  world.updatedAt[index] = world.tick
}
function updateSand(world: World, context: UpdateContext): void { updatePowder(world, context, MaterialId.Sand) }
function updateIce(world: World, context: UpdateContext): void { updatePowder(world, context, MaterialId.Ice) }
function updateGunpowder(world: World, context: UpdateContext): void {
  updatePowder(world, context, MaterialId.Gunpowder)
}

interface FluidPath { drop: number; dropDistance: number; furthest: number; run: number }
function fluidPath(world: World, x: number, y: number, direction: -1 | 1, maximumDistance: number): FluidPath {
  const path: FluidPath = { drop: -1, dropDistance: Number.POSITIVE_INFINITY, furthest: -1, run: 0 }
  for (let distance = 1; distance <= maximumDistance; distance += 1) {
    const targetX = x + direction * distance
    if (!inBounds(world, targetX, y)) break
    const target = at(world, targetX, y)
    if (world.material[target] !== MaterialId.Empty) break
    path.furthest = target
    path.run = distance
    if (y < world.height - 1 && world.material[at(world, targetX, y + 1)] === MaterialId.Empty) {
      path.drop = target
      path.dropDistance = distance
      break
    }
  }
  return path
}

function extinguishNeighbors(world: World, x: number, y: number, power: number, sourceMaterial: MaterialIdValue): void {
  if (power <= 0) return
  const source = at(world, x, y)
  for (const target of neighbors(world, x, y)) {
    if (world.material[target] === MaterialId.Fire || hasStatus(world, target, StatusFlag.Burning)) {
      keepCellActive(world, source, ActivityFlag.Movement)
      keepCellActive(world, target, ActivityFlag.Movement)
    }
    if (world.material[target] === MaterialId.Fire && chance(world, power / 255 * 0.32)) {
      setMaterialCell(world, target, MaterialId.Smoke, Math.min(120, world.temperature[target]))
    } else if (hasStatus(world, target, StatusFlag.Burning)
      && !((sourceMaterial === MaterialId.Water || sourceMaterial === MaterialId.SaltWater) && world.material[target] === MaterialId.Oil)
      && chance(world, power / 255 * 0.18)) {
      clearStatus(world, target, StatusFlag.Burning)
    }
  }
}

function flashWaterAgainstHotOil(world: World, index: number, x: number, y: number, materialId: MaterialIdValue): boolean {
  const sourceIsWater = materialId === MaterialId.Water || materialId === MaterialId.SaltWater
  if (!sourceIsWater && materialId !== MaterialId.Oil) return false
  for (const target of neighbors(world, x, y)) {
    const targetMaterial = world.material[target]
    const oil = materialId === MaterialId.Oil ? index : target
    const water = sourceIsWater ? index : target
    if ((sourceIsWater && targetMaterial !== MaterialId.Oil)
      || (materialId === MaterialId.Oil && targetMaterial !== MaterialId.Water && targetMaterial !== MaterialId.SaltWater)) continue
    if (!hasStatus(world, oil, StatusFlag.Burning) && world.temperature[oil] < 120) continue
    setMaterialCell(world, water, MaterialId.Steam, Math.max(120, world.temperature[water]))
    return water === index
  }
  return false
}

function updateFluid(world: World, context: UpdateContext, materialId: MaterialIdValue): void {
  const { index, x, y } = context
  reactWithNeighbors(world, index, x, y)
  if (world.material[index] !== materialId) return
  const properties = MATERIAL_PROPERTIES[materialId]
  if (isAqueousLiquid(materialId)) {
    mixAqueousNeighbor(world, index, x, y)
    if (world.material[index] !== materialId) return
  }
  if ((materialId === MaterialId.Water || materialId === MaterialId.SaltWater || materialId === MaterialId.Oil)
    && flashWaterAgainstHotOil(world, index, x, y, materialId)) return
  if (properties.extinguishingPower > 0) extinguishNeighbors(world, x, y, properties.extinguishingPower, materialId)
  if (properties.fuel > 0 && updateCombustion(world, index, x, y, materialId)) return
  if (y < world.height - 1 && tryVerticalMove(world, index, x, y, 1, materialId, true)) return
  const maximumDistance = Math.max(1, Math.round((1 - MATERIAL_PROPERTIES[materialId].viscosity) * 12))
  const left = fluidPath(world, x, y, -1, maximumDistance)
  const right = fluidPath(world, x, y, 1, maximumDistance)
  if (left.drop >= 0 || right.drop >= 0) {
    if (left.drop < 0) return move(world, index, right.drop)
    if (right.drop < 0) return move(world, index, left.drop)
    if (left.dropDistance < right.dropDistance) return move(world, index, left.drop)
    if (right.dropDistance < left.dropDistance) return move(world, index, right.drop)
    return move(world, index, chance(world, 0.5) ? left.drop : right.drop)
  }
  const longestRun = Math.max(left.run, right.run)
  if (longestRun > 0) {
    if (left.run > right.run) return move(world, index, left.furthest)
    if (right.run > left.run) return move(world, index, right.furthest)
    return move(world, index, chance(world, 0.5) ? left.furthest : right.furthest)
  }
  world.updatedAt[index] = world.tick
}
function updateWater(world: World, context: UpdateContext): void { updateFluid(world, context, MaterialId.Water) }
function updateOil(world: World, context: UpdateContext): void { updateFluid(world, context, MaterialId.Oil) }
function updateAcid(world: World, context: UpdateContext): void { updateFluid(world, context, MaterialId.Acid) }
function updateLava(world: World, context: UpdateContext): void { updateFluid(world, context, MaterialId.Lava) }
function updateMetal(world: World, context: UpdateContext): void { world.updatedAt[context.index] = world.tick }

function tryHorizontalGasMove(world: World, index: number, x: number, y: number, materialId: MaterialIdValue): boolean {
  const dispersion = MATERIAL_PROPERTIES[materialId].dispersion
  if (dispersion <= 0 || !chance(world, dispersion)) return false
  const direction = chance(world, 0.5) ? 1 : -1
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const targetX = x + (attempt === 0 ? direction : -direction)
    if (!inBounds(world, targetX, y)) continue
    const target = at(world, targetX, y)
    if (world.material[target] === MaterialId.Empty) { move(world, index, target); return true }
  }
  return false
}

function tryRisingMove(world: World, index: number, x: number, y: number, materialId: MaterialIdValue): boolean {
  const properties = MATERIAL_PROPERTIES[materialId]
  if (properties.phase === 'gas' && chance(world, properties.dispersion * 0.25)
    && tryHorizontalGasMove(world, index, x, y, materialId)) return true
  if (tryVerticalMove(world, index, x, y, -1, materialId, false)) return true
  if (properties.phase !== 'gas') return false
  if (tryHorizontalGasMove(world, index, x, y, materialId)) return true
  const hasHorizontalOpening = (x > 0 && world.material[at(world, x - 1, y)] === MaterialId.Empty)
    || (x + 1 < world.width && world.material[at(world, x + 1, y)] === MaterialId.Empty)
  if (hasHorizontalOpening) keepCellActive(world, index, ActivityFlag.Movement)
  return false
}

function updateFire(world: World, { index, x, y }: UpdateContext): void {
  if (world.temperature[index] < 180) return emptyCell(world, index)
  const lifetime = world.state[index] || randomInt(world, FIRE_LIFETIME_MIN, FIRE_LIFETIME_MAX)
  if (lifetime <= 1) return emptyCell(world, index)
  world.state[index] = lifetime - 1
  world.temperature[index] = Math.max(world.temperature[index], 500)
  markCellActivity(world, index, ActivityFlag.Movement | ActivityFlag.Thermal | ActivityFlag.Visual)
  emitHeat(world, x, y, MATERIAL_PROPERTIES[MaterialId.Fire].heatEmission)
  if (tryRisingMove(world, index, x, y, MaterialId.Fire)) return
  world.updatedAt[index] = world.tick
}

function updateSmoke(world: World, { index, x, y }: UpdateContext): void {
  const lifetime = world.state[index] || randomInt(world, SMOKE_LIFETIME_MIN, SMOKE_LIFETIME_MAX)
  if (lifetime <= 1) return emptyCell(world, index)
  world.state[index] = lifetime - 1
  markCellActivity(world, index, ActivityFlag.Movement | ActivityFlag.Visual)
  if (world.tick % 2 === 0) {
    if (tryRisingMove(world, index, x, y, MaterialId.Smoke)) return
  }
  world.updatedAt[index] = world.tick
}

function updateSteam(world: World, { index, x, y }: UpdateContext): void {
  if (tryRisingMove(world, index, x, y, MaterialId.Steam)) return
  world.updatedAt[index] = world.tick
}

function updateSpark(world: World, { index, x, y }: UpdateContext): void {
  const lifetime = world.state[index] || randomInt(world, 3, 6)
  if (lifetime <= 1) return emptyCell(world, index)
  world.state[index] = lifetime - 1
  markCellActivity(world, index, ActivityFlag.Movement | ActivityFlag.Visual)
  if (tryRisingMove(world, index, x, y, MaterialId.Spark)) return
  world.updatedAt[index] = world.tick
}

function updateRisingFuel(world: World, context: UpdateContext, materialId: MaterialIdValue): void {
  if (updateCombustion(world, context.index, context.x, context.y, materialId)) return
  const { index, x, y } = context
  if (tryRisingMove(world, index, x, y, materialId)) return
  world.updatedAt[index] = world.tick
}

export const MATERIALS = [
  { id: MaterialId.Empty, key: 'empty', label: 'Empty', paintable: false, properties: MATERIAL_PROPERTIES[MaterialId.Empty], colors: ['#fbf8ff'], update: updateStatic },
  { id: MaterialId.Sand, key: 'sand', label: 'Sand', paintable: true, properties: MATERIAL_PROPERTIES[MaterialId.Sand], colors: ['#d99836', '#efb956', '#c17c27'], update: updateSand },
  { id: MaterialId.Water, key: 'water', label: 'Water', paintable: true, properties: MATERIAL_PROPERTIES[MaterialId.Water], colors: ['#178fca', '#25aee3', '#167fb6'], update: updateWater },
  { id: MaterialId.Stone, key: 'stone', label: 'Stone', paintable: true, properties: MATERIAL_PROPERTIES[MaterialId.Stone], colors: ['#514b60', '#625b73', '#403b4e'], update: updateStatic },
  { id: MaterialId.Wood, key: 'wood', label: 'Wood', paintable: true, properties: MATERIAL_PROPERTIES[MaterialId.Wood], colors: ['#b87535', '#d18e43', '#925927'], update: updateWood },
  { id: MaterialId.Fire, key: 'fire', label: 'Fire', paintable: true, properties: MATERIAL_PROPERTIES[MaterialId.Fire], colors: ['#ff477f', '#ff6d4a', '#ffbe4f'], update: updateFire },
  { id: MaterialId.Smoke, key: 'smoke', label: 'Smoke', paintable: false, properties: MATERIAL_PROPERTIES[MaterialId.Smoke], colors: ['#81758e', '#998ca7', '#6f657b'], update: updateSmoke },
  { id: MaterialId.Oil, key: 'oil', label: 'Oil', paintable: true, properties: MATERIAL_PROPERTIES[MaterialId.Oil], colors: ['#5a4668', '#766080', '#3e334c'], update: updateOil },
  { id: MaterialId.Plant, key: 'plant', label: 'Plant', paintable: true, properties: MATERIAL_PROPERTIES[MaterialId.Plant], colors: ['#2f9b67', '#54bd75', '#237851'], update: updatePlant },
  { id: MaterialId.Acid, key: 'acid', label: 'Acid', paintable: true, properties: MATERIAL_PROPERTIES[MaterialId.Acid], colors: ['#9acc32', '#c7ed55', '#75a926'], update: updateAcid },
  { id: MaterialId.Metal, key: 'metal', label: 'Metal', paintable: true, properties: MATERIAL_PROPERTIES[MaterialId.Metal], colors: ['#7d8497', '#aab1c1', '#5d6373'], update: updateMetal },
  { id: MaterialId.Lava, key: 'lava', label: 'Lava', paintable: true, properties: MATERIAL_PROPERTIES[MaterialId.Lava], colors: ['#f13d35', '#ff7a35', '#ffc247'], update: updateLava },
  { id: MaterialId.Ice, key: 'ice', label: 'Ice', paintable: true, properties: MATERIAL_PROPERTIES[MaterialId.Ice], colors: ['#8edcf2', '#d5f5ff', '#61bddc'], update: updateIce },
  { id: MaterialId.Spark, key: 'spark', label: 'Spark', paintable: true, properties: MATERIAL_PROPERTIES[MaterialId.Spark], colors: ['#fff176', '#ffffff', '#ffca3a'], update: updateSpark },
  { id: MaterialId.Gunpowder, key: 'gunpowder', label: 'Gunpowder', paintable: true, properties: MATERIAL_PROPERTIES[MaterialId.Gunpowder], colors: ['#35303b', '#514958', '#211e29'], update: updateGunpowder },
  { id: MaterialId.Glass, key: 'glass', label: 'Glass', paintable: false, properties: MATERIAL_PROPERTIES[MaterialId.Glass], colors: ['#bceaf0', '#e5fbff', '#8fcfd8'], update: updateStatic },
  { id: MaterialId.Steam, key: 'steam', label: 'Steam', paintable: false, properties: MATERIAL_PROPERTIES[MaterialId.Steam], colors: ['#a9aec4', '#c7cada', '#858ca8'], update: updateSteam },
  { id: MaterialId.Salt, key: 'salt', label: 'Salt', paintable: true, properties: MATERIAL_PROPERTIES[MaterialId.Salt], colors: ['#f2ecff', '#ffffff', '#d7cfe5'], update: (world, context) => updatePowder(world, context, MaterialId.Salt) },
  { id: MaterialId.SaltWater, key: 'salt-water', label: 'Salt Water', paintable: true, properties: MATERIAL_PROPERTIES[MaterialId.SaltWater], colors: ['#277fb2', '#4bb8d1', '#356c9a'], update: (world, context) => updateFluid(world, context, MaterialId.SaltWater) },
  { id: MaterialId.Coal, key: 'coal', label: 'Coal', paintable: true, properties: MATERIAL_PROPERTIES[MaterialId.Coal], colors: ['#292431', '#3e3747', '#17141c'], update: (world, context) => updatePowder(world, context, MaterialId.Coal) },
  { id: MaterialId.Ash, key: 'ash', label: 'Ash', paintable: false, properties: MATERIAL_PROPERTIES[MaterialId.Ash], colors: ['#8f8996', '#b5aebb', '#6c6672'], update: (world, context) => updatePowder(world, context, MaterialId.Ash) },
  { id: MaterialId.Rubber, key: 'rubber', label: 'Rubber', paintable: true, properties: MATERIAL_PROPERTIES[MaterialId.Rubber], colors: ['#34303d', '#514a5b', '#211e29'], update: (world, context) => updateCombustibleSolid(world, context, MaterialId.Rubber) },
  { id: MaterialId.Copper, key: 'copper', label: 'Copper', paintable: false, properties: MATERIAL_PROPERTIES[MaterialId.Copper], colors: ['#b56d37', '#dc9252', '#824828'], update: updateMetal },
  { id: MaterialId.Battery, key: 'battery', label: 'Battery', paintable: true, properties: MATERIAL_PROPERTIES[MaterialId.Battery], colors: ['#4e5968', '#86e0c8', '#2d3440'], update: (world, context) => updateCombustibleSolid(world, context, MaterialId.Battery) },
  { id: MaterialId.Mercury, key: 'mercury', label: 'Mercury', paintable: false, properties: MATERIAL_PROPERTIES[MaterialId.Mercury], colors: ['#a6abb7', '#d6dae2', '#747b89'], update: (world, context) => updateFluid(world, context, MaterialId.Mercury) },
  { id: MaterialId.Alcohol, key: 'alcohol', label: 'Alcohol', paintable: true, properties: MATERIAL_PROPERTIES[MaterialId.Alcohol], colors: ['#b8d6ed', '#e4f5ff', '#83b9da'], update: (world, context) => updateFluid(world, context, MaterialId.Alcohol) },
  { id: MaterialId.AlcoholVapor, key: 'alcohol-vapor', label: 'Alcohol Vapor', paintable: true, properties: MATERIAL_PROPERTIES[MaterialId.AlcoholVapor], colors: ['#c6a8d7', '#e4c9ee', '#a385b8'], update: (world, context) => updateRisingFuel(world, context, MaterialId.AlcoholVapor) },
  { id: MaterialId.Sodium, key: 'sodium', label: 'Sodium', paintable: true, properties: MATERIAL_PROPERTIES[MaterialId.Sodium], colors: ['#d9d6c6', '#fffce5', '#aaa694'], update: (world, context) => updatePowder(world, context, MaterialId.Sodium) },
  { id: MaterialId.Hydrogen, key: 'hydrogen', label: 'Hydrogen', paintable: true, properties: MATERIAL_PROPERTIES[MaterialId.Hydrogen], colors: ['#d7c7ed', '#f4ebff', '#b29fce'], update: (world, context) => updateRisingFuel(world, context, MaterialId.Hydrogen) },
  { id: MaterialId.Soil, key: 'soil', label: 'Soil', paintable: true, properties: MATERIAL_PROPERTIES[MaterialId.Soil], colors: ['#6b4c37', '#8a6548', '#4d3528'], update: (world, context) => updatePowder(world, context, MaterialId.Soil) },
  { id: MaterialId.Foam, key: 'foam', label: 'Foam', paintable: false, properties: MATERIAL_PROPERTIES[MaterialId.Foam], colors: ['#dfeff2', '#ffffff', '#b9d9de'], update: (world, context) => updateFluid(world, context, MaterialId.Foam) },
  { id: MaterialId.Source, key: 'source', label: 'Source', paintable: true, properties: MATERIAL_PROPERTIES[MaterialId.Source], colors: ['#30293d', '#ff3f7e', '#47e1c2'], update: updateSource },
] as const satisfies readonly MaterialDefinition[]

export const MATERIAL_BY_ID = new Map<number, MaterialDefinition>(MATERIALS.map((material) => [material.id, material]))
export const PAINTABLE_MATERIALS = MATERIALS.filter((material) => material.paintable)

export function initializeTransientState(world: World, index: number, materialId: number): void {
  world.state[index] = 0
  world.status[index] = 0
  world.charge[index] = 0
  world.moisture[index] = 0
  world.phaseProgress[index] = 0
  world.thermalRemainder[index] = 0
  const properties = MATERIAL_PROPERTIES[materialId as MaterialIdValue]
  const initialTemperature = properties?.initialTemperature ?? AMBIENT_TEMPERATURE
  world.temperature[index] = initialTemperature === AMBIENT_TEMPERATURE
    ? world.ambientTemperature
    : initialTemperature
  world.fuel[index] = properties?.fuel ?? 0
  world.liquidMass[index] = properties?.phase === 'liquid' ? 255 : 0
  const solutionDefault = DEFAULT_SOLUTION_CONCENTRATION[materialId as MaterialIdValue]
  if (solutionDefault !== undefined) world.state[index] = solutionDefault
  if (properties?.chargeSource) world.electricalActive = true
  if (materialId === MaterialId.Fire) world.state[index] = randomInt(world, FIRE_LIFETIME_MIN, FIRE_LIFETIME_MAX)
  else if (materialId === MaterialId.Smoke) world.state[index] = randomInt(world, SMOKE_LIFETIME_MIN, SMOKE_LIFETIME_MAX)
  else if (materialId === MaterialId.Spark) world.state[index] = randomInt(world, 3, 6)
  markCellActivity(world, index, ActivityFlag.All, true)
}
