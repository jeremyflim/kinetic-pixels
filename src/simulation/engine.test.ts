import { describe, expect, it } from 'vitest'
import { clearWorld, createWorld, paintStroke, replaceWorld, snapshotWorld, stepWorld } from './engine'
import {
  BURN_PROGRESS_LIMIT,
  BURNING_WOOD_SPREAD_SCALE,
  FIRE_LIFETIME_MIN,
  MATERIALS,
  MATERIAL_PROPERTIES,
  MATERIAL_REACTIONS,
  MaterialId,
  reactMaterialPair,
  StatusFlag,
  WOOD_BURN_DURATION,
} from './materials'
import { cellColor } from './render'
import { bytesToBase64, parseSave, serializeSnapshot } from './serialization'
import { titleMask } from './title'

function index(world: ReturnType<typeof createWorld>, x: number, y: number): number {
  return y * world.width + x
}

describe('startup title', () => {
  it('creates a deterministic centered Wood bitmap', () => {
    const world = createWorld(42)
    const mask = titleMask(world.width, world.height)
    const wood = [...world.material].filter((value) => value === MaterialId.Wood).length
    expect(wood).toBe(1_728)
    expect([...mask].reduce((sum, value) => sum + value, 0)).toBe(wood)
    expect(world.material[index(world, 160, 150)]).toBe(MaterialId.Empty)
  })
})

