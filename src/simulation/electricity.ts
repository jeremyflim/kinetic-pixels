import { addTemperature, MATERIAL_PROPERTIES, MaterialId, type MaterialIdValue, solutionStrength, StatusFlag } from './materials'
import type { ElectricalWave, MaterialProperties, World } from './types'

const CHARGE_STRENGTH = 255
const CHARGE_VISIBLE_THRESHOLD = 32
const CURRENT_SPEED = 4
const CURRENT_TRAIL_STRENGTH = 170
const CURRENT_TRAIL_DECAY = 85

export function effectiveElectricalConductivity(world: World, index: number): number {
  const materialId = world.material[index] as MaterialIdValue
  const properties = MATERIAL_PROPERTIES[materialId]
  if (properties.electricalConductivity <= 0 && properties.moistureCapacity <= 0) return 0
  const saturation = properties.moistureCapacity > 0 ? world.moisture[index] / properties.moistureCapacity : 0
  const solutionScale = materialId === MaterialId.SaltWater ? solutionStrength(materialId, world.state[index]) : 1
  return Math.min(255, Math.round(properties.electricalConductivity * solutionScale + saturation * 150))
}

export function isChargeSourceActive(properties: MaterialProperties, tick: number): boolean {
  if (properties.chargeSource <= 0) return false
  if (properties.chargePulsePeriod <= 1) return true
  return tick % properties.chargePulsePeriod < properties.chargePulseDuration
}

export function launchElectricalPulse(world: World, sources: readonly number[]): void {
  if (sources.length === 0) return
  const wave: ElectricalWave = {
    queue: new Int32Array(world.material.length),
    visited: new Uint8Array(world.material.length),
    head: 0,
    tail: 0,
    layerEnd: 0,
  }
  for (const index of sources) {
    if (index < 0 || index >= world.material.length || wave.visited[index] || effectiveElectricalConductivity(world, index) <= 0) continue
    wave.visited[index] = 1
    wave.queue[wave.tail++] = index
  }
  if (wave.tail === 0) return
  wave.layerEnd = wave.tail
  world.electricalWaves.push(wave)
  world.electricalActive = true
}

function enqueueWaveNeighbor(world: World, wave: ElectricalWave, index: number): void {
  if (wave.visited[index] || effectiveElectricalConductivity(world, index) <= 0) return
  wave.visited[index] = 1
  wave.queue[wave.tail++] = index
}

function advanceWave(world: World, wave: ElectricalWave, next: Uint8Array): boolean {
  for (let distance = 0; distance < CURRENT_SPEED && wave.head < wave.tail; distance += 1) {
    const layerEnd = wave.layerEnd
    while (wave.head < layerEnd) {
      const index = wave.queue[wave.head++]
      if (effectiveElectricalConductivity(world, index) <= 0) continue
      next[index] = Math.max(next[index], CURRENT_TRAIL_STRENGTH)
      const x = index % world.width
      const y = Math.floor(index / world.width)
      if (x > 0) enqueueWaveNeighbor(world, wave, index - 1)
      if (x + 1 < world.width) enqueueWaveNeighbor(world, wave, index + 1)
      if (y > 0) enqueueWaveNeighbor(world, wave, index - world.width)
      if (y + 1 < world.height) enqueueWaveNeighbor(world, wave, index + world.width)
    }
    wave.layerEnd = wave.tail
  }
  for (let cursor = wave.head; cursor < wave.layerEnd; cursor += 1) next[wave.queue[cursor]] = CHARGE_STRENGTH
  return wave.head < wave.tail
}

export function updateElectricity(world: World): void {
  if (!world.electricalActive) return
  const next = world.chargeNext
  next.fill(0)
  let hasSource = false

  for (let index = 0; index < world.charge.length; index += 1) {
    const charge = world.charge[index]
    if (charge > 0) next[index] = Math.max(0, charge - CURRENT_TRAIL_DECAY)
  }

  const activeSources: number[] = []
  for (let index = 0; index < world.material.length; index += 1) {
    const properties = MATERIAL_PROPERTIES[world.material[index] as MaterialIdValue]
    if (properties.chargeSource <= 0) continue
    hasSource = true
    if (!isChargeSourceActive(properties, world.tick)) continue
    activeSources.push(index)
  }
  if (activeSources.length > 0 && world.electricalLaunchTick !== world.tick) {
    launchElectricalPulse(world, activeSources)
    world.electricalLaunchTick = world.tick
  }

  world.electricalWaves = world.electricalWaves.filter((wave) => advanceWave(world, wave, next))

  const previous = world.charge
  world.charge = next
  world.chargeNext = previous
  let hasCharge = false
  for (let index = 0; index < world.material.length; index += 1) {
    const charge = world.charge[index]
    if (charge > 0) hasCharge = true
    const properties = MATERIAL_PROPERTIES[world.material[index] as MaterialIdValue]
    if (charge >= CHARGE_VISIBLE_THRESHOLD) world.status[index] |= StatusFlag.Charged
    else world.status[index] &= ~StatusFlag.Charged
    const conductivity = effectiveElectricalConductivity(world, index)
    if (charge > 0 && conductivity > 0 && conductivity < 255) addTemperature(world, index, Math.round(charge * (255 - conductivity) / 8_160))
    let ignitionCharge = charge
    if (properties.sparkSensitivity > 0 && ignitionCharge < 256 - properties.sparkSensitivity) {
      const x = index % world.width
      const y = Math.floor(index / world.width)
      if (x > 0) ignitionCharge = Math.max(ignitionCharge, world.charge[index - 1])
      if (x + 1 < world.width) ignitionCharge = Math.max(ignitionCharge, world.charge[index + 1])
      if (y > 0) ignitionCharge = Math.max(ignitionCharge, world.charge[index - world.width])
      if (y + 1 < world.height) ignitionCharge = Math.max(ignitionCharge, world.charge[index + world.width])
    }
    if (properties.sparkSensitivity > 0 && world.fuel[index] > 0 && ignitionCharge >= 256 - properties.sparkSensitivity) {
      world.status[index] |= StatusFlag.Burning
    }
  }
  world.electricalActive = hasSource || hasCharge || world.electricalWaves.length > 0
}
