import type { World } from './types'

export function normalizeSeed(seed: number): number {
  const normalized = seed >>> 0
  return normalized === 0 ? 0x6d2b79f5 : normalized
}

export function nextRandom(world: World): number {
  let value = normalizeSeed(world.randomState)
  value ^= value << 13
  value ^= value >>> 17
  value ^= value << 5
  world.randomState = value >>> 0
  return world.randomState / 0x100000000
}

export function chance(world: World, probability: number): boolean {
  return nextRandom(world) < probability
}

export function randomInt(world: World, minimum: number, maximum: number): number {
  return minimum + Math.floor(nextRandom(world) * (maximum - minimum + 1))
}
