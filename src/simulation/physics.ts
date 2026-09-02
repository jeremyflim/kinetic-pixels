import {
  AIR_AMBIENT_EXCHANGE_FRACTION,
  MAXIMUM_TEMPERATURE,
  MAXIMUM_PAIR_EXCHANGE_FRACTION,
  MINIMUM_TEMPERATURE,
  MOISTURE_INTERVAL,
  THERMAL_CONDUCTANCE_SCALE,
  THERMAL_INTERVAL,
} from './constants'
import {
  MATERIAL_PROPERTIES,
  MaterialId,
  type MaterialIdValue,
  StatusFlag,
  solutionConcentration,
  solutionStrength,
  emptyCell,
  setMaterialCell,
} from './materials'
import { chance } from './random'
import type { MaterialProperties, PhaseTransition, World } from './types'
import {
  ACTIVITY_TILE_SIZE,
  ActivityFlag,
  clearActivityFlag,
  markCellActivity,
  prepareActivityWork,
} from './activity'

function properties(world: World, index: number): MaterialProperties {
  return MATERIAL_PROPERTIES[world.material[index] as MaterialIdValue]
}

const THERMAL_CONDUCTIVITY = Float64Array.from(Object.values(MaterialId).map((id) => MATERIAL_PROPERTIES[id].thermalConductivity))
const HEAT_CAPACITY = Uint16Array.from(Object.values(MaterialId).map((id) => MATERIAL_PROPERTIES[id].heatCapacity))

function clampTemperature(value: number): number {
  return Math.max(MINIMUM_TEMPERATURE, Math.min(MAXIMUM_TEMPERATURE, value))
}

function exchangeTemperature(world: World, first: number, second: number): void {
  const difference = world.temperature[first] - world.temperature[second]
  if (Math.abs(difference) < 2) return
  const firstMaterial = world.material[first]
  const secondMaterial = world.material[second]
  const firstConductivity = THERMAL_CONDUCTIVITY[firstMaterial]
  const secondConductivity = THERMAL_CONDUCTIVITY[secondMaterial]
  const conductivity = firstConductivity + secondConductivity > 0
    ? 2 * firstConductivity * secondConductivity / (firstConductivity + secondConductivity)
    : 0
  if (conductivity <= 0) return
  const firstCapacity = HEAT_CAPACITY[firstMaterial]
  const secondCapacity = HEAT_CAPACITY[secondMaterial]
  const equilibriumEnergy = Math.abs(difference) * firstCapacity * secondCapacity / (firstCapacity + secondCapacity)
  const requestedEnergy = Math.abs(difference) * conductivity * THERMAL_CONDUCTANCE_SCALE
  const energy = Math.round(Math.sign(difference) * Math.min(requestedEnergy, equilibriumEnergy * MAXIMUM_PAIR_EXCHANGE_FRACTION))
  if (energy === 0) return
  world.temperatureDelta[first] -= energy
  world.temperatureDelta[second] += energy
  markCellActivity(world, first, ActivityFlag.Thermal | ActivityFlag.Visual)
  markCellActivity(world, second, ActivityFlag.Thermal | ActivityFlag.Visual)
}

export function resolvedPhaseTransitions(world: World, index: number, materialProperties: MaterialProperties): readonly PhaseTransition[] {
  const materialId = world.material[index] as MaterialIdValue
  let transitions = materialProperties.phaseTransitions
  if (materialId === MaterialId.Alcohol) {
    const concentration = solutionConcentration(materialId, world.state[index]) / 255
    const alcoholTransition = materialProperties.phaseTransitions[0]
    const waterTransition = MATERIAL_PROPERTIES[MaterialId.Water].phaseTransitions[0]
    transitions = [{
      direction: 'above',
      temperature: Math.round(100 - concentration * 22),
      product: concentration >= 0.5 ? MaterialId.AlcoholVapor : MaterialId.Steam,
      latentHeat: Math.round(waterTransition.latentHeat * (1 - concentration) + alcoholTransition.latentHeat * concentration),
    }]
  } else if (materialId === MaterialId.SaltWater) {
    const strength = solutionStrength(materialId, world.state[index])
    transitions = materialProperties.phaseTransitions.map((transition) => ({
      ...transition,
      temperature: transition.direction === 'above' ? Math.round(100 + strength * 3) : Math.round(-strength * 4),
    }))
  } else if (materialId === MaterialId.Acid) {
    const strength = solutionStrength(materialId, world.state[index])
    transitions = materialProperties.phaseTransitions.map((transition) => ({ ...transition, temperature: Math.round(100 + strength * 8) }))
  }
  return transitions
}

