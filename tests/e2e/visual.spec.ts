import { expect, test } from '@playwright/test'

for (const viewport of [
  { width: 1024, height: 576 },
  { width: 1366, height: 768 },
  { width: 1920, height: 1080 },
]) {
  test(`console layout ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport)
    await page.goto('./')
    await expect(page.locator('canvas')).toHaveAttribute('data-ready', 'true')
    const device = page.locator('.device')
    const box = await device.boundingBox()
    if (!box) throw new Error('Device did not render')
    expect(Math.abs(box.width / box.height - 16 / 9)).toBeLessThan(0.01)
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.y).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width)
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height)
    await expect(page).toHaveScreenshot(`console-${viewport.width}x${viewport.height}.png`, { animations: 'disabled', maxDiffPixelRatio: 0.01 })
  })
}

test('memory dialog fits the smallest desktop viewport', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 576 })
  await page.goto('./')
  await expect(page.locator('canvas')).toHaveAttribute('data-ready', 'true')
  await page.getByRole('button', { name: /Memory Card/ }).click()
  const box = await page.getByRole('dialog').boundingBox()
  if (!box) throw new Error('Dialog did not render')
  expect(box.y).toBeGreaterThanOrEqual(0)
  expect(box.y + box.height).toBeLessThanOrEqual(576)
  await expect(page).toHaveScreenshot('memory-dialog-1024x576.png', { animations: 'disabled', maxDiffPixelRatio: 0.01 })
})

test('zoom cube stays centered over its vertical track', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 })
  await page.goto('./')
  await expect(page.locator('canvas')).toHaveAttribute('data-ready', 'true')
  await expect(page.locator('.zoom-gauge')).toHaveScreenshot('zoom-gauge-centered-1920x1080.png', {
    animations: 'disabled',
    maxDiffPixelRatio: 0.001,
  })
})

for (const viewport of [
  { width: 390, height: 844 },
  { width: 360, height: 640 },
]) {
  test(`mobile sandbox and tools fit ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport)
    await page.goto('./')
    await expect(page.locator('canvas')).toHaveAttribute('data-ready', 'true')
    const deviceBox = await page.locator('.device').boundingBox()
    if (!deviceBox) throw new Error('Mobile device did not render')
    expect(deviceBox.x).toBe(0)
    expect(deviceBox.y).toBe(0)
    expect(deviceBox.width).toBe(viewport.width)
    expect(deviceBox.height).toBe(viewport.height)
    await expect(page.locator('.mobile-topbar')).toBeVisible()
    await expect(page.locator('.right-rail')).toBeHidden()
    await expect(page).toHaveScreenshot(`mobile-sandbox-${viewport.width}x${viewport.height}.png`, { animations: 'disabled', maxDiffPixelRatio: 0.01 })

    await page.locator('.mobile-dock').getByRole('button', { name: 'Tools' }).click()
    await expect(page.locator('.mobile-tools-panel')).toBeVisible()
    await expect(page.locator('.viewport-panel')).toBeHidden()
    const dockBox = await page.locator('.mobile-dock').boundingBox()
    if (!dockBox) throw new Error('Mobile action dock did not render')
    expect(dockBox.y + dockBox.height).toBeLessThanOrEqual(viewport.height)
    await expect(page).toHaveScreenshot(`mobile-tools-${viewport.width}x${viewport.height}.png`, { animations: 'disabled', maxDiffPixelRatio: 0.01 })
  })
}
