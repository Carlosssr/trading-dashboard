/**
 * Screenshot helper for reviewing pages during development.
 *
 *   node scripts/shot.mjs <path> <output.png> [--dark] [--height=N]
 */

import { chromium } from 'playwright'

const [path = '/', output = 'shot.png', ...flags] = process.argv.slice(2)
const dark = flags.includes('--dark')
const heightFlag = flags.find((flag) => flag.startsWith('--height='))
const height = heightFlag ? Number(heightFlag.split('=')[1]) : 1400

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
const context = await browser.newContext({
  viewport: { width: 1440, height },
  colorScheme: dark ? 'dark' : 'light',
  deviceScaleFactor: 2,
})

// Authenticate through the API so the run does not depend on the login form
// having hydrated yet; the session cookie lands in this browser context.
const login = await context.request.post('http://localhost:3000/api/auth/login', {
  data: { email: 'demo@example.com', password: 'DemoPassword123!' },
})
if (!login.ok()) throw new Error(`login failed: ${login.status()} ${await login.text()}`)

const page = await context.newPage()
await page.goto(`http://localhost:3000${path}`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(2500)

const errors = []
page.on('pageerror', (error) => errors.push(error.message))

await page.screenshot({ path: output, fullPage: true })
if (errors.length > 0) console.log('page errors:', errors)

await browser.close()
console.log(`saved ${output}`)
