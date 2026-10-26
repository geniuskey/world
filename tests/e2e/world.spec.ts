import { test, expect, type Page } from '@playwright/test';
import { plotAt, plotRegion, plotTerritoryId } from '../../shared/plots';
import { coordinates, gridPoint } from '../../shared/geography';

// Plot regions used by browser fixtures: Seoul (127, 37.5) and Lisbon.
const seoul = plotAt(127, 37.5);
const REGION = seoul.region;
const SEOUL_PLOT = `/territory/${plotTerritoryId('s1', seoul)}`;
const LISBON = plotAt(-9.14, 38.72).region;
// Land trading signs up four accounts per run; a separate region keeps Seoul's starters free.
const BUSAN = plotAt(129.07, 35.18).region;
const PLOT_REGION_URL = /\/region\/z14:\d+:\d+$/;

const mapFixture = async (route: import('@playwright/test').Route) => {
  if (new URL(route.request().url()).pathname === '/planet')
    await route.fulfill({
      json: {
        tilejson: '3.0.0',
        tiles: ['https://tiles.openfreemap.org/test/{z}/{x}/{y}.pbf'],
        minzoom: 0,
        maxzoom: 14,
      },
    });
  else await route.fulfill({ status: 204 });
};
test.beforeEach(async ({ page }) => {
  await page.route('https://tiles.openfreemap.org/**', mapFixture);
  await page.route('https://elevation-tiles-prod.s3.amazonaws.com/**', (route) => route.abort());
});

