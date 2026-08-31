import { expect, test, type Page } from '@playwright/test'
import { GRID_HEIGHT, GRID_WIDTH } from '../../src/simulation/types'

const TITLE_WOOD_CELLS = 1_728

async function ready(page: Page) {
  page.on('pageerror', (error) => console.error('PAGE ERROR:', error.stack ?? error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') console.error('BROWSER ERROR:', message.text())
  })
  await page.goto('./')
  await expect(page.locator('canvas')).toHaveAttribute('data-ready', 'true')
}

async function materialCount(page: Page, materialId: number): Promise<number> {
  return page.evaluate((id) => window.__KINETIC_PIXELS__!.count(id), materialId)
}

async function pressStyles(page: Page, selector: string) {
  const button = page.locator(selector)
  const before = await button.evaluate((element) => {
    const style = getComputedStyle(element)
    return { translate: style.translate, shadow: style.boxShadow, filter: style.filter }
  })
  const box = await button.boundingBox()
  if (!box) throw new Error(`Button did not render: ${selector}`)
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.waitForTimeout(90)
  const pressed = await button.evaluate((element) => {
    const style = getComputedStyle(element)
    return { translate: style.translate, shadow: style.boxShadow, filter: style.filter }
  })
  await page.mouse.up()
  return { before, pressed }
}

test.beforeEach(async ({ page }) => {
  await ready(page)
  await page.evaluate(() => localStorage.clear())
})

test('starts with the wooden title, Sand, paused state, and instruction', async ({ page }) => {
  const sandButton = page.getByRole('button', { name: 'Sand' })
  await expect(sandButton).toHaveAttribute('aria-pressed', 'true')
  await expect(sandButton).toHaveCSS('color', 'rgb(48, 41, 61)')
  await expect(sandButton.locator('svg')).toHaveCSS('color', 'rgb(48, 41, 61)')
  await expect(page.getByText('Paused')).toBeVisible()
  await expect(page.getByText('Click to play')).toBeVisible()
  expect(await materialCount(page, 4)).toBe(TITLE_WOOD_CELLS)
})

test('shows the complete paintable material palette inside the element rail', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 576 })
  const expected = ['Sand', 'Water', 'Stone', 'Wood', 'Fire', 'Oil', 'Plant', 'Acid', 'Metal', 'Lava', 'Ice', 'Spark', 'Gunpowder']
  const buttons = page.locator('.material-button')
  await expect(buttons).toHaveCount(expected.length)
  for (const label of expected) await expect(page.getByRole('button', { name: label })).toBeVisible()

  const railBox = await page.locator('.left-rail').boundingBox()
  if (!railBox) throw new Error('Element rail did not render')
  for (const button of await buttons.all()) {
    const box = await button.boundingBox()
    if (!box) throw new Error('Material button did not render')
    expect(box.x).toBeGreaterThanOrEqual(railBox.x)
    expect(box.y).toBeGreaterThanOrEqual(railBox.y)
    expect(box.x + box.width).toBeLessThanOrEqual(railBox.x + railBox.width)
    expect(box.y + box.height).toBeLessThanOrEqual(railBox.y + railBox.height)
  }
  const lastButtonBox = await buttons.last().boundingBox()
  const leftColumnButtonBox = await page.getByRole('button', { name: 'Stone' }).boundingBox()
  const markBox = await page.locator('.rail-mark').boundingBox()
  if (!lastButtonBox || !leftColumnButtonBox || !markBox) throw new Error('Palette footer did not render')
  expect(lastButtonBox.x).toBeCloseTo(leftColumnButtonBox.x, 1)
  expect(lastButtonBox.width).toBeCloseTo(leftColumnButtonBox.width, 1)
  expect(lastButtonBox.y + lastButtonBox.height).toBeLessThanOrEqual(markBox.y)

  await page.getByRole('button', { name: 'Gunpowder' }).click()
  await expect(page.getByRole('button', { name: 'Gunpowder' })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByText('Gunpowder', { exact: true }).last()).toBeVisible()
})

