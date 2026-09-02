import { bench, describe } from 'vitest'
import { createWorld, stepWorld } from './engine'
import { addTemperature, MATERIAL_PROPERTIES, MaterialId, StatusFlag } from './materials'

const BENCHMARK_OPTIONS = { time: 2_000, warmupTime: 500 }

function stationary(activityEnabled: boolean) {
  const world = createWorld(0xabc123, false, undefined, undefined, activityEnabled)
  world.material.fill(MaterialId.Stone)
  for (let tick = 0; tick < 12; tick += 1) stepWorld(world)
  return world
}

function localHeat(activityEnabled: boolean) {
  const world = createWorld(0xabc123, false, undefined, undefined, activityEnabled)
  const center = Math.floor(world.height / 2) * world.width + Math.floor(world.width / 2)
  world.material[center] = MaterialId.Metal
  world.temperature[center] = 700
  for (let tick = 0; tick < 24; tick += 1) stepWorld(world)
  return { world, center }
}

function combustion(activityEnabled: boolean) {
  const world = createWorld(0xabc123, false, undefined, undefined, activityEnabled)
  world.material.fill(MaterialId.Wood)
  resetCombustion(world)
  return world
}

function resetCombustion(world: ReturnType<typeof createWorld>): void {
  world.status.fill(StatusFlag.Burning)
  world.temperature.fill(500)
  world.thermalRemainder.fill(0)
  world.fuel.fill(200)
}

describe('16 × 16 activity scheduler comparison', () => {
  const activeStationary = stationary(true)
  const fullStationary = stationary(false)
  bench('settled stationary field — active tiles', () => stepWorld(activeStationary), BENCHMARK_OPTIONS)
  bench('settled stationary field — full scan', () => stepWorld(fullStationary), BENCHMARK_OPTIONS)

  const activeHeat = localHeat(true)
  const fullHeat = localHeat(false)
  const sourceEnergy = MATERIAL_PROPERTIES[MaterialId.Metal].heatCapacity * 2
  bench('localized constant heat — active tiles', () => {
    addTemperature(activeHeat.world, activeHeat.center, sourceEnergy)
    stepWorld(activeHeat.world)
  }, BENCHMARK_OPTIONS)
  bench('localized constant heat — full scan', () => {
    addTemperature(fullHeat.world, fullHeat.center, sourceEnergy)
    stepWorld(fullHeat.world)
  }, BENCHMARK_OPTIONS)

  const activeCombustion = combustion(true)
  const fullCombustion = combustion(false)
  bench('dense combustion — active tiles', () => {
    resetCombustion(activeCombustion)
    stepWorld(activeCombustion)
  }, BENCHMARK_OPTIONS)
  bench('dense combustion — full scan', () => {
    resetCombustion(fullCombustion)
    stepWorld(fullCombustion)
  }, BENCHMARK_OPTIONS)
})
