import { MATERIALS, MaterialId } from './materials'
import type { World } from './types'

const RGB = MATERIALS.map((material) => material.colors.map((color) => {
  const value = Number.parseInt(color.slice(1), 16)
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255] as const
}))

function colorIndex(materialId: number, x: number, y: number, state: number, seed: number, count: number): number {
  let hash = (Math.imul(x + 1, 0x45d9f3b) ^ Math.imul(y + 1, 0x119de1f3) ^ Math.imul(materialId + 1, 0x27d4eb2d) ^ state ^ seed) >>> 0
  hash ^= hash >>> 16
  return (hash >>> 0) % count
}

export function renderWorld(context: OffscreenCanvasRenderingContext2D, world: World, imageData: ImageData): void {
  const pixels = imageData.data
  for (let index = 0; index < world.material.length; index += 1) {
    const materialId = world.material[index]
    const colors = RGB[materialId] ?? RGB[MaterialId.Empty]
    const x = index % world.width
    const y = Math.floor(index / world.width)
    const [red, green, blue] = colors[colorIndex(materialId, x, y, world.state[index], world.seed, colors.length)]
    const pixel = index * 4
    pixels[pixel] = red
    pixels[pixel + 1] = green
    pixels[pixel + 2] = blue
    pixels[pixel + 3] = 255
  }
  context.putImageData(imageData, 0, 0)
}