describe('materials', () => {
  it('defines a complete physical property table and sparse reaction registry', () => {
    const materialIds = Object.values(MaterialId)
    expect(Object.keys(MATERIAL_PROPERTIES)).toHaveLength(materialIds.length)
    expect(MATERIALS.map((material) => material.id)).toEqual(materialIds)
    for (const materialId of materialIds) {
      const properties = MATERIAL_PROPERTIES[materialId]
      expect(properties.density).toBeGreaterThanOrEqual(0)
      expect(properties.hardness).toBeGreaterThanOrEqual(0)
      expect(properties.friction).toBeGreaterThanOrEqual(0)
      expect(properties.friction).toBeLessThanOrEqual(1)
      expect(properties.flammability).toBeGreaterThanOrEqual(0)
      expect(properties.flammability).toBeLessThanOrEqual(1)
    }
    expect(MATERIAL_REACTIONS).toEqual(expect.arrayContaining([
      expect.objectContaining({ materials: [MaterialId.Fire, MaterialId.Wood], initiator: MaterialId.Fire }),
      expect.objectContaining({ materials: [MaterialId.Water, MaterialId.Fire], instant: true }),
      expect.objectContaining({ materials: [MaterialId.Wood, MaterialId.Wood], chancePerSecond: 0.08 }),
    ]))
  })

  it('moves Sand down, then diagonally around blockers', () => {
    const world = createWorld(1, false, 5, 5)
    world.material[index(world, 2, 1)] = MaterialId.Sand
    stepWorld(world)
    const firstSand = world.material.findIndex((value) => value === MaterialId.Sand)
    const firstX = firstSand % world.width
    expect(Math.floor(firstSand / world.width)).toBe(2)
    world.material[index(world, firstX, 3)] = MaterialId.Stone
    stepWorld(world)
    const secondSand = world.material.findIndex((value) => value === MaterialId.Sand)
    expect(Math.floor(secondSand / world.width)).toBe(3)
    expect(secondSand % world.width).not.toBe(firstX)
  })

  it('randomly drifts falling Sand left and right across deterministic seeds', () => {
    const deltas = new Set<number>()
    for (let seed = 1; seed <= 128; seed += 1) {
      const world = createWorld(Math.imul(seed, 0x9e3779b1), false, 5, 5)
      world.material[index(world, 2, 1)] = MaterialId.Sand
      stepWorld(world)
      const sandX = world.material.findIndex((value) => value === MaterialId.Sand) % world.width
      deltas.add(sandX - 2)
    }
    expect(deltas.has(-1)).toBe(true)
    expect(deltas.has(1)).toBe(true)
  })

  it('lets Sand displace Water', () => {
    const world = createWorld(3, false, 3, 4)
    world.material[index(world, 1, 1)] = MaterialId.Sand
    world.material[index(world, 1, 2)] = MaterialId.Water
    world.material[index(world, 0, 2)] = MaterialId.Stone
    world.material[index(world, 2, 2)] = MaterialId.Stone
    world.material[index(world, 1, 3)] = MaterialId.Stone
    world.updatedAt[index(world, 1, 2)] = 1
    stepWorld(world)
    expect(world.material[index(world, 1, 2)]).toBe(MaterialId.Sand)
    expect(world.material[index(world, 1, 1)]).toBe(MaterialId.Water)
  })

  it('moves Water down and laterally when blocked', () => {
    const world = createWorld(4, false, 5, 4)
    world.material[index(world, 2, 1)] = MaterialId.Water
    stepWorld(world)
    const firstWater = world.material.findIndex((value) => value === MaterialId.Water)
    const firstX = firstWater % world.width
    expect(Math.floor(firstWater / world.width)).toBe(2)
    for (let x = 0; x < world.width; x += 1) world.material[index(world, x, 3)] = MaterialId.Stone
    stepWorld(world)
    const secondWater = world.material.findIndex((value) => value === MaterialId.Water)
    expect(Math.floor(secondWater / world.width)).toBe(2)
    expect(secondWater % world.width).not.toBe(firstX)
  })

  it('randomly drifts falling Water left and right across deterministic seeds', () => {
    const deltas = new Set<number>()
    for (let seed = 1; seed <= 128; seed += 1) {
      const world = createWorld(Math.imul(seed, 0x9e3779b1), false, 5, 5)
      world.material[index(world, 2, 1)] = MaterialId.Water
      stepWorld(world)
      const waterX = world.material.findIndex((value) => value === MaterialId.Water) % world.width
      deltas.add(waterX - 2)
    }
    expect(deltas.has(-1)).toBe(true)
    expect(deltas.has(1)).toBe(true)
  })

  it('levels Water quickly instead of retaining a sand-like mound', () => {
    const world = createWorld(41, false, 17, 7)
    for (let x = 0; x < world.width; x += 1) world.material[index(world, x, 6)] = MaterialId.Stone
    for (let y = 1; y < 6; y += 1) world.material[index(world, 8, y)] = MaterialId.Water
    for (let tick = 0; tick < 18; tick += 1) stepWorld(world)
    const waterX = [...world.material]
      .map((material, cell) => material === MaterialId.Water ? cell % world.width : -1)
      .filter((x) => x >= 0)
    expect(waterX).toHaveLength(5)
    expect(Math.max(...waterX) - Math.min(...waterX)).toBeGreaterThanOrEqual(4)
    expect(new Set(waterX).size).toBe(5)
  })

  it('equalizes Water into level rows inside a basin', () => {
    const world = createWorld(0x1a2b3c, false, 14, 8)
    for (let y = 0; y < world.height; y += 1) {
      world.material[index(world, 0, y)] = MaterialId.Stone
      world.material[index(world, 13, y)] = MaterialId.Stone
    }
    for (let x = 0; x < world.width; x += 1) world.material[index(world, x, 7)] = MaterialId.Stone
    for (let y = 1; y <= 6; y += 1) {
      for (let x = 5; x <= 8; x += 1) world.material[index(world, x, y)] = MaterialId.Water
    }
    for (let tick = 0; tick < 100; tick += 1) stepWorld(world)
    const columnCounts = Array.from({ length: 12 }, (_, offset) => {
      const x = offset + 1
      let count = 0
      for (let y = 0; y < 7; y += 1) if (world.material[index(world, x, y)] === MaterialId.Water) count += 1
      return count
    })
    expect(columnCounts.reduce((sum, count) => sum + count, 0)).toBe(24)
    expect(Math.max(...columnCounts) - Math.min(...columnCounts)).toBeLessThanOrEqual(1)
  })

  it('keeps Stone and unlit Wood fixed', () => {
    const world = createWorld(5, false, 3, 4)
    world.material[index(world, 1, 1)] = MaterialId.Stone
    world.material[index(world, 2, 1)] = MaterialId.Wood
    stepWorld(world)
    expect(world.material[index(world, 1, 1)]).toBe(MaterialId.Stone)
    expect(world.material[index(world, 2, 1)]).toBe(MaterialId.Wood)
  })

  it('moves Fire upward and expires', () => {
    const world = createWorld(6, false, 3, 5)
    world.material[index(world, 1, 3)] = MaterialId.Fire
    world.state[index(world, 1, 3)] = 2
    stepWorld(world)
    const fire = world.material.findIndex((value) => value === MaterialId.Fire)
    expect(Math.floor(fire / world.width)).toBe(2)
    stepWorld(world)
    expect(world.material.includes(MaterialId.Fire)).toBe(false)
  })

  it('lets Fire ignite or immediately consume touching Wood', () => {
    const world = createWorld(7, false, 4, 4)
    world.material[index(world, 1, 2)] = MaterialId.Fire
    world.state[index(world, 1, 2)] = 100
    world.material[index(world, 2, 2)] = MaterialId.Wood
    for (let x = 0; x < 3; x += 1) world.material[index(world, x, 1)] = MaterialId.Stone
    for (let tick = 0; tick < 80 && world.material[index(world, 2, 2)] === MaterialId.Wood && !(world.status[index(world, 2, 2)] & StatusFlag.Burning); tick += 1) {
      stepWorld(world)
    }
    expect(
      world.material[index(world, 2, 2)] !== MaterialId.Wood
      || Boolean(world.status[index(world, 2, 2)] & StatusFlag.Burning),
    ).toBe(true)
  })

  it('gives touching Fire a rare deterministic chance to turn Wood directly into Smoke', () => {
    let flashed = false
    for (let seed = 1; seed <= 1_000 && !flashed; seed += 1) {
      const world = createWorld(seed, false, 5, 4)
      for (let x = 0; x < world.width; x += 1) world.material[index(world, x, 0)] = MaterialId.Stone
      world.material[index(world, 1, 1)] = MaterialId.Stone
      world.material[index(world, 3, 1)] = MaterialId.Stone
      world.material[index(world, 2, 1)] = MaterialId.Wood
      world.material[index(world, 2, 2)] = MaterialId.Fire
      world.state[index(world, 2, 2)] = FIRE_LIFETIME_MIN
      stepWorld(world)
      flashed = world.material[index(world, 2, 1)] === MaterialId.Smoke
    }
    expect(flashed).toBe(true)
  })

  it('lets Fire drift sideways as it rises', () => {
    const world = createWorld(6, false, 21, 21)
    world.material[index(world, 10, 18)] = MaterialId.Fire
    world.state[index(world, 10, 18)] = 20
    const visitedX = new Set([10])
    for (let tick = 0; tick < 8; tick += 1) {
      stepWorld(world)
      const fire = world.material.findIndex((value) => value === MaterialId.Fire)
      visitedX.add(fire % world.width)
    }
    expect(visitedX.size).toBeGreaterThan(1)
  })

  it('lets Water extinguish Fire and burning Wood while retaining Water', () => {
    const world = createWorld(8, false, 5, 5)
    world.material[index(world, 2, 2)] = MaterialId.Water
    world.material[index(world, 2, 1)] = MaterialId.Fire
    world.state[index(world, 2, 1)] = 20
    world.material[index(world, 3, 2)] = MaterialId.Wood
    world.status[index(world, 3, 2)] = StatusFlag.Burning
    world.state[index(world, 3, 2)] = 23
    stepWorld(world)
    expect(world.material.includes(MaterialId.Fire)).toBe(false)
    expect(world.status[index(world, 3, 2)] & StatusFlag.Burning).toBe(0)
    expect(world.state[index(world, 3, 2)]).toBe(0)
    expect(world.material.includes(MaterialId.Water)).toBe(true)
  })

  it('burning Wood emits only Smoke and disappears rapidly', () => {
    const world = createWorld(9, false, 5, 64)
    const wood = index(world, 2, 60)
    world.material[wood] = MaterialId.Wood
    world.status[wood] = StatusFlag.Burning
    for (let tick = 0; tick < WOOD_BURN_DURATION; tick += 1) stepWorld(world)
    const smokeCount = [...world.material].filter((material) => material === MaterialId.Smoke).length
    expect(smokeCount).toBeGreaterThan(0)
    expect(smokeCount).toBeLessThanOrEqual(4)
    expect(world.material.includes(MaterialId.Fire)).toBe(false)
    expect(WOOD_BURN_DURATION).toBeLessThanOrEqual(60)
    world.material[wood] = MaterialId.Wood
    world.status[wood] = StatusFlag.Burning
    world.state[wood] = BURN_PROGRESS_LIMIT - MATERIAL_PROPERTIES[MaterialId.Wood].burnRate
    stepWorld(world)
    expect(world.material[wood]).toBe(MaterialId.Empty)
  })

  it('spreads burning directly between adjacent Wood at a low probability without creating Fire', () => {
    let ignitions = 0
    let createdFire = false
    const samples = 5_000
    for (let seed = 1; seed <= samples; seed += 1) {
      const world = createWorld(Math.imul(seed, 0x9e3779b1), false, 7, 6)
      const burning = index(world, 2, 4)
      const neighbor = index(world, 3, 4)
      world.material[burning] = MaterialId.Wood
      world.status[burning] = StatusFlag.Burning
      world.material[neighbor] = MaterialId.Wood
      stepWorld(world)
      if (world.status[neighbor] & StatusFlag.Burning) ignitions += 1
      createdFire ||= world.material.includes(MaterialId.Fire)
    }
    const spreadChance = BURNING_WOOD_SPREAD_SCALE * MATERIAL_PROPERTIES[MaterialId.Wood].flammability
    expect(spreadChance).toBeLessThan(0.01)
    expect(ignitions).toBeGreaterThan(0)
    expect(ignitions / samples).toBeLessThan(0.015)
    expect(createdFire).toBe(false)
  })

  it('renders burning Wood with a distinct hot and charred palette', () => {
    const world = createWorld(19, false, 3, 3)
    const wood = index(world, 1, 1)
    world.material[wood] = MaterialId.Wood
    const normalColor = cellColor(world, wood)
    world.status[wood] = StatusFlag.Burning
    world.state[wood] = 20
    const burningColor = cellColor(world, wood)
    expect(burningColor).not.toEqual(normalColor)
    expect([
      [255, 190, 79],
      [255, 109, 74],
      [255, 71, 127],
      [104, 52, 43],
      [48, 37, 48],
    ]).toContainEqual(burningColor)
  })

  it('moves Smoke upward slowly and dissipates', () => {
    const world = createWorld(10, false, 3, 5)
    world.material[index(world, 1, 3)] = MaterialId.Smoke
    world.state[index(world, 1, 3)] = 2
    stepWorld(world)
    expect(world.material.includes(MaterialId.Smoke)).toBe(true)
    stepWorld(world)
    expect(world.material.includes(MaterialId.Smoke)).toBe(false)
  })

  it('randomly drifts rising Smoke left and right across deterministic seeds', () => {
    const deltas = new Set<number>()
    for (let seed = 1; seed <= 128; seed += 1) {
      const world = createWorld(Math.imul(seed, 0x9e3779b1), false, 5, 5)
      world.tick = 1
      world.material[index(world, 2, 3)] = MaterialId.Smoke
      world.state[index(world, 2, 3)] = 10
      stepWorld(world)
      const smokeX = world.material.findIndex((value) => value === MaterialId.Smoke) % world.width
      deltas.add(smokeX - 2)
    }
    expect(deltas.has(-1)).toBe(true)
    expect(deltas.has(1)).toBe(true)
  })

  it('carries heat and statuses with moving particles', () => {
    const world = createWorld(21, false, 3, 4)
    const sand = index(world, 1, 1)
    world.material[sand] = MaterialId.Sand
    world.heat[sand] = 80
    world.status[sand] = StatusFlag.Wet
    stepWorld(world)
    const moved = world.material.findIndex((material) => material === MaterialId.Sand)
    expect(moved).not.toBe(sand)
    expect(world.heat[moved]).toBe(80)
    expect(world.status[moved]).toBe(StatusFlag.Wet)
    expect(world.heat[sand]).toBe(0)
    expect(world.status[sand]).toBe(0)
  })

  it('turns sustained Fire-heated Sand into Glass without an instant contact reaction', () => {
    const world = createWorld(22, false, 5, 5)
    const sand = index(world, 2, 1)
    const fire = index(world, 2, 2)
    world.material[sand] = MaterialId.Sand
    world.material[index(world, 1, 1)] = MaterialId.Stone
    world.material[index(world, 3, 1)] = MaterialId.Stone
    world.material[index(world, 1, 2)] = MaterialId.Stone
    world.material[index(world, 3, 2)] = MaterialId.Stone
    let transformedAt = -1
    for (let tick = 0; tick < 300 && transformedAt < 0; tick += 1) {
      if (world.material[fire] === MaterialId.Empty) {
        world.material[fire] = MaterialId.Fire
        world.state[fire] = FIRE_LIFETIME_MIN
        world.heat[fire] = MATERIAL_PROPERTIES[MaterialId.Fire].initialHeat
      }
      stepWorld(world)
      if (world.material[sand] === MaterialId.Glass) transformedAt = tick + 1
    }
    expect(transformedAt).toBeGreaterThan(120)
    expect(transformedAt).toBeLessThan(300)
  })

  it('uses heat thresholds for ignition and phase changes', () => {
    const world = createWorld(23, false, 4, 4)
    const wood = index(world, 0, 3)
    const sand = index(world, 1, 3)
    const water = index(world, 2, 3)
    const ice = index(world, 3, 3)
    world.material[wood] = MaterialId.Wood
    world.material[sand] = MaterialId.Sand
    world.material[water] = MaterialId.Water
    world.material[ice] = MaterialId.Ice
    world.heat[wood] = MATERIAL_PROPERTIES[MaterialId.Wood].ignitionHeat!
    world.heat[sand] = MATERIAL_PROPERTIES[MaterialId.Sand].transitionHeat!
    world.heat[water] = MATERIAL_PROPERTIES[MaterialId.Water].transitionHeat!
    world.heat[ice] = MATERIAL_PROPERTIES[MaterialId.Ice].transitionHeat!
    stepWorld(world)
    expect(world.status[wood] & StatusFlag.Burning).toBe(StatusFlag.Burning)
    expect(world.material[sand]).toBe(MaterialId.Glass)
    expect(world.material[water]).toBe(MaterialId.Steam)
    expect(world.material[ice]).toBe(MaterialId.Water)
  })

  it('lets denser Water settle below Oil', () => {
    const world = createWorld(24, false, 1, 4)
    world.material[index(world, 0, 1)] = MaterialId.Water
    world.material[index(world, 0, 2)] = MaterialId.Oil
    world.material[index(world, 0, 3)] = MaterialId.Stone
    stepWorld(world)
    expect(world.material[index(world, 0, 1)]).toBe(MaterialId.Oil)
    expect(world.material[index(world, 0, 2)]).toBe(MaterialId.Water)
  })

  it('turns Lava and Water into Stone and Steam', () => {
    const world = createWorld(25, false, 3, 4)
    const water = index(world, 1, 1)
    const lava = index(world, 1, 2)
    world.material[water] = MaterialId.Water
    world.material[lava] = MaterialId.Lava
    reactMaterialPair(world, lava, water)
    expect(world.material[lava]).toBe(MaterialId.Stone)
    expect(world.material[water]).toBe(MaterialId.Steam)
  })

  it('condenses Steam against Ice without immediately boiling the result again', () => {
    const world = createWorld(251, false, 3, 3)
    const steam = index(world, 1, 1)
    const ice = index(world, 1, 2)
    world.material[steam] = MaterialId.Steam
    world.heat[steam] = MATERIAL_PROPERTIES[MaterialId.Steam].initialHeat
    world.material[ice] = MaterialId.Ice
    reactMaterialPair(world, steam, ice)
    expect(world.material[steam]).toBe(MaterialId.Water)
    expect(world.material[ice]).toBe(MaterialId.Water)
    expect(world.heat[steam]).toBe(0)
    expect(world.heat[ice]).toBe(0)
  })

  it('grows Plant slowly beside contained Water', () => {
    const world = createWorld(26, false, 5, 6)
    const plant = index(world, 2, 3)
    const water = index(world, 2, 4)
    world.material[plant] = MaterialId.Plant
    world.material[water] = MaterialId.Water
    world.material[index(world, 1, 4)] = MaterialId.Stone
    world.material[index(world, 3, 4)] = MaterialId.Stone
    for (let x = 0; x < world.width; x += 1) world.material[index(world, x, 5)] = MaterialId.Stone
    for (let tick = 0; tick < 120; tick += 1) stepWorld(world)
    expect([...world.material].filter((material) => material === MaterialId.Plant).length).toBeGreaterThan(1)
  })

  it('lets Acid corrode selected materials while Stone and Glass remain inert', () => {
    const world = createWorld(27, false, 5, 2)
    const acid = index(world, 0, 0)
    const plant = index(world, 1, 0)
    const stone = index(world, 2, 0)
    const glass = index(world, 3, 0)
    world.material[acid] = MaterialId.Acid
    world.material[plant] = MaterialId.Plant
    world.material[stone] = MaterialId.Stone
    world.material[glass] = MaterialId.Glass
    for (let attempt = 0; attempt < 600 && world.material[plant] === MaterialId.Plant; attempt += 1) reactMaterialPair(world, acid, plant)
    expect(world.material[plant]).toBe(MaterialId.Empty)
    expect(reactMaterialPair(world, acid, stone)).toBe(false)
    expect(reactMaterialPair(world, acid, glass)).toBe(false)
    expect(world.material[stone]).toBe(MaterialId.Stone)
    expect(world.material[glass]).toBe(MaterialId.Glass)
  })

  it('models wet Gunpowder as a temporary status that blocks ignition', () => {
    const world = createWorld(28, false, 3, 3)
    const powder = index(world, 1, 2)
    world.material[powder] = MaterialId.Gunpowder
    world.material[index(world, 0, 2)] = MaterialId.Water
    world.material[index(world, 2, 2)] = MaterialId.Stone
    world.status[powder] = StatusFlag.Wet
    world.heat[powder] = 255
    stepWorld(world)
    expect(world.material[powder]).toBe(MaterialId.Gunpowder)
    expect(world.status[powder] & StatusFlag.Burning).toBe(0)
    world.material[index(world, 0, 2)] = MaterialId.Empty
    world.status[powder] = 0
    stepWorld(world)
    expect(world.status[powder] & StatusFlag.Burning).toBe(StatusFlag.Burning)
    stepWorld(world)
    expect(world.material.includes(MaterialId.Fire)).toBe(true)
  })

  it('lets Spark charge conductive Metal', () => {
    const world = createWorld(29, false, 3, 5)
    const metal = index(world, 1, 2)
    const spark = index(world, 1, 3)
    world.material[metal] = MaterialId.Metal
    world.material[spark] = MaterialId.Spark
    world.state[spark] = 4
    stepWorld(world)
    expect(world.material.includes(MaterialId.Spark)).toBe(false)
    expect(world.status[metal] & StatusFlag.Charged).toBe(StatusFlag.Charged)
  })

  it('marks updated cells no later than the current tick', () => {
    const world = createWorld(11, false, 4, 4)
    world.material[index(world, 1, 1)] = MaterialId.Sand
    stepWorld(world)
    expect(Math.max(...world.updatedAt)).toBe(world.tick)
    expect([...world.updatedAt].every((tick) => tick <= world.tick)).toBe(true)
  })
})

