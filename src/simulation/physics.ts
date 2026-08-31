import {
  AMBIENT_TEMPERATURE,
  AIR_COOLING_INTERVAL,
  MAXIMUM_TEMPERATURE,
  MINIMUM_TEMPERATURE,
  MOISTURE_INTERVAL,
  THERMAL_INTERVAL,
} from './constants'
import {
  MATERIAL_PROPERTIES,
  MaterialId,
  type MaterialIdValue,
  StatusFlag,
  emptyCell,
  setMaterialCell,
} from './materials'
import type { MaterialProperties, World } from './types'

function properties(world: World, index: number): MaterialProperties {
  return MATERIAL_PROPERTIES[world.material[index] as MaterialIdValue]
}

function clampTemperature(value: number): number {
  return Math.max(MINIMUM_TEMPERATURE, Math.min(MAXIMUM_TEMPERATURE, value))
}

function temperatureChange(energy: number, heatCapacity: number): number {
  if (energy === 0) return 0
  const magnitude = Math.trunc(Math.abs(energy) / Math.max(1, heatCapacity))
  return Math.sign(energy) * Math.max(1, magnitude)
}

function exchangeTemperature(world: World, first: number, second: number): void {
  const difference = world.temperature[first] - world.temperature[second]
  if (Math.abs(difference) < 2) return
  const firstProperties = properties(world, first)
  const secondProperties = properties(world, second)
  const conductivity = Math.min(firstProperties.thermalConductivity, secondProperties.thermalConductivity)
  if (conductivity <= 0) return
  let energy = Math.trunc(difference * conductivity / 128)
  if (energy === 0) energy = Math.sign(difference)
  const maximum = Math.max(1, Math.trunc(Math.abs(difference) * Math.min(firstProperties.heatCapacity, secondProperties.heatCapacity) / 4))
  energy = Math.sign(energy) * Math.min(Math.abs(energy), maximum)
  world.temperatureDelta[first] -= temperatureChange(energy, firstProperties.heatCapacity)
  world.temperatureDelta[second] += temperatureChange(energy, secondProperties.heatCapacity)
}

function conductTemperature(world: World): void {
  world.temperatureDelta.fill(0)
  const coolingFrame = Math.floor(world.tick / THERMAL_INTERVAL) % AIR_COOLING_INTERVAL
  for (let y = 0; y < world.height; y += 1) {
    for (let x = 0; x < world.width; x += 1) {
      const index = y * world.width + x
      if (x + 1 < world.width) exchangeTemperature(world, index, index + 1)
      if (y + 1 < world.height) exchangeTemperature(world, index, index + world.width)
      if (world.material[index] === MaterialId.Empty && index % AIR_COOLING_INTERVAL === coolingFrame) {
        world.temperatureDelta[index] += Math.sign(AMBIENT_TEMPERATURE - world.temperature[index])
      }
    }
  }
  for (let index = 0; index < world.temperature.length; index += 1) {
    world.temperature[index] = clampTemperature(world.temperature[index] + world.temperatureDelta[index])
  }
}

function updatePhaseAndIgnition(world: World): void {
  for (let index = 0; index < world.material.length; index += 1) {
    const materialId = world.material[index] as MaterialIdValue
    if (materialId === MaterialId.Empty) {
      world.phaseProgress[index] = 0
      world.status[index] = 0
      continue
    }
    let materialProperties = MATERIAL_PROPERTIES[materialId]
    const transition = materialProperties.phaseTransitions.find((candidate) => candidate.direction === 'above'
      ? world.temperature[index] >= candidate.temperature
      : world.temperature[index] <= candidate.temperature)
    if (transition) {
      const distance = Math.abs(world.temperature[index] - transition.temperature)
      world.phaseProgress[index] = Math.min(65_535, world.phaseProgress[index] + 4 + Math.ceil(distance / 8))
      if (world.phaseProgress[index] >= transition.latentHeat) {
        const retainedTemperature = world.temperature[index]
        setMaterialCell(world, index, transition.product as MaterialIdValue, retainedTemperature)
        materialProperties = MATERIAL_PROPERTIES[world.material[index] as MaterialIdValue]
      }
    } else {
      world.phaseProgress[index] = Math.max(0, world.phaseProgress[index] - 4)
    }

    const ignitionTemperature = materialProperties.ignitionTemperature
    if (ignitionTemperature === null || world.fuel[index] <= 0 || (world.status[index] & StatusFlag.Burning)) continue
    const capacity = materialProperties.moistureCapacity
    const saturation = capacity > 0 ? world.moisture[index] / capacity : 0
    if (saturation >= 0.35) continue
    const adjustedIgnition = ignitionTemperature + Math.round(saturation * 250)
    if (world.temperature[index] >= adjustedIgnition) world.status[index] |= StatusFlag.Burning
  }
}

