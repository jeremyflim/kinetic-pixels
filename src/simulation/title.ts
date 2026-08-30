import { MaterialId } from './materials'
import type { World } from './types'

const GLYPHS: Record<string, readonly string[]> = {
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  C: ['01111', '10000', '10000', '10000', '10000', '10000', '01111'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  I: ['11111', '00100', '00100', '00100', '00100', '00100', '11111'],
  K: ['10001', '10010', '10100', '11000', '10100', '10010', '10001'],
  L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  N: ['10001', '11001', '11001', '10101', '10011', '10011', '10001'],
  P: ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
  S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  X: ['10001', '10001', '01010', '00100', '01010', '10001', '10001'],
}

export const TITLE_LINES = ['KINETIC', 'PIXELS'] as const
export const TITLE_SCALE = 5
const LETTER_GAP = 2
const LINE_GAP = 3

export function titleMask(width: number, height: number): Uint8Array {
  const mask = new Uint8Array(width * height)
  const lineHeight = 7 * TITLE_SCALE
  const lineGap = LINE_GAP * TITLE_SCALE
  const totalHeight = lineHeight * TITLE_LINES.length + lineGap
  const top = Math.floor((height - totalHeight) / 2)

  TITLE_LINES.forEach((line, lineIndex) => {
    const logicalWidth = line.length * 5 + (line.length - 1) * LETTER_GAP
    const lineWidth = logicalWidth * TITLE_SCALE
    const left = Math.floor((width - lineWidth) / 2)
    const lineTop = top + lineIndex * (lineHeight + lineGap)

    for (let letterIndex = 0; letterIndex < line.length; letterIndex += 1) {
      const glyph = GLYPHS[line[letterIndex]]
      const glyphLeft = left + letterIndex * (5 + LETTER_GAP) * TITLE_SCALE
      glyph.forEach((row, glyphY) => {
        for (let glyphX = 0; glyphX < row.length; glyphX += 1) {
          if (row[glyphX] !== '1') continue
          for (let scaleY = 0; scaleY < TITLE_SCALE; scaleY += 1) {
            for (let scaleX = 0; scaleX < TITLE_SCALE; scaleX += 1) {
              const x = glyphLeft + glyphX * TITLE_SCALE + scaleX
              const y = lineTop + glyphY * TITLE_SCALE + scaleY
              mask[y * width + x] = 1
            }
          }
        }
      })
    }
  })

  return mask
}

export function rasterizeTitle(world: World): number {
  const mask = titleMask(world.width, world.height)
  let count = 0
  for (let index = 0; index < mask.length; index += 1) {
    if (mask[index]) {
      world.material[index] = MaterialId.Wood
      count += 1
    }
  }
  return count
}
