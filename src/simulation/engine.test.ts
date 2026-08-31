import { describe, expect, it } from 'vitest'
import { AMBIENT_TEMPERATURE, THERMAL_ENERGY_UNIT_J_M3 } from './constants'
import { clearWorld, createWorld, paintCircle, paintStroke, replaceWorld, snapshotWorld, stepWorld } from './engine'
import {
  FIRE_LIFETIME_MIN,
  MATERIALS,
  MATERIAL_PROPERTIES,
  MATERIAL_REACTIONS,
  MaterialId,
  type MaterialIdValue,
  applyExplosion,
  initializeTransientState,
  reactMaterialPair,
  StatusFlag,
} from './materials'
import { cellColor } from './render'
import { bytesToBase64, parseSave, serializeSnapshot } from './serialization'
import { CELL_COUNT } from './types'
import { titleMask } from './title'

function index(world: ReturnType<typeof createWorld>, x: number, y: number): number {
  return y * world.width + x
}

function place(world: ReturnType<typeof createWorld>, x: number, y: number, materialId: MaterialIdValue, temperature?: number): number {
  const cell = index(world, x, y)
  world.material[cell] = materialId
  initializeTransientState(world, cell, materialId)
  if (temperature !== undefined) world.temperature[cell] = temperature
  return cell
}

function step(world: ReturnType<typeof createWorld>, count: number): void {
  for (let tick = 0; tick < count; tick += 1) stepWorld(world)
}

describe('startup title', () => {
  it('creates a deterministic centered Wood bitmap with initialized fuel', () => {
    const world = createWorld(42)
    const mask = titleMask(world.width, world.height)
    const wood = [...world.material].filter((value) => value === MaterialId.Wood).length
    expect(wood).toBe(1_728)
    expect([...mask].reduce((sum, value) => sum + value, 0)).toBe(wood)
    const firstWood = world.material.findIndex((material) => material === MaterialId.Wood)
    expect(world.fuel[firstWood]).toBe(MATERIAL_PROPERTIES[MaterialId.Wood].fuel)
  })
})

