import { addTemperature, MATERIAL_PROPERTIES, type MaterialIdValue, StatusFlag } from './materials'
import type { MaterialProperties, World } from './types'

const CHARGE_STRENGTH = 255
const CHARGE_VISIBLE_THRESHOLD = 32

export function effectiveElectricalConductivity(world: World, index: number): number {
  const properties = MATERIAL_PROPERTIES[world.material[index] as MaterialIdValue]
  if (properties.electricalConductivity <= 0 && properties.moistureCapacity <= 0) return 0
  const saturation = properties.moistureCapacity > 0 ? world.moisture[index] / properties.moistureCapacity : 0
  return Math.min(255, Math.round(properties.electricalConductivity + saturation * 150))
}

export function isChargeSourceActive(properties: MaterialProperties, tick: number): boolean {
  if (properties.chargeSource <= 0) return false
  if (properties.chargePulsePeriod <= 1) return true
  return tick % properties.chargePulsePeriod < properties.chargePulseDuration
}

function enqueueConductiveNeighbor(world: World, index: number, tail: number): number {
  if (world.chargeNext[index] > 0 || effectiveElectricalConductivity(world, index) <= 0) return tail
  world.chargeNext[index] = CHARGE_STRENGTH
  world.electricalQueue[tail] = index
  return tail + 1
}

export function updateElectricity(world: World): void {
  if (!world.electricalActive) return
  const next = world.chargeNext
  next.fill(0)
  let head = 0
  let tail = 0
  let hasSource = false

  for (let index = 0; index < world.material.length; index += 1) {
    const properties = MATERIAL_PROPERTIES[world.material[index] as MaterialIdValue]
    if (properties.chargeSource <= 0) continue
    hasSource = true
    if (!isChargeSourceActive(properties, world.tick)) continue
    next[index] = CHARGE_STRENGTH
    world.electricalQueue[tail++] = index
  }

  while (head < tail) {
    const index = world.electricalQueue[head++]
    const x = index % world.width
    const y = Math.floor(index / world.width)
    if (x > 0) tail = enqueueConductiveNeighbor(world, index - 1, tail)
    if (x + 1 < world.width) tail = enqueueConductiveNeighbor(world, index + 1, tail)
    if (y > 0) tail = enqueueConductiveNeighbor(world, index - world.width, tail)
    if (y + 1 < world.height) tail = enqueueConductiveNeighbor(world, index + world.width, tail)
  }

  const previous = world.charge
  world.charge = next
  world.chargeNext = previous
  world.electricalActive = hasSource
  for (let index = 0; index < world.material.length; index += 1) {
    const charge = world.charge[index]
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
}
