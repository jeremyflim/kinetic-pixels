import { MATERIALS, MaterialId, initializeTransientState, swapCells } from './materials'
import { AMBIENT_TEMPERATURE } from './constants'
import { updatePhysicalWorld } from './physics'
import { launchElectricalPulse, updateElectricity } from './electricity'
import { normalizeSeed, randomInt } from './random'
import { rasterizeTitle } from './title'
import { GRID_HEIGHT, GRID_WIDTH, type Snapshot, type UpdateContext, type World } from './types'
import {
  ACTIVITY_TILE_SIZE,
  ActivityFlag,
  beginActivityStep,
  clearActivity,
  finishMovementActivity,
  markAllActivity,
  markCellActivity,
} from './activity'

const MOBILITY_CODE = { none: 0, immovable: 1, powder: 2, fluid: 3, rising: 4 } as const
const MATERIAL_MOBILITY = Uint8Array.from(MATERIALS.map((material) => MOBILITY_CODE[material.properties.mobility]))
const STATIONARY_MASK = 1 << MOBILITY_CODE.immovable
const FALLING_MASK = (1 << MOBILITY_CODE.powder) | (1 << MOBILITY_CODE.fluid)
const RISING_MASK = 1 << MOBILITY_CODE.rising

export function createWorld(seed = 0x4b504958, withTitle = true, width = GRID_WIDTH, height = GRID_HEIGHT, activityEnabled = true): World {
  const normalizedSeed = normalizeSeed(seed)
  const tileColumns = Math.ceil(width / ACTIVITY_TILE_SIZE)
  const tileRows = Math.ceil(height / ACTIVITY_TILE_SIZE)
  const tileCount = tileColumns * tileRows
  const world: World = {
    width,
    height,
    material: new Uint8Array(width * height),
    state: new Uint16Array(width * height),
    status: new Uint8Array(width * height),
    charge: new Uint8Array(width * height),
    temperature: new Int16Array(width * height),
    moisture: new Uint8Array(width * height),
    fuel: new Uint8Array(width * height),
    liquidMass: new Uint8Array(width * height),
    phaseProgress: new Uint32Array(width * height),
    updatedAt: new Uint32Array(width * height),
    temperatureDelta: new Int32Array(width * height),
    thermalRemainder: new Int32Array(width * height),
    moistureDelta: new Int16Array(width * height),
    chargeNext: new Uint8Array(width * height),
    electricalWaves: [],
    electricalLaunchTick: -1,
    electricalActive: false,
    activityEnabled,
    tileColumns,
    tileRows,
    activeTiles: new Uint8Array(tileCount),
    touchedTiles: new Uint8Array(tileCount),
    activityWorkTiles: new Uint8Array(tileCount),
    movementIdleTicks: new Uint8Array(tileCount),
    visualDirtyTiles: new Uint8Array(tileCount),
    denseActivityFlags: 0,
    denseTouchedFlags: 0,
    visualAllDirty: true,
    ambientTemperature: AMBIENT_TEMPERATURE,
    tick: 0,
    seed: normalizedSeed,
    randomState: normalizedSeed,
  }
  world.temperature.fill(world.ambientTemperature)
  markAllActivity(world)
  if (withTitle) rasterizeTitle(world)
  return world
}

function updatePass(world: World, mobilityMask: number, rising: boolean): void {
  const direction = world.tick % 2 === 0 ? 1 : -1
  const startY = rising ? 0 : world.height - 1
  const endY = rising ? world.height : -1
  const stepY = rising ? 1 : -1
  const context: UpdateContext = { direction, index: 0, x: 0, y: 0 }
  let activeTileCount = 0
  if (world.activityEnabled) {
    for (let tile = 0; tile < world.activeTiles.length; tile += 1) {
      if (world.activeTiles[tile] & ActivityFlag.Movement) activeTileCount += 1
    }
  }
  const dense = !world.activityEnabled || activeTileCount * 4 >= world.activeTiles.length * 3

  if (dense) {
    for (let y = startY; y !== endY; y += stepY) {
      const startX = direction === 1 ? 0 : world.width - 1
      const endX = direction === 1 ? world.width : -1
      for (let x = startX; x !== endX; x += direction) {
        const index = y * world.width + x
        if (world.updatedAt[index] === world.tick) continue
        const materialId = world.material[index]
        if ((mobilityMask & (1 << MATERIAL_MOBILITY[materialId])) === 0) continue
        context.index = index
        context.x = x
        context.y = y
        MATERIALS[materialId].update(world, context)
      }
    }
    return
  }

  for (let y = startY; y !== endY; y += stepY) {
    const tileY = Math.floor(y / ACTIVITY_TILE_SIZE)
    const startTileX = direction === 1 ? 0 : world.tileColumns - 1
    const endTileX = direction === 1 ? world.tileColumns : -1
    for (let tileX = startTileX; tileX !== endTileX; tileX += direction) {
      const tile = tileY * world.tileColumns + tileX
      if (world.activityEnabled && (world.activeTiles[tile] & ActivityFlag.Movement) === 0) continue
      const minimumX = tileX * ACTIVITY_TILE_SIZE
      const maximumX = Math.min(world.width, minimumX + ACTIVITY_TILE_SIZE)
      const startX = direction === 1 ? minimumX : maximumX - 1
      const endX = direction === 1 ? maximumX : minimumX - 1
      for (let x = startX; x !== endX; x += direction) {
        const index = y * world.width + x
        if (world.updatedAt[index] === world.tick) continue
        const materialId = world.material[index]
        if ((mobilityMask & (1 << MATERIAL_MOBILITY[materialId])) === 0) continue
        context.index = index
        context.x = x
        context.y = y
        MATERIALS[materialId].update(world, context)
      }
    }
  }
}