describe('world commands and persistence', () => {
  it('produces equal grids for equal seeds and commands', () => {
    const first = createWorld(123, false, 20, 20)
    const second = createWorld(123, false, 20, 20)
    paintStroke(first, 2, 2, 16, 3, 3, MaterialId.Sand)
    paintStroke(second, 2, 2, 16, 3, 3, MaterialId.Sand)
    for (let tick = 0; tick < 20; tick += 1) { stepWorld(first); stepWorld(second) }
    expect(first.material).toEqual(second.material)
    expect(first.state).toEqual(second.state)
    expect(first.status).toEqual(second.status)
    expect(first.heat).toEqual(second.heat)
    expect(first.randomState).toBe(second.randomState)
  })

  it('clears every world and transient array', () => {
    const world = createWorld(12)
    world.state.fill(99)
    world.status.fill(StatusFlag.Wet)
    world.heat.fill(200)
    world.updatedAt.fill(4)
    clearWorld(world)
    expect(world.material.every((value) => value === 0)).toBe(true)
    expect(world.state.every((value) => value === 0)).toBe(true)
    expect(world.status.every((value) => value === 0)).toBe(true)
    expect(world.heat.every((value) => value === 0)).toBe(true)
    expect(world.updatedAt.every((value) => value === 0)).toBe(true)
  })

  it('round-trips the known save version exactly', () => {
    const world = createWorld(13)
    world.tick = 12345
    const serialized = serializeSnapshot(snapshotWorld(world), 'FIRE TEST', '2026-08-31T00:00:00.000Z')
    const parsed = parseSave(serialized)
    expect(parsed.snapshot.material).toEqual(world.material)
    expect(parsed.snapshot.state).toEqual(world.state)
    expect(parsed.snapshot.status).toEqual(world.status)
    expect(parsed.snapshot.heat).toEqual(world.heat)
    expect(parsed.snapshot.tick).toBe(world.tick)
    expect(parsed.file.version).toBe(3)
  })

  it('migrates version 2 burning state into status and initializes heat', () => {
    const world = createWorld(30)
    const wood = index(world, 1, 1)
    world.material[wood] = MaterialId.Wood
    const current = serializeSnapshot(snapshotWorld(world), 'LEGACY', '2026-08-31T00:00:00.000Z')
    const legacyState = new Uint16Array(world.state.length)
    legacyState[wood] = 0x8000 | 17
    const legacyBytes = new Uint8Array(legacyState.length * 2)
    const view = new DataView(legacyBytes.buffer)
    legacyState.forEach((value, cell) => view.setUint16(cell * 2, value, true))
    const legacy = {
      format: current.format,
      version: 2,
      grid: current.grid,
      simulation: {
        tick: current.simulation.tick,
        seed: current.simulation.seed,
        randomState: current.simulation.randomState,
        material: current.simulation.material,
        state: bytesToBase64(legacyBytes),
      },
      metadata: current.metadata,
    }
    const parsed = parseSave(legacy)
    expect(parsed.file.version).toBe(2)
    expect(parsed.snapshot.status[wood] & StatusFlag.Burning).toBe(StatusFlag.Burning)
    expect(parsed.snapshot.state[wood]).toBe(17)
    expect(parsed.snapshot.heat.every((value) => value === 0)).toBe(true)
  })

  it('rejects invalid saves before mutating a world', () => {
    const world = createWorld(14)
    const before = snapshotWorld(world)
    expect(() => parseSave({ format: 'kinetic-pixels', version: 99 })).toThrow()
    expect(snapshotWorld(world)).toEqual(before)
  })

  it('replaces a world from a validated snapshot', () => {
    const source = createWorld(15)
    const target = createWorld(16, false)
    replaceWorld(target, snapshotWorld(source))
    expect(target.material).toEqual(source.material)
    expect(target.status).toEqual(source.status)
    expect(target.heat).toEqual(source.heat)
    expect(target.seed).toBe(source.seed)
  })
})
