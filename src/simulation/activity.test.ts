import { describe, expect, it } from 'vitest'
import { ActivityFlag, MOVEMENT_SLEEP_TICKS } from './activity'
import { createWorld, paintCircle, stepWorld } from './engine'
import { MaterialId } from './materials'

function meanAbsoluteTemperatureError(first: Int16Array, second: Int16Array): number {
  let total = 0
  for (let index = 0; index < first.length; index += 1) total += Math.abs(first[index] - second[index])
  return total / first.length
}

describe('16 × 16 activity tiles', () => {
  it('puts unchanged movement tiles to sleep and wakes the painted neighborhood', () => {
    const world = createWorld(1, false, 64, 64)
    for (let tick = 0; tick < MOVEMENT_SLEEP_TICKS; tick += 1) stepWorld(world)
    expect([...world.activeTiles].every((flags) => (flags & ActivityFlag.Movement) === 0)).toBe(true)

    paintCircle(world, 32, 32, 1, MaterialId.Sand)
    expect([...world.activeTiles].some((flags) => (flags & ActivityFlag.Movement) !== 0)).toBe(true)
  })

  it('matches the full-grid thermal reference within the one-degree air cutoff', () => {
    const active = createWorld(0xabc123, false, 64, 64, true)
    const reference = createWorld(0xabc123, false, 64, 64, false)
    const center = 32 * active.width + 32
    for (const world of [active, reference]) {
      world.material[center] = MaterialId.Metal
      world.temperature[center] = 900
    }

    for (let tick = 0; tick < 360; tick += 1) {
      stepWorld(active)
      stepWorld(reference)
    }

    expect(active.material).toEqual(reference.material)
    expect(meanAbsoluteTemperatureError(active.temperature, reference.temperature)).toBeLessThan(1)
    let maximumError = 0
    for (let index = 0; index < active.temperature.length; index += 1) {
      maximumError = Math.max(maximumError, Math.abs(active.temperature[index] - reference.temperature[index]))
    }
    expect(maximumError / (900 - active.ambientTemperature)).toBeLessThan(0.01)
  })
})
