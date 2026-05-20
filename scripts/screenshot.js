import { chromium } from 'playwright'

const url = process.env.SCREENSHOT_URL || 'http://localhost:5173/'
const path = process.env.SCREENSHOT_PATH || 'screenshots/current.png'

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1503, height: 818 } })
await page.goto(url, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(2500)
await page.screenshot({ path, fullPage: true })
await browser.close()

console.log(`Saved ${path}`)