function transferWaterIntoPorousMaterials(world: World): void {
  for (let y = 0; y < world.height; y += 1) {
    for (let x = 0; x < world.width; x += 1) {
      const source = y * world.width + x
      if (world.material[source] !== MaterialId.Water || world.liquidMass[source] === 0) continue
      for (const [offsetX, offsetY] of [[0, -1], [-1, 0], [1, 0], [0, 1]] as const) {
        const targetX = x + offsetX
        const targetY = y + offsetY
        if (targetX < 0 || targetX >= world.width || targetY < 0 || targetY >= world.height) continue
        const target = targetY * world.width + targetX
        const targetProperties = properties(world, target)
        const room = targetProperties.moistureCapacity - world.moisture[target] - world.moistureDelta[target]
        if (room <= 0 || targetProperties.moistureAbsorption <= 0) continue
        const amount = Math.min(room, targetProperties.moistureAbsorption, world.liquidMass[source])
        world.moistureDelta[target] += amount
        world.liquidMass[source] -= amount
        if (world.liquidMass[source] === 0) break
      }
    }
  }
}

function diffuseMoistureEdge(world: World, first: number, second: number): void {
  const firstProperties = properties(world, first)
  const secondProperties = properties(world, second)
  if (firstProperties.moistureCapacity <= 0 || secondProperties.moistureCapacity <= 0) return
  const firstSaturation = world.moisture[first] / firstProperties.moistureCapacity
  const secondSaturation = world.moisture[second] / secondProperties.moistureCapacity
  if (Math.abs(firstSaturation - secondSaturation) < 0.04) return
  const donor = firstSaturation > secondSaturation ? first : second
  const receiver = donor === first ? second : first
  const donorProperties = donor === first ? firstProperties : secondProperties
  const receiverProperties = receiver === first ? firstProperties : secondProperties
  const rate = Math.max(1, Math.trunc(Math.min(donorProperties.moistureDiffusivity, receiverProperties.moistureDiffusivity) / 16))
  const available = world.moisture[donor] + world.moistureDelta[donor]
  const room = receiverProperties.moistureCapacity - world.moisture[receiver] - world.moistureDelta[receiver]
  const amount = Math.min(rate, available, room)
  if (amount <= 0) return
  world.moistureDelta[donor] -= amount
  world.moistureDelta[receiver] += amount
}

function evaporateMoisture(world: World, index: number): void {
  if (world.moisture[index] <= 0 || world.temperature[index] <= 60) return
  const materialProperties = properties(world, index)
  const amount = Math.min(world.moisture[index], 1 + Math.trunc((world.temperature[index] - 60) / 35))
  world.moisture[index] -= amount
  world.temperature[index] = clampTemperature(world.temperature[index] - Math.max(1, Math.trunc(amount * 18 / materialProperties.heatCapacity)))
  if (amount < 4) return
  const x = index % world.width
  const y = Math.floor(index / world.width)
  for (const [targetX, targetY] of [[x, y - 1], [x - 1, y - 1], [x + 1, y - 1]] as const) {
    if (targetX < 0 || targetX >= world.width || targetY < 0 || targetY >= world.height) continue
    const target = targetY * world.width + targetX
    if (world.material[target] !== MaterialId.Empty) continue
    if (world.moisture[index] < 96) break
    world.moisture[index] -= 96
    setMaterialCell(world, target, MaterialId.Steam, Math.max(100, world.temperature[index]))
    break
  }
}

function updateMoisture(world: World): void {
  world.moistureDelta.fill(0)
  transferWaterIntoPorousMaterials(world)
  for (let y = 0; y < world.height; y += 1) {
    for (let x = 0; x < world.width; x += 1) {
      const index = y * world.width + x
      if (x + 1 < world.width) diffuseMoistureEdge(world, index, index + 1)
      if (y + 1 < world.height) diffuseMoistureEdge(world, index, index + world.width)
    }
  }
  for (let index = 0; index < world.moisture.length; index += 1) {
    const capacity = properties(world, index).moistureCapacity
    world.moisture[index] = Math.max(0, Math.min(capacity, world.moisture[index] + world.moistureDelta[index]))
    evaporateMoisture(world, index)
    if (world.moisture[index] > 0) world.status[index] |= StatusFlag.Wet
    else world.status[index] &= ~StatusFlag.Wet
    if (world.material[index] === MaterialId.Water && world.liquidMass[index] === 0) emptyCell(world, index)
  }
}

export function updatePhysicalWorld(world: World): void {
  if (world.tick % MOISTURE_INTERVAL === 0) updateMoisture(world)
  if (world.tick % THERMAL_INTERVAL !== 0) return
  conductTemperature(world)
  updatePhaseAndIgnition(world)
}