function activePhaseTransition(world: World, index: number, materialProperties: MaterialProperties): PhaseTransition | undefined {
  return resolvedPhaseTransitions(world, index, materialProperties).find((candidate) => candidate.direction === 'above'
    ? world.temperature[index] >= candidate.temperature
    : world.temperature[index] <= candidate.temperature)
}

function completePhaseTransition(world: World, index: number, transition: PhaseTransition, retainedTemperature: number): void {
  if (world.material[index] === MaterialId.SaltWater && transition.direction === 'above' && transition.product === MaterialId.Steam) {
    const concentration = solutionConcentration(MaterialId.SaltWater, world.state[index])
    const x = index % world.width
    const y = Math.floor(index / world.width)
    const vaporTarget = [[x, y - 1], [x - 1, y - 1], [x + 1, y - 1], [x - 1, y], [x + 1, y]]
      .find(([targetX, targetY]) => targetX >= 0 && targetX < world.width && targetY >= 0 && targetY < world.height
        && world.material[targetY * world.width + targetX] === MaterialId.Empty)
    if (vaporTarget && chance(world, concentration / 512)) {
      const target = vaporTarget[1] * world.width + vaporTarget[0]
      setMaterialCell(world, target, MaterialId.Steam, retainedTemperature)
      setMaterialCell(world, index, MaterialId.Salt, transition.temperature)
      return
    }
  }
  setMaterialCell(world, index, transition.product as MaterialIdValue, retainedTemperature)
}

