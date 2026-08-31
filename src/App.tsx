import { Brush, CirclePlay, Droplets, Eraser, Flame, Gem, MemoryStick, Pause, Play, Sparkles, Trash2, Trees } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { MemoryCardDialog } from './MemoryCardDialog'
import { MaterialId, PAINTABLE_MATERIALS } from './simulation/materials'
import { GRID_HEIGHT, GRID_WIDTH, type Snapshot } from './simulation/types'

const ICONS: Record<string, typeof Sparkles> = {
  sand: Sparkles,
  water: Droplets,
  stone: Gem,
  wood: Trees,
  fire: Flame,
}

interface Point { x: number; y: number }

interface PendingStroke {
  from: Point
  to: Point
  radius: number
  materialId: number
  erase: boolean
}

declare global {
  interface Window {
    __KINETIC_PIXELS__?: {
      snapshot: () => Promise<Snapshot>
      count: (materialId: number) => Promise<number>
      cell: (x: number, y: number) => Promise<number>
      tick: () => Promise<number>
    }
  }
}

function isTextEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.isContentEditable || target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement
}

export function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const workerRef = useRef<Worker | null>(null)
  const memoryButtonRef = useRef<HTMLButtonElement>(null)
  const pendingSnapshots = useRef(new Map<number, (snapshot: Snapshot) => void>())
  const requestCounter = useRef(0)
  const pointerDown = useRef(false)
  const previousPoint = useRef<Point | null>(null)
  const previousMaterial = useRef<number>(MaterialId.Sand)
  const runningRef = useRef(false)
  const pendingStroke = useRef<PendingStroke | null>(null)
  const strokeFrame = useRef<number | null>(null)
  const continuousStrokeFrame = useRef<number | null>(null)

  const [ready, setReady] = useState(false)
  const [running, setRunningState] = useState(false)
  const [selectedMaterial, setSelectedMaterial] = useState<number>(MaterialId.Sand)
  const [eraser, setEraser] = useState(false)
  const [radius, setRadius] = useState(5)
  const [startup, setStartup] = useState(true)
  const [memoryOpen, setMemoryOpen] = useState(false)
  const [preview, setPreview] = useState<Point | null>(null)

  const setRunning = useCallback((next: boolean) => {
    runningRef.current = next
    setRunningState(next)
    workerRef.current?.postMessage({ type: 'running', running: next })
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !('transferControlToOffscreen' in canvas)) return
    const worker = new Worker(new URL('./simulation/worker.ts', import.meta.url), { type: 'module' })
    workerRef.current = worker
    const offscreen = canvas.transferControlToOffscreen()
    worker.postMessage({ type: 'init', canvas: offscreen, seed: 0x4b504958 }, [offscreen])
    worker.onmessage = (event: MessageEvent<{ type: string; requestId?: number; snapshot?: Snapshot }>) => {
      if (event.data.type === 'ready') setReady(true)
      if (event.data.type === 'snapshot' && event.data.requestId !== undefined && event.data.snapshot) {
        pendingSnapshots.current.get(event.data.requestId)?.(event.data.snapshot)
        pendingSnapshots.current.delete(event.data.requestId)
      }
    }
    return () => worker.terminate()
  }, [])

  useEffect(() => () => {
    if (strokeFrame.current !== null) cancelAnimationFrame(strokeFrame.current)
    if (continuousStrokeFrame.current !== null) cancelAnimationFrame(continuousStrokeFrame.current)
  }, [])

  const requestSnapshot = useCallback(() => new Promise<Snapshot>((resolve) => {
    const requestId = ++requestCounter.current
    pendingSnapshots.current.set(requestId, resolve)
    workerRef.current?.postMessage({ type: 'snapshot', requestId })
  }), [])

  useEffect(() => {
    window.__KINETIC_PIXELS__ = {
      snapshot: requestSnapshot,
      count: async (materialId) => (await requestSnapshot()).material.reduce((count, value) => count + Number(value === materialId), 0),
      cell: async (x, y) => (await requestSnapshot()).material[y * GRID_WIDTH + x],
      tick: async () => (await requestSnapshot()).tick,
    }
    return () => { delete window.__KINETIC_PIXELS__ }
  }, [requestSnapshot])

  const toggleRunning = useCallback(() => {
    const next = !runningRef.current
    if (next) setStartup(false)
    setRunning(next)
  }, [setRunning])

  const toggleEraser = useCallback(() => {
    setEraser((active) => {
      if (!active) previousMaterial.current = selectedMaterial
      else setSelectedMaterial(previousMaterial.current)
      return !active
    })
  }, [selectedMaterial])

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.ctrlKey || event.altKey || event.metaKey) return
      if (memoryOpen) return
      if (isTextEditable(event.target)) return
      if (event.code === 'Space' && event.target instanceof HTMLButtonElement) return
      if (event.code === 'Space') {
        event.preventDefault()
        toggleRunning()
      } else if (event.key.toLowerCase() === 'e') {
        toggleEraser()
      } else if (event.key === '-') {
        setRadius((value) => Math.max(1, value - 1))
      } else if (event.key === '=' || event.key === '+') {
        setRadius((value) => Math.min(20, value + 1))
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [memoryOpen, toggleEraser, toggleRunning])

  function pointFromClient(clientX: number, clientY: number, canvas: HTMLCanvasElement): Point {
    const bounds = canvas.getBoundingClientRect()
    return {
      x: Math.max(0, Math.min(GRID_WIDTH - 1, ((clientX - bounds.left) / bounds.width) * GRID_WIDTH)),
      y: Math.max(0, Math.min(GRID_HEIGHT - 1, ((clientY - bounds.top) / bounds.height) * GRID_HEIGHT)),
    }
  }

  function postStroke(stroke: PendingStroke) {
    workerRef.current?.postMessage({
      type: 'stroke',
      fromX: stroke.from.x,
      fromY: stroke.from.y,
      toX: stroke.to.x,
      toY: stroke.to.y,
      radius: stroke.radius,
      materialId: stroke.materialId,
      erase: stroke.erase,
    })
  }

  function flushPendingStroke() {
    if (strokeFrame.current !== null) {
      cancelAnimationFrame(strokeFrame.current)
      strokeFrame.current = null
    }
    const stroke = pendingStroke.current
    pendingStroke.current = null
    if (stroke) postStroke(stroke)
  }

  function queueStroke(from: Point, to: Point) {
    const queued = pendingStroke.current
    if (queued && queued.radius === radius && queued.materialId === selectedMaterial && queued.erase === eraser) {
      queued.to = to
    } else {
      flushPendingStroke()
      pendingStroke.current = { from, to, radius, materialId: selectedMaterial, erase: eraser }
    }
    if (strokeFrame.current === null) {
      strokeFrame.current = requestAnimationFrame(() => {
        strokeFrame.current = null
        const stroke = pendingStroke.current
        pendingStroke.current = null
        if (stroke) postStroke(stroke)
      })
    }
  }

  function startContinuousStroke() {
    if (continuousStrokeFrame.current !== null) cancelAnimationFrame(continuousStrokeFrame.current)
    const repeat = () => {
      continuousStrokeFrame.current = null
      const point = previousPoint.current
      if (!pointerDown.current || !point) return
      queueStroke(point, point)
      continuousStrokeFrame.current = requestAnimationFrame(repeat)
    }
    continuousStrokeFrame.current = requestAnimationFrame(repeat)
  }

  function onPointerDown(event: React.PointerEvent<HTMLCanvasElement>) {
    if (event.button !== 0 || !ready) return
    event.currentTarget.setPointerCapture(event.pointerId)
    const point = pointFromClient(event.clientX, event.clientY, event.currentTarget)
    pointerDown.current = true
    previousPoint.current = point
    setPreview(point)
    if (startup) {
      setStartup(false)
      setRunning(true)
    }
    postStroke({ from: point, to: point, radius, materialId: selectedMaterial, erase: eraser })
    startContinuousStroke()
  }

  function onPointerMove(event: React.PointerEvent<HTMLCanvasElement>) {
    const point = pointFromClient(event.clientX, event.clientY, event.currentTarget)
    setPreview(point)
    if (pointerDown.current && previousPoint.current) {
      queueStroke(previousPoint.current, point)
      previousPoint.current = point
    }
  }

  function endPointer() {
    pointerDown.current = false
    if (continuousStrokeFrame.current !== null) cancelAnimationFrame(continuousStrokeFrame.current)
    continuousStrokeFrame.current = null
    flushPendingStroke()
    previousPoint.current = null
  }

  function selectMaterial(materialId: number) {
    setSelectedMaterial(materialId)
    previousMaterial.current = materialId
    setEraser(false)
  }

  function clear() {
    pendingStroke.current = null
    if (strokeFrame.current !== null) cancelAnimationFrame(strokeFrame.current)
    strokeFrame.current = null
    if (continuousStrokeFrame.current !== null) cancelAnimationFrame(continuousStrokeFrame.current)
    continuousStrokeFrame.current = null
    workerRef.current?.postMessage({ type: 'clear' })
    setStartup(false)
  }

  function openMemory() {
    setRunning(false)
    setMemoryOpen(true)
  }

  function loadSnapshot(snapshot: Snapshot) {
    setRunning(false)
    workerRef.current?.postMessage({ type: 'replace', snapshot })
    setStartup(false)
  }

  const currentMaterial = PAINTABLE_MATERIALS.find((material) => material.id === selectedMaterial)
  const toolLabel = eraser ? 'Eraser' : currentMaterial?.label ?? 'Sand'

  return (
    <main className="page-shell">
      <section className="device chamfer" aria-label="Kinetic Pixels simulation console">
        <div className="device-screw screw-one" aria-hidden="true" />
        <div className="device-screw screw-two" aria-hidden="true" />

        <aside className="left-rail halftone chamfer" aria-labelledby="elements-heading">
          <div className="rail-heading" id="elements-heading">Elements</div>
          <div className="material-grid">
            {PAINTABLE_MATERIALS.map((material, index) => {
              const Icon = ICONS[material.key]
              const selected = !eraser && selectedMaterial === material.id
              return (
                <button
                  key={material.id}
                  className={`material-button ${selected ? 'selected' : ''} ${index === PAINTABLE_MATERIALS.length - 1 ? 'last-material' : ''}`}
                  aria-pressed={selected}
                  onClick={() => selectMaterial(material.id)}
                >
                  <Icon aria-hidden="true" />
                  <span>{material.label}</span>
                  <i style={{ backgroundColor: material.colors[1] ?? material.colors[0] }} />
                </button>
              )
            })}
          </div>
          <div className="rail-mark" aria-hidden="true"><span>KP</span><small>{GRID_WIDTH} × {GRID_HEIGHT}</small></div>
        </aside>

        <section className="viewport-panel chamfer" aria-label="Simulation viewport">
          <div className="status-strip">
            <span>Field 01</span>
            <span className="status-space" aria-live="polite">{running ? '' : <b>● Paused</b>}</span>
          </div>
          <div className="canvas-well">
            <div className="canvas-stage">
              <canvas
                ref={canvasRef}
                width={GRID_WIDTH}
                height={GRID_HEIGHT}
                aria-label={`Interactive ${GRID_WIDTH} by ${GRID_HEIGHT} cell pixel physics field. Click, hold, or drag to paint the selected material.`}
                data-ready={ready}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={endPointer}
                onPointerCancel={endPointer}
                onPointerLeave={() => { setPreview(null); if (!pointerDown.current) endPointer() }}
              />
              {startup && <div className="startup-hint"><CirclePlay aria-hidden="true" /><span>Click to play</span></div>}
              {preview && (
                <div
                  className="brush-preview"
                  aria-hidden="true"
                  style={{
                    left: `${(preview.x / GRID_WIDTH) * 100}%`,
                    top: `${(preview.y / GRID_HEIGHT) * 100}%`,
                    width: `${((radius * 2) / GRID_WIDTH) * 100}%`,
                  }}
                />
              )}
            </div>
          </div>
        </section>

        <aside className="right-rail chamfer" aria-labelledby="controls-heading">
          <div className="control-top">
            <div className="rail-heading dark" id="controls-heading">Controls</div>
            <div className="tool-readout"><span>Current tool</span><strong>{toolLabel}</strong></div>
            <label className="brush-label" htmlFor="brush-radius"><span>Brush radius</span><output>{radius} cells</output></label>
            <input id="brush-radius" className="brush-slider" type="range" min="1" max="20" value={radius} onChange={(event) => setRadius(Number(event.target.value))} />
            <div className="utility-grid">
              <button className={`console-button ${eraser ? 'active' : ''}`} aria-pressed={eraser} onClick={toggleEraser}><Eraser aria-hidden="true" /><span>Eraser</span><kbd>E</kbd></button>
              <button className="console-button destructive" onClick={clear}><Trash2 aria-hidden="true" /><span>Clear</span></button>
            </div>
          </div>
          <div className="control-bottom halftone">
            <button className={`play-button ${running ? 'running' : ''}`} onClick={toggleRunning}>
              {running ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
              <span>{running ? 'Pause' : 'Play'}</span>
              <small>Space</small>
            </button>
            <button ref={memoryButtonRef} className="memory-button" onClick={openMemory}><MemoryStick aria-hidden="true" /><span>Memory Card</span></button>
          </div>
        </aside>
      </section>

      <MemoryCardDialog
        open={memoryOpen}
        onOpenChange={(open) => setMemoryOpen(open)}
        requestSnapshot={requestSnapshot}
        loadSnapshot={loadSnapshot}
        triggerRef={memoryButtonRef}
      />
    </main>
  )
}
