import { AMBIENT_TEMPERATURE, MAXIMUM_TEMPERATURE, MINIMUM_TEMPERATURE } from './constants'
import { chance, randomInt } from './random'
import type { MaterialDefinition, MaterialProperties, UpdateContext, World } from './types'

export const MaterialId = {
  Empty: 0, Sand: 1, Water: 2, Stone: 3, Wood: 4, Fire: 5, Smoke: 6,
  Oil: 7, Plant: 8, Acid: 9, Metal: 10, Lava: 11, Ice: 12, Spark: 13,
  Gunpowder: 14, Glass: 15, Steam: 16,
} as const

export type MaterialIdValue = (typeof MaterialId)[keyof typeof MaterialId]

// Wet remains only for version 2/3 save migration. New behavior derives wetness from moisture.
export const StatusFlag = { Burning: 1 << 0, Wet: 1 << 1, Charged: 1 << 2 } as const
export const FIRE_LIFETIME_MIN = 38
export const FIRE_LIFETIME_MAX = 72
export const SMOKE_LIFETIME_MIN = 90
export const SMOKE_LIFETIME_MAX = 180
export const STEAM_LIFETIME_MIN = 180
export const STEAM_LIFETIME_MAX = 360

const inertProperties = {
  hardness: 0, conductivity: false, corrosiveness: 0,
  initialTemperature: AMBIENT_TEMPERATURE, thermalConductivity: 40, heatCapacity: 1, blastResistance: 0,
  phaseTransitions: [], ignitionTemperature: null, fuel: 0, burnRate: 0,
  combustionHeat: 0, smokeYield: 0, explosionRadius: 0, explosionHeat: 0, explosionPressure: 0,
  moistureCapacity: 0, moistureAbsorption: 0, moistureDiffusivity: 0,
} as const

