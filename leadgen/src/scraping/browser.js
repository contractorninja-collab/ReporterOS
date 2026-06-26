// Shared Playwright instance with stealth applied.

import { chromium as chromiumBase } from 'playwright'

let stealthApplied = false
let chromium = chromiumBase

async function applyStealth() {
  if (stealthApplied) return
  try {
    const { chromium: chromiumExtra } = await import('playwright-extra')
    const { default: stealth } = await import('puppeteer-extra-plugin-stealth')
    chromiumExtra.use(stealth())
    chromium = chromiumExtra
    stealthApplied = true
  } catch (err) {
    console.warn('[browser] stealth plugin unavailable, falling back to vanilla Playwright:', err.message)
    stealthApplied = true
  }
}

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0',
]

function randomUA() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)]
}

let browserPromise = null

export async function getBrowser() {
  await applyStealth()
  if (!browserPromise) {
    browserPromise = chromium.launch({
      headless: true,
      args: [
        '--disable-blink-features=AutomationControlled',
        '--no-sandbox',
        '--disable-dev-shm-usage',
      ],
    })
  }
  return browserPromise
}

export async function newContext() {
  const browser = await getBrowser()
  return browser.newContext({
    userAgent: randomUA(),
    viewport: { width: 1366, height: 820 },
    locale: 'en-US',
    timezoneId: 'Europe/London',
    extraHTTPHeaders: {
      'accept-language': 'en-US,en;q=0.9',
    },
  })
}

export async function closeBrowser() {
  if (browserPromise) {
    const b = await browserPromise
    await b.close().catch(() => {})
    browserPromise = null
  }
}

export function sleep(min, max) {
  const ms = max ? min + Math.random() * (max - min) : min
  return new Promise((r) => setTimeout(r, ms))
}
