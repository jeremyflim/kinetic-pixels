import { MATERIAL_BY_ID, MaterialId, initializeTransientState } from './materials'
import { AMBIENT_TEMPERATURE } from './constants'
import { updatePhysicalWorld } from './physics'
import { updateElectricity } from './electricity'
import { normalizeSeed } from './random'
import { rasterizeTitle } from './title'
import { GRID_HEIGHT, GRID_WIDTH, type MaterialMobility, type Snapshot, type World } from './types'

const STATIONARY_MOBILITIES = new Set<MaterialMobility>(['immovable'])
const FALLING_MOBILITIES = new Set<MaterialMobility>(['powder', 'fluid'])
const RISING_MOBILITIES = new Set<MaterialMobility>(['rising'])

export function createWorld(seed = 0x4b504958, withTitle = true, width = GRID_WIDTH, height = GRID_HEIGHT): World {
  const normalizedSeed = normalizeSeed(seed)
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
    electricalActive: false,
    ambientTemperature: AMBIENT_TEMPERATURE,
    tick: 0,
    seed: normalizedSeed,
    randomState: normalizedSeed,
  }
  world.temperature.fill(world.ambientTemperature)
  if (withTitle) rasterizeTitle(world)
  return world
}

function updatePass(world: World, mobilities: ReadonlySet<MaterialMobility>, rising: boolean): void {
  const direction = world.tick % 2 === 0 ? 1 : -1
  const startY = rising ? 0 : world.height - 1
  const endY = rising ? world.height : -1
  const stepY = rising ? 1 : -1

  for (let y = startY; y !== endY; y += stepY) {
    const startX = direction === 1 ? 0 : world.width - 1
    const endX = direction === 1 ? world.width : -1
    for (let x = startX; x !== endX; x += direction) {
      const index = y * world.width + x
      if (world.updatedAt[index] === world.tick) continue
      const definition = MATERIAL_BY_ID.get(world.material[index])
      if (!definition || !mobilities.has(definition.properties.mobility)) continue
      definition.update(world, { direction, index, x, y })
    }
  }
}

export function stepWorld(world: World): void {
  world.tick += 1
  updatePass(world, STATIONARY_MOBILITIES, false)
  updatePass(world, FALLING_MOBILITIES, false)
  updatePass(world, RISING_MOBILITIES, true)
  updateElectricity(world)
  updatePhysicalWorld(world)
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
  world.electricalActive = false
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
      } else {
        const definition = MATERIAL_BY_ID.get(materialId)
        const canPaint = definition?.paintable && (
          world.material[index] === MaterialId.Empty
          || (world.material[index] === materialId && definition.properties.phase === 'energy')
        )
        if (canPaint) {
          world.material[index] = materialId
          initializeTransientState(world, index, materialId)
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
  world.electricalActive = snapshot.charge.some((value) => value > 0)
    || snapshot.material.some((materialId) => Boolean(MATERIAL_BY_ID.get(materialId)?.properties.chargeSource))
  world.tick = snapshot.tick >>> 0
  world.seed = normalizeSeed(snapshot.seed)
  world.randomState = normalizeSeed(snapshot.randomState)
}