export const MATERIAL_PROPERTIES: Readonly<Record<MaterialIdValue, MaterialProperties>> = {
  [MaterialId.Empty]: { ...inertProperties, phase: 'gas', mobility: 'none', density: 0, friction: 0 },
  [MaterialId.Sand]: {
    ...inertProperties, phase: 'solid', mobility: 'powder', density: 5, hardness: 0.25, friction: 0.7,
    thermalConductivity: 24, heatCapacity: 4, blastResistance: 0.18,
    phaseTransitions: [{ direction: 'above', temperature: 900, product: MaterialId.Glass, latentHeat: 320 }],
    moistureCapacity: 96, moistureAbsorption: 8, moistureDiffusivity: 18,
  },
  [MaterialId.Water]: {
    ...inertProperties, phase: 'liquid', mobility: 'fluid', density: 2, friction: 0.04, conductivity: true,
    thermalConductivity: 48, heatCapacity: 4, blastResistance: 0.12,
    phaseTransitions: [
      { direction: 'above', temperature: 100, product: MaterialId.Steam, latentHeat: 180 },
      { direction: 'below', temperature: -2, product: MaterialId.Ice, latentHeat: 120 },
    ],
  },
  [MaterialId.Stone]: {
    ...inertProperties, phase: 'solid', mobility: 'immovable', density: 10, hardness: 1, friction: 0.95,
    thermalConductivity: 96, heatCapacity: 8, blastResistance: 0.95,
    phaseTransitions: [{ direction: 'above', temperature: 1_000, product: MaterialId.Lava, latentHeat: 420 }],
  },
  [MaterialId.Wood]: {
    ...inertProperties, phase: 'solid', mobility: 'immovable', density: 8, hardness: 0.45, friction: 0.8,
    thermalConductivity: 20, heatCapacity: 3, blastResistance: 0.48,
    ignitionTemperature: 160, fuel: 255, burnRate: 3, combustionHeat: 20, smokeYield: 0.012,
    moistureCapacity: 180, moistureAbsorption: 32, moistureDiffusivity: 24,
  },
  [MaterialId.Fire]: {
    ...inertProperties, phase: 'energy', mobility: 'rising', density: 0.02, friction: 0.05,
    initialTemperature: 600, thermalConductivity: 48, blastResistance: 0,
  },
  [MaterialId.Smoke]: {
    ...inertProperties, phase: 'gas', mobility: 'rising', density: 0.01, friction: 0.12,
    initialTemperature: 120, thermalConductivity: 10, blastResistance: 0,
  },
  [MaterialId.Oil]: {
    ...inertProperties, phase: 'liquid', mobility: 'fluid', density: 1, friction: 0.025,
    thermalConductivity: 12, heatCapacity: 3, blastResistance: 0.08,
    ignitionTemperature: 145, fuel: 255, burnRate: 3, combustionHeat: 16, smokeYield: 0.012,
  },
  [MaterialId.Plant]: {
    ...inertProperties, phase: 'solid', mobility: 'immovable', density: 4, hardness: 0.1, friction: 0.75,
    thermalConductivity: 12, heatCapacity: 2, blastResistance: 0.16,
    ignitionTemperature: 180, fuel: 180, burnRate: 4, combustionHeat: 10, smokeYield: 0.008,
    moistureCapacity: 220, moistureAbsorption: 30, moistureDiffusivity: 28,
  },
  [MaterialId.Acid]: {
    ...inertProperties, phase: 'liquid', mobility: 'fluid', density: 2.5, friction: 0.055,
    corrosiveness: 1, thermalConductivity: 40, heatCapacity: 4, blastResistance: 0.08,
  },
  [MaterialId.Metal]: {
    ...inertProperties, phase: 'solid', mobility: 'immovable', density: 12, hardness: 0.9, friction: 0.98,
    conductivity: true, thermalConductivity: 255, heatCapacity: 10, blastResistance: 1.2,
  },
  [MaterialId.Lava]: {
    ...inertProperties, phase: 'liquid', mobility: 'fluid', density: 7, hardness: 0.15, friction: 0.11,
    initialTemperature: 1_200, thermalConductivity: 96, heatCapacity: 8, blastResistance: 0.42,
    phaseTransitions: [{ direction: 'below', temperature: 850, product: MaterialId.Stone, latentHeat: 360 }],
  },
  [MaterialId.Ice]: {
    ...inertProperties, phase: 'solid', mobility: 'powder', density: 1.6, hardness: 0.3, friction: 0.86,
    initialTemperature: -10, thermalConductivity: 76, heatCapacity: 5, blastResistance: 0.34,
    phaseTransitions: [{ direction: 'above', temperature: 2, product: MaterialId.Water, latentHeat: 120 }],
  },
  [MaterialId.Spark]: {
    ...inertProperties, phase: 'energy', mobility: 'rising', density: 0.005, friction: 0.02,
    initialTemperature: 800, thermalConductivity: 80, blastResistance: 0,
  },
  [MaterialId.Gunpowder]: {
    ...inertProperties, phase: 'solid', mobility: 'powder', density: 4, hardness: 0.15, friction: 0.62,
    thermalConductivity: 18, heatCapacity: 2, blastResistance: 0.05,
    ignitionTemperature: 160, fuel: 255, burnRate: 255, combustionHeat: 80, smokeYield: 0.02,
    explosionRadius: 5, explosionHeat: 1_600, explosionPressure: 1.35,
    moistureCapacity: 255, moistureAbsorption: 28, moistureDiffusivity: 72,
  },
  [MaterialId.Glass]: {
    ...inertProperties, phase: 'solid', mobility: 'immovable', density: 9, hardness: 0.85, friction: 0.92,
    thermalConductivity: 34, heatCapacity: 5, blastResistance: 0.2,
  },
  [MaterialId.Steam]: {
    ...inertProperties, phase: 'gas', mobility: 'rising', density: 0.015, friction: 0.035,
    initialTemperature: 110, thermalConductivity: 14, heatCapacity: 2, blastResistance: 0,
    phaseTransitions: [{ direction: 'below', temperature: 90, product: MaterialId.Water, latentHeat: 140 }],
  },
}

function at(world: World, x: number, y: number): number { return y * world.width + x }
function inBounds(world: World, x: number, y: number): boolean { return x >= 0 && x < world.width && y >= 0 && y < world.height }
function hasStatus(world: World, index: number, flag: number): boolean { return Boolean(world.status[index] & flag) }
function addStatus(world: World, index: number, flag: number): void { world.status[index] |= flag }
function clearStatus(world: World, index: number, flag: number): void {
  world.status[index] &= ~flag
  if (flag & StatusFlag.Charged) world.state[index] = 0
}