function conductTemperature(world: World): void {
  const work = prepareActivityWork(world, ActivityFlag.Thermal)
  if (!world.activityEnabled) world.temperatureDelta.fill(0)
  else {
    for (let tile = 0; tile < work.length; tile += 1) {
      if (work[tile] === 0) continue
      const tileX = tile % world.tileColumns
      const tileY = Math.floor(tile / world.tileColumns)
      const minimumX = tileX * ACTIVITY_TILE_SIZE
      const maximumX = Math.min(world.width, minimumX + ACTIVITY_TILE_SIZE)
      const minimumY = tileY * ACTIVITY_TILE_SIZE
      const maximumY = Math.min(world.height, minimumY + ACTIVITY_TILE_SIZE)
      for (let y = minimumY; y < maximumY; y += 1) {
        world.temperatureDelta.fill(0, y * world.width + minimumX, y * world.width + maximumX)
      }
    }
  }
  clearActivityFlag(world, ActivityFlag.Thermal)
  for (let tile = 0; tile < work.length; tile += 1) {
    if (work[tile] === 0) continue
    const tileX = tile % world.tileColumns
    const tileY = Math.floor(tile / world.tileColumns)
    const minimumX = tileX * ACTIVITY_TILE_SIZE
    const maximumX = Math.min(world.width, minimumX + ACTIVITY_TILE_SIZE)
    const minimumY = tileY * ACTIVITY_TILE_SIZE
    const maximumY = Math.min(world.height, minimumY + ACTIVITY_TILE_SIZE)
    for (let y = minimumY; y < maximumY; y += 1) {
      for (let x = minimumX; x < maximumX; x += 1) {
        const index = y * world.width + x
        if (x + 1 < world.width && (x + 1 < maximumX || work[tile + 1] !== 0)) exchangeTemperature(world, index, index + 1)
        if (y + 1 < world.height && (y + 1 < maximumY || work[tile + world.tileColumns] !== 0)) exchangeTemperature(world, index, index + world.width)
        if (world.material[index] === MaterialId.Empty) {
          const ambientDifference = world.ambientTemperature - world.temperature[index]
          world.temperatureDelta[index] += Math.round(ambientDifference * HEAT_CAPACITY[MaterialId.Empty] * AIR_AMBIENT_EXCHANGE_FRACTION)
        }
      }
    }
  }
  for (let tile = 0; tile < work.length; tile += 1) {
    if (work[tile] === 0) continue
    const tileX = tile % world.tileColumns
    const tileY = Math.floor(tile / world.tileColumns)
    const minimumX = tileX * ACTIVITY_TILE_SIZE
    const maximumX = Math.min(world.width, minimumX + ACTIVITY_TILE_SIZE)
    const minimumY = tileY * ACTIVITY_TILE_SIZE
    const maximumY = Math.min(world.height, minimumY + ACTIVITY_TILE_SIZE)
    for (let y = minimumY; y < maximumY; y += 1) {
      for (let x = minimumX; x < maximumX; x += 1) {
        const index = y * world.width + x
        const previousTemperature = world.temperature[index]
        const capacity = HEAT_CAPACITY[world.material[index]]
        const totalEnergy = world.thermalRemainder[index] + world.temperatureDelta[index]
        const temperatureDelta = Math.trunc(totalEnergy / capacity)
        let nextTemperature = clampTemperature(previousTemperature + temperatureDelta)
        let nextRemainder = nextTemperature === MINIMUM_TEMPERATURE || nextTemperature === MAXIMUM_TEMPERATURE
          ? 0
          : totalEnergy - temperatureDelta * capacity
        if (world.activityEnabled && world.material[index] === MaterialId.Empty
          && Math.abs(nextTemperature - world.ambientTemperature) <= 1) {
          nextTemperature = world.ambientTemperature
          nextRemainder = 0
        }
        world.temperature[index] = nextTemperature
        world.thermalRemainder[index] = nextRemainder
        if (nextTemperature !== previousTemperature) {
          const flags = ActivityFlag.Thermal | ActivityFlag.Visual
            | (world.moisture[index] > 0 ? ActivityFlag.Moisture : 0)
          markCellActivity(world, index, flags)
        }
        if (world.material[index] === MaterialId.Empty && Math.abs(nextTemperature - world.ambientTemperature) > 1) {
          markCellActivity(world, index, ActivityFlag.Thermal)
        }
      }
    }
  }
}