test('clearly separates the playable canvas from its dark bezel', async ({ page }) => {
  await expect(page.locator('.canvas-well')).toHaveCSS('background-color', 'rgb(33, 25, 44)')
  await expect(page.locator('.canvas-stage')).toHaveCSS('outline-style', 'solid')
  await expect(page.locator('canvas')).toHaveCSS('background-color', 'rgb(251, 248, 255)')
})

test('inspection mode reads live stats while preserving normal painting', async ({ page }) => {
  const inspect = page.getByRole('button', { name: /See stats/ })
  await inspect.click()
  await expect(inspect).toHaveAttribute('aria-pressed', 'true')
  const canvas = page.locator('canvas')
  await canvas.hover({ position: { x: 10, y: 10 } })
  const panel = page.getByLabel('Pixel inspection')
  await expect(panel).toBeVisible()
  await expect(panel).toContainText('Air')
  await expect(panel).toContainText('Temperature')
  await canvas.click({ position: { x: 10, y: 10 } })
  await expect(page.getByText('Click to play')).not.toBeVisible()
  expect(await materialCount(page, 1)).toBeGreaterThan(0)
})

test('pause control and side indicators use the console signal animations', async ({ page }) => {
  await expect(page.locator('.status-space b')).toHaveCSS('animation-name', 'paused-indicator-blink')
  await page.keyboard.press('Space')
  await expect(page.getByRole('button', { name: /Pause/ })).toHaveCSS('animation-name', 'none')
  await expect(page.locator('.screw-one')).toHaveCSS('animation-name', 'side-light-left')
  await expect(page.locator('.screw-two')).toHaveCSS('animation-name', 'side-light-right')
})

test('wheel zoom keeps the pointed cell anchored and the gauge can reset it', async ({ page }) => {
  const canvas = page.locator('canvas')
  const slider = page.getByRole('slider', { name: 'Field zoom' })
  const before = await canvas.boundingBox()
  if (!before) throw new Error('Canvas did not render')
  const anchor = { x: before.x + before.width * 0.72, y: before.y + before.height * 0.36 }
  const logicalBefore = {
    x: ((anchor.x - before.x) / before.width) * 192,
    y: ((anchor.y - before.y) / before.height) * 180,
  }
  await page.mouse.move(anchor.x, anchor.y)
  await page.mouse.wheel(0, -100)
  await expect(slider).toHaveValue('125')
  const after = await canvas.boundingBox()
  if (!after) throw new Error('Zoomed canvas did not render')
  expect(after.width).toBeCloseTo(before.width * 1.25, 0)
  expect(((anchor.x - after.x) / after.width) * 192).toBeCloseTo(logicalBefore.x, 1)
  expect(((anchor.y - after.y) / after.height) * 180).toBeCloseTo(logicalBefore.y, 1)
  await slider.fill('100')
  await expect(slider).toHaveValue('100')
  const reset = await canvas.boundingBox()
  if (!reset) throw new Error('Reset canvas did not render')
  expect(reset.width).toBeCloseTo(before.width, 0)
})

test('momentary action buttons visibly press into the console', async ({ page }) => {
  const clear = await pressStyles(page, '.console-button.destructive')
  expect(clear.pressed.translate).not.toBe(clear.before.translate)
  expect(clear.pressed.shadow).toContain('inset')
  expect(clear.pressed.filter).not.toBe(clear.before.filter)

  const memory = await pressStyles(page, '.memory-button')
  expect(memory.pressed.translate).not.toBe(memory.before.translate)
  expect(memory.pressed.shadow).toContain('inset')
  expect(memory.pressed.filter).not.toBe(memory.before.filter)
  await expect(page.getByRole('dialog')).toBeVisible()
})

test('physics continues ticking throughout a long drawing gesture', async ({ page }) => {
  await page.keyboard.press('Space')
  await page.waitForTimeout(100)
  const tickBefore = await page.evaluate(() => window.__KINETIC_PIXELS__!.tick())
  const canvas = page.locator('canvas')
  const box = await canvas.boundingBox()
  if (!box) throw new Error('Canvas did not render')
  await page.mouse.move(box.x + 20, box.y + 30)
  await page.mouse.down()
  for (let step = 0; step < 24; step += 1) {
    await page.mouse.move(box.x + 20 + step * 9, box.y + 30 + (step % 4) * 8)
    await page.waitForTimeout(10)
  }
  const tickDuringStroke = await page.evaluate(() => window.__KINETIC_PIXELS__!.tick())
  await page.mouse.up()
  expect(tickDuringStroke).toBeGreaterThan(tickBefore + 5)
  await expect(page.getByRole('button', { name: /Pause/ })).toBeVisible()
})