function swap(world: World, first: number, second: number): void {
  const material = world.material[first]
  const state = world.state[first]
  const status = world.status[first]
  const temperature = world.temperature[first]
  const moisture = world.moisture[first]
  const fuel = world.fuel[first]
  const liquidMass = world.liquidMass[first]
  const phaseProgress = world.phaseProgress[first]
  world.material[first] = world.material[second]
  world.state[first] = world.state[second]
  world.status[first] = world.status[second]
  world.temperature[first] = world.temperature[second]
  world.moisture[first] = world.moisture[second]
  world.fuel[first] = world.fuel[second]
  world.liquidMass[first] = world.liquidMass[second]
  world.phaseProgress[first] = world.phaseProgress[second]
  world.material[second] = material
  world.state[second] = state
  world.status[second] = status
  world.temperature[second] = temperature
  world.moisture[second] = moisture
  world.fuel[second] = fuel
  world.liquidMass[second] = liquidMass
  world.phaseProgress[second] = phaseProgress
  world.updatedAt[first] = world.tick
  world.updatedAt[second] = world.tick
}

function move(world: World, source: number, destination: number): void { swap(world, source, destination) }

export function emptyCell(world: World, index: number): void {
  world.material[index] = MaterialId.Empty
  world.state[index] = 0
  world.status[index] = 0
  world.moisture[index] = 0
  world.fuel[index] = 0
  world.liquidMass[index] = 0
  world.phaseProgress[index] = 0
  world.updatedAt[index] = world.tick
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
  const properties = MATERIAL_PROPERTIES[world.material[index] as MaterialIdValue]
  const change = Math.trunc(energy / Math.max(1, properties.heatCapacity))
  world.temperature[index] = Math.max(MINIMUM_TEMPERATURE, Math.min(MAXIMUM_TEMPERATURE, world.temperature[index] + change))
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

interface ReactionSideEffect { product?: MaterialIdValue }
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
  { materials: [MaterialId.Acid, MaterialId.Metal], initiator: MaterialId.Acid, chancePerSecond: 0.45, scaleByCorrosion: true, b: { product: MaterialId.Empty } },
  { materials: [MaterialId.Acid, MaterialId.Water], initiator: MaterialId.Acid, chancePerSecond: 0.3, a: { product: MaterialId.Water } },
]

function reactionKey(first: number, second: number): number { return (Math.min(first, second) << 8) | Math.max(first, second) }
const REACTIONS_BY_PAIR = new Map<number, readonly MaterialReaction[]>()
for (const reaction of MATERIAL_REACTIONS) {
  const key = reactionKey(...reaction.materials)
  REACTIONS_BY_PAIR.set(key, [...(REACTIONS_BY_PAIR.get(key) ?? []), reaction])
}

function applyReactionEffect(world: World, index: number, effect: ReactionSideEffect | undefined): void {
  if (effect?.product === undefined) return
  setMaterialCell(world, index, effect.product, world.temperature[index])
}

export function reactMaterialPair(world: World, actorIndex: number, targetIndex: number): boolean {
  const actor = world.material[actorIndex] as MaterialIdValue
  const target = world.material[targetIndex] as MaterialIdValue
  const reactions = REACTIONS_BY_PAIR.get(reactionKey(actor, target))
  if (!reactions) return false
  for (const reaction of reactions) {
    const initiators = Array.isArray(reaction.initiator) ? reaction.initiator : [reaction.initiator]
    if (!initiators.includes(actor)) continue
    const sameOrder = reaction.materials[0] === actor && reaction.materials[1] === target
    const aIndex = sameOrder ? actorIndex : targetIndex
    const bIndex = sameOrder ? targetIndex : actorIndex
    let probability = 1 - Math.pow(1 - reaction.chancePerSecond, 1 / 60)
    if (reaction.scaleByCorrosion) {
      const aProperties = MATERIAL_PROPERTIES[world.material[aIndex] as MaterialIdValue]
      const bProperties = MATERIAL_PROPERTIES[world.material[bIndex] as MaterialIdValue]
      probability *= Math.max(0, Math.min(1, aProperties.corrosiveness - bProperties.hardness * 0.5))
    }
    if (!chance(world, probability)) continue
    applyReactionEffect(world, aIndex, reaction.a)
    applyReactionEffect(world, bIndex, reaction.b)
    return true
  }
  return false
}

