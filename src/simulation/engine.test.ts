import { describe, expect, it } from 'vitest'
import { clearWorld, createWorld, paintStroke, replaceWorld, snapshotWorld, stepWorld } from './engine'
import {
  BURNING_FLAG,
  EMISSION_INTERVAL,
  FIRE_LIFETIME_MIN,
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
  it('moves Sand down, then diagonally around blockers', () => {
    const world = createWorld(1, false, 5, 5)
    world.material[index(world, 2, 1)] = MaterialId.Sand
    stepWorld(world)
    expect(world.material[index(world, 2, 2)]).toBe(MaterialId.Sand)
    world.material[index(world, 2, 3)] = MaterialId.Stone
    stepWorld(world)
    expect([world.material[index(world, 1, 3)], world.material[index(world, 3, 3)]]).toContain(MaterialId.Sand)
  })

  it('alternates scan direction without permanent lateral bias', () => {
    const left = createWorld(2, false, 7, 5)
    left.material[index(left, 3, 1)] = MaterialId.Sand
    left.material[index(left, 3, 2)] = MaterialId.Stone
    stepWorld(left)
    const firstX = left.material.findIndex((value) => value === MaterialId.Sand) % left.width
    const right = createWorld(2, false, 7, 5)
    right.tick = 1
    right.material[index(right, 3, 1)] = MaterialId.Sand
    right.material[index(right, 3, 2)] = MaterialId.Stone
    stepWorld(right)
    const secondX = right.material.findIndex((value) => value === MaterialId.Sand) % right.width
    expect([firstX, secondX].sort()).toEqual([2, 4])
  })

  it('lets Sand displace Water', () => {
    const world = createWorld(3, false, 3, 4)
    world.material[index(world, 1, 1)] = MaterialId.Sand
    world.material[index(world, 1, 2)] = MaterialId.Water
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
    expect(world.material[index(world, 2, 2)]).toBe(MaterialId.Water)
    world.material[index(world, 1, 3)] = MaterialId.Stone
    world.material[index(world, 2, 3)] = MaterialId.Stone
    world.material[index(world, 3, 3)] = MaterialId.Stone
    stepWorld(world)
    const waterX = world.material.findIndex((value) => value === MaterialId.Water) % world.width
    expect(Math.abs(waterX - 2)).toBeGreaterThan(1)
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
    expect(Math.max(...waterX) - Math.min(...waterX)).toBeGreaterThanOrEqual(8)
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
    const world = createWorld(9, false, 5, 6)
    const wood = index(world, 2, 4)
    world.material[wood] = MaterialId.Wood
    world.state[wood] = BURNING_FLAG | (EMISSION_INTERVAL - 1)
    stepWorld(world)
    expect(world.material.includes(MaterialId.Smoke)).toBe(true)
    expect(world.material.includes(MaterialId.Fire)).toBe(false)
    expect(WOOD_BURN_DURATION).toBeLessThanOrEqual(120)
    world.state[wood] = BURNING_FLAG | (WOOD_BURN_DURATION - 1)
    stepWorld(world)
    expect(world.material[wood]).toBe(MaterialId.Empty)
  })

  it('spreads burning directly between adjacent Wood cells without creating Fire', () => {
    const world = createWorld(12, false, 7, 6)
    const burning = index(world, 2, 4)
    const neighbor = index(world, 3, 4)
    world.material[burning] = MaterialId.Wood
    world.state[burning] = BURNING_FLAG
    world.material[neighbor] = MaterialId.Wood
    for (let tick = 0; tick < 50 && !(world.state[neighbor] & BURNING_FLAG); tick += 1) stepWorld(world)
    expect(world.state[neighbor] & BURNING_FLAG).toBeTruthy()
    expect(world.material.includes(MaterialId.Fire)).toBe(false)
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
