import { describe, expect, it } from 'vitest'
import { clearWorld, createWorld, paintStroke, replaceWorld, snapshotWorld, stepWorld } from './engine'
import {
  BURN_PROGRESS_LIMIT,
  BURNING_WOOD_SPREAD_SCALE,
  BURNING_FLAG,
  FIRE_LIFETIME_MIN,
  MATERIAL_PROPERTIES,
  MATERIAL_REACTIONS,
  MaterialId,
  WOOD_BURN_DURATION,
} from './materials'
import { cellColor } from './render'
import { parseSave, serializeSnapshot } from './serialization'
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
      expect.objectContaining({ actor: MaterialId.Fire, target: MaterialId.Wood, effect: 'ignite-target' }),
      expect.objectContaining({ actor: MaterialId.Water, target: MaterialId.Fire, effect: 'remove-target' }),
      expect.objectContaining({ actor: MaterialId.Wood, target: MaterialId.Wood, effect: 'ignite-target' }),
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
    world.state[index(world, 1, 2)] = FIRE_LIFETIME_MIN
    world.material[index(world, 2, 2)] = MaterialId.Wood
    for (let x = 0; x < 3; x += 1) world.material[index(world, x, 1)] = MaterialId.Stone
    for (let tick = 0; tick < 80 && world.material[index(world, 2, 2)] === MaterialId.Wood && !(world.state[index(world, 2, 2)] & BURNING_FLAG); tick += 1) {
      stepWorld(world)
    }
    expect(
      world.material[index(world, 2, 2)] !== MaterialId.Wood
      || Boolean(world.state[index(world, 2, 2)] & BURNING_FLAG),
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
    world.state[index(world, 3, 2)] = BURNING_FLAG | 23
    stepWorld(world)
    expect(world.material.includes(MaterialId.Fire)).toBe(false)
    expect(world.state[index(world, 3, 2)]).toBe(23)
    expect(world.material.includes(MaterialId.Water)).toBe(true)
  })

  it('burning Wood emits only Smoke and disappears rapidly', () => {
    const world = createWorld(9, false, 5, 64)
    const wood = index(world, 2, 60)
    world.material[wood] = MaterialId.Wood
    world.state[wood] = BURNING_FLAG
    for (let tick = 0; tick < WOOD_BURN_DURATION; tick += 1) stepWorld(world)
    const smokeCount = [...world.material].filter((material) => material === MaterialId.Smoke).length
    expect(smokeCount).toBeGreaterThan(0)
    expect(smokeCount).toBeLessThanOrEqual(4)
    expect(world.material.includes(MaterialId.Fire)).toBe(false)
    expect(WOOD_BURN_DURATION).toBeLessThanOrEqual(60)
    world.material[wood] = MaterialId.Wood
    world.state[wood] = BURNING_FLAG | (BURN_PROGRESS_LIMIT - MATERIAL_PROPERTIES[MaterialId.Wood].burnRate)
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
      world.state[burning] = BURNING_FLAG
      world.material[neighbor] = MaterialId.Wood
      stepWorld(world)
      if (world.state[neighbor] & BURNING_FLAG) ignitions += 1
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
    world.state[wood] = BURNING_FLAG | 20
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
    expect(first.randomState).toBe(second.randomState)
  })

  it('clears every world and transient array', () => {
    const world = createWorld(12)
    world.state.fill(99)
    world.updatedAt.fill(4)
    clearWorld(world)
    expect(world.material.every((value) => value === 0)).toBe(true)
    expect(world.state.every((value) => value === 0)).toBe(true)
    expect(world.updatedAt.every((value) => value === 0)).toBe(true)
  })

  it('round-trips the known save version exactly', () => {
    const world = createWorld(13)
    world.tick = 12345
    const serialized = serializeSnapshot(snapshotWorld(world), 'FIRE TEST', '2026-08-31T00:00:00.000Z')
    const parsed = parseSave(serialized)
    expect(parsed.snapshot.material).toEqual(world.material)
    expect(parsed.snapshot.state).toEqual(world.state)
    expect(parsed.snapshot.tick).toBe(world.tick)
    expect(parsed.file.version).toBe(2)
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
    expect(target.seed).toBe(source.seed)
  })
})
