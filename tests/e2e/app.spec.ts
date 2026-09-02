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
  const startupHint = page.locator('.startup-hint')
  await expect(startupHint).toBeVisible()
  await expect(page.locator('.device')).toHaveCSS('animation-name', 'console-signal-cycle')
  expect(await materialCount(page, 4)).toBe(TITLE_WOOD_CELLS)
})

test('shows the complete paintable material palette inside the element rail', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 576 })
  const expected = [
    'Sand', 'Water', 'Stone', 'Wood', 'Fire', 'Oil', 'Plant', 'Acid', 'Metal', 'Lava', 'Ice', 'Spark', 'Gunpowder',
    'Salt', 'Salt Water', 'Coal', 'Rubber', 'Battery', 'Alcohol', 'Alcohol Vapor', 'Sodium', 'Hydrogen', 'Soil', 'Source',
  ]
  const buttons = page.locator('.material-button')
  await expect(buttons).toHaveCount(expected.length)
  await expect(buttons).toHaveText(expected)

  const railBox = await page.locator('.left-rail').boundingBox()
  if (!railBox) throw new Error('Element rail did not render')
  for (const button of await buttons.all().then((items) => items.slice(0, 4))) {
    const box = await button.boundingBox()
    if (!box) throw new Error('Material button did not render')
    expect(box.x).toBeGreaterThanOrEqual(railBox.x)
    expect(box.y).toBeGreaterThanOrEqual(railBox.y)
    expect(box.x + box.width).toBeLessThanOrEqual(railBox.x + railBox.width)
    expect(box.y + box.height).toBeLessThanOrEqual(railBox.y + railBox.height)
  }
  const grid = page.locator('.material-grid')
  expect(await grid.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true)
  const markBefore = await page.locator('.rail-mark').boundingBox()
  await page.getByRole('button', { name: 'Source' }).scrollIntoViewIfNeeded()
  await expect(page.getByRole('button', { name: 'Source' })).toBeVisible()
  const lastButtonBox = await buttons.last().boundingBox()
  const leftColumnButtonBox = await page.getByRole('button', { name: 'Hydrogen' }).boundingBox()
  const markBox = await page.locator('.rail-mark').boundingBox()
  if (!lastButtonBox || !leftColumnButtonBox || !markBox || !markBefore) throw new Error('Palette footer did not render')
  expect(lastButtonBox.x).toBeCloseTo(leftColumnButtonBox.x, 1)
  expect(lastButtonBox.width).toBeCloseTo(leftColumnButtonBox.width, 1)
  expect(lastButtonBox.y + lastButtonBox.height).toBeLessThanOrEqual(markBox.y)
  expect(markBox.y).toBeCloseTo(markBefore.y, 1)

  await page.getByRole('button', { name: 'Source' }).click()
  await expect(page.getByRole('button', { name: 'Source' })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByText('Source', { exact: true }).last()).toBeVisible()
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
  await expect(panel).toContainText('Live')
  await expect(panel).toContainText('Material')
  await expect(panel).not.toContainText('Burn rate')
  await expect(panel).not.toContainText('State channel')
  const panelBox = await panel.boundingBox()
  const stageBox = await page.locator('.canvas-stage').boundingBox()
  expect(panelBox && stageBox && panelBox.y + panelBox.height <= stageBox.y + stageBox.height).toBe(true)
  await canvas.click({ position: { x: 10, y: 10 } })
  await expect(page.getByText('Click to play')).not.toBeVisible()
  expect(await materialCount(page, 1)).toBeGreaterThan(0)
})

test('stationary inspection keeps refreshing without another pointer move', async ({ page }) => {
  await page.getByLabel('Brush radius').fill('1')
  const canvas = page.locator('canvas')
  await page.getByRole('button', { name: 'Metal' }).click()
  await canvas.click({ position: { x: 120, y: 210 } })
  await page.getByRole('button', { name: 'Fire' }).click()
  await canvas.click({ position: { x: 120, y: 216 } })
  await page.getByRole('button', { name: /See stats/ }).click()
  await canvas.hover({ position: { x: 120, y: 210 } })
  const temperature = page.getByLabel('Pixel inspection').locator('dt', { hasText: 'Temperature' }).locator('xpath=following-sibling::dd[1]')
  await expect(temperature).toBeVisible()
  const before = await temperature.textContent()
  await expect.poll(() => temperature.textContent(), { timeout: 3_000 }).not.toBe(before)
})

