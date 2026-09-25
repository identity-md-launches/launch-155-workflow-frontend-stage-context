import { chromium } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
const server = spawn(process.execPath, ['tests/serve.mjs'], { stdio: 'ignore' });
const evidence = { checkedAt: new Date().toISOString(), url: 'http://127.0.0.1:4173/ipfs/noop/', walletConnected: false, errors: [], failedResources: [], result: '' };
let browser;
try {
  for (let count = 0; count < 30; count++) {
    try { if ((await fetch(evidence.url)).ok) break; } catch { /* server starting */ }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on('pageerror', error => evidence.errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') evidence.errors.push(message.text()); });
  page.on('response', response => { if (response.status() >= 400) evidence.failedResources.push({ url: response.url(), status: response.status() }); });
  await page.goto(evidence.url);
  await page.getByText(/Deployment verified|Verification unavailable/).waitFor({ timeout: 60000 });
  evidence.result = await page.locator('.verification').innerText();
  evidence.liveState = await page.locator('.live-panel').innerText();
  evidence.swapDisabled = await page.getByRole('button', { name: 'Get Quote' }).isDisabled();
  evidence.overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  await page.screenshot({ path: '../docs/frontend/live-desktop.png', fullPage: true });
} catch (error) { evidence.result = `Unable to complete live browser read: ${error.message}`; }
finally {
  await browser?.close(); server.kill();
  await writeFile('../docs/frontend/live-browser.json', JSON.stringify(evidence, null, 2) + '\n');
  console.log(JSON.stringify(evidence, null, 2));
}