describe('material model', () => {
  it('defines physical fields for every material and reserves pair rules for chemistry', () => {
    const materialIds = Object.values(MaterialId)
    expect(Object.keys(MATERIAL_PROPERTIES)).toHaveLength(materialIds.length)
    expect(MATERIALS.map((material) => material.id)).toEqual(materialIds)
    for (const materialId of materialIds) {
      const properties = MATERIAL_PROPERTIES[materialId]
      expect(properties.massDensity).toBeGreaterThan(0)
      expect(properties.specificHeatCapacity).toBeGreaterThan(0)
      expect(properties.thermalConductivity).toBeGreaterThanOrEqual(0)
      expect(properties.heatCapacity).toBeGreaterThan(0)
      expect(properties.heatCapacity).toBe(Math.max(1, Math.round(properties.massDensity * properties.specificHeatCapacity / THERMAL_ENERGY_UNIT_J_M3)))
      expect(properties.moistureCapacity).toBeGreaterThanOrEqual(0)
    }
    expect(MATERIAL_REACTIONS.length).toBe(4)
    expect(MATERIAL_REACTIONS.every((reaction) => reaction.materials.includes(MaterialId.Acid))).toBe(true)
    expect(reactMaterialPair(createWorld(1, false, 2, 1), 0, 1)).toBe(false)
  })

  it('moves Sand down and diagonally while preserving its physical state', () => {
    const world = createWorld(1, false, 5, 5)
    const sand = place(world, 2, 1, MaterialId.Sand, 130)
    world.moisture[sand] = 50
    stepWorld(world)
    const firstSand = world.material.findIndex((value) => value === MaterialId.Sand)
    const firstX = firstSand % world.width
    expect(Math.floor(firstSand / world.width)).toBe(2)
    expect(world.temperature[firstSand]).toBe(130)
    expect(world.moisture[firstSand]).toBe(50)
    place(world, firstX, 3, MaterialId.Stone)
    stepWorld(world)
    const secondSand = world.material.findIndex((value) => value === MaterialId.Sand)
    expect(Math.floor(secondSand / world.width)).toBe(3)
    expect(secondSand % world.width).not.toBe(firstX)
  })

  it('lets denser Sand and Water displace lighter fluids', () => {
    const sandWorld = createWorld(3, false, 3, 4)
    place(sandWorld, 1, 1, MaterialId.Sand)
    place(sandWorld, 1, 2, MaterialId.Water)
    place(sandWorld, 0, 2, MaterialId.Stone)
    place(sandWorld, 2, 2, MaterialId.Stone)
    place(sandWorld, 1, 3, MaterialId.Stone)
    sandWorld.updatedAt[index(sandWorld, 1, 2)] = 1
    stepWorld(sandWorld)
    expect(sandWorld.material[index(sandWorld, 1, 2)]).toBe(MaterialId.Sand)

    const waterWorld = createWorld(24, false, 1, 4)
    place(waterWorld, 0, 1, MaterialId.Water)
    place(waterWorld, 0, 2, MaterialId.Oil)
    place(waterWorld, 0, 3, MaterialId.Stone)
    stepWorld(waterWorld)
    expect(waterWorld.material[index(waterWorld, 0, 1)]).toBe(MaterialId.Oil)
    expect(waterWorld.material[index(waterWorld, 0, 2)]).toBe(MaterialId.Water)
  })

  it('levels Water into rows instead of retaining a powder mound', () => {
    const world = createWorld(0x1a2b3c, false, 14, 8)
    for (let y = 0; y < world.height; y += 1) {
      place(world, 0, y, MaterialId.Stone)
      place(world, 13, y, MaterialId.Stone)
    }
    for (let x = 0; x < world.width; x += 1) place(world, x, 7, MaterialId.Stone)
    for (let y = 1; y <= 6; y += 1) for (let x = 5; x <= 8; x += 1) place(world, x, y, MaterialId.Water)
    step(world, 100)
    const columnCounts = Array.from({ length: 12 }, (_, offset) => {
      let count = 0
      for (let y = 0; y < 7; y += 1) if (world.material[index(world, offset + 1, y)] === MaterialId.Water) count += 1
      return count
    })
    expect(columnCounts.reduce((sum, count) => sum + count, 0)).toBe(24)
    expect(Math.max(...columnCounts) - Math.min(...columnCounts)).toBeLessThanOrEqual(1)
  })

  it('keeps stationary solids fixed', () => {
    const world = createWorld(5, false, 3, 4)
    place(world, 1, 1, MaterialId.Stone)
    place(world, 2, 1, MaterialId.Wood)
    stepWorld(world)
    expect(world.material[index(world, 1, 1)]).toBe(MaterialId.Stone)
    expect(world.material[index(world, 2, 1)]).toBe(MaterialId.Wood)
  })

  it('moves rising particles with randomized horizontal drift and finite lifetimes', () => {
    const visitedX = new Set<number>()
    const world = createWorld(6, false, 21, 21)
    const fire = place(world, 10, 18, MaterialId.Fire)
    world.state[fire] = 20
    for (let tick = 0; tick < 8; tick += 1) {
      stepWorld(world)
      const current = world.material.findIndex((value) => value === MaterialId.Fire)
      visitedX.add(current % world.width)
    }
    expect(visitedX.size).toBeGreaterThan(1)

    const smokeWorld = createWorld(10, false, 3, 5)
    const smoke = place(smokeWorld, 1, 3, MaterialId.Smoke)
    smokeWorld.state[smoke] = 2
    step(smokeWorld, 2)
    expect(smokeWorld.material.includes(MaterialId.Smoke)).toBe(false)
  })
})

