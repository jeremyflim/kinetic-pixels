import * as Dialog from '@radix-ui/react-dialog'
import { Download, FileDown, FileUp, MemoryStick, Save, Trash2, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { parseSave, parseSaveJson, sanitizeSaveName, serializeSnapshot, type SaveFileV1 } from './simulation/serialization'
import type { Snapshot } from './simulation/types'

const SLOT_IDS = ['a', 'b', 'c'] as const
type SlotId = (typeof SLOT_IDS)[number]
const storageKey = (slot: SlotId) => `kinetic-pixels:save:${slot}`

interface StoredSlot {
  file: SaveFileV1
  snapshot: Snapshot
}

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  requestSnapshot: () => Promise<Snapshot>
  loadSnapshot: (snapshot: Snapshot) => void
  triggerRef: React.RefObject<HTMLButtonElement | null>
}

function readSlots(): Record<SlotId, StoredSlot | null> {
  const result = { a: null, b: null, c: null } as Record<SlotId, StoredSlot | null>
  for (const slot of SLOT_IDS) {
    try {
      const stored = localStorage.getItem(storageKey(slot))
      if (stored) result[slot] = parseSave(JSON.parse(stored) as unknown)
    } catch {
      result[slot] = null
    }
  }
  return result
}

function displayDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
}

