import { MATERIALS, MATERIAL_PROPERTIES, MaterialId, type MaterialIdValue, solutionStrength, StatusFlag } from './materials'
import { AMBIENT_TEMPERATURE, MAXIMUM_TEMPERATURE, MINIMUM_TEMPERATURE } from './constants'
import type { World } from './types'
import { ACTIVITY_TILE_SIZE } from './activity'

const RENDER_TILE_SIZE = ACTIVITY_TILE_SIZE

export interface RenderCache {
  material: Uint8Array
  state: Uint16Array
  status: Uint8Array
  charge: Uint8Array
  temperature: Int16Array
  moisture: Uint8Array
  fuel: Uint8Array
  animationTick: Uint32Array
  dirtyTiles: Uint8Array
  tileColumns: number
  tileRows: number
}

export interface RenderResult {
  changedCells: number
  uploadedRegions: number
}

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

const SMOLDERING_COAL_RGB = [
  [42, 34, 38],
  [92, 43, 38],
  [184, 62, 37],
  [255, 135, 45],
] as const

const VISIBLY_HEATED = new Set<number>([
  MaterialId.Sand,
  MaterialId.Wood,
  MaterialId.Oil,
  MaterialId.Plant,
  MaterialId.Metal,
  MaterialId.Gunpowder,
  MaterialId.Glass,
  MaterialId.Coal,
  MaterialId.Rubber,
  MaterialId.Copper,
  MaterialId.Battery,
  MaterialId.Mercury,
  MaterialId.Alcohol,
  MaterialId.Sodium,
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
  const colors = isBurning && materialId !== MaterialId.Coal ? BURNING_WOOD_RGB : (RGB[materialId] ?? RGB[MaterialId.Empty])
  const x = index % world.width
  const y = Math.floor(index / world.width)
  let color: readonly [number, number, number] = colors[colorIndex(materialId, x, y, cellState, world.seed, colors.length)]
  if (materialId === MaterialId.Alcohol || materialId === MaterialId.Acid || materialId === MaterialId.SaltWater) {
    const strength = solutionStrength(materialId, cellState)
    const waterColors = RGB[MaterialId.Water]
    const waterColor = waterColors[colorIndex(MaterialId.Water, x, y, cellState, world.seed, waterColors.length)]
    color = blendColor(waterColor, color, strength)
  }
  if (isBurning && materialId === MaterialId.Coal) {
    color = SMOLDERING_COAL_RGB[colorIndex(materialId, x, y, cellState ^ Math.floor(world.tick / 4), world.seed, SMOLDERING_COAL_RGB.length)]
  } else if (isBurning) {
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
    color = blendColor(color, chargeColor, 0.25 + world.charge[index] / 255 * 0.5)
  }
  if (!isBurning && VISIBLY_HEATED.has(materialId) && world.temperature[index] > 100) {
    const blend = Math.min(0.46, ((world.temperature[index] - 100) / 900) * 0.46)
    color = blendColor(color, [255, 109, 74], blend)
  }
  const temperatureOffset = world.temperature[index] - AMBIENT_TEMPERATURE
  if (temperatureOffset > 2) {
    const haze = Math.min(0.38, 0.035 + Math.sqrt(temperatureOffset / (MAXIMUM_TEMPERATURE - AMBIENT_TEMPERATURE)) * 0.42)
    color = blendColor(color, [224, 48, 76], haze)
  } else if (temperatureOffset < -2) {
    const haze = Math.min(0.36, 0.035 + Math.sqrt(-temperatureOffset / (AMBIENT_TEMPERATURE - MINIMUM_TEMPERATURE)) * 0.34)
    color = blendColor(color, [47, 122, 232], haze)
  }
  return color
}

export function createRenderCache(world: World): RenderCache {
  const length = world.material.length
  const material = new Uint8Array(length)
  material.fill(0xff)
  return {
    material,
    state: new Uint16Array(length),
    status: new Uint8Array(length),
    charge: new Uint8Array(length),
    temperature: new Int16Array(length),
    moisture: new Uint8Array(length),
    fuel: new Uint8Array(length),
    animationTick: new Uint32Array(length),
    tileColumns: Math.ceil(world.width / RENDER_TILE_SIZE),
    tileRows: Math.ceil(world.height / RENDER_TILE_SIZE),
    dirtyTiles: new Uint8Array(Math.ceil(world.width / RENDER_TILE_SIZE) * Math.ceil(world.height / RENDER_TILE_SIZE)),
  }
}

function animationTick(world: World, index: number): number {
  return world.status[index] & (StatusFlag.Burning | StatusFlag.Charged) ? world.tick >>> 0 : 0
}

function visualStateChanged(world: World, cache: RenderCache, index: number): boolean {
  const nextAnimationTick = animationTick(world, index)
  if (
    cache.material[index] === world.material[index]
    && cache.state[index] === world.state[index]
    && cache.status[index] === world.status[index]
    && cache.charge[index] === world.charge[index]
    && cache.temperature[index] === world.temperature[index]
    && cache.moisture[index] === world.moisture[index]
    && cache.fuel[index] === world.fuel[index]
    && cache.animationTick[index] === nextAnimationTick
  ) return false
  cache.material[index] = world.material[index]
  cache.state[index] = world.state[index]
  cache.status[index] = world.status[index]
  cache.charge[index] = world.charge[index]
  cache.temperature[index] = world.temperature[index]
  cache.moisture[index] = world.moisture[index]
  cache.fuel[index] = world.fuel[index]
  cache.animationTick[index] = nextAnimationTick
  return true
}

function uploadDirtyTiles(
  context: OffscreenCanvasRenderingContext2D,
  imageData: ImageData,
  cache: RenderCache,
  width: number,
  height: number,
  dirtyTileCount: number,
): number {
  if (dirtyTileCount === 0) return 0
  if (dirtyTileCount > cache.dirtyTiles.length / 4) {
    context.putImageData(imageData, 0, 0, 0, 0, width, height)
    return 1
  }
  let uploadedRegions = 0
  for (let tileY = 0; tileY < cache.tileRows; tileY += 1) {
    let tileX = 0
    while (tileX < cache.tileColumns) {
      const rowOffset = tileY * cache.tileColumns
      while (tileX < cache.tileColumns && cache.dirtyTiles[rowOffset + tileX] === 0) tileX += 1
      if (tileX >= cache.tileColumns) break
      const startTileX = tileX
      while (tileX < cache.tileColumns && cache.dirtyTiles[rowOffset + tileX] !== 0) tileX += 1
      const dirtyX = startTileX * RENDER_TILE_SIZE
      const dirtyY = tileY * RENDER_TILE_SIZE
      const dirtyWidth = Math.min(width, tileX * RENDER_TILE_SIZE) - dirtyX
      const dirtyHeight = Math.min(RENDER_TILE_SIZE, height - dirtyY)
      context.putImageData(imageData, 0, 0, dirtyX, dirtyY, dirtyWidth, dirtyHeight)
      uploadedRegions += 1
    }
  }
  return uploadedRegions
}

export function renderWorld(
  context: OffscreenCanvasRenderingContext2D,
  world: World,
  imageData: ImageData,
  cache: RenderCache,
): RenderResult {
  const pixels = imageData.data
  cache.dirtyTiles.fill(0)
  let changedCells = 0
  let dirtyTileCount = 0
  const allDirty = !world.activityEnabled || world.visualAllDirty
  for (let tile = 0; tile < cache.dirtyTiles.length; tile += 1) {
    if (!allDirty && world.visualDirtyTiles[tile] === 0) continue
    const tileX = tile % cache.tileColumns
    const tileY = Math.floor(tile / cache.tileColumns)
    const minimumX = tileX * RENDER_TILE_SIZE
    const maximumX = Math.min(world.width, minimumX + RENDER_TILE_SIZE)
    const minimumY = tileY * RENDER_TILE_SIZE
    const maximumY = Math.min(world.height, minimumY + RENDER_TILE_SIZE)
    for (let y = minimumY; y < maximumY; y += 1) {
      for (let x = minimumX; x < maximumX; x += 1) {
        const index = y * world.width + x
        if (!visualStateChanged(world, cache, index)) continue
        const [red, green, blue] = cellColor(world, index)
        const pixel = index * 4
        pixels[pixel] = red
        pixels[pixel + 1] = green
        pixels[pixel + 2] = blue
        pixels[pixel + 3] = 255
        changedCells += 1
        if (cache.dirtyTiles[tile] === 0) {
          cache.dirtyTiles[tile] = 1
          dirtyTileCount += 1
        }
      }
    }
    if (world.activityEnabled) world.visualDirtyTiles[tile] = 0
  }
  if (world.activityEnabled) world.visualAllDirty = false
  return {
    changedCells,
    uploadedRegions: uploadDirtyTiles(context, imageData, cache, world.width, world.height, dirtyTileCount),
  }
}