describe('shared thermal physics', () => {
  it('conducts temperature over distance through connected Metal', () => {
    const world = createWorld(100, false, 7, 3)
    for (let x = 1; x <= 5; x += 1) place(world, x, 1, MaterialId.Metal)
    world.temperature[index(world, 1, 1)] = 900
    step(world, 90)
    expect(world.temperature[index(world, 5, 1)]).toBeGreaterThan(AMBIENT_TEMPERATURE + 30)
  })

  it('conducts through nearby air while the external environment suppresses long-range heating', () => {
    const world = createWorld(106, false, 15, 3)
    const source = index(world, 1, 1)
    const nearbyAir = index(world, 2, 1)
    const distantAir = index(world, 13, 1)
    for (let tick = 0; tick < 2_400; tick += 1) {
      world.temperature[source] = 1_000
      stepWorld(world)
    }
    expect(world.temperature[nearbyAir]).toBeGreaterThan(AMBIENT_TEMPERATURE + 5)
    expect(world.temperature[distantAir]).toBeLessThanOrEqual(AMBIENT_TEMPERATURE + 2)
  })

  it('cools air toward room temperature in proportion to its temperature difference', () => {
    const hot = createWorld(107, false, 1, 1)
    const warm = createWorld(108, false, 1, 1)
    hot.temperature[0] = 500
    warm.temperature[0] = 100
    step(hot, 120)
    step(warm, 120)
    expect(hot.temperature[0]).toBeLessThan(50)
    expect(warm.temperature[0]).toBeLessThanOrEqual(27)
    expect(500 - hot.temperature[0]).toBeGreaterThan(100 - warm.temperature[0])
  })

  it('boils Water through a Metal pan without a Fire-Water pair rule', () => {
    const world = createWorld(101, false, 7, 7)
    for (let x = 1; x <= 5; x += 1) place(world, x, 4, MaterialId.Stone)
    for (let x = 2; x <= 4; x += 1) place(world, x, 3, MaterialId.Metal)
    place(world, 2, 2, MaterialId.Metal)
    const water = place(world, 3, 2, MaterialId.Water)
    place(world, 4, 2, MaterialId.Metal)
    const fireCell = index(world, 3, 4)
    let producedSteam = false
    for (let tick = 0; tick < 1_800 && !producedSteam; tick += 1) {
      if (world.material[fireCell] !== MaterialId.Fire) {
        place(world, 3, 4, MaterialId.Fire)
        world.state[fireCell] = FIRE_LIFETIME_MIN
      }
      stepWorld(world)
      producedSteam = world.material.includes(MaterialId.Steam)
    }
    expect(producedSteam).toBe(true)
  })

  it('does not boil Water across an air gap before physical contact', () => {
    const world = createWorld(110, false, 3, 5)
    const water = place(world, 1, 1, MaterialId.Water)
    const pan = place(world, 1, 3, MaterialId.Metal, 600)
    for (let tick = 0; tick < 600; tick += 1) {
      world.updatedAt[water] = world.tick + 1
      world.temperature[pan] = 600
      stepWorld(world)
    }
    expect(world.material[water]).toBe(MaterialId.Water)
    expect(world.temperature[water]).toBeLessThan(100)
    expect(world.phaseProgress[water]).toBe(0)
  })

  it('conserves pair energy across unequal volumetric heat capacities', () => {
    const world = createWorld(111, false, 2, 1)
    const stone = place(world, 0, 0, MaterialId.Stone, 800)
    const metal = place(world, 1, 0, MaterialId.Metal, 20)
    const totalEnergy = () => world.temperature[stone] * MATERIAL_PROPERTIES[MaterialId.Stone].heatCapacity
      + world.temperature[metal] * MATERIAL_PROPERTIES[MaterialId.Metal].heatCapacity
      + world.thermalRemainder[stone] + world.thermalRemainder[metal]
    const before = totalEnergy()
    step(world, 120)
    expect(totalEnergy()).toBeCloseTo(before, 6)
    expect(world.temperature[stone]).toBeGreaterThan(world.temperature[metal])
  })

  it('transfers far less sensible heat from Spark than from Fire', () => {
    const transferred = (source: MaterialIdValue) => {
      const world = createWorld(112, false, 2, 1)
      place(world, 0, 0, source)
      const metal = place(world, 1, 0, MaterialId.Metal)
      step(world, 2)
      return world.temperature[metal] - AMBIENT_TEMPERATURE
    }
    expect(transferred(MaterialId.Spark)).toBeLessThan(transferred(MaterialId.Fire))
  })

  it('continues transferring Lava heat through an intervening Stone layer', () => {
    const world = createWorld(102, false, 5, 3)
    for (let x = 0; x < world.width; x += 1) {
      place(world, x, 0, MaterialId.Stone)
      place(world, x, 2, MaterialId.Stone)
    }
    place(world, 0, 1, MaterialId.Stone)
    const water = place(world, 1, 1, MaterialId.Water)
    const barrier = place(world, 2, 1, MaterialId.Stone)
    const lava = place(world, 3, 1, MaterialId.Lava)
    place(world, 4, 1, MaterialId.Stone)
    step(world, 180)
    expect(world.temperature[barrier]).toBeGreaterThan(AMBIENT_TEMPERATURE + 70)
    expect(world.temperature[water]).toBeGreaterThan(AMBIENT_TEMPERATURE)
    expect(world.temperature[lava]).toBeLessThan(1_200)
    expect(reactMaterialPair(world, water, lava)).toBe(false)
  })

  it('melts Stone into Lava and freezes cooled Lava into Stone using phase properties', () => {
    const hot = createWorld(103, false, 5, 5)
    for (let y = 0; y < hot.height; y += 1) for (let x = 0; x < hot.width; x += 1) place(hot, x, y, MaterialId.Stone, 1_800)
    step(hot, 90)
    expect(hot.material.includes(MaterialId.Lava)).toBe(true)

    const cold = createWorld(104, false, 3, 3)
    for (let x = 0; x < 3; x += 1) place(cold, x, 2, MaterialId.Stone, 700)
    place(cold, 0, 1, MaterialId.Stone, 700)
    const lava = place(cold, 1, 1, MaterialId.Lava, 700)
    place(cold, 2, 1, MaterialId.Stone, 700)
    step(cold, 120)
    expect(cold.material[lava]).toBe(MaterialId.Stone)
  })

  it('uses latent progress rather than instant temperature thresholds', () => {
    const world = createWorld(105, false, 3, 3)
    for (let x = 0; x < 3; x += 1) place(world, x, 2, MaterialId.Stone, 20)
    place(world, 0, 1, MaterialId.Stone, 20)
    place(world, 2, 1, MaterialId.Stone, 20)
    const ice = place(world, 1, 1, MaterialId.Ice, 20)
    step(world, 2)
    expect(world.material[ice]).toBe(MaterialId.Ice)
    expect(world.phaseProgress[ice]).toBeGreaterThan(0)
    expect(world.temperature[ice]).toBe(0)
    for (let tick = 0; tick < 600 && world.material[ice] === MaterialId.Ice; tick += 1) {
      for (let cell = 0; cell < world.material.length; cell += 1) {
        if (world.material[cell] === MaterialId.Stone) world.temperature[cell] = 20
      }
      stepWorld(world)
    }
    expect(world.material[ice]).toBe(MaterialId.Water)
  })

  it('requires continued energy input to complete a phase transition', () => {
    const world = createWorld(109, false, 1, 1)
    const water = place(world, 0, 0, MaterialId.Water, 101)
    step(world, 120)
    expect(world.material[water]).toBe(MaterialId.Water)
    expect(world.temperature[water]).toBe(100)
    expect(world.phaseProgress[water]).toBeGreaterThan(0)
    expect(world.phaseProgress[water]).toBeLessThan(MATERIAL_PROPERTIES[MaterialId.Water].phaseTransitions[0].latentHeat)
  })
})

