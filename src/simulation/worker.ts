/// <reference lib="webworker" />

import { clearWorld, createWorld, paintStroke, replaceWorld, snapshotWorld, stepWorld } from './engine'
import { renderWorld } from './render'
import type { CellInspection, Snapshot, World } from './types'

type WorkerCommand =
  | { type: 'init'; canvas: OffscreenCanvas; seed: number }
  | { type: 'running'; running: boolean }
  | { type: 'stroke'; fromX: number; fromY: number; toX: number; toY: number; radius: number; materialId: number; erase: boolean }
  | { type: 'clear' }
  | { type: 'snapshot'; requestId: number }
  | { type: 'inspect'; requestId: number; x: number; y: number }
  | { type: 'replace'; snapshot: Snapshot }
  | { type: 'rate'; rate: number }

let world: World | undefined
let context: OffscreenCanvasRenderingContext2D | null = null
let imageData: ImageData | undefined
let running = false
let lastTime = 0
let accumulator = 0
let timeRate = 1
const FIXED_STEP_MS = 1000 / 60
const MAX_CATCH_UP_STEPS = 5

function draw(): void {
  if (world && context && imageData) renderWorld(context, world, imageData)
}

function scheduleFrame(callback: (time: number) => void): void {
  if (typeof self.requestAnimationFrame === 'function') self.requestAnimationFrame(callback)
  else setTimeout(() => callback(performance.now()), 16)
}

function frame(time: number): void {
  if (!running || !world) return
  if (lastTime === 0) lastTime = time
  accumulator = Math.min(accumulator + (time - lastTime) * timeRate, FIXED_STEP_MS * MAX_CATCH_UP_STEPS)
  lastTime = time
  let steps = 0
  while (accumulator >= FIXED_STEP_MS && steps < MAX_CATCH_UP_STEPS) {
    stepWorld(world)
    accumulator -= FIXED_STEP_MS
    steps += 1
  }
  if (steps > 0) draw()
  scheduleFrame(frame)
}

function setRunning(nextRunning: boolean): void {
  if (running === nextRunning) return
  running = nextRunning
  lastTime = 0
  accumulator = 0
  if (running) scheduleFrame(frame)
}

self.onmessage = (event: MessageEvent<WorkerCommand>) => {
  const command = event.data
  if (command.type === 'init') {
    world = createWorld(command.seed)
    command.canvas.width = world.width
    command.canvas.height = world.height
    context = command.canvas.getContext('2d', { alpha: false })
    if (!context) throw new Error('Unable to initialize simulation canvas')
    context.imageSmoothingEnabled = false
    imageData = context.createImageData(world.width, world.height)
    draw()
    self.postMessage({ type: 'ready' })
    return
  }
  if (!world) return
  if (command.type === 'running') setRunning(command.running)
  if (command.type === 'rate' && (command.rate === 0.5 || command.rate === 1 || command.rate === 2)) {
    timeRate = command.rate
    lastTime = 0
    accumulator = 0
  }
  if (command.type === 'stroke') {
    paintStroke(world, command.fromX, command.fromY, command.toX, command.toY, command.radius, command.materialId, command.erase)
    if (!running) draw()
  }
  if (command.type === 'clear') {
    clearWorld(world)
    draw()
  }
  if (command.type === 'replace') {
    setRunning(false)
    replaceWorld(world, command.snapshot)
    draw()
  }
  if (command.type === 'snapshot') self.postMessage({ type: 'snapshot', requestId: command.requestId, snapshot: snapshotWorld(world) })
  if (command.type === 'inspect') {
    const x = Math.max(0, Math.min(world.width - 1, Math.floor(command.x)))
    const y = Math.max(0, Math.min(world.height - 1, Math.floor(command.y)))
    const index = y * world.width + x
    const inspection: CellInspection = {
      x,
      y,
      materialId: world.material[index],
      state: world.state[index],
      status: world.status[index],
      temperature: world.temperature[index],
      moisture: world.moisture[index],
      fuel: world.fuel[index],
      liquidMass: world.liquidMass[index],
      phaseProgress: world.phaseProgress[index],
    }
    self.postMessage({ type: 'inspection', requestId: command.requestId, inspection })
  }
}

export {}
