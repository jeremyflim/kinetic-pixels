import { MATERIALS, MATERIAL_PROPERTIES, MaterialId, type MaterialIdValue, StatusFlag } from './materials'
import { AMBIENT_TEMPERATURE, MAXIMUM_TEMPERATURE, MINIMUM_TEMPERATURE } from './constants'
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
    const maximumFuel = Math.max(1, MATERIAL_PROPERTIES[materialId as MaterialIdValue].fuel)
    const progress = maximumFuel - world.fuel[index]
    const burnRatio = progress / maximumFuel
    const hotColorCount = burnRatio < 0.55 ? 3 : 2
    const charredColorCount = burnRatio < 0.55 ? 1 : 2
    const showChar = colorIndex(materialId, x, y, cellState ^ world.tick, world.seed, hotColorCount + charredColorCount) >= hotColorCount
    color = showChar
      ? BURNING_WOOD_RGB[BURNING_WOOD_RGB.length - 1 - (progress % charredColorCount)]
      : BURNING_WOOD_RGB[colorIndex(materialId, x, y, cellState ^ world.tick, world.seed, hotColorCount)]
  }
  if (world.moisture[index] > 0) {
    const capacity = Math.max(1, MATERIAL_PROPERTIES[materialId as MaterialIdValue].moistureCapacity)
    color = blendColor(color, [37, 174, 227], Math.min(0.4, world.moisture[index] / capacity * 0.4))
  }
  if (cellStatus & StatusFlag.Charged) {
    const chargeColor = world.tick % 2 === 0 ? [255, 255, 255] as const : [78, 224, 200] as const
    color = blendColor(color, chargeColor, 0.65)
  }
  if (!isBurning && VISIBLY_HEATED.has(materialId) && world.temperature[index] > 100) {
    const blend = Math.min(0.46, ((world.temperature[index] - 100) / 900) * 0.46)
    color = blendColor(color, [255, 109, 74], blend)
  }
  const temperatureOffset = world.temperature[index] - AMBIENT_TEMPERATURE
  if (temperatureOffset > 4) {
    const haze = Math.min(0.15, temperatureOffset / (MAXIMUM_TEMPERATURE - AMBIENT_TEMPERATURE) * 0.3)
    color = blendColor(color, [255, 132, 147], haze)
  } else if (temperatureOffset < -4) {
    const haze = Math.min(0.17, -temperatureOffset / (AMBIENT_TEMPERATURE - MINIMUM_TEMPERATURE) * 0.17)
    color = blendColor(color, [116, 190, 255], haze)
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
