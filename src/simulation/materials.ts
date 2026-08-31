import { chance, randomInt } from './random'
import type { MaterialDefinition, MaterialProperties, UpdateContext, World } from './types'

export const MaterialId = {
  Empty: 0, Sand: 1, Water: 2, Stone: 3, Wood: 4, Fire: 5, Smoke: 6,
  Oil: 7, Plant: 8, Acid: 9, Metal: 10, Lava: 11, Ice: 12, Spark: 13,
  Gunpowder: 14, Glass: 15, Steam: 16,
} as const

export type MaterialIdValue = (typeof MaterialId)[keyof typeof MaterialId]

export const StatusFlag = { Burning: 1 << 0, Wet: 1 << 1, Charged: 1 << 2 } as const
export const BURN_PROGRESS_LIMIT = 110
export const BURNING_WOOD_SPREAD_SCALE = 1 - Math.pow(1 - 0.08, 1 / 60)
export const FIRE_LIFETIME_MIN = 38
export const FIRE_LIFETIME_MAX = 72
export const SMOKE_LIFETIME_MIN = 90
export const SMOKE_LIFETIME_MAX = 180
export const STEAM_LIFETIME_MIN = 180
export const STEAM_LIFETIME_MAX = 360

const inertProperties = {
  hardness: 0, conductivity: false, corrosiveness: 0, initialHeat: 0, heatOutput: 0,
  heatCapacity: 1, coolingRate: 1, ignitionHeat: null, transitionHeat: null,
  transitionProduct: null, flammability: 0, burnRate: 0, smokeYield: 0,
} as const

export const MATERIAL_PROPERTIES: Readonly<Record<MaterialIdValue, MaterialProperties>> = {
  [MaterialId.Empty]: { ...inertProperties, phase: 'vacuum', mobility: 'none', density: 0, friction: 0 },
  [MaterialId.Sand]: {
    ...inertProperties, phase: 'solid', mobility: 'powder', density: 5, hardness: 0.25, friction: 0.7,
    heatCapacity: 4, transitionHeat: 180, transitionProduct: MaterialId.Glass,
  },
  [MaterialId.Water]: {
    ...inertProperties, phase: 'liquid', mobility: 'fluid', density: 2, friction: 0.04, conductivity: true,
    heatCapacity: 2, coolingRate: 4, transitionHeat: 180, transitionProduct: MaterialId.Steam,
  },
  [MaterialId.Stone]: {
    ...inertProperties, phase: 'solid', mobility: 'immovable', density: 10, hardness: 1, friction: 0.95, heatCapacity: 6,
  },
  [MaterialId.Wood]: {
    ...inertProperties, phase: 'solid', mobility: 'immovable', density: 8, hardness: 0.45, friction: 0.8,
    heatOutput: 1, heatCapacity: 2, ignitionHeat: 80, flammability: 0.8, burnRate: 2, smokeYield: 0.035,
  },
  [MaterialId.Fire]: {
    ...inertProperties, phase: 'energy', mobility: 'rising', density: 0.02, friction: 0.05,
    initialHeat: 255, heatOutput: 3, coolingRate: 0,
  },
  [MaterialId.Smoke]: {
    ...inertProperties, phase: 'gas', mobility: 'rising', density: 0.01, friction: 0.12, initialHeat: 30, coolingRate: 2,
  },
  [MaterialId.Oil]: {
    ...inertProperties, phase: 'liquid', mobility: 'fluid', density: 1, friction: 0.025,
    heatOutput: 5, ignitionHeat: 22, flammability: 1, burnRate: 1, smokeYield: 0.018,
  },
  [MaterialId.Plant]: {
    ...inertProperties, phase: 'solid', mobility: 'immovable', density: 4, hardness: 0.1, friction: 0.75,
    heatOutput: 2, ignitionHeat: 30, flammability: 0.95, burnRate: 3, smokeYield: 0.015,
  },
  [MaterialId.Acid]: {
    ...inertProperties, phase: 'liquid', mobility: 'fluid', density: 2.5, friction: 0.055,
    corrosiveness: 1, heatCapacity: 2, coolingRate: 3,
  },
  [MaterialId.Metal]: {
    ...inertProperties, phase: 'solid', mobility: 'immovable', density: 12, hardness: 0.9, friction: 0.98,
    conductivity: true, heatCapacity: 5,
  },
  [MaterialId.Lava]: {
    ...inertProperties, phase: 'liquid', mobility: 'fluid', density: 7, hardness: 0.15, friction: 0.11,
    initialHeat: 255, heatOutput: 16, heatCapacity: 5, coolingRate: 0,
  },
  [MaterialId.Ice]: {
    ...inertProperties, phase: 'solid', mobility: 'powder', density: 1.6, hardness: 0.3, friction: 0.86,
    coolingRate: 8, transitionHeat: 45, transitionProduct: MaterialId.Water,
  },
  [MaterialId.Spark]: {
    ...inertProperties, phase: 'energy', mobility: 'rising', density: 0.005, friction: 0.02,
    initialHeat: 255, heatOutput: 30, coolingRate: 0,
  },
  [MaterialId.Gunpowder]: {
    ...inertProperties, phase: 'solid', mobility: 'powder', density: 4, hardness: 0.15, friction: 0.62,
    heatOutput: 8, ignitionHeat: 28, flammability: 1, burnRate: BURN_PROGRESS_LIMIT, smokeYield: 0.04,
  },
  [MaterialId.Glass]: {
    ...inertProperties, phase: 'solid', mobility: 'immovable', density: 9, hardness: 0.85, friction: 0.92, heatCapacity: 5,
  },
  [MaterialId.Steam]: {
    ...inertProperties, phase: 'gas', mobility: 'rising', density: 0.015, friction: 0.035,
    initialHeat: 180, heatCapacity: 1, coolingRate: 8,
  },
}

