const assert = require('node:assert/strict');
const { mkdtempSync, readFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const { spawn } = require('node:child_process');

let chromium;
try { ({ chromium } = require(process.env.TYREKICK_PLAYWRIGHT_MODULE || 'playwright-core')); }
catch { throw new Error('Install playwright-core separately or set TYREKICK_PLAYWRIGHT_MODULE to its module path.'); }
const root = resolve(__dirname, '..');
const extension = resolve(process.env.TYREKICK_EXTENSION_DIR || join(root, '.output/chrome-mv3'));
const api = new URL(process.env.WXT_API_BASE || 'http://127.0.0.1:8787');
assert.equal(api.hostname, '127.0.0.1', 'Fixture verification uses IPv4 loopback.');
assert.equal(api.protocol, 'http:');
assert.ok(readFileSync(join(extension, 'background.js'), 'utf8').includes(api.origin), `Build first with WXT_API_BASE=${api.origin}`);
const manifest = JSON.parse(readFileSync(join(extension, 'manifest.json'), 'utf8'));
assert.deepEqual(manifest.permissions, ['storage']);
assert.deepEqual(manifest.host_permissions, ['https://www.donedeal.ie/*', 'http://127.0.0.1/*']);
const profile = mkdtempSync(join(tmpdir(), 'tyrekick-browser-'));
const prices = [10000, 14000, 14500, 15000, 15500, 16000, 16500];
const searchUrl = 'https://www.donedeal.ie/cars/Volkswagen/Golf?transmission=Manual';
const detailUrl = 'https://www.donedeal.ie/cars-for-sale/fixture-golf/55000001';
const ad = (index) => ({ id: 55000001 + index, mileageInKm: 90000 + index * 500, dealer: {}, priceInfo: { priceInEuro: prices[index] || 15500 } });
const nextData = () => ({ query: { section: ['cars', 'Volkswagen', 'Golf'], transmission: 'Manual' }, props: { pageProps: { ads: prices.map((_, i) => ad(i)), initialMakeModels: [{ make: 'Volkswagen', model: ['Golf'] }] } } });
const card = (index) => `<article class="Card-styled__Container-fixture"><h3><a href="/cars-for-sale/fixture-golf/${55000001 + index}">Volkswagen Golf ${index + 1}</a></h3><ul><li class="SearchCard-styled__MetaInfoItem-fixture">2018</li><li class="SearchCard-styled__MetaInfoItem-fixture">1.6 Diesel</li><li class="SearchCard-styled__MetaInfoItem-fixture">${90000 + index * 500} km</li></ul><div class="Price-styled__Wrapper-fixture"><div class="Price-styled__Price-fixture">€${prices[index] || 15500}</div><span>From €200/mo</span></div></article>`;
const script = (data) => `<script type="application/json" id="__NEXT_DATA__">${JSON.stringify(data)}</script>`;
const shell = (body) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>DoneDeal fixture</title><style>body{font:16px system-ui;background:#f4f6f3;padding:25px}main{max-width:850px}.Card-styled__Container-fixture{border:1px solid #ddd;position:relative;background:white;padding:16px;margin:12px 0;min-height:155px}h3 a::after{content:'';position:absolute;inset:0}ul{display:flex;gap:30px;list-style:none;padding:0}.Price-styled__Price-fixture{font-size:22px;font-weight:bold}</style></head><body><main>${body}</main></body></html>`;
const searchHtml = () => shell(`<h1>Volkswagen Golf</h1>${prices.map((_, i) => card(i)).join('')}${script(nextData())}`);
const detailHtml = () => shell(`<h1>Volkswagen Golf</h1><div class="AdTitleBox-styled__PriceRow-fixture"><div class="AdTitleBox-styled__Price-fixture">€10,000</div></div>${script({ props: { pageProps: { id: 55000001, header: 'Volkswagen Golf', description: 'Pay a €500 deposit before viewing. Call 087 123 4567 or email seller@example.com.', priceEuro: 10000, sellerType: 'dealer', displayAttributes: [{ name: 'year', value: '2018' }, { name: 'mileage', value: '90000 km' }, { name: 'make', value: 'Volkswagen' }, { name: 'model', value: 'Golf' }, { name: 'fuelType', value: 'Diesel' }, { name: 'transmission', value: 'Manual' }, { name: 'engine', value: '1.6' }] } } })}`);
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let fixture;
let context;
const errors = [];
const checks = [];
const navigations = [];
const check = (label) => { checks.push(label); console.log(`PASS ${label}`); };
async function stats() { return (await fetch(`${api.origin}/stats`)).json(); }
async function control(value) { assert.ok((await fetch(`${api.origin}/control`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(value) })).ok); }
async function settled(page) { await page.waitForFunction(() => [...document.querySelectorAll('tyrekick-badges')].every((host) => !host.shadowRoot?.querySelector('.badge-row')?.textContent.includes('Checking'))); }
async function main() {
  context = await chromium.launchPersistentContext(profile, {
    executablePath: process.env.TYREKICK_CHROMIUM_PATH || undefined,
    headless: process.env.TYREKICK_BROWSER_HEADLESS === '1',
    ignoreDefaultArgs: ['--disable-extensions'],
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
    viewport: { width: 1100, height: 900 },
  });
  context.on('page', (page) => page.on('pageerror', (error) => errors.push(error.message)));
  await context.route('https://www.donedeal.ie/**', async (route) => {
    const url = new URL(route.request().url());
    if (route.request().isNavigationRequest()) {
      navigations.push({ url: url.href, fixture: true });
      await route.fulfill({ contentType: 'text/html', body: url.pathname.startsWith('/cars-for-sale/') ? detailHtml() : searchHtml() });
    }
    else await route.abort();
  });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const extensionId = new URL(worker.url()).host;
  fixture = spawn(process.env.BUN_BINARY || 'bun', [join(root, 'scripts/browser-fixture-worker.ts')], { cwd: root, env: { ...process.env, TYREKICK_VERIFY_PORT: api.port || '80', TYREKICK_VERIFY_ORIGIN: `chrome-extension://${extensionId}` }, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  fixture.stdout.on('data', (data) => { output += data; });
  fixture.stderr.on('data', (data) => { output += data; });
  for (let i = 0; i < 100 && !output.includes('Fixture Worker ready'); i++) {
    if (fixture.exitCode !== null) throw new Error(`Fixture Worker failed. ${output}`);
    await pause(50);
  }
  assert.ok(output.includes('Fixture Worker ready'), 'Fixture Worker started without touching an existing process.');
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  await popup.getByRole('button', { name: 'Agree and enable' }).waitFor();
  const page = await context.newPage();
  await page.goto(searchUrl);
  await pause(400);
  assert.equal(await page.locator('tyrekick-badges').count(), 0);
  assert.equal((await stats()).requests, 0);
  check('no badges or transmission before consent');
  await popup.getByRole('button', { name: 'Agree and enable' }).click();
  await page.locator('tyrekick-badges').first().getByRole('button', { name: /Price: Great price/ }).waitFor();
  assert.equal(await page.locator('tyrekick-badges').count(), 7);
  await settled(page);
  const trigger = page.locator('tyrekick-badges').first().getByRole('button', { name: /Show details/ });
  await trigger.focus();
  await page.keyboard.press('Space');
  const dialog = page.locator('tyrekick-badges').first().getByRole('dialog');
  await dialog.waitFor();
  assert.match(await dialog.textContent(), /Compared with this search.*6 close matches/s);
  assert.match(await dialog.textContent(), /Card info only/);
  assert.equal(await dialog.getByRole('link').count(), 5);
  assert.equal(page.url(), searchUrl);
  await page.setViewportSize({ width: 1100, height: 800 });
  await trigger.evaluate((button) => {
    const anchor = button.getRootNode().host.parentElement;
    anchor.style.marginTop = `${Math.max(0, 356 - button.getBoundingClientRect().top)}px`;
    window.dispatchEvent(new Event('resize'));
  });
  const panelBounds = await dialog.boundingBox();
  assert.ok(panelBounds.y >= 12 && panelBounds.y + panelBounds.height <= 788, 'Long explanations fit the space beside the trigger.');
  await dialog.evaluate((panel) => { panel.scrollTop = panel.scrollHeight; });
  assert.ok(await dialog.getByText(/Card info only/).isVisible());
  await trigger.evaluate((button) => { button.getRootNode().host.parentElement.style.marginTop = ''; });
  await page.setViewportSize({ width: 1100, height: 900 });
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'hidden' });
  await page.waitForFunction((element) => element.getRootNode().activeElement === element, await trigger.elementHandle());
  check('cash beside finance, attributed independent badges, keyboard explanation and focus return');
  await page.evaluate(({ markup, extra }) => {
    const data = JSON.parse(document.querySelector('#__NEXT_DATA__').textContent);
    data.props.pageProps.ads.push(extra);
    document.querySelector('#__NEXT_DATA__').textContent = JSON.stringify(data);
    document.querySelector('main').insertAdjacentHTML('beforeend', markup);
  }, { markup: card(7), extra: ad(7) });
  await page.waitForFunction(() => document.querySelectorAll('tyrekick-badges').length === 8);
  await settled(page);
  await trigger.click();
  assert.match(await dialog.textContent(), /7 close matches/);
  await page.keyboard.press('Escape');
  check('infinite-scroll cohort growth reprices loaded cards');
  await page.locator('h3 a').first().click();
  await page.locator('tyrekick-badges').getByRole('button', { name: /Price: Great price.*Warnings: Suspicious/ }).waitFor();
  await page.locator('tyrekick-badges').getByRole('button', { name: /Show details/ }).click();
  const detailDialog = page.getByRole('dialog');
  assert.match(await detailDialog.textContent(), /from the results you opened this ad from/);
  assert.match(await detailDialog.textContent(), /Pay a €500 deposit before viewing/);
  assert.match(await detailDialog.textContent(), /Full listing checked/);
  assert.doesNotMatch(await detailDialog.textContent(), /087 123 4567|seller@example.com/);
  if (process.env.TYREKICK_SCREENSHOT) await page.screenshot({ path: process.env.TYREKICK_SCREENSHOT });
  check('same-tab navigation retains search price and displays validated detail evidence');
  await page.goBack();
  await page.locator('tyrekick-badges').first().getByRole('button', { name: /Warnings: Suspicious/ }).waitFor();
  await page.locator('tyrekick-badges').first().getByRole('button', { name: /Show details/ }).click();
  assert.match(await page.getByRole('dialog').textContent(), /Later edits to the ad won't show here/);
  await page.keyboard.press('Escape');
  check('returning cards reuse agreeing detail facts with evidence-time disclosure');
  const newTabPromise = context.waitForEvent('page');
  await page.locator('h3 a').first().evaluate((link) => { link.target = '_blank'; });
  await page.locator('h3 a').first().click();
  const newTab = await newTabPromise;
  await newTab.waitForURL(detailUrl);
  await newTab.waitForLoadState('domcontentloaded');
  await newTab.bringToFront();
  assert.equal(await newTab.title(), 'DoneDeal fixture', 'New-tab navigation must stay inside the synthetic replay.');
  await newTab.locator('tyrekick-badges').getByRole('button', { name: /Price: Great price/ }).waitFor();
  await newTab.close();
  const direct = await context.newPage();
  await direct.goto(detailUrl);
  await direct.locator('tyrekick-badges').getByRole('button', { name: /Price: Not enough data.*Warnings: Suspicious/ }).waitFor();
  await direct.close();
  check('new-tab originating price and direct-detail abstention');
  await page.evaluate(() => {
    history.pushState({}, '', '/cars/Volkswagen/Golf?sort=price');
    const data = JSON.parse(document.querySelector('#__NEXT_DATA__').textContent);
    delete data.query.transmission;
    data.query.sort = 'price';
    document.querySelector('#__NEXT_DATA__').textContent = JSON.stringify(data);
  });
  await page.locator('tyrekick-badges').first().getByRole('button', { name: /Price: Not enough data/ }).waitFor();
  check('SPA search changes remove old price labels and keep unknown facts unknown');
  await control({ delayMs: 0, fail: true });
  await page.evaluate(() => {
    document.querySelector('h3 a').textContent = 'Golf payment question';
    document.querySelector('.Price-styled__Price-fixture').textContent = '€12000';
  });
  await page.locator('tyrekick-badges').first().getByRole('button', { name: /Price: Temporarily unavailable.*Warnings: Temporarily unavailable/ }).waitFor();
  check('service failure remains unavailable in both independent branches');
  const beforeDelayed = (await stats()).requests;
  await control({ delayMs: 1000, fail: false });
  await page.evaluate(() => { document.querySelector('h3 a').textContent = 'New payment question before clear'; });
  for (let i = 0; i < 100 && (await stats()).requests === beforeDelayed; i++) await pause(20);
  assert.ok((await stats()).requests > beforeDelayed, 'A delayed assessment is in flight before pause and clear.');
  await popup.bringToFront();
  await popup.getByRole('button', { name: 'Pause analysis' }).click();
  await page.waitForFunction(() => document.querySelectorAll('tyrekick-badges').length === 0);
  await popup.getByRole('button', { name: 'Clear local data' }).click();
  await pause(1100);
  const stored = await popup.evaluate(async () => ({ local: await chrome.storage.local.get(null), session: await chrome.storage.session.get(null) }));
  assert.deepEqual(stored.local['tyrekick.assessments'].entries, []);
  assert.equal(stored.session['tyrekick.openings'], undefined);
  const pausedCount = (await stats()).requests;
  await page.evaluate(() => { document.querySelector('h3 a').textContent = 'Changed while paused'; });
  await pause(500);
  assert.equal((await stats()).requests, pausedCount);
  await control({ delayMs: 0, fail: false });
  await popup.getByRole('button', { name: 'Resume analysis' }).click();
  await page.locator('tyrekick-badges').first().getByRole('button', { name: /Price: Not enough data/ }).waitFor();
  check('pause hides signals, clear rejects late results and removes stored data, resume restarts analysis');
  assert.deepEqual(errors, [], 'No page or React runtime errors.');
  console.log(JSON.stringify({ extensionId, checks: checks.length, fixtureRequests: (await stats()).requests, model: 'deterministic fixture, no live inference' }));
}
main().catch(async (error) => {
  const page = context?.pages().findLast((candidate) => candidate.url().startsWith('https://www.donedeal.ie/'));
  if (page) {
    console.error(JSON.stringify(await page.evaluate(() => ({
      url: location.href,
      state: document.readyState,
      title: document.title,
      nextData: !!document.querySelector('#__NEXT_DATA__'),
      headings: [...document.querySelectorAll('h1')].map((node) => node.textContent),
      badges: [...document.querySelectorAll('tyrekick-badges')].map((host) => host.shadowRoot?.querySelector('.badge-row')?.getAttribute('aria-label')),
    }))));
    console.error(JSON.stringify({ navigations }));
    if (process.env.TYREKICK_SCREENSHOT) await page.screenshot({ path: process.env.TYREKICK_SCREENSHOT });
  }
  if (fixture?.exitCode === null) console.error(JSON.stringify({ fixture: await stats(), errors }));
  console.error(error);
  process.exitCode = 1;
}).finally(async () => {
  await context?.close();
  fixture?.kill('SIGTERM');
  rmSync(profile, { recursive: true, force: true });
});