const unique = () => `Explorer ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
async function signup(page: Page, name = unique(), region = REGION) {
  await page.goto(`/region/${region}`);
  await page.getByRole('button', { name: 'Join the world', exact: true }).click();
  await page.getByLabel('Settler name').pressSequentially(name, { delay: 5 });
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Enter local playtest' }).click();
  await expect(page).toHaveURL(`/region/${region}`);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  return name;
}
test('public exploration, language, regional navigation and no overflow', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  if (page.viewportSize()!.width > 680)
    await expect(page.getByRole('heading', { name: 'A little piece of your own.' })).toBeVisible();
  const mapBounds = await page.locator('.atlas').boundingBox();
  expect(mapBounds!.width).toBe(page.viewportSize()!.width);
  expect(mapBounds!.height).toBeGreaterThan(page.viewportSize()!.height * 0.8);
  await expect(page.getByRole('img', { name: 'World map' })).toBeVisible();
  await page.getByRole('button', { name: 'Join the world', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('Click anywhere on the world map');
  await expect(page.getByLabel('Starting region')).toHaveCount(0);
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: '한국어로 변경' }).click();
  await expect(page.getByRole('img', { name: '세계 지도' })).toBeVisible();
  await page.getByRole('button', { name: 'Switch to English' }).click();
  await expect(page.locator('.earth-region-pin')).toHaveCount(0);
  await page.locator('.coordinate-search > summary').click();
  await page.getByLabel('Longitude', { exact: true }).fill('127');
  await page.getByLabel('Latitude', { exact: true }).fill('37.5');
  await page.getByRole('button', { name: 'Go to this location', exact: true }).click();
  await expect(page).toHaveURL(SEOUL_PLOT);
  await page.locator('.coordinate-search > summary').click();
  await expect(page.getByRole('img', { name: 'Regional territory map' })).toBeVisible();
  await expect(page.locator('[data-testid^="tile-"]').first()).toBeVisible();
  // The coordinates selected their plot; close its details to reach the map controls.
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await page.getByRole('button', { name: 'Zoom out', exact: true }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  expect(errors).toEqual([]);
});
test('free starter, adjacent claim, construction and reload persistence', async ({ page }) => {
  await signup(page);
  const initial = await (await page.request.get('/api/me/state')).json();
  const home = initial.territories[0];
  const targetX = home.x + 1,
    targetY = home.y;
  const tile = page.getByTestId(`tile-${targetX}-${targetY}`);
  await expect(tile).toBeVisible();
  await tile.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.cost-note')).toHaveText('1 energy · 10 Gold');
  await page.getByRole('button', { name: 'Claim territory', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Build facility', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Build facility', exact: true }).click();
  await expect(page.getByText('Facility established')).toBeVisible();
  await page.reload();
  const current = await (await page.request.get('/api/me/state')).json();
  expect(current.territory_count).toBe(2);
  expect(current.energy_value).toBe(3);
  // 100 starter Gold - 10 land price - 20 facility.
  expect(current.gold_balance).toBe(70);
  expect(current.territories.some((t: { structure_type: string | null }) => t.structure_type)).toBe(
    true,
  );
  await page.goto('/me');
  await expect(page.getByRole('heading', { name: 'Your places' })).toBeVisible();
  await expect(page.getByText('Facility built', { exact: true }).first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
test('two independent browser sessions can buy and cancel escrowed lots', async ({
  page,
  browser,
}) => {
  const seller = await signup(page);
  await page.goto('/market');
  await page.getByRole('button', { name: 'Create an offer', exact: true }).click();
  await page.getByLabel('Quantity', { exact: true }).fill('3');
  await page.getByLabel('Gold per unit').fill('4');
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Create an offer', exact: true })
    .click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const listedAt = Date.now();
  const context = await browser.newContext({ baseURL: 'http://localhost:5175' });
  await context.route('https://tiles.openfreemap.org/**', (route) => route.abort());
  const buyerPage = await context.newPage();
  try {
    await signup(buyerPage);
    await buyerPage.goto('/market');
    const order = buyerPage.locator('.order-card').filter({ hasText: seller });
    await expect(order).toBeVisible();
    await order.getByRole('button', { name: 'Buy lot' }).click();
    await buyerPage.getByRole('button', { name: 'Confirm purchase' }).click();
    await expect(buyerPage.getByRole('dialog')).toHaveCount(0);
    const buyerState = await (await buyerPage.request.get('/api/me/state')).json();
    expect(buyerState.gold_balance).toBe(88);
    expect(buyerState.resources.food).toBe(15);
    const sellerState = await (await page.request.get('/api/me/state')).json();
    expect(sellerState.gold_balance).toBe(111);
    expect(sellerState.resources.food).toBe(9);
    await expect.poll(() => Date.now()).toBeGreaterThan(listedAt + 2100);
    await page.reload();
    await page.getByRole('button', { name: 'Create an offer', exact: true }).click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Create an offer', exact: true })
      .click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    const own = page.locator('.order-card').filter({ hasText: seller });
    await own.getByRole('button', { name: 'Withdraw' }).click();
    await expect(own).toHaveCount(0);
    const after = await (await page.request.get('/api/me/state')).json();
    expect(after.resources.food).toBe(9);
  } finally {
    await context.close();
  }
});
test('an owner lists a plot and another session buys it at the asking price', async ({
  page,
  browser,
}) => {
  const sellerName = await signup(page, unique(), BUSAN);
  const home = (await (await page.request.get('/api/me/state')).json()).territories[0];
  await page.getByTestId(`tile-${home.x + 1}-${home.y}`).focus();
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Claim territory', exact: true }).click();
  const tile = (await (await page.request.get('/api/me/state')).json()).territories.find(
    (t: { x: number; y: number }) => t.x === home.x + 1 && t.y === home.y,
  );
  await page.goto(`/territory/${tile.id}`);
  await page.getByLabel('Asking price (Gold)').fill('11');
  await expect(
    page.getByText('You would receive 10 Gold after 1 Gold transfer tax.'),
  ).toBeVisible();
  await page.getByRole('button', { name: 'List for sale', exact: true }).click();
  await expect(page.getByText('Listed for 11 Gold')).toBeVisible();
  const context = await browser.newContext({ baseURL: 'http://localhost:5175' });
  await context.route('https://tiles.openfreemap.org/**', (route) => route.abort());
  const buyerPage = await context.newPage();
  try {
    await signup(buyerPage, unique(), BUSAN);
    await buyerPage.goto(`/territory/${tile.id}`);
    await buyerPage.getByRole('button', { name: 'Buy for 11 Gold', exact: true }).click();
    await expect(buyerPage.getByText('The land is yours.')).toBeVisible();
    const buyer = await (await buyerPage.request.get('/api/me/state')).json();
    expect(buyer.gold_balance).toBe(89);
    expect(buyer.territories.some((t: { id: string }) => t.id === tile.id)).toBe(true);
    const seller = await (await page.request.get('/api/me/state')).json();
    // 100 - 10 land price + 11 sale - 1 transfer tax.
    expect(seller.gold_balance).toBe(100);
    expect(seller.territory_count).toBe(1);
    // The buyer sees the plot's record; the seller is told once and has a public profile.
    await buyerPage.reload();
    await expect(buyerPage.getByText('First settled by')).toBeVisible();
    await expect(buyerPage.getByRole('link', { name: sellerName }).first()).toBeVisible();
    await page.reload();
    await expect(page.getByText('Your land changed hands')).toBeVisible();
    const seen = page.waitForResponse('**/api/me/notifications/seen');
    await page.getByRole('button', { name: 'Dismiss' }).click();
    expect((await seen).ok()).toBe(true);
    await expect(page.getByText('Your land changed hands')).toHaveCount(0);
    await page.reload();
    await expect(
      page.getByText('First settled by').or(page.locator('.welcome-panel')),
    ).toBeVisible();
    await expect(page.getByText('Your land changed hands')).toHaveCount(0);
    // Zoomed in, owned plots carry their owner's name on the map.
    await buyerPage.getByRole('button', { name: 'Close' }).first().click();
    for (let i = 0; i < 2; i++)
      await buyerPage.getByRole('button', { name: 'Zoom in', exact: true }).click();
    await expect(
      buyerPage
        .locator('.plot-owner')
        .filter({ hasText: sellerName.slice(0, 9) })
        .first(),
    ).toBeVisible();
    await page.goto(`/player/${seller.user.id}`);
    await expect(page.getByRole('heading', { name: sellerName })).toBeVisible();
    await expect(page.getByText(/^Sold to /)).toBeVisible();
  } finally {
    await context.close();
  }
});
test('studio remains a preview and operator page is private', async ({ page }) => {
  await page.goto('/store');
  await expect(page.getByText('Preview only · Purchases are unavailable')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Preview', exact: true })).toHaveCount(3);
  for (const button of await page.getByRole('button', { name: 'Preview', exact: true }).all())
    await expect(button).toBeDisabled();
  await page.getByRole('button', { name: 'Ocean', exact: true }).click();
  await expect(page.locator('.flag-preview')).toHaveClass(/ocean/);
  await page.goto('/admin');
  await expect(
    page.getByRole('heading', { name: 'This area is for world operators.' }),
  ).toBeVisible();
});
test('slow map loading, drag, and background polling stay bounded', async ({ page }) => {
  const chunks: string[] = [];
  await page.route('**/api/map/chunks?**', async (route) => {
    chunks.push(route.request().url());
    await new Promise((resolve) => setTimeout(resolve, 180));
    await route.continue();
  });
  await page.goto(`/region/${LISBON}`);
  await expect(page.locator('[data-testid^="tile-"]').first()).toBeVisible();
  const map = page.getByRole('img', { name: 'Regional territory map' });
  await map.scrollIntoViewIfNeeded();
  const box = (await map.boundingBox())!;
  const before = await map.getAttribute('data-camera');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 70, box.y + box.height / 2 + 40, { steps: 10 });
  await page.mouse.up();
  expect(await map.getAttribute('data-camera')).not.toBe(before);
  await expect(page.getByRole('button', { name: 'Claim territory', exact: true })).toHaveCount(0);
  const count = chunks.length;
  await page.clock.install();
  await page.evaluate(() =>
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' }),
  );
  await page.clock.fastForward(240_000);
  expect(chunks.length).toBe(count);
  expect(chunks.length).toBeLessThanOrEqual(12);
});
test('two-finger pinch zooms without selecting or claiming a tile', async ({ page, context }) => {
  await page.goto(`/region/${LISBON}`);
  await expect(page.locator('[data-testid^="tile-"]').first()).toBeVisible();
  const map = page.getByRole('img', { name: 'Regional territory map' });
  await map.scrollIntoViewIfNeeded();
  const box = (await map.boundingBox())!,
    x = box.x + box.width / 2,
    y = box.y + box.height / 2;
  const zoomBefore = Number(await map.getAttribute('data-zoom'));
  const cdp = await context.newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [
      { x: x - 35, y, id: 1 },
      { x: x + 35, y, id: 2 },
    ],
  });
  for (let step = 1; step <= 6; step++)
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [
        { x: x - 35 - step * 6, y, id: 1 },
        { x: x + 35 + step * 6, y, id: 2 },
      ],
    });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect
    .poll(async () => Number(await map.getAttribute('data-zoom')))
    .toBeGreaterThan(zoomBefore + 0.3);
  await expect(page.getByRole('button', { name: 'Claim territory', exact: true })).toHaveCount(0);
  await cdp.detach();
});

test('geographic location, projection switching and world exploration', async ({ page }) => {
  await page.goto(`/region/${REGION}`);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const tile = page.getByTestId('tile-4-4');
  await expect(tile).toBeVisible();
  await tile.scrollIntoViewIfNeeded();
  const bounds = (await tile.boundingBox())!;
  await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  const point = gridPoint(plotRegion(REGION, 's1')!, 4.5, 4.5);
  await expect(page.locator('.territory-location')).toContainText(coordinates(point));
  const link = page.getByRole('link', { name: 'View this location on OpenStreetMap' });
  await expect(link).toHaveAttribute(
    'href',
    `https://www.openstreetmap.org/?mlat=${point[1]}&mlon=${point[0]}#map=16/${point[1]}/${point[0]}`,
  );
  await page.getByRole('button', { name: '3D globe', exact: true }).click();
  await expect(page.getByRole('button', { name: '3D globe', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByRole('button', { name: '2D map', exact: true }).click();
  await expect(page.getByTestId('tile-4-4')).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('geographic-map.png'), fullPage: true });
  await page.getByRole('button', { name: 'Back to world', exact: true }).click();
  await expect(
    page.getByText('1,048,576 world tiles · Zoom in for individual boundaries · Click to explore'),
  ).toBeVisible();
  await page.getByRole('button', { name: '3D globe', exact: true }).click();
  await expect(page.locator('.earth-region-pin')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('basemap failures explain the problem and can be retried', async ({ page }) => {
  const unavailable = (route: import('@playwright/test').Route) => route.abort();
  await page.route('https://tiles.openfreemap.org/**', unavailable);
  await page.goto(`/region/${REGION}`);
  await expect(
    page.getByText('Map connection interrupted. Check your connection or retry.'),
  ).toBeVisible();
  await page.unroute('https://tiles.openfreemap.org/**', unavailable);
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(page.getByTestId('tile-4-4')).toBeVisible();
  await expect(
    page.getByText('Map connection interrupted. Check your connection or retry.'),
  ).toHaveCount(0);
});

test('world tile exploration and first settlement work without preallocated plots', async ({
  page,
}) => {
  await page.goto('/');
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await expect(page.getByText('1,048,576 WORLD TILES', { exact: true })).toBeVisible();
  await expect(page.locator('.earth-atlas')).toHaveAttribute('data-map-ready', 'true');
  await expect
    .poll(async () =>
      Number(await page.locator('.earth-atlas').getAttribute('data-visible-world-tiles')),
    )
    .toBeGreaterThan(0);
  const canvas = page.locator('.earth-map canvas');
  await canvas.scrollIntoViewIfNeeded();
  await canvas.click();
  await expect(page).toHaveURL(PLOT_REGION_URL);
  // Coordinates open the exact plot, and joining from it settles that plot.
  // Desktop and mobile share one database, so each settles its own plot.
  const [longitude, latitude, area] =
    test.info().project.name === 'mobile'
      ? ['127.0276', '37.4979', 'Yeoksam 1(il)-dong, Gangnam-gu, Seoul']
      : ['126.9779', '37.5663', 'Myeong-dong, Jung-gu, Seoul'];
  const home = plotAt(Number(longitude), Number(latitude));
  await page.locator('.coordinate-search > summary').click();
  await page.getByLabel('Longitude', { exact: true }).fill(longitude);
  await page.getByLabel('Latitude', { exact: true }).fill(latitude);
  await page.getByRole('button', { name: 'Go to this location', exact: true }).click();
  await expect(page).toHaveURL(`/territory/${plotTerritoryId('s1', home)}`);
  await expect(page.getByTestId(`tile-${home.x}-${home.y}`)).toBeVisible();
  await page.getByRole('button', { name: 'Join the world', exact: true }).click();
  await expect(page.getByLabel('Your first land')).toHaveValue(
    `${area} · ${home.x + 1}-${home.y + 1}`,
  );
  await page.getByLabel('Settler name').fill(unique());
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Enter local playtest' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const state = await (await page.request.get('/api/me/state')).json();
  expect(state.territories[0].id).toBe(plotTerritoryId('s1', home));
  expect(state.territory_count).toBe(1);
  expect(errors).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('clicks name real places and open plots outside the current region', async ({ page }) => {
  await page.goto(`/region/${REGION}`);
  await expect(page.locator('.atlas-label')).toContainText(/-dong, .+-gu/);
  const tile = page.getByTestId('tile-4-4');
  await expect(tile).toBeVisible();
  const canvas = page.locator('.earth-map canvas');
  const bounds = (await canvas.boundingBox())!;
  const plot = (await tile.boundingBox())!;
  await canvas.click({
    position: { x: plot.x + plot.width / 2 - bounds.x, y: plot.y + plot.height / 2 - bounds.y },
  });
  await expect(page.locator('.maplibregl-popup-content')).toContainText('· 5-5');
  await expect(page.locator('.maplibregl-popup-content')).toContainText('Seoul');
  await page.getByRole('button', { name: '한국어로 변경' }).click();
  await expect(page.locator('.atlas-label')).toContainText(/동$/);
  await page.getByRole('button', { name: '닫기', exact: true }).click();
  // Every point is a plot: a click beyond this region opens that plot in its own region.
  const zoom = Number(await page.locator('.earth-cells').getAttribute('data-zoom'));
  await page.getByRole('button', { name: '축소', exact: true }).click();
  await expect
    .poll(async () => Number(await page.locator('.earth-cells').getAttribute('data-zoom')))
    .toBeLessThanOrEqual(zoom - 0.99);
  const outside = (await page.getByTestId('tile-4-4').boundingBox())!;
  await canvas.click({
    position: {
      x: outside.x + outside.width * 5.5 - bounds.x,
      y: outside.y + outside.height / 2 - bounds.y,
    },
  });
  await expect(page).toHaveURL(/\/territory\/s1:z14:\d+:\d+:\d:\d$/);
  expect(page.url()).not.toContain(REGION);
  await expect(page.locator('.detail-sidebar.has-selection')).toBeVisible();
  await page.getByRole('button', { name: '닫기', exact: true }).click();
  for (let step = 0; step < 6; step++) {
    const previousZoom = Number(await page.locator('.earth-cells').getAttribute('data-zoom'));
    await page.getByRole('button', { name: '축소', exact: true }).click();
    await expect
      .poll(async () => Number(await page.locator('.earth-cells').getAttribute('data-zoom')))
      .toBeLessThanOrEqual(previousZoom - 0.99);
  }
  const before = page.url();
  await canvas.click({ position: { x: bounds.width * 0.9, y: bounds.height * 0.35 } });
  await expect(page).toHaveURL(PLOT_REGION_URL);
  expect(page.url()).not.toBe(before);
});

test('the local world and grid remain usable when the external basemap fails', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('https://tiles.openfreemap.org/**', (route) => route.abort());
  const land = page.waitForResponse(
    (response) => response.url().endsWith('/land.geojson') && response.status() === 200,
  );
  await page.goto('/');
  await land;
  await expect(page.locator('.earth-atlas')).toHaveAttribute('data-map-ready', 'true');
  await expect
    .poll(async () =>
      Number(await page.locator('.earth-atlas').getAttribute('data-visible-world-tiles')),
    )
    .toBeGreaterThan(0);
  const canvas = page.locator('.earth-map canvas');
  await canvas.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: test.info().outputPath('world-offline-basemap.png'),
    fullPage: true,
  });
  await canvas.click();
  await expect(page).toHaveURL(PLOT_REGION_URL);
  expect(errors).toEqual([]);
});

test('grid follows the pointer and preserves selected and keyboard-focused plots', async ({
  page,
}) => {
  await page.goto(`/region/${REGION}`);
  const tile = page.getByTestId('tile-4-4');
  await expect(tile).toBeVisible();
  const spotlight = page.locator('.earth-cells mask rect');
  const gradient = page.locator('.earth-cells radialGradient');
  await expect(spotlight).toHaveAttribute('opacity', '0');
  await expect(tile).toHaveAttribute('mask', /url\(#.+-mask\)/);
  const canvas = page.locator('.earth-map canvas');
  const bounds = (await canvas.boundingBox())!;
  await page.mouse.move(bounds.x + 120, bounds.y + 200);
  await expect(spotlight).toHaveAttribute('opacity', '1');
  await expect(gradient).toHaveAttribute('cx', '120');
  await expect(gradient).toHaveAttribute('cy', '200');
  await page.mouse.move(bounds.x + 240, bounds.y + 250);
  await expect(gradient).toHaveAttribute('cx', '240');
  await page.mouse.move(0, 0);
  await expect(spotlight).toHaveAttribute('opacity', '0');
  await tile.focus();
  await expect(tile).toHaveCSS('mask-image', 'none');
  await page.keyboard.press('Enter');
  await expect(tile).not.toHaveAttribute('mask', /.+/);
  await page.goto('/');
  await expect(page.locator('.world-grid polygon').first()).toBeAttached();
  await expect(page.locator('.world-grid')).toHaveAttribute('mask', /url\(#.+-mask\)/);
  await expect(page.locator('.earth-cells mask rect')).toHaveAttribute('opacity', '0');
});

test('regional grid fills the viewport after moving beyond the settlement', async ({ page }) => {
  await page.goto(`/region/${REGION}`);
  await expect(page.getByTestId('tile-4-4')).toBeVisible();
  const grid = page.locator('.regional-grid');
  const pattern = page.locator('.earth-cells pattern');
  const canvas = page.locator('.earth-map canvas');
  const bounds = (await canvas.boundingBox())!;
  await expect(grid).toHaveAttribute('width', String(bounds.width));
  await expect(grid).toHaveAttribute('height', String(bounds.height));
  await expect(grid).toHaveAttribute('mask', /url\(#.+-mask\)/);
  const spacing = Number(await pattern.getAttribute('width'));
  expect(spacing).toBeGreaterThan(12);
  // The repeated lines align with the actual playable cell boundaries.
  const tile = (await page.getByTestId('tile-4-4').boundingBox())!;
  expect(Math.abs(tile.width - spacing)).toBeLessThan(1);
  const camera = await page.locator('.earth-cells').getAttribute('data-camera');
  for (let drag = 0; drag < 4; drag++) {
    await page.mouse.move(bounds.x + bounds.width * 0.2, bounds.y + bounds.height * 0.4);
    await page.mouse.down();
    await page.mouse.move(bounds.x + bounds.width * 0.85, bounds.y + bounds.height * 0.4, {
      steps: 8,
    });
    await page.mouse.up();
  }
  await expect(page.locator('[data-testid^="tile-"]')).toHaveCount(0);
  await expect(page.locator('.earth-cells')).not.toHaveAttribute('data-camera', camera!);
  await expect(grid).toBeVisible();
  await expect(grid).toHaveAttribute('width', String(bounds.width));
  await page.mouse.move(bounds.x + bounds.width * 0.6, bounds.y + bounds.height * 0.4);
  await expect(page.locator('.earth-cells mask rect')).toHaveAttribute('opacity', '1');
  expect(Number(await pattern.getAttribute('width'))).toBeCloseTo(spacing, 3);
  await page.getByRole('button', { name: 'Zoom out', exact: true }).click();
  await expect
    .poll(async () => Number(await pattern.getAttribute('width')))
    .toBeLessThan(spacing * 0.6);
});

test('zooming out fills the world grid while the next area response is delayed', async ({
  page,
}) => {
  // Let the initial, small regional bounds replace the startup overview response.
  const initialArea = page.waitForResponse((response) => {
    const url = new URL(response.url());
    const bbox = url.searchParams.get('bbox')?.split(',').map(Number);
    return url.pathname === '/api/world/tiles' && !!bbox && bbox[2] - bbox[0] < 1;
  });
  await page.goto(`/region/${REGION}`);
  await expect(page.getByTestId('tile-4-4')).toBeVisible();
  await initialArea;
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/world/tiles?*', async (route) => {
    await pending;
    await route.continue();
  });
  try {
    const overlay = page.locator('.earth-cells');
    for (let step = 0; step < 7; step++) {
      const zoom = Number(await overlay.getAttribute('data-zoom'));
      await page.getByRole('button', { name: 'Zoom out', exact: true }).click();
      await expect
        .poll(async () => Number(await overlay.getAttribute('data-zoom')))
        .toBeLessThanOrEqual(zoom - 0.99);
    }
    const canvas = (await page.locator('.earth-map canvas').boundingBox())!;
    await page.mouse.move(canvas.x + canvas.width * 0.7, canvas.y + canvas.height * 0.5);
    await expect(page.locator('.earth-cells mask rect')).toHaveAttribute('opacity', '1');
    const coverage = await page.locator('.world-grid').evaluate((grid) => {
      const view = grid.closest('svg')!.viewBox.baseVal;
      const cells = [...grid.querySelectorAll('polygon')].map((polygon) => polygon.getBBox());
      return [0.25, 0.5, 0.75].flatMap((x) =>
        [0.25, 0.5, 0.75].map((y) =>
          cells.some(
            (cell) =>
              cell.x <= view.width * x &&
              cell.x + cell.width >= view.width * x &&
              cell.y <= view.height * y &&
              cell.y + cell.height >= view.height * y,
          ),
        ),
      );
    });
    expect(coverage).toEqual(Array(9).fill(true));
  } finally {
    release();
    await page.unrouteAll({ behavior: 'wait' });
  }
});