export const WOOD_BURN_DURATION = Math.ceil(BURN_PROGRESS_LIMIT / MATERIAL_PROPERTIES[MaterialId.Wood].burnRate)

function at(world: World, x: number, y: number): number { return y * world.width + x }
function inBounds(world: World, x: number, y: number): boolean { return x >= 0 && x < world.width && y >= 0 && y < world.height }
function hasStatus(world: World, index: number, flag: number): boolean { return Boolean(world.status[index] & flag) }
function addStatus(world: World, index: number, flag: number): void { world.status[index] |= flag }
function clearStatus(world: World, index: number, flag: number): void {
  world.status[index] &= ~flag
  if (flag & (StatusFlag.Burning | StatusFlag.Charged)) world.state[index] = 0
}

function move(world: World, source: number, destination: number): void {
  world.material[destination] = world.material[source]
  world.state[destination] = world.state[source]
  world.status[destination] = world.status[source]
  world.heat[destination] = world.heat[source]
  world.material[source] = MaterialId.Empty
  world.state[source] = 0
  world.status[source] = 0
  world.heat[source] = 0
  world.updatedAt[source] = world.tick
  world.updatedAt[destination] = world.tick
}

function swap(world: World, first: number, second: number): void {
  const material = world.material[first]
  const state = world.state[first]
  const status = world.status[first]
  const heat = world.heat[first]
  world.material[first] = world.material[second]
  world.state[first] = world.state[second]
  world.status[first] = world.status[second]
  world.heat[first] = world.heat[second]
  world.material[second] = material
  world.state[second] = state
  world.status[second] = status
  world.heat[second] = heat
  world.updatedAt[first] = world.tick
  world.updatedAt[second] = world.tick
}

function empty(world: World, index: number): void {
  world.material[index] = MaterialId.Empty
  world.state[index] = 0
  world.status[index] = 0
  world.heat[index] = 0
  world.updatedAt[index] = world.tick
}

