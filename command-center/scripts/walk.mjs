/**
 * Visits every page as a signed-in user and reports HTTP status, page errors,
 * console errors, and whether the page produced a horizontal overflow.
 *
 *   node scripts/walk.mjs [--dark]
 */

import { chromium } from 'playwright'

const PATHS = [
  '/',
  '/accounts',
  '/transactions',
  '/credit-cards',
  '/debt',
  '/bills',
  '/bills/recurring',
  '/real-estate',
  '/business',
  '/investments',
  '/reports',
  '/settings',
  '/settings/connections',
]

const dark = process.argv.includes('--dark')

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  colorScheme: dark ? 'dark' : 'light',
})

const login = await context.request.post('http://localhost:3000/api/auth/login', {
  data: { email: 'demo@example.com', password: 'DemoPassword123!' },
})
if (!login.ok()) throw new Error(`login failed: ${login.status()}`)

let failures = 0

for (const path of PATHS) {
  const page = await context.newPage()
  const problems = []

  page.on('pageerror', (error) => problems.push(`js: ${error.message}`))
  page.on('console', (message) => {
    if (message.type() === 'error' && !message.text().includes('favicon')) {
      problems.push(`console: ${message.text().slice(0, 160)}`)
    }
  })

  const response = await page.goto(`http://localhost:3000${path}`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(1800)

  const status = response?.status() ?? 0
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  )
  const emptyBody = await page.evaluate(() => (document.body.innerText ?? '').trim().length < 60)

  const bad = status !== 200 || problems.length > 0 || overflow || emptyBody
  if (bad) failures += 1

  console.log(
    `${bad ? 'FAIL' : 'ok  '} ${status} ${path.padEnd(24)}` +
      `${overflow ? ' [horizontal overflow]' : ''}${emptyBody ? ' [empty]' : ''}`,
  )
  for (const problem of [...new Set(problems)].slice(0, 4)) console.log(`       ${problem}`)

  await page.close()
}

await browser.close()
console.log(failures === 0 ? '\nAll pages clean.' : `\n${failures} page(s) with problems.`)
process.exitCode = failures === 0 ? 0 : 1
