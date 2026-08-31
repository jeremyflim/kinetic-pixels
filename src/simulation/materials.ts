import { chance, randomInt } from './random'
import type { MaterialDefinition, UpdateContext, World } from './types'

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

export const IGNITION_CHANCE = 0.24
export const FLASH_BURN_CHANCE = 0.015
export const BURN_SPREAD_CHANCE = 0.08
export const WOOD_BURN_DURATION = 110
export const EMISSION_INTERVAL = 5
export const FIRE_DRIFT_CHANCE = 0.4
export const WATER_SPREAD_DISTANCE = 6
export const FIRE_LIFETIME_MIN = 38
export const FIRE_LIFETIME_MAX = 72
export const SMOKE_LIFETIME_MIN = 90
export const SMOKE_LIFETIME_MAX = 180
export const BURNING_FLAG = 0x8000
export const BURN_PROGRESS_MASK = 0x7fff

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

function updateStatic(world: World, context: UpdateContext): void {
  world.updatedAt[context.index] = world.tick
}

function updateWood(world: World, { index, x, y }: UpdateContext): void {
  let cellState = world.state[index]
  if (!(cellState & BURNING_FLAG)) {
    world.updatedAt[index] = world.tick
    return
  }

  const adjacent = neighbors(world, x, y)
  if (adjacent.some((neighbor) => world.material[neighbor] === MaterialId.Water)) {
    world.state[index] = cellState & BURN_PROGRESS_MASK
    world.updatedAt[index] = world.tick
    return
  }

  for (const neighbor of adjacent) {
    if (world.material[neighbor] !== MaterialId.Wood || (world.state[neighbor] & BURNING_FLAG)) continue
    if (chance(world, BURN_SPREAD_CHANCE)) {
      world.state[neighbor] |= BURNING_FLAG
    }
  }

  const progress = (cellState & BURN_PROGRESS_MASK) + 1
  if (progress >= WOOD_BURN_DURATION) {
    empty(world, index)
    return
  }

  world.state[index] = BURNING_FLAG | progress
  world.updatedAt[index] = world.tick

  if (progress % EMISSION_INTERVAL !== 0) return
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

function updateSand(world: World, { index, x, y, direction }: UpdateContext): void {
  if (y >= world.height - 1) return updateStatic(world, { index, x, y, direction })
  const below = at(world, x, y + 1)
  if (world.material[below] === MaterialId.Empty) return move(world, index, below)
  if (world.material[below] === MaterialId.Water) return swap(world, index, below)

  const directions = [direction, -direction] as const
  for (const offsetX of directions) {
    const targetX = x + offsetX
    if (!inBounds(world, targetX, y + 1)) continue
    const target = at(world, targetX, y + 1)
    if (world.material[target] === MaterialId.Empty) return move(world, index, target)
    if (world.material[target] === MaterialId.Water) return swap(world, index, target)
  }
  world.updatedAt[index] = world.tick
}

function extinguishAroundWater(world: World, x: number, y: number): void {
  for (const neighbor of neighbors(world, x, y)) {
    if (world.material[neighbor] === MaterialId.Fire) empty(world, neighbor)
    if (world.material[neighbor] === MaterialId.Wood && (world.state[neighbor] & BURNING_FLAG)) {
      world.state[neighbor] &= BURN_PROGRESS_MASK
      world.updatedAt[neighbor] = world.tick
    }
  }
}

function updateWater(world: World, { index, x, y, direction }: UpdateContext): void {
  extinguishAroundWater(world, x, y)
  const attempts = y < world.height - 1
    ? [[x, y + 1], [x + direction, y + 1], [x - direction, y + 1]]
    : []
  for (const [targetX, targetY] of attempts) {
    if (!inBounds(world, targetX, targetY)) continue
    const target = at(world, targetX, targetY)
    if (world.material[target] === MaterialId.Empty) return move(world, index, target)
  }

  for (const lateralDirection of [direction, -direction]) {
    let destination = -1
    for (let distance = 1; distance <= WATER_SPREAD_DISTANCE; distance += 1) {
      const targetX = x + lateralDirection * distance
      if (!inBounds(world, targetX, y)) break
      const target = at(world, targetX, y)
      if (world.material[target] !== MaterialId.Empty) break
      destination = target
    }
    if (destination >= 0) return move(world, index, destination)
  }
  world.updatedAt[index] = world.tick
}

function igniteAdjacentWood(world: World, x: number, y: number): void {
  for (const neighbor of neighbors(world, x, y)) {
    if (world.material[neighbor] !== MaterialId.Wood) continue
    if (chance(world, FLASH_BURN_CHANCE)) {
      world.material[neighbor] = MaterialId.Smoke
      world.state[neighbor] = randomInt(world, SMOKE_LIFETIME_MIN, SMOKE_LIFETIME_MAX)
      world.updatedAt[neighbor] = world.tick
      continue
    }
    if (!(world.state[neighbor] & BURNING_FLAG) && chance(world, IGNITION_CHANCE)) {
      world.state[neighbor] |= BURNING_FLAG
    }
  }
}

function updateFire(world: World, { index, x, y, direction }: UpdateContext): void {
  if (neighbors(world, x, y).some((neighbor) => world.material[neighbor] === MaterialId.Water)) {
    empty(world, index)
    return
  }
  igniteAdjacentWood(world, x, y)
  const lifetime = world.state[index] || randomInt(world, FIRE_LIFETIME_MIN, FIRE_LIFETIME_MAX)
  if (lifetime <= 1) {
    empty(world, index)
    return
  }
  world.state[index] = lifetime - 1
  const driftDirection = chance(world, 0.5) ? 1 : -1
  const attempts = chance(world, FIRE_DRIFT_CHANCE)
    ? [[x + driftDirection, y - 1], [x, y - 1], [x - driftDirection, y - 1]]
    : [[x, y - 1], [x + direction, y - 1], [x - direction, y - 1]]
  for (const [targetX, targetY] of attempts) {
    if (!inBounds(world, targetX, targetY)) continue
    const target = at(world, targetX, targetY)
    if (world.material[target] === MaterialId.Empty) return move(world, index, target)
  }
  world.updatedAt[index] = world.tick
}

function updateSmoke(world: World, { index, x, y, direction }: UpdateContext): void {
  const lifetime = world.state[index] || randomInt(world, SMOKE_LIFETIME_MIN, SMOKE_LIFETIME_MAX)
  if (lifetime <= 1) {
    empty(world, index)
    return
  }
  world.state[index] = lifetime - 1
  if (world.tick % 2 === 0) {
    const attempts = [[x, y - 1], [x + direction, y - 1], [x - direction, y - 1]]
    for (const [targetX, targetY] of attempts) {
      if (!inBounds(world, targetX, targetY)) continue
      const target = at(world, targetX, targetY)
      if (world.material[target] === MaterialId.Empty) return move(world, index, target)
    }
  }
  world.updatedAt[index] = world.tick
}

export const MATERIALS = [
  { id: 0, key: 'empty', label: 'Empty', paintable: false, phase: 'gas', density: 0, colors: ['#fbf8ff'], update: updateStatic },
  { id: 1, key: 'sand', label: 'Sand', paintable: true, phase: 'powder', density: 5, colors: ['#d99836', '#efb956', '#c17c27'], update: updateSand },
  { id: 2, key: 'water', label: 'Water', paintable: true, phase: 'liquid', density: 2, colors: ['#178fca', '#25aee3', '#167fb6'], update: updateWater },
  { id: 3, key: 'stone', label: 'Stone', paintable: true, phase: 'solid', density: 10, colors: ['#514b60', '#625b73', '#403b4e'], update: updateStatic },
  { id: 4, key: 'wood', label: 'Wood', paintable: true, phase: 'solid', density: 8, colors: ['#b87535', '#d18e43', '#925927'], update: updateWood },
  { id: 5, key: 'fire', label: 'Fire', paintable: true, phase: 'energy', density: 0, colors: ['#ff477f', '#ff6d4a', '#ffbe4f'], update: updateFire },
  { id: 6, key: 'smoke', label: 'Smoke', paintable: false, phase: 'gas', density: 0, colors: ['#81758e', '#998ca7', '#6f657b'], update: updateSmoke },
] as const satisfies readonly MaterialDefinition[]

export const MATERIAL_BY_ID = new Map<number, MaterialDefinition>(MATERIALS.map((material) => [material.id, material]))
export const PAINTABLE_MATERIALS = MATERIALS.filter((material) => material.paintable)

export function initializeTransientState(world: World, index: number, materialId: number): void {
  if (materialId === MaterialId.Fire) world.state[index] = randomInt(world, FIRE_LIFETIME_MIN, FIRE_LIFETIME_MAX)
  else if (materialId === MaterialId.Smoke) world.state[index] = randomInt(world, SMOKE_LIFETIME_MIN, SMOKE_LIFETIME_MAX)
  else world.state[index] = 0
}
