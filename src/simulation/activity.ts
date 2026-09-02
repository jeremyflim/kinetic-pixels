import type { World } from './types'

export const ACTIVITY_TILE_SIZE = 16
export const MOVEMENT_SLEEP_TICKS = 8

export const ActivityFlag = {
  Movement: 1 << 0,
  Thermal: 1 << 1,
  Moisture: 1 << 2,
  Electrical: 1 << 3,
  Visual: 1 << 4,
  Simulation: (1 << 0) | (1 << 1) | (1 << 2) | (1 << 3),
  All: (1 << 0) | (1 << 1) | (1 << 2) | (1 << 3) | (1 << 4),
} as const

export function activityTileIndex(world: World, index: number): number {
  const x = index % world.width
  const y = Math.floor(index / world.width)
  return Math.floor(y / ACTIVITY_TILE_SIZE) * world.tileColumns + Math.floor(x / ACTIVITY_TILE_SIZE)
}

function markTile(world: World, tileX: number, tileY: number, flags: number, touched: boolean): void {
  if (tileX < 0 || tileX >= world.tileColumns || tileY < 0 || tileY >= world.tileRows) return
  const tile = tileY * world.tileColumns + tileX
  const simulationFlags = flags & ActivityFlag.Simulation
  if ((world.activeTiles[tile] & simulationFlags) !== simulationFlags) world.activeTiles[tile] |= simulationFlags
  if (touched && (world.touchedTiles[tile] & simulationFlags) !== simulationFlags) world.touchedTiles[tile] |= simulationFlags
  if ((flags & ActivityFlag.Visual) && world.visualDirtyTiles[tile] === 0) world.visualDirtyTiles[tile] = 1
}

export function markCellActivity(world: World, index: number, flags = ActivityFlag.All, includeNeighborTiles = false): void {
  if (!world.activityEnabled) return
  const simulationFlags = flags & ActivityFlag.Simulation
  const denseFlags = simulationFlags & world.denseActivityFlags
  world.denseTouchedFlags |= denseFlags
  if ((flags & ActivityFlag.Visual) && world.denseActivityFlags !== 0) world.visualAllDirty = true
  const effectiveFlags = (flags & ~ActivityFlag.Simulation & ~ActivityFlag.Visual)
    | (simulationFlags & ~world.denseActivityFlags)
    | ((flags & ActivityFlag.Visual) && !world.visualAllDirty ? ActivityFlag.Visual : 0)
  if (effectiveFlags === 0) return
  const x = index % world.width
  const y = Math.floor(index / world.width)
  const tileX = Math.floor(x / ACTIVITY_TILE_SIZE)
  const tileY = Math.floor(y / ACTIVITY_TILE_SIZE)
  markTile(world, tileX, tileY, effectiveFlags, true)
  if (!includeNeighborTiles) return
  for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
    for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
      if (offsetX !== 0 || offsetY !== 0) markTile(world, tileX + offsetX, tileY + offsetY, effectiveFlags, true)
    }
  }
}

export function keepCellActive(world: World, index: number, flags: number): void {
  if (!world.activityEnabled) return
  const simulationFlags = flags & ActivityFlag.Simulation
  const denseFlags = simulationFlags & world.denseActivityFlags
  world.denseTouchedFlags |= denseFlags
  const effectiveFlags = simulationFlags & ~world.denseActivityFlags
  if (effectiveFlags === 0) return
  const tile = activityTileIndex(world, index)
  world.activeTiles[tile] |= effectiveFlags
  world.touchedTiles[tile] |= effectiveFlags
}

export function markAllActivity(world: World, flags = ActivityFlag.All): void {
  if (!world.activityEnabled) return
  if (flags & ActivityFlag.Simulation) {
    for (let tile = 0; tile < world.activeTiles.length; tile += 1) {
      world.activeTiles[tile] |= flags & ActivityFlag.Simulation
      world.touchedTiles[tile] |= flags & ActivityFlag.Simulation
    }
  }
  if (flags & ActivityFlag.Visual) world.visualDirtyTiles.fill(1)
  if (flags & ActivityFlag.Visual) world.visualAllDirty = true
}

export function clearActivity(world: World): void {
  world.activeTiles.fill(0)
  world.touchedTiles.fill(0)
  world.activityWorkTiles.fill(0)
  world.movementIdleTicks.fill(0)
  world.visualDirtyTiles.fill(1)
  world.denseActivityFlags = 0
  world.denseTouchedFlags = 0
  world.visualAllDirty = true
}

export function beginActivityStep(world: World): void {
  if (!world.activityEnabled) return
  world.touchedTiles.fill(0)
  world.denseActivityFlags = 0
  world.denseTouchedFlags = 0
  for (const flag of [ActivityFlag.Movement, ActivityFlag.Thermal, ActivityFlag.Moisture, ActivityFlag.Electrical]) {
    let activeCount = 0
    for (let tile = 0; tile < world.activeTiles.length; tile += 1) {
      if (world.activeTiles[tile] & flag) activeCount += 1
    }
    if (activeCount * 4 >= world.activeTiles.length * 3) world.denseActivityFlags |= flag
  }
}

export function finishMovementActivity(world: World): void {
  if (!world.activityEnabled) return
  const denseMovementTouched = Boolean(world.denseTouchedFlags & ActivityFlag.Movement)
  for (let tile = 0; tile < world.activeTiles.length; tile += 1) {
    if ((world.activeTiles[tile] & ActivityFlag.Movement) === 0) {
      world.movementIdleTicks[tile] = 0
      continue
    }
    if (denseMovementTouched || (world.touchedTiles[tile] & ActivityFlag.Movement)) {
      world.movementIdleTicks[tile] = 0
      continue
    }
    const idleTicks = Math.min(255, world.movementIdleTicks[tile] + 1)
    world.movementIdleTicks[tile] = idleTicks
    if (idleTicks >= MOVEMENT_SLEEP_TICKS) world.activeTiles[tile] &= ~ActivityFlag.Movement
  }
  world.denseActivityFlags = 0
  world.denseTouchedFlags = 0
}

export function clearActivityFlag(world: World, flag: number): void {
  if (!world.activityEnabled) return
  world.denseActivityFlags &= ~flag
  for (let tile = 0; tile < world.activeTiles.length; tile += 1) world.activeTiles[tile] &= ~flag
}

export function prepareActivityWork(world: World, flag: number, includeNeighborTiles = true): Uint8Array {
  const work = world.activityWorkTiles
  work.fill(0)
  if (!world.activityEnabled) {
    work.fill(1)
    return work
  }
  for (let tile = 0; tile < world.activeTiles.length; tile += 1) {
    if ((world.activeTiles[tile] & flag) === 0) continue
    const tileX = tile % world.tileColumns
    const tileY = Math.floor(tile / world.tileColumns)
    const radius = includeNeighborTiles ? 1 : 0
    for (let offsetY = -radius; offsetY <= radius; offsetY += 1) {
      const targetY = tileY + offsetY
      if (targetY < 0 || targetY >= world.tileRows) continue
      for (let offsetX = -radius; offsetX <= radius; offsetX += 1) {
        const targetX = tileX + offsetX
        if (targetX < 0 || targetX >= world.tileColumns) continue
        work[targetY * world.tileColumns + targetX] = 1
      }
    }
  }
  return work
}