test('Monitor arms without painting, then stays pinned while normal controls and painting resume', async ({ page }) => {
  const monitor = page.getByRole('button', { name: 'Monitor' })
  const canvas = page.locator('canvas')
  await monitor.click()
  await expect(monitor).toHaveAttribute('aria-pressed', 'true')
  expect(await materialCount(page, 1)).toBe(0)
  await canvas.click({ position: { x: 35, y: 35 } })
  expect(await materialCount(page, 1)).toBe(0)
  await expect(page.getByText('Click to play')).toBeVisible()
  const panel = page.getByLabel('Pixel inspection')
  await expect(panel).toBeVisible()
  const firstCoordinate = await panel.locator('header b').textContent()
  await page.getByRole('button', { name: 'Water', exact: true }).click()
  await page.getByRole('button', { name: /Play|Pause/ }).click()
  await page.getByRole('button', { name: '2×' }).click()
  await expect(panel.locator('header b')).toHaveText(firstCoordinate ?? '')
  await expect(monitor).toHaveAttribute('aria-pressed', 'true')
  await canvas.click({ position: { x: 90, y: 70 } })
  expect(await materialCount(page, 2)).toBeGreaterThan(0)
  await expect(panel.locator('header b')).toHaveText(firstCoordinate ?? '')
  await expect(monitor).toHaveAttribute('aria-pressed', 'true')
  await page.keyboard.press('Escape')
  await expect(monitor).toHaveAttribute('aria-pressed', 'true')
  await expect(panel).toBeVisible()
  await monitor.click()
  await expect(monitor).toHaveAttribute('aria-pressed', 'false')

  await monitor.click()
  await page.getByRole('button', { name: 'Oil', exact: true }).click()
  await expect(monitor).toHaveAttribute('aria-pressed', 'false')
  await expect(panel).toBeHidden()
})

test('time rate keys change worker tick throughput without changing the fixed simulation step', async ({ page }) => {
  const speed = page.getByRole('group', { name: 'Simulation speed' })
  await speed.getByRole('button', { name: '½×' }).click()
  await page.getByRole('button', { name: 'Play' }).click()
  const slowStart = await page.evaluate(() => window.__KINETIC_PIXELS__!.tick())
  await page.waitForTimeout(650)
  const slowEnd = await page.evaluate(() => window.__KINETIC_PIXELS__!.tick())
  await speed.getByRole('button', { name: '2×' }).click()
  const fastStart = await page.evaluate(() => window.__KINETIC_PIXELS__!.tick())
  await page.waitForTimeout(650)
  const fastEnd = await page.evaluate(() => window.__KINETIC_PIXELS__!.tick())
  expect(fastEnd - fastStart).toBeGreaterThan((slowEnd - slowStart) * 2.5)
})

test('all blinking indicators share one console signal timeline', async ({ page }) => {
  await expect(page.locator('.device')).toHaveCSS('animation-name', 'console-signal-cycle')
  await expect(page.locator('.device')).toHaveCSS('animation-duration', '1s')
  await expect(page.locator('.status-space b')).toHaveCSS('animation-name', 'none')
  await expect(page.locator('.startup-hint')).toHaveCSS('animation-name', 'none')
  await expect(page.locator('.screw-one')).toHaveCSS('animation-name', 'none')
  await expect(page.locator('.screw-two')).toHaveCSS('animation-name', 'none')
  await expect.poll(() => page.locator('.device').evaluate((device) => {
    const style = (selector: string) => getComputedStyle(device.querySelector(selector)!)
    return {
      status: style('.status-space b').color,
      statusOpacity: style('.status-space b').opacity,
      left: style('.screw-one').backgroundColor,
      right: style('.screw-two').backgroundColor,
      prompt: style('.startup-hint').backgroundColor,
    }
  }), { timeout: 2_500, intervals: [20] }).toEqual({
    status: 'rgb(255, 190, 79)',
    statusOpacity: '1',
    left: 'rgb(255, 190, 79)',
    right: 'rgb(146, 167, 255)',
    prompt: 'rgb(69, 230, 189)',
  })
  await page.keyboard.press('Space')
  await expect(page.getByRole('button', { name: /Pause/ })).toHaveCSS('animation-name', 'none')
})

test('wheel zoom keeps the pointed cell anchored and the gauge can reset it', async ({ page }) => {
  const canvas = page.locator('canvas')
  const slider = page.getByRole('slider', { name: 'Field zoom' })
  const stageBox = await page.locator('.canvas-stage').boundingBox()
  const gaugeBox = await page.locator('.zoom-gauge').boundingBox()
  const wellBox = await page.locator('.canvas-well').boundingBox()
  if (!stageBox || !gaugeBox || !wellBox) throw new Error('Zoom controls did not render')
  expect(gaugeBox.x + gaugeBox.width).toBeLessThanOrEqual(stageBox.x)
  expect(gaugeBox.y).toBeCloseTo(stageBox.y, 1)
  expect(gaugeBox.height).toBeCloseTo(stageBox.height, 1)
  expect(Math.abs((stageBox.x - wellBox.x) - (wellBox.x + wellBox.width - stageBox.x - stageBox.width))).toBeLessThan(2)
  expect(gaugeBox.x + gaugeBox.width / 2).toBeCloseTo((wellBox.x + stageBox.x) / 2, 0)
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
  expect(Math.abs(((anchor.x - after.x) / after.width) * 192 - logicalBefore.x)).toBeLessThan(0.1)
  expect(Math.abs(((anchor.y - after.y) / after.height) * 180 - logicalBefore.y)).toBeLessThan(0.1)
  await slider.fill('100')
  await expect(slider).toHaveValue('100')
  const reset = await canvas.boundingBox()
  if (!reset) throw new Error('Reset canvas did not render')
  expect(reset.width).toBeCloseTo(before.width, 0)
})