function updatePhaseAndIgnition(world: World): void {
  const work = world.activityWorkTiles
  for (let tile = 0; tile < work.length; tile += 1) {
    if (work[tile] === 0) continue
    const tileX = tile % world.tileColumns
    const tileY = Math.floor(tile / world.tileColumns)
    const minimumX = tileX * ACTIVITY_TILE_SIZE
    const maximumX = Math.min(world.width, minimumX + ACTIVITY_TILE_SIZE)
    const minimumY = tileY * ACTIVITY_TILE_SIZE
    const maximumY = Math.min(world.height, minimumY + ACTIVITY_TILE_SIZE)
    for (let y = minimumY; y < maximumY; y += 1) {
      for (let x = minimumX; x < maximumX; x += 1) {
        const index = y * world.width + x
        const materialId = world.material[index] as MaterialIdValue
        if (materialId === MaterialId.Empty) {
          const changed = world.phaseProgress[index] !== 0 || world.status[index] !== 0
          world.phaseProgress[index] = 0
          world.status[index] = 0
          if (changed) markCellActivity(world, index, ActivityFlag.Visual)
          continue
        }
        let materialProperties = MATERIAL_PROPERTIES[materialId]
        const transition = activePhaseTransition(world, index, materialProperties)
        if (transition) {
          const distance = Math.abs(world.temperature[index] - transition.temperature)
          const availableEnergy = distance * materialProperties.heatCapacity
          const neededEnergy = Math.max(0, transition.latentHeat - world.phaseProgress[index])
          const absorbedEnergy = Math.min(availableEnergy, neededEnergy)
          world.phaseProgress[index] = Math.min(0xffff_ffff, world.phaseProgress[index] + absorbedEnergy)
          const direction = transition.direction === 'above' ? 1 : -1
          world.temperature[index] = transition.temperature
          markCellActivity(world, index, ActivityFlag.Thermal | ActivityFlag.Visual)
          if (world.phaseProgress[index] < transition.latentHeat) markCellActivity(world, index, ActivityFlag.Thermal)
          if (world.phaseProgress[index] >= transition.latentHeat) {
            const productProperties = MATERIAL_PROPERTIES[transition.product as MaterialIdValue]
            const remainingEnergy = availableEnergy - absorbedEnergy
            const retainedTemperature = transition.temperature + direction * Math.trunc(remainingEnergy / productProperties.heatCapacity)
            completePhaseTransition(world, index, transition, retainedTemperature)
            materialProperties = MATERIAL_PROPERTIES[world.material[index] as MaterialIdValue]
          }
        } else {
          world.phaseProgress[index] = Math.max(0, world.phaseProgress[index] - materialProperties.heatCapacity)
          if (world.phaseProgress[index] > 0) markCellActivity(world, index, ActivityFlag.Thermal)
        }

        const ignitionTemperature = materialProperties.ignitionTemperature
        if (ignitionTemperature === null || world.fuel[index] <= 0 || (world.status[index] & StatusFlag.Burning)) continue
        const capacity = materialProperties.moistureCapacity
        const saturation = capacity > 0 ? world.moisture[index] / capacity : 0
        if (saturation >= 0.35) continue
        const adjustedIgnition = ignitionTemperature + Math.round(saturation * 250)
        if (world.temperature[index] >= adjustedIgnition) {
          world.status[index] |= StatusFlag.Burning
          markCellActivity(world, index, ActivityFlag.Movement | ActivityFlag.Visual)
        }
      }
    }
  }
}