function reactWithNeighbors(world: World, actorIndex: number, x: number, y: number): void {
  for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
    for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
      if ((offsetX === 0 && offsetY === 0) || !inBounds(world, x + offsetX, y + offsetY)) continue
      reactMaterialPair(world, actorIndex, at(world, x + offsetX, y + offsetY))
      if (world.material[actorIndex] === MaterialId.Empty) return
    }
  }
}

function driftingVerticalAttempts(world: World, x: number, y: number, verticalDirection: -1 | 1, materialDriftChance: number): readonly (readonly [number, number])[] {
  const horizontalDirection = chance(world, 0.5) ? 1 : -1
  const verticalY = y + verticalDirection
  return chance(world, materialDriftChance)
    ? [[x + horizontalDirection, verticalY], [x, verticalY], [x - horizontalDirection, verticalY]]
    : [[x, verticalY], [x + horizontalDirection, verticalY], [x - horizontalDirection, verticalY]]
}
function driftChance(materialId: MaterialIdValue): number { return 0.15 + (1 - MATERIAL_PROPERTIES[materialId].friction) * 0.3 }
function canDisplace(movingMaterial: MaterialIdValue, targetMaterial: MaterialIdValue): boolean {
  const moving = MATERIAL_PROPERTIES[movingMaterial]
  const target = MATERIAL_PROPERTIES[targetMaterial]
  return (target.phase === 'liquid' || target.phase === 'gas') && moving.density > target.density
}
function updateStatic(world: World, context: UpdateContext): void { world.updatedAt[context.index] = world.tick }

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
      addTemperature(world, target, Math.round(source.explosionHeat * falloff))
      const targetProperties = MATERIAL_PROPERTIES[world.material[target] as MaterialIdValue]
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
  if (saturation >= 0.35 || world.temperature[index] < (properties.ignitionTemperature ?? 0) * 0.55) {
    clearStatus(world, index, StatusFlag.Burning)
    return false
  }
  const consumed = Math.min(world.fuel[index], properties.burnRate)
  if (consumed <= 0) { emptyCell(world, index); return true }
  world.fuel[index] -= consumed
  addTemperature(world, index, properties.combustionHeat * consumed)
  if (chance(world, properties.smokeYield)) emitSmoke(world, x, y)
  if (world.fuel[index] === 0) { emptyCell(world, index); return true }
  return false
}

function updateWood(world: World, context: UpdateContext): void {
  updateCombustion(world, context.index, context.x, context.y, MaterialId.Wood)
  world.updatedAt[context.index] = world.tick
}

function updatePlant(world: World, context: UpdateContext): void {
  const { index, x, y } = context
  if (updateCombustion(world, index, x, y, MaterialId.Plant)) return
  const nearbyWater = neighbors(world, x, y).find((target) => world.material[target] === MaterialId.Water)
  if (nearbyWater === undefined) {
    world.state[index] = Math.max(0, world.state[index] - 1)
    world.updatedAt[index] = world.tick
    return
  }
  world.state[index] = Math.min(120, world.state[index] + 1)
  if (world.state[index] >= 120) {
    const candidates = [[x, y - 1], [x - 1, y], [x + 1, y], [x, y + 1]] as const
    for (const [targetX, targetY] of candidates) {
      if (!inBounds(world, targetX, targetY)) continue
      const target = at(world, targetX, targetY)
      if (world.material[target] !== MaterialId.Empty) continue
      setMaterialCell(world, target, MaterialId.Plant)
      world.state[index] = 0
      if (chance(world, 0.1)) emptyCell(world, nearbyWater)
      break
    }
  }
  world.updatedAt[index] = world.tick
}