test('right-drag pans only while zoomed and suppresses the field context menu', async ({ page }) => {
  const stage = page.locator('.canvas-stage')
  const canvas = page.locator('canvas')
  const camera = page.locator('.canvas-camera')
  const hint = page.getByText('Right-drag to pan')
  await expect(hint).toBeHidden()

  await page.getByRole('slider', { name: 'Field zoom' }).fill('200')
  await expect(hint).toBeVisible()
  const contextPrevented = await canvas.evaluate((element) => {
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
    element.dispatchEvent(event)
    return event.defaultPrevented
  })
  expect(contextPrevented).toBe(true)

  const stageBox = await stage.boundingBox()
  if (!stageBox) throw new Error('Canvas stage did not render')
  const leftBefore = Number.parseFloat(await camera.evaluate((element) => getComputedStyle(element).left))
  await page.mouse.move(stageBox.x + stageBox.width / 2, stageBox.y + stageBox.height / 2)
  await page.mouse.down({ button: 'right' })
  await expect(canvas).toHaveCSS('cursor', 'grabbing')
  await page.mouse.move(stageBox.x + stageBox.width / 2 + 60, stageBox.y + stageBox.height / 2 + 30, { steps: 4 })
  await page.mouse.up({ button: 'right' })
  const leftAfter = Number.parseFloat(await camera.evaluate((element) => getComputedStyle(element).left))
  expect(leftAfter).toBeGreaterThan(leftBefore)
  expect(await materialCount(page, 1)).toBe(0)
  await expect(page.getByText('Click to play')).toBeVisible()

  await page.getByRole('slider', { name: 'Field zoom' }).fill('100')
  await expect(hint).toBeHidden()
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

test('Mix stirs movable pixels without creating or deleting material', async ({ page }) => {
  await page.keyboard.press('Space')
  await page.keyboard.press('Space')
  const canvas = page.locator('canvas')
  const box = await canvas.boundingBox()
  if (!box) throw new Error('Canvas did not render')

  await page.getByLabel('Brush radius').fill('6')
  await page.mouse.move(box.x + 35, box.y + 35)
  await page.mouse.down()
  await page.mouse.move(box.x + 105, box.y + 35)
  await page.mouse.up()
  await page.getByRole('button', { name: 'Gunpowder' }).click()
  await page.mouse.move(box.x + 115, box.y + 35)
  await page.mouse.down()
  await page.mouse.move(box.x + 185, box.y + 35)
  await page.mouse.up()

  const before = await page.evaluate(async () => Array.from((await window.__KINETIC_PIXELS__!.snapshot()).material))
  await page.getByRole('button', { name: 'Mix' }).click()
  await expect(page.getByRole('button', { name: 'Mix' })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('.tool-readout strong')).toHaveText('Mix')
  await page.getByLabel('Brush radius').fill('12')
  await page.mouse.move(box.x + 75, box.y + 35)
  await page.mouse.down()
  await page.mouse.move(box.x + 145, box.y + 35, { steps: 4 })
  await page.mouse.up()
  const after = await page.evaluate(async () => Array.from((await window.__KINETIC_PIXELS__!.snapshot()).material))

  expect(after).not.toEqual(before)
  expect(after.filter((material) => material === 1)).toHaveLength(before.filter((material) => material === 1).length)
  expect(after.filter((material) => material === 14)).toHaveLength(before.filter((material) => material === 14).length)
  await page.keyboard.press('m')
  await expect(page.getByRole('button', { name: 'Mix' })).toHaveAttribute('aria-pressed', 'false')
  await expect(page.locator('.tool-readout strong')).toHaveText('Gunpowder')
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

test('room temperature control sets the environmental baseline', async ({ page }) => {
  const slider = page.getByLabel('Room temperature')
  await expect(slider).toHaveValue('20')
  await expect(slider).toHaveAttribute('min', '-100')
  await expect(slider).toHaveAttribute('max', '500')
  await slider.fill('-100')
  await expect(page.locator('.temperature-label output')).toHaveText('-100 °C')
  await slider.fill('500')
  await expect(slider).toHaveValue('500')
  await expect(page.locator('.temperature-label output')).toHaveText('500 °C')

  await page.getByRole('button', { name: /Clear/ }).click()
  await page.getByRole('button', { name: /See stats/ }).click()
  await page.locator('canvas').hover({ position: { x: 20, y: 20 } })
  const temperature = page.getByLabel('Pixel inspection').locator('dt', { hasText: 'Temperature' }).locator('xpath=following-sibling::dd[1]')
  await expect(temperature).toHaveText('500 °C')
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
