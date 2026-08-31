import { Activity, Bomb, CirclePlay, Cog, Droplet, Droplets, Eraser, Flame, FlaskConical, Gem, Leaf, MemoryStick, Mountain, Pause, Play, ScanSearch, Snowflake, Sparkles, Trash2, Trees, Zap } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { MemoryCardDialog } from './MemoryCardDialog'
import { MATERIAL_BY_ID, MaterialId, PAINTABLE_MATERIALS, StatusFlag } from './simulation/materials'
import { GRID_HEIGHT, GRID_WIDTH, type CellInspection, type Snapshot } from './simulation/types'

const ICONS: Record<string, typeof Sparkles> = {
  sand: Sparkles,
  water: Droplets,
  stone: Gem,
  wood: Trees,
  fire: Flame,
  oil: Droplet,
  plant: Leaf,
  acid: FlaskConical,
  metal: Cog,
  lava: Mountain,
  ice: Snowflake,
  spark: Zap,
  gunpowder: Bomb,
}

interface Point { x: number; y: number }
interface CameraState { zoom: number; offsetX: number; offsetY: number }

const MIN_ZOOM = 1
const MAX_ZOOM = 4
const ZOOM_STEP = 0.25
const SIMULATION_RATES = [0.5, 1, 2] as const
type SimulationRate = (typeof SIMULATION_RATES)[number]

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
      status: (x: number, y: number) => Promise<number>
      heat: (x: number, y: number) => Promise<number>
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
  const canvasStageRef = useRef<HTMLDivElement>(null)
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
  const inspectionPending = useRef(false)
  const latestInspectionRequest = useRef(0)

  const [ready, setReady] = useState(false)
  const [running, setRunningState] = useState(false)
  const [selectedMaterial, setSelectedMaterial] = useState<number>(MaterialId.Sand)
  const [eraser, setEraser] = useState(false)
  const [radius, setRadius] = useState(5)
  const [startup, setStartup] = useState(true)
  const [memoryOpen, setMemoryOpen] = useState(false)
  const [preview, setPreview] = useState<Point | null>(null)
  const [inspectMode, setInspectMode] = useState(false)
  const [monitorMode, setMonitorMode] = useState(false)
  const [monitoredPoint, setMonitoredPoint] = useState<Point | null>(null)
  const [inspection, setInspection] = useState<CellInspection | null>(null)
  const [camera, setCamera] = useState<CameraState>({ zoom: MIN_ZOOM, offsetX: 0, offsetY: 0 })
  const [simulationRate, setSimulationRate] = useState<SimulationRate>(1)

  const requestInspection = useCallback((point: Point) => {
    if (inspectionPending.current) return
    const worker = workerRef.current
    if (!worker) return
    inspectionPending.current = true
    const requestId = ++requestCounter.current
    latestInspectionRequest.current = requestId
    worker.postMessage({ type: 'inspect', requestId, x: point.x, y: point.y })
  }, [])

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
    worker.onmessage = (event: MessageEvent<{ type: string; requestId?: number; snapshot?: Snapshot; inspection?: CellInspection }>) => {
      if (event.data.type === 'ready') setReady(true)
      if (event.data.type === 'snapshot' && event.data.requestId !== undefined && event.data.snapshot) {
        pendingSnapshots.current.get(event.data.requestId)?.(event.data.snapshot)
        pendingSnapshots.current.delete(event.data.requestId)
      }
      if (event.data.type === 'inspection') {
        inspectionPending.current = false
        if (event.data.requestId === latestInspectionRequest.current && event.data.inspection) setInspection(event.data.inspection)
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
      status: async (x, y) => (await requestSnapshot()).status[y * GRID_WIDTH + x],
      heat: async (x, y) => (await requestSnapshot()).temperature[y * GRID_WIDTH + x],
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

  const toggleInspect = useCallback(() => {
    if (monitorMode && monitoredPoint) return
    setMonitorMode(false)
    setMonitoredPoint(null)
    setInspectMode((active) => {
      if (active) setInspection(null)
      return !active
    })
  }, [monitorMode, monitoredPoint])

  const cancelMonitor = useCallback(() => {
    setMonitorMode(false)
    setMonitoredPoint(null)
    setInspection(null)
  }, [])

  const toggleMonitor = useCallback(() => {
    setMonitorMode((active) => {
      if (active) {
        setMonitoredPoint(null)
        setInspection(null)
      } else {
        setInspectMode(false)
        setInspection(null)
      }
      return !active
    })
  }, [])

  useEffect(() => {
    const target = monitorMode ? monitoredPoint : inspectMode ? preview : null
    if (!target) return
    requestInspection(target)
    const timer = window.setInterval(() => requestInspection(target), 80)
    return () => window.clearInterval(timer)
  }, [inspectMode, monitorMode, monitoredPoint, preview, requestInspection])

  useEffect(() => {
    if (!monitorMode || monitoredPoint) return
    function cancelForOutsideControl(event: PointerEvent) {
      if (!(event.target instanceof Element)) return
      if (event.target.closest('.canvas-stage') || event.target.closest('.monitor-button')) return
      if (event.target.closest('button, input, select, textarea, [role="button"]')) cancelMonitor()
    }
    document.addEventListener('pointerdown', cancelForOutsideControl)
    return () => document.removeEventListener('pointerdown', cancelForOutsideControl)
  }, [cancelMonitor, monitorMode, monitoredPoint])

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.ctrlKey || event.altKey || event.metaKey) return
      if (memoryOpen) return
      if (isTextEditable(event.target)) return
      if (event.key === 'Escape' && monitorMode && !monitoredPoint) {
        event.preventDefault()
        cancelMonitor()
        return
      }
      if (event.code === 'Space' && event.target instanceof HTMLButtonElement) return
      if (event.code === 'Space') {
        event.preventDefault()
        toggleRunning()
      } else if (event.key.toLowerCase() === 'e') {
        toggleEraser()
      } else if (event.key.toLowerCase() === 'i') {
        toggleInspect()
      } else if (event.key === '-') {
        setRadius((value) => Math.max(1, value - 1))
      } else if (event.key === '=' || event.key === '+') {
        setRadius((value) => Math.min(20, value + 1))
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [cancelMonitor, memoryOpen, monitorMode, monitoredPoint, toggleEraser, toggleInspect, toggleRunning])

  function pointFromClient(clientX: number, clientY: number, canvas: HTMLCanvasElement): Point {
    const bounds = canvas.getBoundingClientRect()
    return {
      x: Math.max(0, Math.min(GRID_WIDTH - 1, ((clientX - bounds.left) / bounds.width) * GRID_WIDTH)),
      y: Math.max(0, Math.min(GRID_HEIGHT - 1, ((clientY - bounds.top) / bounds.height) * GRID_HEIGHT)),
    }
  }

  function setZoomAt(nextZoom: number, anchorX: number, anchorY: number) {
    setCamera((current) => {
      const zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Math.round(nextZoom / ZOOM_STEP) * ZOOM_STEP))
      if (zoom === current.zoom) return current
      const currentVisibleWidth = GRID_WIDTH / current.zoom
      const currentVisibleHeight = GRID_HEIGHT / current.zoom
      const anchoredWorldX = current.offsetX + anchorX * currentVisibleWidth
      const anchoredWorldY = current.offsetY + anchorY * currentVisibleHeight
      const nextVisibleWidth = GRID_WIDTH / zoom
      const nextVisibleHeight = GRID_HEIGHT / zoom
      return {
        zoom,
        offsetX: Math.max(0, Math.min(GRID_WIDTH - nextVisibleWidth, anchoredWorldX - anchorX * nextVisibleWidth)),
        offsetY: Math.max(0, Math.min(GRID_HEIGHT - nextVisibleHeight, anchoredWorldY - anchorY * nextVisibleHeight)),
      }
    })
  }

  function onViewportWheel(event: WheelEvent) {
    if (event.target instanceof Element && event.target.closest('.zoom-gauge')) return
    event.preventDefault()
    const bounds = canvasStageRef.current?.getBoundingClientRect()
    if (!bounds) return
    const anchorX = Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width))
    const anchorY = Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height))
    setCamera((current) => {
      const zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, current.zoom + (event.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP)))
      if (zoom === current.zoom) return current
      const currentVisibleWidth = GRID_WIDTH / current.zoom
      const currentVisibleHeight = GRID_HEIGHT / current.zoom
      const anchoredWorldX = current.offsetX + anchorX * currentVisibleWidth
      const anchoredWorldY = current.offsetY + anchorY * currentVisibleHeight
      const nextVisibleWidth = GRID_WIDTH / zoom
      const nextVisibleHeight = GRID_HEIGHT / zoom
      return {
        zoom,
        offsetX: Math.max(0, Math.min(GRID_WIDTH - nextVisibleWidth, anchoredWorldX - anchorX * nextVisibleWidth)),
        offsetY: Math.max(0, Math.min(GRID_HEIGHT - nextVisibleHeight, anchoredWorldY - anchorY * nextVisibleHeight)),
      }
    })
  }

  useEffect(() => {
    const stage = canvasStageRef.current
    if (!stage) return
    stage.addEventListener('wheel', onViewportWheel, { passive: false })
    return () => stage.removeEventListener('wheel', onViewportWheel)
  })

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
    const point = pointFromClient(event.clientX, event.clientY, event.currentTarget)
    if (monitorMode && !monitoredPoint) {
      const pinned = { x: Math.floor(point.x), y: Math.floor(point.y) }
      setMonitoredPoint(pinned)
      requestInspection(pinned)
      setPreview(point)
      event.preventDefault()
      return
    }
    if (inspectMode) requestInspection(point)
    event.currentTarget.setPointerCapture(event.pointerId)
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
    if (inspectMode) requestInspection(point)
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
  const inspectedMaterial = inspection ? MATERIAL_BY_ID.get(inspection.materialId) : undefined
  const inspectedProperties = inspectedMaterial?.properties
  const inspectedConditions = inspection
    ? [
        inspection.status & StatusFlag.Burning ? 'Burning' : '',
        inspection.moisture > 0 ? 'Wet' : '',
        inspection.status & StatusFlag.Charged ? 'Charged' : '',
      ].filter(Boolean).join(', ') || 'Stable'
    : ''
  const monitorArmed = monitorMode && !monitoredPoint
  const reticlePoint = monitorMode ? monitoredPoint : inspectMode ? preview : null

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
            <label className="zoom-gauge">
              <span className="sr-only">Field zoom</span>
              <input
                aria-label="Field zoom"
                type="range"
                min={MIN_ZOOM * 100}
                max={MAX_ZOOM * 100}
                step={ZOOM_STEP * 100}
                value={camera.zoom * 100}
                onChange={(event) => setZoomAt(Number(event.target.value) / 100, 0.5, 0.5)}
              />
            </label>
            <div ref={canvasStageRef} className="canvas-stage">
              <div
                className="canvas-camera"
                style={{
                  left: `${-(camera.offsetX * camera.zoom / GRID_WIDTH) * 100}%`,
                  top: `${-(camera.offsetY * camera.zoom / GRID_HEIGHT) * 100}%`,
                  transform: `scale(${camera.zoom})`,
                }}
              >
                <canvas
                  ref={canvasRef}
                  className={`${inspectMode || monitorMode ? 'inspecting' : ''} ${monitorArmed ? 'monitor-armed' : ''}`.trim()}
                  width={GRID_WIDTH}
                  height={GRID_HEIGHT}
                  aria-label={`Interactive ${GRID_WIDTH} by ${GRID_HEIGHT} cell pixel physics field. Click, hold, or drag to paint the selected material.`}
                  data-ready={ready}
                  onPointerDown={onPointerDown}
                  onPointerMove={onPointerMove}
                  onPointerUp={endPointer}
                  onPointerCancel={endPointer}
                  onPointerLeave={() => { setPreview(null); if (inspectMode) setInspection(null); if (!pointerDown.current) endPointer() }}
                />
              {preview && !monitorArmed && (
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
              {reticlePoint && (
                <div
                  className="inspect-reticle"
                  aria-hidden="true"
                  style={{
                    left: `${((Math.floor(reticlePoint.x) + 0.5) / GRID_WIDTH) * 100}%`,
                    top: `${((Math.floor(reticlePoint.y) + 0.5) / GRID_HEIGHT) * 100}%`,
                    width: `${100 / GRID_WIDTH}%`,
                    height: `${100 / GRID_HEIGHT}%`,
                  }}
                />
              )}
              </div>
              {startup && <div className="startup-hint"><CirclePlay aria-hidden="true" /><span>Click to play</span></div>}
              {(inspectMode || monitorMode) && (
                <aside className={`inspection-panel ${monitorMode ? 'monitoring' : ''}`} aria-live="polite" aria-label="Pixel inspection">
                  <header><span>{monitorMode ? 'Pixel monitor' : 'Pixel probe'}</span><b>{inspection ? `${inspection.x}, ${inspection.y}` : monitorMode ? 'Click field' : 'Hover field'}</b></header>
                  {inspection && inspectedProperties ? (
                    <dl>
                      <dt>Material</dt><dd>{inspection.materialId === MaterialId.Empty ? 'Air' : inspectedMaterial?.label}</dd>
                      <dt>Temperature</dt><dd>{inspection.temperature} °C</dd>
                      <dt>Condition</dt><dd>{inspectedConditions}</dd>
                      <dt>State channel</dt><dd>{inspection.state}</dd>
                      <dt>Type</dt><dd>{inspectedProperties.phase} / {inspectedProperties.mobility}</dd>
                      <dt>Flow density</dt><dd>{inspectedProperties.density}</dd>
                      <dt>Hardness</dt><dd>{inspectedProperties.hardness}</dd>
                      <dt>Friction</dt><dd>{inspectedProperties.friction}</dd>
                      <dt>Mass density</dt><dd>{inspectedProperties.massDensity} kg/m³</dd>
                      <dt>Specific heat</dt><dd>{inspectedProperties.specificHeatCapacity} J/kg·K</dd>
                      <dt>Conductivity</dt><dd>{inspectedProperties.thermalConductivity} W/m·K</dd>
                      <dt>Thermal mass</dt><dd>{inspectedProperties.heatCapacity} units/K</dd>
                      <dt>Moisture</dt><dd>{inspection.moisture} / {inspectedProperties.moistureCapacity}</dd>
                      <dt>Fuel</dt><dd>{inspection.fuel} / {inspectedProperties.fuel}</dd>
                      <dt>Liquid mass</dt><dd>{inspection.liquidMass}</dd>
                      <dt>Phase progress</dt><dd>{inspection.phaseProgress}</dd>
                      <dt>Ignition</dt><dd>{inspectedProperties.ignitionTemperature === null ? '—' : `${inspectedProperties.ignitionTemperature} °C`}</dd>
                      <dt>Explosion</dt><dd>{inspectedProperties.explosionRadius > 0 ? `${inspectedProperties.explosionRadius} cells / ${inspectedProperties.explosionPressure}` : '—'}</dd>
                      <dt>Blast resistance</dt><dd>{inspectedProperties.blastResistance}</dd>
                      <dt>Conductive</dt><dd>{inspectedProperties.conductivity ? 'Yes' : 'No'}</dd>
                      <dt>Corrosiveness</dt><dd>{inspectedProperties.corrosiveness}</dd>
                    </dl>
                  ) : <p>{monitorMode ? 'Click a pixel to pin its live channel.' : 'Move across the field to read a cell.'}</p>}
                </aside>
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
            <div className="rate-control" role="group" aria-label="Simulation speed">
              <span>Time rate</span>
              <div>
                {SIMULATION_RATES.map((rate) => (
                  <button
                    key={rate}
                    type="button"
                    className={simulationRate === rate ? 'active' : ''}
                    aria-pressed={simulationRate === rate}
                    onClick={() => {
                      setSimulationRate(rate)
                      workerRef.current?.postMessage({ type: 'rate', rate })
                    }}
                  >
                    {rate === 0.5 ? '½×' : `${rate}×`}
                  </button>
                ))}
              </div>
            </div>
            <div className="utility-grid">
              <button className={`console-button ${eraser ? 'active' : ''}`} aria-pressed={eraser} onClick={toggleEraser}><Eraser aria-hidden="true" /><span>Eraser</span><kbd>E</kbd></button>
              <button className="console-button destructive" onClick={clear}><Trash2 aria-hidden="true" /><span>Clear</span></button>
              <button className={`console-button inspect-button ${inspectMode ? 'active' : ''}`} aria-pressed={inspectMode} onClick={toggleInspect}><ScanSearch aria-hidden="true" /><span>See stats</span><kbd>I</kbd></button>
              <button className={`console-button inspect-button monitor-button ${monitorMode ? 'active' : ''}`} aria-pressed={monitorMode} onClick={toggleMonitor}><Activity aria-hidden="true" /><span>Monitor</span></button>
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