test('holding the pointer still continuously reapplies the active brush', async ({ page }) => {
  const canvas = page.locator('canvas')
  const box = await canvas.boundingBox()
  if (!box) throw new Error('Canvas did not render')
  await page.mouse.move(box.x + box.width * 0.25, box.y + box.height * 0.12)
  await page.mouse.down()
  await page.waitForTimeout(600)
  const sandDuringHold = await materialCount(page, 1)
  await page.mouse.up()
  expect(sandDuringHold).toBeGreaterThan(120)
  await expect(page.getByRole('button', { name: /Pause/ })).toBeVisible()
})

test('first canvas pointer starts and paints in the same gesture', async ({ page }) => {
  const canvas = page.locator('canvas')
  await canvas.click({ position: { x: 20, y: 20 } })
  await expect(page.getByText('Click to play')).toBeHidden()
  await expect(page.getByRole('button', { name: /Pause/ })).toBeVisible()
  expect(await materialCount(page, 1)).toBeGreaterThan(0)
})

test('a first click on occupied Wood starts without replacing it', async ({ page }) => {
  const canvas = page.locator('canvas')
  const box = await canvas.boundingBox()
  if (!box) throw new Error('Canvas did not render')
  await page.mouse.click(box.x + (25.5 / GRID_WIDTH) * box.width, box.y + (64.5 / GRID_HEIGHT) * box.height)
  await expect(page.getByRole('button', { name: /Pause/ })).toBeVisible()
  expect(await page.evaluate(() => window.__KINETIC_PIXELS__!.cell(25, 64))).toBe(4)
  expect(await materialCount(page, 4)).toBe(TITLE_WOOD_CELLS)
})

test('Space starts without painting and pause status tracks state', async ({ page }) => {
  await page.keyboard.press('Space')
  await expect(page.getByText('Click to play')).toBeHidden()
  await expect(page.getByText('Paused')).toBeHidden()
  expect(await materialCount(page, 1)).toBe(0)
  await page.keyboard.press('Space')
  await expect(page.getByText('Paused')).toBeVisible()
})

test('paused painting, interpolation, and erasing update immediately', async ({ page }) => {
  await page.keyboard.press('Space')
  await page.keyboard.press('Space')
  await page.getByRole('button', { name: 'Stone' }).click()
  await page.getByLabel('Brush radius').fill('1')
  const canvas = page.locator('canvas')
  const box = await canvas.boundingBox()
  if (!box) throw new Error('Canvas did not render')
  await page.mouse.move(box.x + 35, box.y + 40)
  await page.mouse.down()
  await page.mouse.move(box.x + 200, box.y + 40, { steps: 2 })
  await page.mouse.up()
  expect(await materialCount(page, 3)).toBeGreaterThan(80)
  const beforeErase = await materialCount(page, 3)
  await page.keyboard.press('e')
  await canvas.click({ position: { x: 100, y: 40 } })
  expect(await materialCount(page, 3)).toBeLessThan(beforeErase)
  await expect(page.getByRole('button', { name: /Eraser/ })).toHaveAttribute('aria-pressed', 'true')
  await page.keyboard.press('e')
  await expect(page.getByRole('button', { name: 'Stone' })).toHaveAttribute('aria-pressed', 'true')
})

test('radius shortcuts clamp and adjust the control', async ({ page }) => {
  const slider = page.getByLabel('Brush radius')
  await expect(slider).toHaveValue('5')
  await page.keyboard.press('-')
  await expect(slider).toHaveValue('4')
  await page.keyboard.press('=')
  await expect(slider).toHaveValue('5')
  await page.keyboard.press('+')
  await expect(slider).toHaveValue('6')
})

test('Clear empties the world and reload restores the title', async ({ page }) => {
  await page.getByRole('button', { name: /Clear/ }).click()
  expect(await materialCount(page, 4)).toBe(0)
  await expect(page.getByText('Click to play')).toBeHidden()
  await page.reload()
  await expect(page.locator('canvas')).toHaveAttribute('data-ready', 'true')
  expect(await materialCount(page, 4)).toBe(TITLE_WOOD_CELLS)
})