describe('moisture and combustion', () => {
  it('refreshes painted Fire as a sustained heat source', () => {
    const world = createWorld(199, false, 5, 5)
    paintCircle(world, 2, 2, 1, MaterialId.Fire)
    const fire = index(world, 2, 2)
    world.temperature[fire] = 200
    world.state[fire] = 1
    paintCircle(world, 2, 2, 1, MaterialId.Fire)
    expect(world.temperature[fire]).toBe(MATERIAL_PROPERTIES[MaterialId.Fire].initialTemperature)
    expect(world.state[fire]).toBeGreaterThanOrEqual(FIRE_LIFETIME_MIN)
  })

  it('absorbs Water and diffuses moisture into the interior of a Gunpowder pile', () => {
    const world = createWorld(200, false, 8, 3)
    for (let x = 0; x < world.width; x += 1) {
      place(world, x, 0, MaterialId.Stone)
      place(world, x, 2, MaterialId.Stone)
    }
    const water = place(world, 0, 1, MaterialId.Water)
    for (let x = 1; x <= 6; x += 1) place(world, x, 1, MaterialId.Gunpowder)
    place(world, 7, 1, MaterialId.Stone)
    step(world, 360)
    expect(world.moisture[index(world, 1, 1)]).toBeGreaterThan(0)
    expect(world.moisture[index(world, 5, 1)]).toBeGreaterThan(0)
    expect(world.liquidMass[water]).toBeLessThan(255)
  })

  it('prevents saturated Gunpowder from igniting until it dries', () => {
    const world = createWorld(201, false, 3, 3)
    for (let x = 0; x < 3; x += 1) place(world, x, 2, MaterialId.Stone)
    place(world, 0, 1, MaterialId.Stone)
    place(world, 2, 1, MaterialId.Stone)
    const powder = place(world, 1, 1, MaterialId.Gunpowder, 900)
    world.moisture[powder] = 220
    step(world, 6)
    expect(world.material[powder]).toBe(MaterialId.Gunpowder)
    expect(world.status[powder] & StatusFlag.Burning).toBe(0)
    world.moisture[powder] = 0
    world.temperature[powder] = 300
    step(world, 2)
    expect(world.status[powder] & StatusFlag.Burning).toBe(StatusFlag.Burning)
    stepWorld(world)
    expect(world.material.includes(MaterialId.Fire)).toBe(true)
  })

  it('lets warm Oil ignite readily through the shared ignition evaluator', () => {
    const world = createWorld(204, false, 3, 3)
    for (let y = 0; y < world.height; y += 1) {
      for (let x = 0; x < world.width; x += 1) place(world, x, y, MaterialId.Oil, 200)
    }
    step(world, 2)
    expect(world.status.some((status) => Boolean(status & StatusFlag.Burning))).toBe(true)
  })

  it('applies generalized explosion heat, pressure destruction, resistance, and explosive chaining', () => {
    const world = createWorld(205, false, 11, 11)
    const origin = place(world, 5, 5, MaterialId.Gunpowder, 300)
    const chained = place(world, 5, 4, MaterialId.Gunpowder)
    const metal = place(world, 4, 5, MaterialId.Metal)
    let plantCount = 0
    for (let y = 3; y <= 7; y += 1) {
      for (let x = 3; x <= 7; x += 1) {
        const cell = index(world, x, y)
        if (world.material[cell] !== MaterialId.Empty) continue
        place(world, x, y, MaterialId.Plant)
        plantCount += 1
      }
    }
    applyExplosion(world, origin, 5, 5, MATERIAL_PROPERTIES[MaterialId.Gunpowder])
    expect(world.material[origin]).toBe(MaterialId.Fire)
    expect(world.material[chained]).toBe(MaterialId.Gunpowder)
    expect(world.status[chained] & StatusFlag.Burning).toBe(StatusFlag.Burning)
    expect(world.temperature[chained]).toBeGreaterThan(AMBIENT_TEMPERATURE)
    expect(world.material[metal]).toBe(MaterialId.Metal)
    expect(world.temperature[metal]).toBeGreaterThan(AMBIENT_TEMPERATURE)
    const survivingPlants = world.material.reduce((count, material) => count + Number(material === MaterialId.Plant), 0)
    expect(survivingPlants).toBeLessThan(plantCount)
  })

  it('spreads Wood combustion through heat rather than a Wood-Wood reaction', () => {
    const world = createWorld(202, false, 7, 5)
    for (let x = 0; x < world.width; x += 1) place(world, x, 4, MaterialId.Stone)
    const burning = place(world, 2, 3, MaterialId.Wood, 500)
    const neighbor = place(world, 3, 3, MaterialId.Wood)
    world.status[burning] |= StatusFlag.Burning
    let neighborIgnited = false
    for (let tick = 0; tick < 180 && !neighborIgnited; tick += 1) {
      stepWorld(world)
      neighborIgnited = Boolean(world.status[neighbor] & StatusFlag.Burning)
    }
    expect(neighborIgnited).toBe(true)
    expect(MATERIAL_REACTIONS.some((reaction) => reaction.materials[0] === MaterialId.Wood && reaction.materials[1] === MaterialId.Wood)).toBe(false)
  })

  it('lets Water cool and wet burning Wood through shared fields', () => {
    const world = createWorld(203, false, 5, 4)
    for (let x = 0; x < world.width; x += 1) place(world, x, 3, MaterialId.Stone)
    const wood = place(world, 2, 2, MaterialId.Wood, 450)
    place(world, 0, 2, MaterialId.Stone)
    place(world, 1, 2, MaterialId.Water)
    place(world, 3, 2, MaterialId.Stone)
    world.status[wood] |= StatusFlag.Burning
    step(world, 60)
    expect(world.moisture[wood]).toBeGreaterThan(0)
    expect(world.status[wood] & StatusFlag.Burning).toBe(0)
  })

  it('renders continuous moisture and fuel-driven burning distinctly', () => {
    const world = createWorld(204, false, 3, 3)
    const wood = place(world, 1, 1, MaterialId.Wood)
    const normal = cellColor(world, wood)
    world.moisture[wood] = 90
    const wet = cellColor(world, wood)
    world.moisture[wood] = 0
    world.status[wood] |= StatusFlag.Burning
    world.fuel[wood] = 100
    const burning = cellColor(world, wood)
    expect(wet).not.toEqual(normal)
    expect(burning).not.toEqual(normal)
  })

  it('renders a translucent hot and cold haze even over air', () => {
    const world = createWorld(206, false, 1, 1)
    const ambient = cellColor(world, 0)
    world.temperature[0] = 1_000
    const hot = cellColor(world, 0)
    world.temperature[0] = -100
    const cold = cellColor(world, 0)
    expect(hot).not.toEqual(ambient)
    expect(cold).not.toEqual(ambient)
    expect(hot).not.toEqual(cold)
  })
})