function setMaterial(world: World, index: number, materialId: MaterialIdValue, preservedHeat = 0): void {
  if (materialId === MaterialId.Empty) return empty(world, index)
  world.material[index] = materialId
  initializeTransientState(world, index, materialId)
  world.heat[index] = Math.max(preservedHeat, MATERIAL_PROPERTIES[materialId].initialHeat)
  world.updatedAt[index] = world.tick
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

interface ReactionSideEffect {
  product?: MaterialIdValue
  addStatus?: number
  clearStatus?: number
  heatDelta?: number
  resetState?: boolean
}

export interface MaterialReaction {
  materials: readonly [MaterialIdValue, MaterialIdValue]
  initiator: MaterialIdValue | readonly MaterialIdValue[]
  instant?: boolean
  chancePerSecond?: number
  aStatusAll?: number
  aStatusNone?: number
  bStatusAll?: number
  bStatusNone?: number
  scaleByCorrosion?: boolean
  scaleByFlammability?: boolean
  a?: ReactionSideEffect
  b?: ReactionSideEffect
}

export const MATERIAL_REACTIONS: readonly MaterialReaction[] = [
  { materials: [MaterialId.Water, MaterialId.Fire], initiator: [MaterialId.Water, MaterialId.Fire], instant: true, a: { heatDelta: 45 }, b: { product: MaterialId.Empty } },
  { materials: [MaterialId.Water, MaterialId.Wood], initiator: MaterialId.Water, instant: true, bStatusAll: StatusFlag.Burning, b: { clearStatus: StatusFlag.Burning, heatDelta: -60, resetState: true } },
  { materials: [MaterialId.Water, MaterialId.Plant], initiator: MaterialId.Water, instant: true, bStatusAll: StatusFlag.Burning, b: { clearStatus: StatusFlag.Burning, heatDelta: -60, resetState: true } },
  { materials: [MaterialId.Water, MaterialId.Oil], initiator: MaterialId.Water, instant: true, bStatusAll: StatusFlag.Burning, b: { clearStatus: StatusFlag.Burning, heatDelta: -60, resetState: true } },
  { materials: [MaterialId.Water, MaterialId.Gunpowder], initiator: MaterialId.Water, instant: true, b: { addStatus: StatusFlag.Wet, clearStatus: StatusFlag.Burning, heatDelta: -80, resetState: true } },
  { materials: [MaterialId.Fire, MaterialId.Wood], initiator: MaterialId.Fire, chancePerSecond: 0.03, bStatusNone: StatusFlag.Burning, scaleByFlammability: true, b: { product: MaterialId.Smoke } },
  { materials: [MaterialId.Wood, MaterialId.Wood], initiator: MaterialId.Wood, chancePerSecond: 0.08, aStatusAll: StatusFlag.Burning, bStatusNone: StatusFlag.Burning, scaleByFlammability: true, b: { addStatus: StatusFlag.Burning, resetState: true } },
  { materials: [MaterialId.Acid, MaterialId.Plant], initiator: MaterialId.Acid, chancePerSecond: 0.85, scaleByCorrosion: true, b: { product: MaterialId.Empty } },
  { materials: [MaterialId.Acid, MaterialId.Wood], initiator: MaterialId.Acid, chancePerSecond: 0.15, scaleByCorrosion: true, b: { product: MaterialId.Empty } },
  { materials: [MaterialId.Acid, MaterialId.Metal], initiator: MaterialId.Acid, chancePerSecond: 0.45, scaleByCorrosion: true, b: { product: MaterialId.Empty } },
  { materials: [MaterialId.Acid, MaterialId.Water], initiator: MaterialId.Acid, chancePerSecond: 0.3, a: { product: MaterialId.Water } },
  { materials: [MaterialId.Lava, MaterialId.Water], initiator: [MaterialId.Lava, MaterialId.Water], instant: true, a: { product: MaterialId.Stone }, b: { product: MaterialId.Steam } },
  { materials: [MaterialId.Lava, MaterialId.Ice], initiator: [MaterialId.Lava, MaterialId.Ice], instant: true, a: { product: MaterialId.Stone }, b: { product: MaterialId.Steam } },
  { materials: [MaterialId.Steam, MaterialId.Ice], initiator: [MaterialId.Steam, MaterialId.Ice], instant: true, a: { product: MaterialId.Water, heatDelta: -255 }, b: { product: MaterialId.Water, heatDelta: -255 } },
]

function reactionKey(first: number, second: number): number { return (Math.min(first, second) << 8) | Math.max(first, second) }
const REACTIONS_BY_PAIR = new Map<number, readonly MaterialReaction[]>()
for (const reaction of MATERIAL_REACTIONS) {
  const key = reactionKey(...reaction.materials)
  REACTIONS_BY_PAIR.set(key, [...(REACTIONS_BY_PAIR.get(key) ?? []), reaction])
}

function statusMatches(status: number, all = 0, none = 0): boolean { return (status & all) === all && (status & none) === 0 }
function applyReactionEffect(world: World, index: number, effect: ReactionSideEffect | undefined): void {
  if (!effect) return
  const previousHeat = world.heat[index]
  if (effect.product !== undefined) setMaterial(world, index, effect.product, previousHeat)
  if (world.material[index] === MaterialId.Empty) return
  if (effect.addStatus) addStatus(world, index, effect.addStatus)
  if (effect.clearStatus) clearStatus(world, index, effect.clearStatus)
  if (effect.resetState) world.state[index] = 0
  if (effect.heatDelta) world.heat[index] = Math.max(0, Math.min(255, world.heat[index] + effect.heatDelta))
  world.updatedAt[index] = world.tick
}

export function reactMaterialPair(world: World, actorIndex: number, targetIndex: number): boolean {
  const actor = world.material[actorIndex] as MaterialIdValue
  const target = world.material[targetIndex] as MaterialIdValue
  const reactions = REACTIONS_BY_PAIR.get(reactionKey(actor, target))
  if (!reactions) return false
  let reacted = false
  for (const reaction of reactions) {
    const initiators = Array.isArray(reaction.initiator) ? reaction.initiator : [reaction.initiator]
    if (!initiators.includes(actor)) continue
    const sameOrder = reaction.materials[0] === actor && reaction.materials[1] === target
    const aIndex = sameOrder ? actorIndex : targetIndex
    const bIndex = sameOrder ? targetIndex : actorIndex
    if (!statusMatches(world.status[aIndex], reaction.aStatusAll, reaction.aStatusNone)) continue
    if (!statusMatches(world.status[bIndex], reaction.bStatusAll, reaction.bStatusNone)) continue
    let probability = reaction.instant ? 1 : 1 - Math.pow(1 - (reaction.chancePerSecond ?? 0), 1 / 60)
    if (reaction.scaleByCorrosion) {
      const aProperties = MATERIAL_PROPERTIES[world.material[aIndex] as MaterialIdValue]
      const bProperties = MATERIAL_PROPERTIES[world.material[bIndex] as MaterialIdValue]
      probability *= Math.max(0, Math.min(1, aProperties.corrosiveness - bProperties.hardness * 0.5))
    }
    if (reaction.scaleByFlammability) probability *= MATERIAL_PROPERTIES[world.material[bIndex] as MaterialIdValue].flammability
    if (probability < 1 && !chance(world, probability)) continue
    applyReactionEffect(world, aIndex, reaction.a)
    applyReactionEffect(world, bIndex, reaction.b)
    reacted = true
    if (world.material[actorIndex] !== actor || world.material[targetIndex] !== target) break
  }
  return reacted
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

function addHeat(world: World, index: number, amount: number): void {
  if (world.material[index] === MaterialId.Empty || amount <= 0) return
  const capacity = Math.max(1, MATERIAL_PROPERTIES[world.material[index] as MaterialIdValue].heatCapacity)
  world.heat[index] = Math.min(255, world.heat[index] + Math.max(1, Math.ceil(amount / capacity)))
}
function emitHeat(world: World, x: number, y: number, amount: number): void {
  if (amount <= 0) return
  for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
    for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
      if ((offsetX === 0 && offsetY === 0) || !inBounds(world, x + offsetX, y + offsetY)) continue
      addHeat(world, at(world, x + offsetX, y + offsetY), amount)
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
    setMaterial(world, target, MaterialId.Smoke)
    break
  }
}

function explodeGunpowder(world: World, index: number, x: number, y: number): void {
  setMaterial(world, index, MaterialId.Fire)
  const radius = 4
  for (let targetY = Math.max(0, y - radius); targetY <= Math.min(world.height - 1, y + radius); targetY += 1) {
    for (let targetX = Math.max(0, x - radius); targetX <= Math.min(world.width - 1, x + radius); targetX += 1) {
      if ((targetX - x) ** 2 + (targetY - y) ** 2 > radius * radius || (targetX === x && targetY === y)) continue
      const target = at(world, targetX, targetY)
      const material = world.material[target] as MaterialIdValue
      if (material === MaterialId.Gunpowder) {
        clearStatus(world, target, StatusFlag.Wet)
        addStatus(world, target, StatusFlag.Burning)
        world.heat[target] = Math.max(world.heat[target], MATERIAL_PROPERTIES[MaterialId.Gunpowder].ignitionHeat ?? 0)
        world.updatedAt[target] = world.tick
      } else if (MATERIAL_PROPERTIES[material].flammability > 0) addHeat(world, target, 90)
      else if (material === MaterialId.Empty && chance(world, 0.025)) setMaterial(world, target, MaterialId.Fire)
    }
  }
}

function updateCombustion(world: World, index: number, x: number, y: number, materialId: MaterialIdValue): boolean {
  if (!hasStatus(world, index, StatusFlag.Burning)) return false
  if (hasStatus(world, index, StatusFlag.Wet)) { clearStatus(world, index, StatusFlag.Burning); return false }
  if (materialId === MaterialId.Gunpowder) { explodeGunpowder(world, index, x, y); return true }
  const properties = MATERIAL_PROPERTIES[materialId]
  const progress = world.state[index] + properties.burnRate
  if (progress >= BURN_PROGRESS_LIMIT) { empty(world, index); return true }
  world.state[index] = progress
  world.heat[index] = Math.max(world.heat[index], properties.ignitionHeat ?? 0)
  const heatInterval = materialId === MaterialId.Oil ? 1 : materialId === MaterialId.Plant ? 3 : 8
  if (world.tick % heatInterval === 0) emitHeat(world, x, y, properties.heatOutput)
  if (chance(world, properties.smokeYield)) emitSmoke(world, x, y)
  return false
}

function updateWood(world: World, context: UpdateContext): void {
  reactWithNeighbors(world, context.index, context.x, context.y)
  if (updateCombustion(world, context.index, context.x, context.y, MaterialId.Wood)) return
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
      setMaterial(world, target, MaterialId.Plant)
      world.state[index] = 0
      if (chance(world, 0.1)) empty(world, nearbyWater)
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
  const { index, x, y } = context
  if (hasStatus(world, index, StatusFlag.Wet)) {
    const touchingWater = neighbors(world, x, y).some((target) => world.material[target] === MaterialId.Water)
    if (!touchingWater && chance(world, 1 - Math.pow(1 - 0.35, 1 / 60))) clearStatus(world, index, StatusFlag.Wet)
  }
  if (updateCombustion(world, index, x, y, MaterialId.Gunpowder)) return
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

function propagateCharge(world: World, index: number, x: number, y: number): void {
  if (!hasStatus(world, index, StatusFlag.Charged)) return
  const remaining = world.state[index]
  emitHeat(world, x, y, 12)
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
  reactWithNeighbors(world, index, x, y)
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
function updateLava(world: World, context: UpdateContext): void {
  emitHeat(world, context.x, context.y, MATERIAL_PROPERTIES[MaterialId.Lava].heatOutput)
  updateFluid(world, context, MaterialId.Lava)
}
function updateMetal(world: World, context: UpdateContext): void {
  propagateCharge(world, context.index, context.x, context.y)
  world.updatedAt[context.index] = world.tick
}

function updateFire(world: World, { index, x, y }: UpdateContext): void {
  emitHeat(world, x, y, MATERIAL_PROPERTIES[MaterialId.Fire].heatOutput)
  reactWithNeighbors(world, index, x, y)
  if (world.material[index] === MaterialId.Empty) return
  const lifetime = world.state[index] || randomInt(world, FIRE_LIFETIME_MIN, FIRE_LIFETIME_MAX)
  if (lifetime <= 1) return empty(world, index)
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
  if (lifetime <= 1) return empty(world, index)
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
  reactWithNeighbors(world, index, x, y)
  if (world.material[index] !== MaterialId.Steam) return
  const lifetime = world.state[index] || randomInt(world, STEAM_LIFETIME_MIN, STEAM_LIFETIME_MAX)
  if (lifetime <= 1) {
    if (world.heat[index] <= 60) setMaterial(world, index, MaterialId.Water, world.heat[index])
    else empty(world, index)
    return
  }
  world.state[index] = lifetime - 1
  for (const [targetX, targetY] of driftingVerticalAttempts(world, x, y, -1, driftChance(MaterialId.Steam))) {
    if (!inBounds(world, targetX, targetY)) continue
    const target = at(world, targetX, targetY)
    if (world.material[target] === MaterialId.Empty) return move(world, index, target)
  }
  world.updatedAt[index] = world.tick
}

function updateSpark(world: World, { index, x, y }: UpdateContext): void {
  emitHeat(world, x, y, MATERIAL_PROPERTIES[MaterialId.Spark].heatOutput)
  const conductor = neighbors(world, x, y).find((target) => MATERIAL_PROPERTIES[world.material[target] as MaterialIdValue].conductivity)
  if (conductor !== undefined) {
    addStatus(world, conductor, StatusFlag.Charged)
    world.state[conductor] = world.material[conductor] === MaterialId.Metal ? 20 : 8
    world.updatedAt[conductor] = world.tick
    empty(world, index)
    return
  }
  const lifetime = world.state[index] || randomInt(world, 3, 6)
  if (lifetime <= 1) return empty(world, index)
  world.state[index] = lifetime - 1
  for (const [targetX, targetY] of driftingVerticalAttempts(world, x, y, -1, driftChance(MaterialId.Spark))) {
    if (!inBounds(world, targetX, targetY)) continue
    const target = at(world, targetX, targetY)
    if (world.material[target] === MaterialId.Empty) return move(world, index, target)
  }
  world.updatedAt[index] = world.tick
}

export function updateThermalWorld(world: World): void {
  const coolThisTick = world.tick % 4 === 0
  for (let index = 0; index < world.material.length; index += 1) {
    let materialId = world.material[index] as MaterialIdValue
    if (materialId === MaterialId.Empty) { world.heat[index] = 0; world.status[index] = 0; continue }
    let properties = MATERIAL_PROPERTIES[materialId]
    if (coolThisTick && properties.coolingRate > 0 && world.heat[index] > 0) world.heat[index] = Math.max(0, world.heat[index] - properties.coolingRate)
    if (properties.transitionHeat !== null && properties.transitionProduct !== null && world.heat[index] >= properties.transitionHeat) {
      const retainedHeat = world.heat[index]
      setMaterial(world, index, properties.transitionProduct as MaterialIdValue, retainedHeat)
      materialId = world.material[index] as MaterialIdValue
      properties = MATERIAL_PROPERTIES[materialId]
    }
    if (properties.ignitionHeat !== null && world.heat[index] >= properties.ignitionHeat && !hasStatus(world, index, StatusFlag.Burning) && !hasStatus(world, index, StatusFlag.Wet)) {
      addStatus(world, index, StatusFlag.Burning)
      world.state[index] = 0
    }
  }
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
  const properties = MATERIAL_PROPERTIES[materialId as MaterialIdValue]
  world.heat[index] = properties?.initialHeat ?? 0
  if (materialId === MaterialId.Fire) world.state[index] = randomInt(world, FIRE_LIFETIME_MIN, FIRE_LIFETIME_MAX)
  else if (materialId === MaterialId.Smoke) world.state[index] = randomInt(world, SMOKE_LIFETIME_MIN, SMOKE_LIFETIME_MAX)
  else if (materialId === MaterialId.Steam) world.state[index] = randomInt(world, STEAM_LIFETIME_MIN, STEAM_LIFETIME_MAX)
  else if (materialId === MaterialId.Spark) world.state[index] = randomInt(world, 3, 6)
}
