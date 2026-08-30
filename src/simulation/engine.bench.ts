import { bench, describe } from 'vitest'
import { createWorld, stepWorld } from './engine'
import { BURNING_FLAG, MaterialId } from './materials'

function filled(materialId: number) {
  const world = createWorld(0xabc123, false)
  world.material.fill(materialId)
  return world
}

describe('320 × 300 simulation tick', () => {
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

  const combustion = createWorld(0xabc123, false)
  for (let index = 0; index < combustion.material.length; index += 3) {
    combustion.material[index] = MaterialId.Wood
    combustion.state[index] = BURNING_FLAG | (index % 300)
    if (index + 1 < combustion.material.length) {
      combustion.material[index + 1] = MaterialId.Fire
      combustion.state[index + 1] = 60
    }
    if (index + 2 < combustion.material.length) {
      combustion.material[index + 2] = MaterialId.Smoke
      combustion.state[index + 2] = 120
    }
  }
  bench('burning Wood, Fire, and Smoke', () => stepWorld(combustion))
})