describe('specific chemistry and existing electricity', () => {
  it('heats Acid through the shared solver and boils it into vapor with sustained energy', () => {
    const world = createWorld(28, false, 2, 1)
    const acid = place(world, 0, 0, MaterialId.Acid)
    const heater = place(world, 1, 0, MaterialId.Glass, 500)
    step(world, 2)
    expect(world.temperature[acid]).toBeGreaterThan(AMBIENT_TEMPERATURE)

    for (let tick = 0; tick < 1_000 && world.material[acid] === MaterialId.Acid; tick += 1) {
      world.temperature[heater] = 500
      world.updatedAt[acid] = world.tick + 1
      stepWorld(world)
    }
    expect(world.material[acid]).toBe(MaterialId.Steam)
  })

  it('keeps Acid corrosion as a sparse identity-specific reaction', () => {
    const world = createWorld(27, false, 5, 2)
    const acid = place(world, 0, 0, MaterialId.Acid)
    const plant = place(world, 1, 0, MaterialId.Plant)
    const stone = place(world, 2, 0, MaterialId.Stone)
    const glass = place(world, 3, 0, MaterialId.Glass)
    for (let attempt = 0; attempt < 600 && world.material[plant] === MaterialId.Plant; attempt += 1) reactMaterialPair(world, acid, plant)
    expect(world.material[plant]).toBe(MaterialId.Empty)
    expect(reactMaterialPair(world, acid, stone)).toBe(false)
    expect(reactMaterialPair(world, acid, glass)).toBe(false)
  })

  it('preserves current Spark-to-Metal charging behavior', () => {
    const world = createWorld(29, false, 3, 5)
    const metal = place(world, 1, 2, MaterialId.Metal)
    const spark = place(world, 1, 3, MaterialId.Spark)
    world.state[spark] = 4
    stepWorld(world)
    expect(world.material.includes(MaterialId.Spark)).toBe(false)
    expect(world.status[metal] & StatusFlag.Charged).toBe(StatusFlag.Charged)
  })
})

