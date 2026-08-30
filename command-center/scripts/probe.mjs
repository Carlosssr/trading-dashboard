import { chromium } from 'playwright'
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
await context.request.post('http://localhost:3000/api/auth/login', { data: { email: 'demo@example.com', password: 'DemoPassword123!' } })
const page = await context.newPage()
const errs = []
page.on('pageerror', e => errs.push(e.message))
page.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()) })
await page.goto('http://localhost:3000/', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(3000)
const info = await page.evaluate(() => {
  const nav = document.querySelector('nav[aria-label="Primary"]')
  const links = nav ? nav.querySelectorAll('a').length : -1
  const r = nav ? nav.getBoundingClientRect() : null
  const chart = document.querySelector('.recharts-wrapper')
  const cr = chart ? chart.getBoundingClientRect() : null
  return { hasNav: !!nav, links, navRect: r && { w: r.width, h: r.height, x: r.x, y: r.y },
           navText: nav ? nav.innerText.slice(0,80) : null,
           chartRect: cr && { w: cr.width, h: cr.height },
           surfaces: getComputedStyle(document.body).backgroundColor }
})
console.log(JSON.stringify(info, null, 2))
console.log('errors:', errs.slice(0,8))
await browser.close()