function transferWaterIntoPorousMaterials(world: World, work: Uint8Array): void {
  for (let tile = 0; tile < work.length; tile += 1) {
    if (work[tile] === 0) continue
    const tileX = tile % world.tileColumns
    const tileY = Math.floor(tile / world.tileColumns)
    const minimumX = tileX * ACTIVITY_TILE_SIZE
    const maximumX = Math.min(world.width, minimumX + ACTIVITY_TILE_SIZE)
    const minimumY = tileY * ACTIVITY_TILE_SIZE
    const maximumY = Math.min(world.height, minimumY + ACTIVITY_TILE_SIZE)
    for (let y = minimumY; y < maximumY; y += 1) {
      for (let x = minimumX; x < maximumX; x += 1) {
        const source = y * world.width + x
        if ((world.material[source] !== MaterialId.Water && world.material[source] !== MaterialId.SaltWater) || world.liquidMass[source] === 0) continue
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
          markCellActivity(world, source, ActivityFlag.Moisture | ActivityFlag.Movement | ActivityFlag.Electrical | ActivityFlag.Visual)
          markCellActivity(world, target, ActivityFlag.Moisture | ActivityFlag.Movement | ActivityFlag.Electrical | ActivityFlag.Visual)
          if (world.liquidMass[source] === 0) break
        }
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
  markCellActivity(world, donor, ActivityFlag.Moisture | ActivityFlag.Movement | ActivityFlag.Electrical | ActivityFlag.Visual)
  markCellActivity(world, receiver, ActivityFlag.Moisture | ActivityFlag.Movement | ActivityFlag.Electrical | ActivityFlag.Visual)
}

function evaporateMoisture(world: World, index: number): void {
  if (world.moisture[index] <= 0 || world.temperature[index] <= 60) return
  const materialProperties = properties(world, index)
  const amount = Math.min(world.moisture[index], 1 + Math.trunc((world.temperature[index] - 60) / 35))
  world.moisture[index] -= amount
  world.temperature[index] = clampTemperature(world.temperature[index] - Math.max(1, Math.trunc(amount * 18 / materialProperties.heatCapacity)))
  markCellActivity(world, index, ActivityFlag.Moisture | ActivityFlag.Movement | ActivityFlag.Thermal | ActivityFlag.Visual)
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
  const work = prepareActivityWork(world, ActivityFlag.Moisture)
  if (!world.activityEnabled) world.moistureDelta.fill(0)
  else {
    for (let tile = 0; tile < work.length; tile += 1) {
      if (work[tile] === 0) continue
      const tileX = tile % world.tileColumns
      const tileY = Math.floor(tile / world.tileColumns)
      const minimumX = tileX * ACTIVITY_TILE_SIZE
      const maximumX = Math.min(world.width, minimumX + ACTIVITY_TILE_SIZE)
      const minimumY = tileY * ACTIVITY_TILE_SIZE
      const maximumY = Math.min(world.height, minimumY + ACTIVITY_TILE_SIZE)
      for (let y = minimumY; y < maximumY; y += 1) {
        world.moistureDelta.fill(0, y * world.width + minimumX, y * world.width + maximumX)
      }
    }
  }
  clearActivityFlag(world, ActivityFlag.Moisture)
  transferWaterIntoPorousMaterials(world, work)
  for (let tile = 0; tile < work.length; tile += 1) {
    if (work[tile] === 0) continue
    const tileX = tile % world.tileColumns
    const tileY = Math.floor(tile / world.tileColumns)
    const minimumX = tileX * ACTIVITY_TILE_SIZE
    const maximumX = Math.min(world.width, minimumX + ACTIVITY_TILE_SIZE)
    const minimumY = tileY * ACTIVITY_TILE_SIZE
    const maximumY = Math.min(world.height, minimumY + ACTIVITY_TILE_SIZE)
    for (let y = minimumY; y < maximumY; y += 1) {
      for (let x = minimumX; x < maximumX; x += 1) {
        const index = y * world.width + x
        if (x + 1 < world.width && (x + 1 < maximumX || work[tile + 1] !== 0)) diffuseMoistureEdge(world, index, index + 1)
        if (y + 1 < world.height && (y + 1 < maximumY || work[tile + world.tileColumns] !== 0)) diffuseMoistureEdge(world, index, index + world.width)
      }
    }
  }
  for (let tile = 0; tile < work.length; tile += 1) {
    if (work[tile] === 0) continue
    const tileX = tile % world.tileColumns
    const tileY = Math.floor(tile / world.tileColumns)
    const minimumX = tileX * ACTIVITY_TILE_SIZE
    const maximumX = Math.min(world.width, minimumX + ACTIVITY_TILE_SIZE)
    const minimumY = tileY * ACTIVITY_TILE_SIZE
    const maximumY = Math.min(world.height, minimumY + ACTIVITY_TILE_SIZE)
    for (let y = minimumY; y < maximumY; y += 1) {
      for (let x = minimumX; x < maximumX; x += 1) {
        const index = y * world.width + x
        const previousMoisture = world.moisture[index]
        const previousStatus = world.status[index]
        const capacity = properties(world, index).moistureCapacity
        world.moisture[index] = Math.max(0, Math.min(capacity, previousMoisture + world.moistureDelta[index]))
        evaporateMoisture(world, index)
        if (world.moisture[index] > 0) world.status[index] |= StatusFlag.Wet
        else world.status[index] &= ~StatusFlag.Wet
        if (world.moisture[index] !== previousMoisture || world.status[index] !== previousStatus) {
          markCellActivity(world, index, ActivityFlag.Moisture | ActivityFlag.Movement | ActivityFlag.Electrical | ActivityFlag.Visual)
        }
        if (world.moisture[index] > 0 && world.temperature[index] > 60) markCellActivity(world, index, ActivityFlag.Moisture)
        if ((world.material[index] === MaterialId.Water || world.material[index] === MaterialId.SaltWater) && world.liquidMass[index] === 0) emptyCell(world, index)
      }
    }
  }
}

export function updatePhysicalWorld(world: World): void {
  if (world.tick % MOISTURE_INTERVAL === 0) updateMoisture(world)
  if (world.tick % THERMAL_INTERVAL !== 0) return
  conductTemperature(world)
  updatePhaseAndIgnition(world)
}
