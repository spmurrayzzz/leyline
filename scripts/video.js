import fs from 'node:fs/promises'
import path from 'node:path'
import { chromium } from 'playwright'

const url = process.env.VIDEO_URL || 'http://localhost:5173/'
const outputPath = process.env.VIDEO_PATH || 'screenshots/walkthrough.webm'
const videoDir = process.env.VIDEO_DIR || 'screenshots/videos'
const width = Number(process.env.VIDEO_WIDTH || 1503)
const height = Number(process.env.VIDEO_HEIGHT || 818)

await fs.mkdir(path.dirname(outputPath), { recursive: true })
await fs.mkdir(videoDir, { recursive: true })

const browser = await chromium.launch()
const context = await browser.newContext({
  viewport: { width, height },
  deviceScaleFactor: 1,
  recordVideo: {
    dir: videoDir,
    size: { width, height },
  },
})
const page = await context.newPage()

async function pause(ms = 800) {
  await page.waitForTimeout(ms)
}

async function clickIfVisible(selector, options = {}) {
  const locator = page.locator(selector).first()
  if (await locator.isVisible().catch(() => false)) {
    await locator.click(options)
    await pause()
    return true
  }
  return false
}

async function openFirstSession() {
  if (await page.locator('.composer').isVisible().catch(() => false)) return

  const firstProject = page.locator('.project-title > button').first()
  if (!(await firstProject.isVisible().catch(() => false))) return

  await firstProject.click()
  await pause()

  const firstSession = page.locator('.session').first()
  if (await firstSession.isVisible().catch(() => false)) {
    await firstSession.click()
    await page
      .waitForSelector(
        '.composer, .empty-workbench, .session-loading-panel',
        { timeout: 10000 },
      )
      .catch(() => {})
    await pause(1200)
  }
}

async function showTranscriptDetails() {
  await clickIfVisible('.transcript-tool')

  const workbench = page.locator('.workbench').first()
  if (await workbench.isVisible().catch(() => false)) {
    await workbench.evaluate((el) => {
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
    })
    await pause(1000)
  }
}

async function showPanels() {
  await clickIfVisible('button:has-text("Events")')
  await pause(600)
  await clickIfVisible('.event-log-header button')
  await clickIfVisible('button:has-text("Terminal")')
  await pause(1000)
  await clickIfVisible('.terminal-header button')
  await clickIfVisible('.settings-button')
  await pause(1000)
  await clickIfVisible('.settings-drawer-header button')
}

async function showStartState() {
  if (!(await page.locator('.start-panel').isVisible().catch(() => false))) {
    await clickIfVisible('.brand-home')
  }

  await clickIfVisible('.start-project-button')
  await pause(1000)
}

await page.goto(url, { waitUntil: 'domcontentloaded' })
await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {})
await pause(2500)

await showStartState()
await openFirstSession()
await showTranscriptDetails()
await showPanels()
await pause(1200)

const video = page.video()
await context.close()
await browser.close()

if (video) {
  await fs.copyFile(await video.path(), outputPath)
  console.log(`Saved ${outputPath}`)
} else {
  throw new Error('Playwright did not create a video')
}
