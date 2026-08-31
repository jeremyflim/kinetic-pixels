import { MATERIAL_BY_ID, MaterialId, StatusFlag } from './materials'
import { CELL_COUNT, GRID_HEIGHT, GRID_WIDTH, type Snapshot } from './types'

export const SAVE_FORMAT = 'kinetic-pixels'
export const SAVE_VERSION = 3
export const MAX_IMPORT_BYTES = 2_000_000

interface SaveFileBase {
  format: typeof SAVE_FORMAT
  grid: { width: number; height: number }
  metadata: { name: string; savedAt: string }
}

export interface SaveFileV2 extends SaveFileBase {
  version: 2
  simulation: {
    tick: number
    seed: number
    randomState: number
    material: string
    state: string
  }
}

export interface SaveFileV3 extends SaveFileBase {
  version: typeof SAVE_VERSION
  simulation: SaveFileV2['simulation'] & {
    status: string
    heat: string
  }
}

export type SaveFile = SaveFileV2 | SaveFileV3

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
const LEGACY_BURNING_FLAG = 0x8000
const LEGACY_PROGRESS_MASK = 0x7fff

export function bytesToBase64(bytes: Uint8Array): string {
  let output = ''
  for (let index = 0; index < bytes.length; index += 3) {
    const a = bytes[index]
    const b = index + 1 < bytes.length ? bytes[index + 1] : 0
    const c = index + 2 < bytes.length ? bytes[index + 2] : 0
    const combined = (a << 16) | (b << 8) | c
    output += BASE64[(combined >>> 18) & 63]
    output += BASE64[(combined >>> 12) & 63]
    output += index + 1 < bytes.length ? BASE64[(combined >>> 6) & 63] : '='
    output += index + 2 < bytes.length ? BASE64[combined & 63] : '='
  }
  return output
}

export function base64ToBytes(value: string): Uint8Array {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) throw new Error('Save contains invalid Base64 data')
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0
  const output = new Uint8Array((value.length / 4) * 3 - padding)
  let outputIndex = 0
  for (let index = 0; index < value.length; index += 4) {
    const a = BASE64.indexOf(value[index])
    const b = BASE64.indexOf(value[index + 1])
    const c = value[index + 2] === '=' ? 0 : BASE64.indexOf(value[index + 2])
    const d = value[index + 3] === '=' ? 0 : BASE64.indexOf(value[index + 3])
    const combined = (a << 18) | (b << 12) | (c << 6) | d
    if (outputIndex < output.length) output[outputIndex++] = (combined >>> 16) & 255
    if (outputIndex < output.length) output[outputIndex++] = (combined >>> 8) & 255
    if (outputIndex < output.length) output[outputIndex++] = combined & 255
  }
  return output
}

function stateToBytes(state: Uint16Array): Uint8Array {
  const bytes = new Uint8Array(state.length * 2)
  const view = new DataView(bytes.buffer)
  state.forEach((value, index) => view.setUint16(index * 2, value, true))
  return bytes
}

function bytesToState(bytes: Uint8Array): Uint16Array {
  const state = new Uint16Array(bytes.length / 2)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  for (let index = 0; index < state.length; index += 1) state[index] = view.getUint16(index * 2, true)
  return state
}

export function sanitizeSaveName(value: string, fallback: string): string {
  return value.trim().slice(0, 24) || fallback
}

export function serializeSnapshot(snapshot: Snapshot, name: string, savedAt = new Date().toISOString()): SaveFileV3 {
  return {
    format: SAVE_FORMAT,
    version: SAVE_VERSION,
    grid: { width: snapshot.width, height: snapshot.height },
    simulation: {
      tick: snapshot.tick,
      seed: snapshot.seed,
      randomState: snapshot.randomState,
      material: bytesToBase64(snapshot.material),
      state: bytesToBase64(stateToBytes(snapshot.state)),
      status: bytesToBase64(snapshot.status),
      heat: bytesToBase64(snapshot.heat),
    },
    metadata: { name: name.slice(0, 24), savedAt },
  }
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Save must be a JSON object')
  return value as Record<string, unknown>
}

function finiteInteger(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > 0xffffffff) throw new Error(`${label} is invalid`)
  return value
}

function validateByteField(value: unknown, label: string): Uint8Array {
  if (typeof value !== 'string') throw new Error('Save data is missing')
  const bytes = base64ToBytes(value)
  if (bytes.length !== CELL_COUNT) throw new Error(`${label} data length is invalid`)
  return bytes
}

export function parseSave(input: unknown): { file: SaveFile; snapshot: Snapshot } {
  const root = record(input)
  if (root.format !== SAVE_FORMAT) throw new Error('Not a Kinetic Pixels save')
  if (root.version !== 2 && root.version !== SAVE_VERSION) throw new Error('Unsupported save version')
  const grid = record(root.grid)
  if (grid.width !== GRID_WIDTH || grid.height !== GRID_HEIGHT) throw new Error('Save grid dimensions do not match')
  const simulation = record(root.simulation)
  const material = validateByteField(simulation.material, 'Material')
  if (typeof simulation.state !== 'string') throw new Error('Save data is missing')
  const stateBytes = base64ToBytes(simulation.state)
  if (stateBytes.length !== CELL_COUNT * 2) throw new Error('State data length is invalid')
  const state = bytesToState(stateBytes)
  const status = root.version === SAVE_VERSION ? validateByteField(simulation.status, 'Status') : new Uint8Array(CELL_COUNT)
  const heat = root.version === SAVE_VERSION ? validateByteField(simulation.heat, 'Heat') : new Uint8Array(CELL_COUNT)

  for (let index = 0; index < material.length; index += 1) {
    if (!MATERIAL_BY_ID.has(material[index])) throw new Error('Save contains an unknown material')
    if (root.version === 2 && material[index] === MaterialId.Wood && (state[index] & LEGACY_BURNING_FLAG)) {
      status[index] |= StatusFlag.Burning
      state[index] &= LEGACY_PROGRESS_MASK
    }
  }

  const metadata = record(root.metadata)
  if (typeof metadata.name !== 'string' || metadata.name.length > 24 || typeof metadata.savedAt !== 'string' || Number.isNaN(Date.parse(metadata.savedAt))) {
    throw new Error('Save metadata is invalid')
  }
  const snapshot: Snapshot = {
    width: GRID_WIDTH,
    height: GRID_HEIGHT,
    tick: finiteInteger(simulation.tick, 'Tick'),
    seed: finiteInteger(simulation.seed, 'Seed'),
    randomState: finiteInteger(simulation.randomState, 'Random state'),
    material,
    state,
    status,
    heat,
  }
  return { file: root as unknown as SaveFile, snapshot }
}

export function parseSaveJson(text: string): { file: SaveFile; snapshot: Snapshot } {
  if (new Blob([text]).size > MAX_IMPORT_BYTES) throw new Error('Save file is too large')
  try {
    return parseSave(JSON.parse(text) as unknown)
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error('Save file is not valid JSON')
    throw error
  }
}