describe('world commands and persistence', () => {
  it('produces equal grids for equal seeds and commands', () => {
    const first = createWorld(123, false, 20, 20)
    const second = createWorld(123, false, 20, 20)
    paintStroke(first, 2, 2, 16, 3, 3, MaterialId.Sand)
    paintStroke(second, 2, 2, 16, 3, 3, MaterialId.Sand)
    step(first, 20)
    step(second, 20)
    expect(snapshotWorld(first)).toEqual(snapshotWorld(second))
  })

  it('clears all material state and restores ambient air', () => {
    const world = createWorld(12)
    world.state.fill(99)
    world.status.fill(StatusFlag.Wet)
    world.temperature.fill(900)
    world.moisture.fill(200)
    world.fuel.fill(100)
    world.liquidMass.fill(80)
    world.phaseProgress.fill(40)
    clearWorld(world)
    expect(world.material.every((value) => value === 0)).toBe(true)
    expect(world.state.every((value) => value === 0)).toBe(true)
    expect(world.status.every((value) => value === 0)).toBe(true)
    expect(world.temperature.every((value) => value === AMBIENT_TEMPERATURE)).toBe(true)
    expect(world.moisture.every((value) => value === 0)).toBe(true)
    expect(world.fuel.every((value) => value === 0)).toBe(true)
    expect(world.liquidMass.every((value) => value === 0)).toBe(true)
    expect(world.phaseProgress.every((value) => value === 0)).toBe(true)
  })

  it('round-trips save version 5 exactly', () => {
    const world = createWorld(13)
    world.tick = 12_345
    const serialized = serializeSnapshot(snapshotWorld(world), 'FIRE TEST', '2026-08-31T00:00:00.000Z')
    const parsed = parseSave(serialized)
    expect(parsed.snapshot).toEqual(snapshotWorld(world))
    expect(parsed.file.version).toBe(5)
  })

  it('loads version 4 saves with 16-bit phase progress', () => {
    const world = createWorld(14)
    const current = serializeSnapshot(snapshotWorld(world), 'V4 SAVE', '2026-08-31T00:00:00.000Z')
    const legacyPhase = new Uint8Array(CELL_COUNT * 2)
    legacyPhase[0] = 42
    const legacy = {
      ...current,
      version: 4,
      simulation: { ...current.simulation, phaseProgress: bytesToBase64(legacyPhase) },
    }
    const parsed = parseSave(legacy)
    expect(parsed.file.version).toBe(4)
    expect(parsed.snapshot.phaseProgress).toBeInstanceOf(Uint32Array)
    expect(parsed.snapshot.phaseProgress[0]).toBe(42)
  })

  it('migrates version 3 heat and Wet status into temperature and moisture', () => {
    const world = createWorld(30)
    const wood = index(world, 1, 1)
    world.material[wood] = MaterialId.Wood
    const current = serializeSnapshot(snapshotWorld(world), 'LEGACY', '2026-08-31T00:00:00.000Z')
    const heat = new Uint8Array(CELL_COUNT)
    heat[wood] = 255
    const status = new Uint8Array(CELL_COUNT)
    status[wood] = StatusFlag.Wet | StatusFlag.Burning
    const legacy = {
      format: current.format,
      version: 3,
      grid: current.grid,
      simulation: {
        tick: current.simulation.tick,
        seed: current.simulation.seed,
        randomState: current.simulation.randomState,
        material: current.simulation.material,
        state: current.simulation.state,
        status: bytesToBase64(status),
        heat: bytesToBase64(heat),
      },
      metadata: current.metadata,
    }
    const parsed = parseSave(legacy)
    expect(parsed.file.version).toBe(3)
    expect(parsed.snapshot.temperature[wood]).toBeGreaterThan(AMBIENT_TEMPERATURE)
    expect(parsed.snapshot.moisture[wood]).toBe(MATERIAL_PROPERTIES[MaterialId.Wood].moistureCapacity)
    expect(parsed.snapshot.fuel[wood]).toBe(MATERIAL_PROPERTIES[MaterialId.Wood].fuel)
  })

  it('rejects invalid saves and replaces complete validated snapshots', () => {
    const source = createWorld(15)
    const target = createWorld(16, false)
    const before = snapshotWorld(source)
    expect(() => parseSave({ format: 'kinetic-pixels', version: 99 })).toThrow()
    expect(snapshotWorld(source)).toEqual(before)
    replaceWorld(target, before)
    expect(snapshotWorld(target)).toEqual(before)
  })
})
