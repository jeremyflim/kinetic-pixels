import { BURN_PROGRESS_LIMIT, MATERIALS, MaterialId, StatusFlag } from './materials'
import type { World } from './types'

const RGB = MATERIALS.map((material) => material.colors.map((color) => {
  const value = Number.parseInt(color.slice(1), 16)
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255] as const
}))

const BURNING_WOOD_RGB = [
  [255, 190, 79],
  [255, 109, 74],
  [255, 71, 127],
  [104, 52, 43],
  [48, 37, 48],
] as const

const VISIBLY_HEATED = new Set<number>([
  MaterialId.Sand,
  MaterialId.Wood,
  MaterialId.Oil,
  MaterialId.Plant,
  MaterialId.Metal,
  MaterialId.Gunpowder,
  MaterialId.Glass,
])

function blendColor(
  color: readonly [number, number, number],
  target: readonly [number, number, number],
  amount: number,
): readonly [number, number, number] {
  return [
    Math.round(color[0] * (1 - amount) + target[0] * amount),
    Math.round(color[1] * (1 - amount) + target[1] * amount),
    Math.round(color[2] * (1 - amount) + target[2] * amount),
  ]
}

function colorIndex(materialId: number, x: number, y: number, state: number, seed: number, count: number): number {
  let hash = (Math.imul(x + 1, 0x45d9f3b) ^ Math.imul(y + 1, 0x119de1f3) ^ Math.imul(materialId + 1, 0x27d4eb2d) ^ state ^ seed) >>> 0
  hash ^= hash >>> 16
  return (hash >>> 0) % count
}

export function cellColor(world: World, index: number): readonly [number, number, number] {
  const materialId = world.material[index]
  const cellState = world.state[index]
  const cellStatus = world.status[index]
  const isBurning = Boolean(cellStatus & StatusFlag.Burning)
  const colors = isBurning ? BURNING_WOOD_RGB : (RGB[materialId] ?? RGB[MaterialId.Empty])
  const x = index % world.width
  const y = Math.floor(index / world.width)
  let color: readonly [number, number, number] = colors[colorIndex(materialId, x, y, cellState, world.seed, colors.length)]
  if (isBurning) {
    const progress = cellState
    const burnRatio = progress / BURN_PROGRESS_LIMIT
    const hotColorCount = burnRatio < 0.55 ? 3 : 2
    const charredColorCount = burnRatio < 0.55 ? 1 : 2
    const showChar = colorIndex(materialId, x, y, cellState ^ world.tick, world.seed, hotColorCount + charredColorCount) >= hotColorCount
    color = showChar
      ? BURNING_WOOD_RGB[BURNING_WOOD_RGB.length - 1 - (progress % charredColorCount)]
      : BURNING_WOOD_RGB[colorIndex(materialId, x, y, cellState ^ world.tick, world.seed, hotColorCount)]
  }
  if (cellStatus & StatusFlag.Wet) {
    color = blendColor(color, [37, 174, 227], 0.32)
  }
  if (cellStatus & StatusFlag.Charged) {
    const chargeColor = world.tick % 2 === 0 ? [255, 255, 255] as const : [78, 224, 200] as const
    color = blendColor(color, chargeColor, 0.65)
  }
  if (!isBurning && VISIBLY_HEATED.has(materialId) && world.heat[index] > 40) {
    const blend = Math.min(0.38, ((world.heat[index] - 40) / 215) * 0.38)
    color = blendColor(color, [255, 109, 74], blend)
  }
  return color
}

export function renderWorld(context: OffscreenCanvasRenderingContext2D, world: World, imageData: ImageData): void {
  const pixels = imageData.data
  for (let index = 0; index < world.material.length; index += 1) {
    const [red, green, blue] = cellColor(world, index)
    const pixel = index * 4
    pixels[pixel] = red
    pixels[pixel + 1] = green
    pixels[pixel + 2] = blue
    pixels[pixel + 3] = 255
  }
  context.putImageData(imageData, 0, 0)
}
