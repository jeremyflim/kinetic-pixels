import { describe, expect, it, vi } from 'vitest'
import { createWorld } from './engine'
import { MaterialId, StatusFlag } from './materials'
import { createRenderCache, renderWorld } from './render'
import { ActivityFlag, markCellActivity } from './activity'

function renderHarness(width = 24, height = 24) {
  const world = createWorld(1, false, width, height)
  const imageData = { data: new Uint8ClampedArray(width * height * 4) } as ImageData
  const putImageData = vi.fn()
  const context = { putImageData } as unknown as OffscreenCanvasRenderingContext2D
  const cache = createRenderCache(world)
  return { world, imageData, putImageData, context, cache }
}

describe('dirty region rendering', () => {
  it('draws the initial frame once and skips an unchanged world', () => {
    const { world, imageData, putImageData, context, cache } = renderHarness()
    expect(renderWorld(context, world, imageData, cache)).toEqual({ changedCells: 576, uploadedRegions: 1 })
    putImageData.mockClear()
    expect(renderWorld(context, world, imageData, cache)).toEqual({ changedCells: 0, uploadedRegions: 0 })
    expect(putImageData).not.toHaveBeenCalled()
  })

  it('uploads only the tile containing a changed cell', () => {
    const { world, imageData, putImageData, context, cache } = renderHarness()
    renderWorld(context, world, imageData, cache)
    putImageData.mockClear()
    world.material[0] = MaterialId.Stone
    markCellActivity(world, 0, ActivityFlag.Visual)
    const result = renderWorld(context, world, imageData, cache)
    expect(result).toEqual({ changedCells: 1, uploadedRegions: 1 })
    expect(putImageData).toHaveBeenCalledWith(imageData, 0, 0, 0, 0, 16, 16)
  })

  it('continues repainting animated burning and charged cells', () => {
    const { world, imageData, context, cache } = renderHarness()
    world.material[0] = MaterialId.Wood
    world.status[0] = StatusFlag.Burning | StatusFlag.Charged
    world.fuel[0] = 200
    renderWorld(context, world, imageData, cache)
    world.tick += 1
    markCellActivity(world, 0, ActivityFlag.Visual)
    expect(renderWorld(context, world, imageData, cache).changedCells).toBe(1)
  })
})
