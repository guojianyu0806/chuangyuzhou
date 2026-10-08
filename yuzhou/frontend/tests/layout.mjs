import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('C:/Users/g2806/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
const baseURL = process.env.TEST_BASE_URL || 'http://127.0.0.1:4397';
const errors = [];
const networkFailures = [];
const layoutFailures = [];
let current = '';
page.on('pageerror', error => errors.push({ at: current, message: error.message }));
page.on('requestfailed', request => networkFailures.push({ at: current, url: request.url(), message: request.failure()?.errorText }));
page.on('response', response => { if (response.status() >= 400) networkFailures.push({ at: current, url: response.url(), status: response.status() }); });

try {
  for (const width of [320, 375, 414, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const route of ['home', 'ai', 'space/student-union', 'courses', 'courses/course-data-structures', 'english', 'inbox', 'tasks', 'ledger', 'review', 'settings']) {
      current = `${width}px / ${route}`;
      await page.goto(`${baseURL}/#/${route}`, { waitUntil: 'networkidle' });
      await page.waitForFunction(width => window.innerWidth === width && document.querySelector('#main')?.children.length > 0, width);
      const result = await page.evaluate(() => {
        const viewport = window.innerWidth;
        const clipped = [];
        const inScrollableStrip = element => {
          for (let ancestor = element.parentElement; ancestor && ancestor !== document.body; ancestor = ancestor.parentElement) {
            const style = getComputedStyle(ancestor);
            if (['auto', 'scroll'].includes(style.overflowX) && ancestor.scrollWidth > ancestor.clientWidth + 1) return true;
          }
          return false;
        };
        for (const element of document.querySelectorAll('button,input,select,textarea,h1,h2,p,.panel')) {
          if (element.closest('[aria-hidden="true"], [hidden], .sidebar, .cv-viewport:not(.is-list) .cv-world')) continue;
          const style = getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0 || rect.width === 0 || rect.height === 0 || !element.getClientRects().length) continue;
          if (inScrollableStrip(element)) continue;
          if (rect.left < -1 || rect.right > viewport + 1) {
            clipped.push({ tag: element.tagName.toLowerCase(), class: element.className, text: (element.innerText || element.getAttribute('aria-label') || element.getAttribute('placeholder') || '').slice(0, 90), left: Number(rect.left.toFixed(2)), right: Number(rect.right.toFixed(2)), width: Number(rect.width.toFixed(2)) });
          }
        }
        return { viewport, scrollWidth: document.documentElement.scrollWidth, clipped };
      });
      const passed = result.scrollWidth <= result.viewport + 1 && result.clipped.length === 0;
      if (!passed) layoutFailures.push({ at: current, ...result });
      console.log(`${passed ? 'PASS' : 'FAIL'} ${current} ${JSON.stringify(result)}`);
    }
  }
  console.log('BROWSER_ERRORS', JSON.stringify(errors));
  console.log('NETWORK_FAILURES', JSON.stringify(networkFailures));
  console.log('LAYOUT_FAILURES', JSON.stringify(layoutFailures));
  assert.deepEqual(errors, [], 'No uncaught browser errors');
  assert.deepEqual(networkFailures, [], 'No failed network requests or HTTP errors');
  assert.deepEqual(layoutFailures, [], 'All pages fit viewport without actual horizontal clipping');
} finally {
  await context.close();
  await browser.close();
}
