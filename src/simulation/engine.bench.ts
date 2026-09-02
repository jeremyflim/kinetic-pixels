import { bench, describe } from 'vitest'
import { createWorld, mixStroke, stepWorld } from './engine'
import { MATERIAL_PROPERTIES, MaterialId, StatusFlag, initializeTransientState } from './materials'

function filled(materialId: number) {
  const world = createWorld(0xabc123, false)
  world.material.fill(materialId)
  return world
}

describe('192 × 180 simulation tick', () => {
  const occupied = filled(MaterialId.Stone)
  bench('fully occupied stationary grid', () => stepWorld(occupied))

  const sand = createWorld(0xabc123, false)
  for (let y = 0; y < sand.height / 2; y += 1) {
    sand.material.fill(MaterialId.Sand, y * sand.width, (y + 1) * sand.width)
  }
  bench('falling Sand', () => stepWorld(sand))

  const water = createWorld(0xabc123, false)
  water.material.fill(MaterialId.Water, 0, water.material.length / 2)
  bench('Water spread', () => stepWorld(water))

  const mixture = createWorld(0xabc123, false)
  for (let index = 0; index < mixture.material.length / 2; index += 1) {
    const materialId = index % 2 === 0 ? MaterialId.Water : MaterialId.Alcohol
    mixture.material[index] = materialId
    initializeTransientState(mixture, index, materialId)
  }
  bench('Water and Alcohol mixing', () => stepWorld(mixture))

  const lava = filled(MaterialId.Lava)
  lava.temperature.fill(MATERIAL_PROPERTIES[MaterialId.Lava].initialTemperature)
  bench('fully occupied Lava heat', () => stepWorld(lava))

  const circuit = filled(MaterialId.Metal)
  circuit.material[0] = MaterialId.Battery
  initializeTransientState(circuit, 0, MaterialId.Battery)
  bench('current propagating through Metal', () => stepWorld(circuit))

  const combustion = createWorld(0xabc123, false)
  for (let index = 0; index < combustion.material.length; index += 3) {
    combustion.material[index] = MaterialId.Wood
    combustion.status[index] = StatusFlag.Burning
    combustion.temperature[index] = 500
    combustion.fuel[index] = 200
    if (index + 1 < combustion.material.length) {
      combustion.material[index + 1] = MaterialId.Fire
      combustion.state[index + 1] = 60
      combustion.temperature[index + 1] = MATERIAL_PROPERTIES[MaterialId.Fire].initialTemperature
    }
    if (index + 2 < combustion.material.length) {
      combustion.material[index + 2] = MaterialId.Smoke
      combustion.state[index + 2] = 120
      combustion.temperature[index + 2] = MATERIAL_PROPERTIES[MaterialId.Smoke].initialTemperature
    }
  }
  bench('burning Wood, Fire, and Smoke', () => stepWorld(combustion))

  const mixedPowders = createWorld(0xabc123, false)
  for (let index = 0; index < mixedPowders.material.length; index += 1) {
    const materialId = index % 2 === 0 ? MaterialId.Sand : MaterialId.Gunpowder
    mixedPowders.material[index] = materialId
    initializeTransientState(mixedPowders, index, materialId)
  }
  bench('maximum-radius Mix tool', () => mixStroke(mixedPowders, mixedPowders.width / 2, mixedPowders.height / 2, mixedPowders.width / 2, mixedPowders.height / 2, 20))
})