function updatePowder(world: World, context: UpdateContext, materialId: MaterialIdValue): void {
  const { index, x, y } = context
  if (y >= world.height - 1) return updateStatic(world, context)
  for (const [targetX, targetY] of driftingVerticalAttempts(world, x, y, 1, driftChance(materialId))) {
    if (!inBounds(world, targetX, targetY)) continue
    const target = at(world, targetX, targetY)
    if (world.material[target] === MaterialId.Empty) return move(world, index, target)
    if (canDisplace(materialId, world.material[target] as MaterialIdValue)) return swap(world, index, target)
  }
  world.updatedAt[index] = world.tick
}
function updateSand(world: World, context: UpdateContext): void { updatePowder(world, context, MaterialId.Sand) }
function updateIce(world: World, context: UpdateContext): void { updatePowder(world, context, MaterialId.Ice) }
function updateGunpowder(world: World, context: UpdateContext): void {
  if (updateCombustion(world, context.index, context.x, context.y, MaterialId.Gunpowder)) return
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

function warmNeighbors(world: World, x: number, y: number, energy: number): void {
  for (const target of neighbors(world, x, y)) addTemperature(world, target, energy)
}

function propagateCharge(world: World, index: number, x: number, y: number): void {
  if (!hasStatus(world, index, StatusFlag.Charged)) return
  const remaining = world.state[index]
  warmNeighbors(world, x, y, 24)
  clearStatus(world, index, StatusFlag.Charged)
  if (remaining <= 1) return
  const conductor = neighbors(world, x, y).find((target) => {
    const properties = MATERIAL_PROPERTIES[world.material[target] as MaterialIdValue]
    return properties.conductivity && !hasStatus(world, target, StatusFlag.Charged)
  })
  if (conductor === undefined) return
  addStatus(world, conductor, StatusFlag.Charged)
  world.state[conductor] = remaining - 1
  world.updatedAt[conductor] = world.tick
}

function updateFluid(world: World, context: UpdateContext, materialId: MaterialIdValue): void {
  const { index, x, y } = context
  if (materialId === MaterialId.Acid) reactWithNeighbors(world, index, x, y)
  if (world.material[index] !== materialId) return
  if (MATERIAL_PROPERTIES[materialId].conductivity) propagateCharge(world, index, x, y)
  if (materialId === MaterialId.Oil && updateCombustion(world, index, x, y, materialId)) return
  const attempts = y < world.height - 1 ? driftingVerticalAttempts(world, x, y, 1, driftChance(materialId)) : []
  for (const [targetX, targetY] of attempts) {
    if (!inBounds(world, targetX, targetY)) continue
    const target = at(world, targetX, targetY)
    if (world.material[target] === MaterialId.Empty) return move(world, index, target)
    if (canDisplace(materialId, world.material[target] as MaterialIdValue)) return swap(world, index, target)
  }
  const maximumDistance = Math.max(1, Math.round((1 - MATERIAL_PROPERTIES[materialId].friction) * 12))
  const left = fluidPath(world, x, y, -1, maximumDistance)
  const right = fluidPath(world, x, y, 1, maximumDistance)
  const drops = [left, right].filter((path) => path.drop >= 0)
  if (drops.length > 0) {
    const shortest = Math.min(...drops.map((path) => path.dropDistance))
    const closest = drops.filter((path) => path.dropDistance === shortest)
    return move(world, index, (closest.length === 1 || chance(world, 0.5) ? closest[0] : closest[1]).drop)
  }
  const longestRun = Math.max(left.run, right.run)
  if (longestRun > 0) {
    const longest = [left, right].filter((path) => path.run === longestRun)
    return move(world, index, (longest.length === 1 || chance(world, 0.5) ? longest[0] : longest[1]).furthest)
  }
  world.updatedAt[index] = world.tick
}
function updateWater(world: World, context: UpdateContext): void { updateFluid(world, context, MaterialId.Water) }
function updateOil(world: World, context: UpdateContext): void { updateFluid(world, context, MaterialId.Oil) }
function updateAcid(world: World, context: UpdateContext): void { updateFluid(world, context, MaterialId.Acid) }
function updateLava(world: World, context: UpdateContext): void { updateFluid(world, context, MaterialId.Lava) }
function updateMetal(world: World, context: UpdateContext): void {
  propagateCharge(world, context.index, context.x, context.y)
  world.updatedAt[context.index] = world.tick
}

function updateFire(world: World, { index, x, y }: UpdateContext): void {
  if (world.temperature[index] < 180) return emptyCell(world, index)
  const lifetime = world.state[index] || randomInt(world, FIRE_LIFETIME_MIN, FIRE_LIFETIME_MAX)
  if (lifetime <= 1) return emptyCell(world, index)
  world.state[index] = lifetime - 1
  for (const [targetX, targetY] of driftingVerticalAttempts(world, x, y, -1, driftChance(MaterialId.Fire))) {
    if (!inBounds(world, targetX, targetY)) continue
    const target = at(world, targetX, targetY)
    if (world.material[target] === MaterialId.Empty) return move(world, index, target)
  }
  world.updatedAt[index] = world.tick
}

function updateSmoke(world: World, { index, x, y }: UpdateContext): void {
  const lifetime = world.state[index] || randomInt(world, SMOKE_LIFETIME_MIN, SMOKE_LIFETIME_MAX)
  if (lifetime <= 1) return emptyCell(world, index)
  world.state[index] = lifetime - 1
  if (world.tick % 2 === 0) {
    for (const [targetX, targetY] of driftingVerticalAttempts(world, x, y, -1, driftChance(MaterialId.Smoke))) {
      if (!inBounds(world, targetX, targetY)) continue
      const target = at(world, targetX, targetY)
      if (world.material[target] === MaterialId.Empty) return move(world, index, target)
    }
  }
  world.updatedAt[index] = world.tick
}

function updateSteam(world: World, { index, x, y }: UpdateContext): void {
  const lifetime = world.state[index] || randomInt(world, STEAM_LIFETIME_MIN, STEAM_LIFETIME_MAX)
  if (lifetime <= 1) return emptyCell(world, index)
  world.state[index] = lifetime - 1
  for (const [targetX, targetY] of driftingVerticalAttempts(world, x, y, -1, driftChance(MaterialId.Steam))) {
    if (!inBounds(world, targetX, targetY)) continue
    const target = at(world, targetX, targetY)
    if (world.material[target] === MaterialId.Empty) return move(world, index, target)
  }
  world.updatedAt[index] = world.tick
}

function updateSpark(world: World, { index, x, y }: UpdateContext): void {
  const conductor = neighbors(world, x, y).find((target) => MATERIAL_PROPERTIES[world.material[target] as MaterialIdValue].conductivity)
  if (conductor !== undefined) {
    addStatus(world, conductor, StatusFlag.Charged)
    world.state[conductor] = world.material[conductor] === MaterialId.Metal ? 20 : 8
    world.updatedAt[conductor] = world.tick
    emptyCell(world, index)
    return
  }
  const lifetime = world.state[index] || randomInt(world, 3, 6)
  if (lifetime <= 1) return emptyCell(world, index)
  world.state[index] = lifetime - 1
  for (const [targetX, targetY] of driftingVerticalAttempts(world, x, y, -1, driftChance(MaterialId.Spark))) {
    if (!inBounds(world, targetX, targetY)) continue
    const target = at(world, targetX, targetY)
    if (world.material[target] === MaterialId.Empty) return move(world, index, target)
  }
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
  { id: MaterialId.Steam, key: 'steam', label: 'Steam', paintable: false, properties: MATERIAL_PROPERTIES[MaterialId.Steam], colors: ['#d8d6e3', '#f2eff8', '#bbb8ca'], update: updateSteam },
] as const satisfies readonly MaterialDefinition[]

export const MATERIAL_BY_ID = new Map<number, MaterialDefinition>(MATERIALS.map((material) => [material.id, material]))
export const PAINTABLE_MATERIALS = MATERIALS.filter((material) => material.paintable)

export function initializeTransientState(world: World, index: number, materialId: number): void {
  world.state[index] = 0
  world.status[index] = 0
  world.moisture[index] = 0
  world.phaseProgress[index] = 0
  const properties = MATERIAL_PROPERTIES[materialId as MaterialIdValue]
  world.temperature[index] = properties?.initialTemperature ?? AMBIENT_TEMPERATURE
  world.fuel[index] = properties?.fuel ?? 0
  world.liquidMass[index] = properties?.phase === 'liquid' ? 255 : 0
  if (materialId === MaterialId.Fire) world.state[index] = randomInt(world, FIRE_LIFETIME_MIN, FIRE_LIFETIME_MAX)
  else if (materialId === MaterialId.Smoke) world.state[index] = randomInt(world, SMOKE_LIFETIME_MIN, SMOKE_LIFETIME_MAX)
  else if (materialId === MaterialId.Steam) world.state[index] = randomInt(world, STEAM_LIFETIME_MIN, STEAM_LIFETIME_MAX)
  else if (materialId === MaterialId.Spark) world.state[index] = randomInt(world, 3, 6)
}
