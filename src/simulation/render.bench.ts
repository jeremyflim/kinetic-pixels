import { bench, describe } from 'vitest'
import { createWorld } from './engine'
import { MaterialId, StatusFlag } from './materials'
import { createRenderCache, renderWorld } from './render'

const context = { putImageData() {} } as unknown as OffscreenCanvasRenderingContext2D

function imageData(length: number): ImageData {
  return { data: new Uint8ClampedArray(length * 4) } as ImageData
}

describe('192 × 180 render preparation', () => {
  const staticWorld = createWorld(1, false)
  const staticImage = imageData(staticWorld.material.length)
  const staticCache = createRenderCache(staticWorld)
  renderWorld(context, staticWorld, staticImage, staticCache)
  bench('unchanged field', () => {
    renderWorld(context, staticWorld, staticImage, staticCache)
  })

  const animatedWorld = createWorld(2, false)
  for (let index = 0; index < animatedWorld.material.length; index += 2) {
    animatedWorld.material[index] = MaterialId.Wood
    animatedWorld.status[index] = StatusFlag.Burning
    animatedWorld.fuel[index] = 200
    animatedWorld.temperature[index] = 500
  }
  const animatedImage = imageData(animatedWorld.material.length)
  const animatedCache = createRenderCache(animatedWorld)
  renderWorld(context, animatedWorld, animatedImage, animatedCache)
  bench('half-screen burning animation', () => {
    animatedWorld.tick += 1
    renderWorld(context, animatedWorld, animatedImage, animatedCache)
  })
})