export function stepWorld(world: World): void {
  world.tick += 1
  beginActivityStep(world)
  updatePass(world, STATIONARY_MASK, false)
  updatePass(world, FALLING_MASK, false)
  updatePass(world, RISING_MASK, true)
  updateElectricity(world)
  updatePhysicalWorld(world)
  finishMovementActivity(world)
}

export function clearWorld(world: World): void {
  world.material.fill(0)
  world.state.fill(0)
  world.status.fill(0)
  world.charge.fill(0)
  world.temperature.fill(world.ambientTemperature)
  world.moisture.fill(0)
  world.fuel.fill(0)
  world.liquidMass.fill(0)
  world.phaseProgress.fill(0)
  world.updatedAt.fill(0)
  world.temperatureDelta.fill(0)
  world.thermalRemainder.fill(0)
  world.moistureDelta.fill(0)
  world.chargeNext.fill(0)
  world.electricalWaves.length = 0
  world.electricalLaunchTick = -1
  world.electricalActive = false
  clearActivity(world)
}

export function paintCircle(world: World, centerX: number, centerY: number, radius: number, materialId: number, erase = false): void {
  const safeRadius = Math.max(1, Math.min(20, Math.round(radius)))
  const minimumX = Math.max(0, Math.floor(centerX - safeRadius))
  const maximumX = Math.min(world.width - 1, Math.ceil(centerX + safeRadius))
  const minimumY = Math.max(0, Math.floor(centerY - safeRadius))
  const maximumY = Math.min(world.height - 1, Math.ceil(centerY + safeRadius))
  const squaredRadius = safeRadius * safeRadius

  for (let y = minimumY; y <= maximumY; y += 1) {
    for (let x = minimumX; x <= maximumX; x += 1) {
      const deltaX = x - centerX
      const deltaY = y - centerY
      if (deltaX * deltaX + deltaY * deltaY > squaredRadius) continue
      const index = y * world.width + x
      if (erase) {
        world.material[index] = MaterialId.Empty
        world.state[index] = 0
        world.status[index] = 0
        world.charge[index] = 0
        world.temperature[index] = world.ambientTemperature
        world.moisture[index] = 0
        world.fuel[index] = 0
        world.liquidMass[index] = 0
        world.phaseProgress[index] = 0
        world.thermalRemainder[index] = 0
        markCellActivity(world, index, ActivityFlag.All, true)
      } else {
        const definition = MATERIALS[materialId]
        const canPaint = definition?.paintable && (
          world.material[index] === MaterialId.Empty
          || (world.material[index] === materialId && definition.properties.phase === 'energy')
        )
        if (canPaint) {
          world.material[index] = materialId
          initializeTransientState(world, index, materialId)
          markCellActivity(world, index, ActivityFlag.All, true)
        }
      }
    }
  }
}

export function paintStroke(world: World, fromX: number, fromY: number, toX: number, toY: number, radius: number, materialId: number, erase = false): void {
  const distance = Math.hypot(toX - fromX, toY - fromY)
  const steps = Math.max(1, Math.ceil(distance / Math.max(1, radius * 0.5)))
  for (let step = 0; step <= steps; step += 1) {
    const progress = step / steps
    paintCircle(world, fromX + (toX - fromX) * progress, fromY + (toY - fromY) * progress, radius, materialId, erase)
  }
}