export function MemoryCardDialog({ open, onOpenChange, requestSnapshot, loadSnapshot, triggerRef }: Props) {
  const [slots, setSlots] = useState<Record<SlotId, StoredSlot | null>>(() => readSlots())
  const [names, setNames] = useState<Record<SlotId, string>>({ a: '', b: '', c: '' })
  const [confirming, setConfirming] = useState<SlotId | null>(null)
  const [feedback, setFeedback] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)
  const importRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    const current = readSlots()
    setSlots(current)
    setNames({
      a: current.a?.file.metadata.name ?? '',
      b: current.b?.file.metadata.name ?? '',
      c: current.c?.file.metadata.name ?? '',
    })
    setConfirming(null)
    setFeedback(null)
  }, [open])

  async function saveSlot(slot: SlotId, overwrite = false) {
    if (slots[slot] && !overwrite) {
      setConfirming(slot)
      return
    }
    try {
      const snapshot = await requestSnapshot()
      const name = sanitizeSaveName(names[slot], `SAVE ${slot.toUpperCase()}`)
      const file = serializeSnapshot(snapshot, name)
      localStorage.setItem(storageKey(slot), JSON.stringify(file))
      setSlots((current) => ({ ...current, [slot]: { file, snapshot } }))
      setNames((current) => ({ ...current, [slot]: name }))
      setConfirming(null)
      setFeedback({ kind: 'success', text: `Slot ${slot.toUpperCase()} saved.` })
    } catch (error) {
      setFeedback({ kind: 'error', text: error instanceof Error ? error.message : 'Unable to save this slot.' })
    }
  }

  function loadSlot(slot: SlotId) {
    const saved = slots[slot]
    if (!saved) return
    loadSnapshot(saved.snapshot)
    setFeedback({ kind: 'success', text: `Slot ${slot.toUpperCase()} loaded.` })
    onOpenChange(false)
  }

  function deleteSlot(slot: SlotId) {
    try {
      localStorage.removeItem(storageKey(slot))
      setSlots((current) => ({ ...current, [slot]: null }))
      setNames((current) => ({ ...current, [slot]: '' }))
      setConfirming(null)
      setFeedback({ kind: 'success', text: `Slot ${slot.toUpperCase()} deleted.` })
    } catch {
      setFeedback({ kind: 'error', text: 'Local storage is unavailable.' })
    }
  }

  async function exportWorld() {
    try {
      const snapshot = await requestSnapshot()
      const file = serializeSnapshot(snapshot, 'KINETIC PIXELS')
      const blob = new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `kinetic-pixels-${file.metadata.savedAt.replace(/[:.]/g, '-')}.json`
      anchor.click()
      URL.revokeObjectURL(url)
      setFeedback({ kind: 'success', text: 'World exported.' })
    } catch (error) {
      setFeedback({ kind: 'error', text: error instanceof Error ? error.message : 'Export failed.' })
    }
  }

  async function importWorld(file: File | undefined) {
    if (!file) return
    try {
      const parsed = parseSaveJson(await file.text())
      loadSnapshot(parsed.snapshot)
      setFeedback({ kind: 'success', text: 'World imported.' })
      onOpenChange(false)
    } catch (error) {
      setFeedback({ kind: 'error', text: error instanceof Error ? error.message : 'Import failed.' })
    } finally {
      if (importRef.current) importRef.current.value = ''
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-backdrop" />
        <Dialog.Content
          className="memory-dialog chamfer"
          aria-describedby="memory-description"
          onPointerDownOutside={(event) => event.preventDefault()}
          onInteractOutside={(event) => event.preventDefault()}
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            triggerRef.current?.focus()
          }}
        >
          <header className="dialog-header halftone">
            <div>
              <Dialog.Title>Memory Card Manager</Dialog.Title>
              <Dialog.Description id="memory-description">Three local slots and portable world files.</Dialog.Description>
            </div>
            <MemoryStick aria-hidden="true" />
          </header>

          <div className="dialog-body">
            <div className="slot-list">
              {SLOT_IDS.map((slot) => {
                const saved = slots[slot]
                return (
                  <section className="save-slot" key={slot} aria-labelledby={`slot-${slot}-label`}>
                    <div className="slot-heading">
                      <span id={`slot-${slot}-label`}>Slot {slot.toUpperCase()}</span>
                      <span className={`slot-status ${saved ? 'occupied' : ''}`}>{saved ? 'Occupied' : 'Empty'}</span>
                    </div>
                    <label className="sr-only" htmlFor={`slot-${slot}-name`}>Slot {slot.toUpperCase()} save name</label>
                    <input
                      id={`slot-${slot}-name`}
                      maxLength={24}
                      placeholder={`SAVE ${slot.toUpperCase()}`}
                      value={names[slot]}
                      onChange={(event) => setNames((current) => ({ ...current, [slot]: event.target.value }))}
                    />
                    <div className="slot-meta">{saved ? displayDate(saved.file.metadata.savedAt) : 'No world stored'}</div>
                    {confirming === slot ? (
                      <div className="overwrite-row" role="group" aria-label={`Overwrite Slot ${slot.toUpperCase()}?`}>
                        <span>Replace this save?</span>
                        <button className="button compact" onClick={() => setConfirming(null)}>Cancel</button>
                        <button className="button danger compact" onClick={() => void saveSlot(slot, true)}>Overwrite</button>
                      </div>
                    ) : (
                      <div className="slot-actions">
                        <button className="button accent" onClick={() => void saveSlot(slot)}><Save aria-hidden="true" />Save</button>
                        <button className="button" disabled={!saved} onClick={() => loadSlot(slot)}><Download aria-hidden="true" />Load</button>
                        <button className="icon-button danger-outline" disabled={!saved} onClick={() => deleteSlot(slot)} aria-label={`Delete Slot ${slot.toUpperCase()}`}><Trash2 aria-hidden="true" /></button>
                      </div>
                    )}
                  </section>
                )
              })}
            </div>

            <section className="external-panel halftone" aria-labelledby="external-heading">
              <h2 id="external-heading">External file management</h2>
              <div>
                <button className="button amber" onClick={() => void exportWorld()}><FileDown aria-hidden="true" />JSON Export</button>
                <button className="button amber" onClick={() => importRef.current?.click()}><FileUp aria-hidden="true" />JSON Import</button>
                <input ref={importRef} className="sr-only" type="file" accept=".json,application/json" onChange={(event) => void importWorld(event.target.files?.[0])} />
              </div>
            </section>

            <div className="dialog-footer">
              <p className={`feedback ${feedback?.kind ?? ''}`} role="status" aria-live="polite">{feedback?.text ?? ''}</p>
              <Dialog.Close asChild><button className="button close-button"><X aria-hidden="true" />Close</button></Dialog.Close>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
