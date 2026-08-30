import { MATERIAL_BY_ID, MaterialId, initializeTransientState } from './materials'
import { normalizeSeed } from './random'
import { rasterizeTitle } from './title'
import { GRID_HEIGHT, GRID_WIDTH, type Snapshot, type World } from './types'

export function createWorld(seed = 0x4b504958, withTitle = true, width = GRID_WIDTH, height = GRID_HEIGHT): World {
  const normalizedSeed = normalizeSeed(seed)
  const world: World = {
    width,
    height,
    material: new Uint8Array(width * height),
    state: new Uint16Array(width * height),
    updatedAt: new Uint32Array(width * height),
    tick: 0,
    seed: normalizedSeed,
    randomState: normalizedSeed,
  }
  if (withTitle) rasterizeTitle(world)
  return world
}

function updatePass(world: World, phases: ReadonlySet<string>, rising: boolean): void {
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
      if (!definition || !phases.has(definition.phase)) continue
      definition.update(world, { direction, index, x, y })
    }
  }
}

export function stepWorld(world: World): void {
  world.tick += 1
  updatePass(world, new Set(['solid']), false)
  updatePass(world, new Set(['powder', 'liquid']), false)
  updatePass(world, new Set(['energy', 'gas']), true)
}

export function clearWorld(world: World): void {
  world.material.fill(0)
  world.state.fill(0)
  world.updatedAt.fill(0)
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
      } else if (world.material[index] === MaterialId.Empty && MATERIAL_BY_ID.get(materialId)?.paintable) {
        world.material[index] = materialId
        initializeTransientState(world, index, materialId)
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
  }
}

export function replaceWorld(world: World, snapshot: Snapshot): void {
  if (snapshot.width !== world.width || snapshot.height !== world.height) throw new Error('World dimensions do not match')
  if (snapshot.material.length !== world.material.length || snapshot.state.length !== world.state.length) throw new Error('World data length does not match')
  world.material.set(snapshot.material)
  world.state.set(snapshot.state)
  world.updatedAt.fill(0)
  world.tick = snapshot.tick >>> 0
  world.seed = normalizeSeed(snapshot.seed)
  world.randomState = normalizeSeed(snapshot.randomState)
}