function isMixableCell(world: World, index: number): boolean {
  return world.material[index] === MaterialId.Empty || MATERIAL_MOBILITY[world.material[index]] >= MOBILITY_CODE.powder
}

export function mixCircle(world: World, centerX: number, centerY: number, radius: number): void {
  const safeRadius = Math.max(1, Math.min(20, Math.round(radius)))
  const minimumX = Math.max(0, Math.floor(centerX - safeRadius))
  const maximumX = Math.min(world.width - 1, Math.ceil(centerX + safeRadius))
  const minimumY = Math.max(0, Math.floor(centerY - safeRadius))
  const maximumY = Math.min(world.height - 1, Math.ceil(centerY + safeRadius))
  const squaredRadius = safeRadius * safeRadius
  const attempts = Math.min(256, Math.max(4, Math.ceil(squaredRadius * 0.75)))

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const firstX = randomInt(world, minimumX, maximumX)
    const firstY = randomInt(world, minimumY, maximumY)
    const secondX = randomInt(world, minimumX, maximumX)
    const secondY = randomInt(world, minimumY, maximumY)
    if ((firstX - centerX) ** 2 + (firstY - centerY) ** 2 > squaredRadius
      || (secondX - centerX) ** 2 + (secondY - centerY) ** 2 > squaredRadius) continue
    const first = firstY * world.width + firstX
    const second = secondY * world.width + secondX
    if (first === second || !isMixableCell(world, first) || !isMixableCell(world, second)) continue
    swapCells(world, first, second)
  }
}

export function mixStroke(world: World, fromX: number, fromY: number, toX: number, toY: number, radius: number): void {
  const distance = Math.hypot(toX - fromX, toY - fromY)
  const steps = Math.max(1, Math.ceil(distance / Math.max(1, radius * 0.5)))
  for (let step = 0; step <= steps; step += 1) {
    const progress = step / steps
    mixCircle(world, fromX + (toX - fromX) * progress, fromY + (toY - fromY) * progress, radius)
  }
}

export function snapshotWorld(world: World): Snapshot {
  return {
    width: world.width,
    height: world.height,
    tick: world.tick,
    seed: world.seed,
    randomState: world.randomState,
    material: world.material.slice(),
    state: world.state.slice(),
    status: world.status.slice(),
    charge: world.charge.slice(),
    temperature: world.temperature.slice(),
    moisture: world.moisture.slice(),
    fuel: world.fuel.slice(),
    liquidMass: world.liquidMass.slice(),
    phaseProgress: world.phaseProgress.slice(),
  }
}

export function replaceWorld(world: World, snapshot: Snapshot): void {
  if (snapshot.width !== world.width || snapshot.height !== world.height) throw new Error('World dimensions do not match')
  if (
    snapshot.material.length !== world.material.length
    || snapshot.state.length !== world.state.length
    || snapshot.status.length !== world.status.length
    || snapshot.charge.length !== world.charge.length
    || snapshot.temperature.length !== world.temperature.length
    || snapshot.moisture.length !== world.moisture.length
    || snapshot.fuel.length !== world.fuel.length
    || snapshot.liquidMass.length !== world.liquidMass.length
    || snapshot.phaseProgress.length !== world.phaseProgress.length
  ) throw new Error('World data length does not match')
  world.material.set(snapshot.material)
  world.state.set(snapshot.state)
  world.status.set(snapshot.status)
  world.charge.set(snapshot.charge)
  world.temperature.set(snapshot.temperature)
  world.moisture.set(snapshot.moisture)
  world.fuel.set(snapshot.fuel)
  world.liquidMass.set(snapshot.liquidMass)
  world.phaseProgress.set(snapshot.phaseProgress)
  world.updatedAt.fill(0)
  world.temperatureDelta.fill(0)
  world.thermalRemainder.fill(0)
  world.moistureDelta.fill(0)
  world.chargeNext.fill(0)
  world.electricalWaves.length = 0
  world.electricalLaunchTick = -1
  const savedFront = [...snapshot.charge.keys()].filter((index) => snapshot.charge[index] === 255)
  if (savedFront.length > 0) launchElectricalPulse(world, savedFront)
  world.electricalActive = snapshot.charge.some((value) => value > 0)
    || snapshot.material.some((materialId) => Boolean(MATERIALS[materialId]?.properties.chargeSource))
  world.tick = snapshot.tick >>> 0
  world.seed = normalizeSeed(snapshot.seed)
  world.randomState = normalizeSeed(snapshot.randomState)
  clearActivity(world)
  markAllActivity(world)
}
