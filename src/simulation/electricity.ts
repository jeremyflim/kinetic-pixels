import { addTemperature, MATERIAL_PROPERTIES, MaterialId, type MaterialIdValue, StatusFlag } from './materials'
import type { World } from './types'

const CHARGE_VISIBLE_THRESHOLD = 32

export function effectiveElectricalConductivity(world: World, index: number): number {
  const properties = MATERIAL_PROPERTIES[world.material[index] as MaterialIdValue]
  if (properties.electricalConductivity <= 0 && properties.moistureCapacity <= 0) return 0
  const saturation = properties.moistureCapacity > 0 ? world.moisture[index] / properties.moistureCapacity : 0
  return Math.min(255, Math.round(properties.electricalConductivity + saturation * 150))
}

function connectionLoss(first: number, second: number): number {
  return 1 + Math.ceil((255 - Math.min(first, second)) / 12)
}

export function updateElectricity(world: World): void {
  if (!world.electricalActive) return
  const current = world.charge
  const next = world.chargeNext
  next.fill(0)
  let hasActivity = false

  for (let y = 0; y < world.height; y += 1) {
    for (let x = 0; x < world.width; x += 1) {
      const index = y * world.width + x
      const materialId = world.material[index] as MaterialIdValue
      const properties = MATERIAL_PROPERTIES[materialId]
      const conductivity = effectiveElectricalConductivity(world, index)
      let strength = properties.chargeSource
      if (conductivity > 0 && current[index] > 0) strength = Math.max(strength, current[index] - 18)

      if (conductivity > 0) {
        const neighbors = [
          x > 0 ? index - 1 : -1,
          x + 1 < world.width ? index + 1 : -1,
          y > 0 ? index - world.width : -1,
          y + 1 < world.height ? index + world.width : -1,
        ]
        for (const neighbor of neighbors) {
          if (neighbor < 0 || current[neighbor] === 0) continue
          const neighborConductivity = effectiveElectricalConductivity(world, neighbor)
          if (neighborConductivity <= 0) continue
          strength = Math.max(strength, current[neighbor] - connectionLoss(conductivity, neighborConductivity))
        }
      }
      next[index] = Math.max(0, strength)
      if (next[index] > 0) hasActivity = true
    }
  }

  world.charge = next
  world.chargeNext = current
  world.electricalActive = hasActivity
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