test('memory manager pauses, locks shortcuts, ignores backdrop, and closes with Escape', async ({ page }) => {
  await page.keyboard.press('Space')
  await page.getByRole('button', { name: /Memory Card/ }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(page.getByText('Paused')).toBeVisible()
  const slider = page.getByLabel('Brush radius')
  await page.keyboard.press('-')
  await page.keyboard.press('=')
  await page.keyboard.press('+')
  await page.keyboard.press('e')
  await page.keyboard.press('Space')
  await expect(slider).toHaveValue('5')
  await expect(page.locator('.play-button')).toContainText('Play')
  await page.locator('.dialog-backdrop').click({ position: { x: 2, y: 2 }, force: true })
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toBeHidden()
  await expect(page.getByRole('button', { name: /Memory Card/ })).toBeFocused()
})

test('three local slots save, confirm overwrite, load, and delete', async ({ page }) => {
  await page.keyboard.press('Space')
  await page.keyboard.press('Space')
  await page.getByRole('button', { name: 'Stone' }).click()
  await page.locator('canvas').click({ position: { x: 25, y: 25 } })
  const stoneCount = await materialCount(page, 3)
  await page.getByRole('button', { name: /Memory Card/ }).click()
  await page.getByLabel('Slot A save name').fill('ROCK TEST')
  await page.getByRole('region', { name: 'Slot A' }).getByRole('button', { name: 'Save' }).click()
  await expect(page.getByText('Slot A saved.')).toBeVisible()
  await page.getByRole('region', { name: 'Slot A' }).getByRole('button', { name: 'Save' }).click()
  await expect(page.getByText('Replace this save?')).toBeVisible()
  await page.getByRole('button', { name: 'Cancel' }).click()
  await page.getByRole('button', { name: 'Close' }).click()
  await page.getByRole('button', { name: /Clear/ }).click()
  await page.getByRole('button', { name: /Memory Card/ }).click()
  await page.getByRole('region', { name: 'Slot A' }).getByRole('button', { name: 'Load' }).click()
  expect(await materialCount(page, 3)).toBe(stoneCount)
  await expect(page.getByText('Paused')).toBeVisible()
  await page.getByRole('button', { name: /Memory Card/ }).click()
  await page.getByRole('button', { name: 'Delete Slot A' }).click()
  await expect(page.getByText('Slot A deleted.')).toBeVisible()
  await expect(page.getByRole('region', { name: 'Slot A' }).getByRole('button', { name: 'Load' })).toBeDisabled()
  await expect(page.getByRole('region', { name: 'Slot B' }).getByRole('button', { name: 'Load' })).toBeDisabled()
  await expect(page.getByRole('region', { name: 'Slot C' }).getByRole('button', { name: 'Load' })).toBeDisabled()
})

test('JSON export/import round-trips and invalid import preserves the world', async ({ page }) => {
  await page.keyboard.press('Space')
  await page.keyboard.press('Space')
  await page.getByRole('button', { name: 'Stone' }).click()
  await page.locator('canvas').click({ position: { x: 30, y: 30 } })
  const stoneCount = await materialCount(page, 3)
  await page.getByRole('button', { name: /Memory Card/ }).click()
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: /JSON Export/ }).click()
  const download = await downloadPromise
  const path = await download.path()
  if (!path) throw new Error('Export did not produce a file')
  await page.getByRole('button', { name: 'Close' }).click()
  await page.getByRole('button', { name: /Clear/ }).click()
  await page.getByRole('button', { name: /Memory Card/ }).click()
  await page.locator('input[type=file]').setInputFiles(path)
  await expect(page.getByRole('dialog')).toBeHidden()
  expect(await materialCount(page, 3)).toBe(stoneCount)
  await page.getByRole('button', { name: /Memory Card/ }).click()
  await page.locator('input[type=file]').setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{"bad":true}') })
  await expect(page.getByText('Not a Kinetic Pixels save')).toBeVisible()
  expect(await materialCount(page, 3)).toBe(stoneCount)
})
