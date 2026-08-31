import { chance, randomInt } from './random'
import type { MaterialDefinition, MaterialProperties, UpdateContext, World } from './types'

export const MaterialId = {
  Empty: 0,
  Sand: 1,
  Water: 2,
  Stone: 3,
  Wood: 4,
  Fire: 5,
  Smoke: 6,
} as const

export type MaterialIdValue = (typeof MaterialId)[keyof typeof MaterialId]

export const BURN_PROGRESS_LIMIT = 110
export const FIRE_IGNITION_SCALE = 0.3
export const FIRE_FLASH_BURN_SCALE = 0.01875
export const BURNING_WOOD_SPREAD_SCALE = 0.0075
export const FIRE_LIFETIME_MIN = 38
export const FIRE_LIFETIME_MAX = 72
export const SMOKE_LIFETIME_MIN = 90
export const SMOKE_LIFETIME_MAX = 180
export const BURNING_FLAG = 0x8000
export const BURN_PROGRESS_MASK = 0x7fff

const inertProperties = {
  hardness: 0,
  conductivity: false,
  corrosiveness: 0,
  ignitionTemperature: null,
  flammability: 0,
  burnRate: 0,
  smokeYield: 0,
} as const

export const MATERIAL_PROPERTIES: Readonly<Record<MaterialIdValue, MaterialProperties>> = {
  [MaterialId.Empty]: {
    ...inertProperties,
    phase: 'vacuum',
    mobility: 'none',
    density: 0,
    friction: 0,
    temperature: 20,
  },
  [MaterialId.Sand]: {
    ...inertProperties,
    phase: 'solid',
    mobility: 'powder',
    density: 5,
    hardness: 0.25,
    friction: 0.7,
    temperature: 20,
  },
  [MaterialId.Water]: {
    ...inertProperties,
    phase: 'liquid',
    mobility: 'fluid',
    density: 2,
    friction: 0.04,
    conductivity: true,
    temperature: 20,
  },
  [MaterialId.Stone]: {
    ...inertProperties,
    phase: 'solid',
    mobility: 'immovable',
    density: 10,
    hardness: 1,
    friction: 0.95,
    temperature: 20,
  },
  [MaterialId.Wood]: {
    ...inertProperties,
    phase: 'solid',
    mobility: 'immovable',
    density: 8,
    hardness: 0.45,
    friction: 0.8,
    temperature: 20,
    ignitionTemperature: 300,
    flammability: 0.8,
    burnRate: 2,
    smokeYield: 0.035,
  },
  [MaterialId.Fire]: {
    ...inertProperties,
    phase: 'energy',
    mobility: 'rising',
    density: 0.02,
    friction: 0.05,
    temperature: 900,
  },
  [MaterialId.Smoke]: {
    ...inertProperties,
    phase: 'gas',
    mobility: 'rising',
    density: 0.01,
    friction: 0.12,
    temperature: 80,
  },
}

export const WOOD_BURN_DURATION = Math.ceil(
  BURN_PROGRESS_LIMIT / MATERIAL_PROPERTIES[MaterialId.Wood].burnRate,
)

function at(world: World, x: number, y: number): number {
  return y * world.width + x
}

function inBounds(world: World, x: number, y: number): boolean {
  return x >= 0 && x < world.width && y >= 0 && y < world.height
}

function move(world: World, source: number, destination: number): void {
  world.material[destination] = world.material[source]
  world.state[destination] = world.state[source]
  world.material[source] = MaterialId.Empty
  world.state[source] = 0
  world.updatedAt[source] = world.tick
  world.updatedAt[destination] = world.tick
}

function swap(world: World, first: number, second: number): void {
  const material = world.material[first]
  const state = world.state[first]
  world.material[first] = world.material[second]
  world.state[first] = world.state[second]
  world.material[second] = material
  world.state[second] = state
  world.updatedAt[first] = world.tick
  world.updatedAt[second] = world.tick
}

function empty(world: World, index: number): void {
  world.material[index] = MaterialId.Empty
  world.state[index] = 0
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

export type ReactionEffect = 'remove-source' | 'remove-target' | 'extinguish-source' | 'extinguish-target' | 'ignite-target' | 'transform-target'

export interface MaterialReaction {
  actor: MaterialIdValue
  target: MaterialIdValue
  effect: ReactionEffect
  chance: number
  scaleByFlammability?: boolean
  requiresBurningActor?: boolean
  heat?: number
  product?: MaterialIdValue
}

export const MATERIAL_REACTIONS: readonly MaterialReaction[] = [
  { actor: MaterialId.Water, target: MaterialId.Fire, effect: 'remove-target', chance: 1 },
  { actor: MaterialId.Fire, target: MaterialId.Water, effect: 'remove-source', chance: 1 },
  { actor: MaterialId.Water, target: MaterialId.Wood, effect: 'extinguish-target', chance: 1 },
  { actor: MaterialId.Wood, target: MaterialId.Water, effect: 'extinguish-source', chance: 1 },
  {
    actor: MaterialId.Fire,
    target: MaterialId.Wood,
    effect: 'transform-target',
    chance: FIRE_FLASH_BURN_SCALE,
    scaleByFlammability: true,
    product: MaterialId.Smoke,
  },
  {
    actor: MaterialId.Fire,
    target: MaterialId.Wood,
    effect: 'ignite-target',
    chance: FIRE_IGNITION_SCALE,
    scaleByFlammability: true,
  },
  {
    actor: MaterialId.Wood,
    target: MaterialId.Wood,
    effect: 'ignite-target',
    chance: BURNING_WOOD_SPREAD_SCALE,
    scaleByFlammability: true,
    requiresBurningActor: true,
    heat: 450,
  },
]

function reactionKey(actor: number, target: number): number {
  return (actor << 8) | target
}

const REACTIONS_BY_PAIR = new Map<number, readonly MaterialReaction[]>()
for (const reaction of MATERIAL_REACTIONS) {
  const key = reactionKey(reaction.actor, reaction.target)
  REACTIONS_BY_PAIR.set(key, [...(REACTIONS_BY_PAIR.get(key) ?? []), reaction])
}

function reactionCanApply(world: World, reaction: MaterialReaction, actorIndex: number, targetIndex: number): boolean {
  if (reaction.requiresBurningActor && !(world.state[actorIndex] & BURNING_FLAG)) return false
  if (reaction.effect === 'extinguish-source' && !(world.state[actorIndex] & BURNING_FLAG)) return false
  if (reaction.effect === 'extinguish-target' && !(world.state[targetIndex] & BURNING_FLAG)) return false
  if (reaction.effect === 'ignite-target' && (world.state[targetIndex] & BURNING_FLAG)) return false
  if (reaction.effect === 'ignite-target') {
    const targetProperties = MATERIAL_PROPERTIES[world.material[targetIndex] as MaterialIdValue]
    const actorProperties = MATERIAL_PROPERTIES[world.material[actorIndex] as MaterialIdValue]
    const heat = reaction.heat ?? actorProperties.temperature
    if (targetProperties.ignitionTemperature !== null && heat < targetProperties.ignitionTemperature) return false
  }
  return true
}

function applyReactionEffect(world: World, reaction: MaterialReaction, actorIndex: number, targetIndex: number): void {
  if (reaction.effect === 'remove-source') empty(world, actorIndex)
  else if (reaction.effect === 'remove-target') empty(world, targetIndex)
  else if (reaction.effect === 'extinguish-source') {
    world.state[actorIndex] &= BURN_PROGRESS_MASK
    world.updatedAt[actorIndex] = world.tick
  }
  else if (reaction.effect === 'extinguish-target') {
    world.state[targetIndex] &= BURN_PROGRESS_MASK
    world.updatedAt[targetIndex] = world.tick
  } else if (reaction.effect === 'ignite-target') {
    world.state[targetIndex] |= BURNING_FLAG
  } else if (reaction.effect === 'transform-target' && reaction.product !== undefined) {
    world.material[targetIndex] = reaction.product
    initializeTransientState(world, targetIndex, reaction.product)
    world.updatedAt[targetIndex] = world.tick
  }
}

export function reactMaterialPair(world: World, actorIndex: number, targetIndex: number): boolean {
  const actor = world.material[actorIndex]
  const target = world.material[targetIndex]
  const reactions = REACTIONS_BY_PAIR.get(reactionKey(actor, target))
  if (!reactions) return false

  let reacted = false
  for (const reaction of reactions) {
    if (world.material[actorIndex] !== actor || world.material[targetIndex] !== target) break
    if (!reactionCanApply(world, reaction, actorIndex, targetIndex)) continue
    const targetProperties = MATERIAL_PROPERTIES[target as MaterialIdValue]
    const probability = reaction.chance * (reaction.scaleByFlammability ? targetProperties.flammability : 1)
    if (!chance(world, probability)) continue
    applyReactionEffect(world, reaction, actorIndex, targetIndex)
    reacted = true
  }
  return reacted
}

function reactWithNeighbors(world: World, actorIndex: number, x: number, y: number): void {
  for (const targetIndex of neighbors(world, x, y)) {
    reactMaterialPair(world, actorIndex, targetIndex)
    if (world.material[actorIndex] === MaterialId.Empty) return
  }
}

function driftingVerticalAttempts(
  world: World,
  x: number,
  y: number,
  verticalDirection: -1 | 1,
  driftChance: number,
): readonly (readonly [number, number])[] {
  const horizontalDirection = chance(world, 0.5) ? 1 : -1
  const verticalY = y + verticalDirection
  return chance(world, driftChance)
    ? [[x + horizontalDirection, verticalY], [x, verticalY], [x - horizontalDirection, verticalY]]
    : [[x, verticalY], [x + horizontalDirection, verticalY], [x - horizontalDirection, verticalY]]
}

function driftChance(materialId: MaterialIdValue): number {
  return 0.15 + (1 - MATERIAL_PROPERTIES[materialId].friction) * 0.3
}

function canDisplace(movingMaterial: MaterialIdValue, targetMaterial: MaterialIdValue): boolean {
  const moving = MATERIAL_PROPERTIES[movingMaterial]
  const target = MATERIAL_PROPERTIES[targetMaterial]
  return (target.phase === 'liquid' || target.phase === 'gas') && moving.density > target.density
}

function updateStatic(world: World, context: UpdateContext): void {
  world.updatedAt[context.index] = world.tick
}

function updateWood(world: World, { index, x, y }: UpdateContext): void {
  reactWithNeighbors(world, index, x, y)
  const cellState = world.state[index]
  if (!(cellState & BURNING_FLAG)) {
    world.updatedAt[index] = world.tick
    return
  }

  const properties = MATERIAL_PROPERTIES[MaterialId.Wood]
  const progress = (cellState & BURN_PROGRESS_MASK) + properties.burnRate
  if (progress >= BURN_PROGRESS_LIMIT) {
    empty(world, index)
    return
  }

  world.state[index] = BURNING_FLAG | progress
  world.updatedAt[index] = world.tick

  if (!chance(world, properties.smokeYield)) return
  const candidates = [[x, y - 1], [x - 1, y - 1], [x + 1, y - 1]] as const
  for (const [targetX, targetY] of candidates) {
    if (!inBounds(world, targetX, targetY)) continue
    const target = at(world, targetX, targetY)
    if (world.material[target] !== MaterialId.Empty) continue
    world.material[target] = MaterialId.Smoke
    world.state[target] = randomInt(world, SMOKE_LIFETIME_MIN, SMOKE_LIFETIME_MAX)
    world.updatedAt[target] = world.tick
    break
  }
}

function updateSand(world: World, context: UpdateContext): void {
  const { index, x, y } = context
  if (y >= world.height - 1) return updateStatic(world, context)
  const attempts = driftingVerticalAttempts(world, x, y, 1, driftChance(MaterialId.Sand))
  for (const [targetX, targetY] of attempts) {
    if (!inBounds(world, targetX, targetY)) continue
    const target = at(world, targetX, targetY)
    if (world.material[target] === MaterialId.Empty) return move(world, index, target)
    if (canDisplace(MaterialId.Sand, world.material[target] as MaterialIdValue)) return swap(world, index, target)
  }
  world.updatedAt[index] = world.tick
}

interface FluidPath {
  drop: number
  dropDistance: number
  furthest: number
  run: number
}

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

function updateWater(world: World, { index, x, y }: UpdateContext): void {
  reactWithNeighbors(world, index, x, y)
  const attempts = y < world.height - 1
    ? driftingVerticalAttempts(world, x, y, 1, driftChance(MaterialId.Water))
    : []
  for (const [targetX, targetY] of attempts) {
    if (!inBounds(world, targetX, targetY)) continue
    const target = at(world, targetX, targetY)
    if (world.material[target] === MaterialId.Empty) return move(world, index, target)
  }

  const maximumDistance = Math.max(1, Math.round((1 - MATERIAL_PROPERTIES[MaterialId.Water].friction) * 12))
  const left = fluidPath(world, x, y, -1, maximumDistance)
  const right = fluidPath(world, x, y, 1, maximumDistance)
  const drops = [left, right].filter((path) => path.drop >= 0)
  if (drops.length > 0) {
    const shortest = Math.min(...drops.map((path) => path.dropDistance))
    const closest = drops.filter((path) => path.dropDistance === shortest)
    const destination = closest.length === 1 || chance(world, 0.5) ? closest[0].drop : closest[1].drop
    return move(world, index, destination)
  }

  const longestRun = Math.max(left.run, right.run)
  if (longestRun > 0) {
    const longest = [left, right].filter((path) => path.run === longestRun)
    const destination = longest.length === 1 || chance(world, 0.5) ? longest[0].furthest : longest[1].furthest
    return move(world, index, destination)
  }
  world.updatedAt[index] = world.tick
}

function updateFire(world: World, { index, x, y }: UpdateContext): void {
  reactWithNeighbors(world, index, x, y)
  if (world.material[index] === MaterialId.Empty) return
  const lifetime = world.state[index] || randomInt(world, FIRE_LIFETIME_MIN, FIRE_LIFETIME_MAX)
  if (lifetime <= 1) {
    empty(world, index)
    return
  }
  world.state[index] = lifetime - 1
  const attempts = driftingVerticalAttempts(world, x, y, -1, driftChance(MaterialId.Fire))
  for (const [targetX, targetY] of attempts) {
    if (!inBounds(world, targetX, targetY)) continue
    const target = at(world, targetX, targetY)
    if (world.material[target] === MaterialId.Empty) return move(world, index, target)
  }
  world.updatedAt[index] = world.tick
}

function updateSmoke(world: World, { index, x, y }: UpdateContext): void {
  const lifetime = world.state[index] || randomInt(world, SMOKE_LIFETIME_MIN, SMOKE_LIFETIME_MAX)
  if (lifetime <= 1) {
    empty(world, index)
    return
  }
  world.state[index] = lifetime - 1
  if (world.tick % 2 === 0) {
    const attempts = driftingVerticalAttempts(world, x, y, -1, driftChance(MaterialId.Smoke))
    for (const [targetX, targetY] of attempts) {
      if (!inBounds(world, targetX, targetY)) continue
      const target = at(world, targetX, targetY)
      if (world.material[target] === MaterialId.Empty) return move(world, index, target)
    }
  }
  world.updatedAt[index] = world.tick
}

export const MATERIALS = [
  { id: 0, key: 'empty', label: 'Empty', paintable: false, properties: MATERIAL_PROPERTIES[MaterialId.Empty], colors: ['#fbf8ff'], update: updateStatic },
  { id: 1, key: 'sand', label: 'Sand', paintable: true, properties: MATERIAL_PROPERTIES[MaterialId.Sand], colors: ['#d99836', '#efb956', '#c17c27'], update: updateSand },
  { id: 2, key: 'water', label: 'Water', paintable: true, properties: MATERIAL_PROPERTIES[MaterialId.Water], colors: ['#178fca', '#25aee3', '#167fb6'], update: updateWater },
  { id: 3, key: 'stone', label: 'Stone', paintable: true, properties: MATERIAL_PROPERTIES[MaterialId.Stone], colors: ['#514b60', '#625b73', '#403b4e'], update: updateStatic },
  { id: 4, key: 'wood', label: 'Wood', paintable: true, properties: MATERIAL_PROPERTIES[MaterialId.Wood], colors: ['#b87535', '#d18e43', '#925927'], update: updateWood },
  { id: 5, key: 'fire', label: 'Fire', paintable: true, properties: MATERIAL_PROPERTIES[MaterialId.Fire], colors: ['#ff477f', '#ff6d4a', '#ffbe4f'], update: updateFire },
  { id: 6, key: 'smoke', label: 'Smoke', paintable: false, properties: MATERIAL_PROPERTIES[MaterialId.Smoke], colors: ['#81758e', '#998ca7', '#6f657b'], update: updateSmoke },
] as const satisfies readonly MaterialDefinition[]

export const MATERIAL_BY_ID = new Map<number, MaterialDefinition>(MATERIALS.map((material) => [material.id, material]))
export const PAINTABLE_MATERIALS = MATERIALS.filter((material) => material.paintable)

export function initializeTransientState(world: World, index: number, materialId: number): void {
  if (materialId === MaterialId.Fire) world.state[index] = randomInt(world, FIRE_LIFETIME_MIN, FIRE_LIFETIME_MAX)
  else if (materialId === MaterialId.Smoke) world.state[index] = randomInt(world, SMOKE_LIFETIME_MIN, SMOKE_LIFETIME_MAX)
  else world.state[index] = 0
}
