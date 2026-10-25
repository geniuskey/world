import { test, expect, type Page } from '@playwright/test';

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
});

const unique = () => `Explorer ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
async function signup(page: Page, name = unique()) {
  await page.goto('/region/earth2:873:725');
  await page.getByRole('button', { name: 'Join the world', exact: true }).click();
  await page.getByLabel('Settler name').pressSequentially(name, { delay: 5 });
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Enter local playtest' }).click();
  await expect(page).toHaveURL(/\/region\/earth2:873:725/);
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
  await page.getByRole('button', { name: 'Explore a world tile', exact: true }).click();
  await expect(page).toHaveURL('/region/earth2:873:725');
  await page.locator('.coordinate-search > summary').click();
  await expect(page.getByRole('img', { name: 'Regional territory map' })).toBeVisible();
  await expect(page.locator('[data-testid^="tile-"]').first()).toBeVisible();
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
  await page.getByRole('button', { name: 'Claim territory', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Build facility', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Build facility', exact: true }).click();
  await expect(page.getByText('Facility established')).toBeVisible();
  await page.reload();
  const current = await (await page.request.get('/api/me/state')).json();
  expect(current.territory_count).toBe(2);
  expect(current.energy_value).toBe(3);
  expect(current.gold_balance).toBe(80);
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
  await page.goto('/region/earth2:486:732');
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
  await page.goto('/region/earth2:486:732');
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
  await page.goto('/region/earth2:873:725');
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const tile = page.getByTestId('tile-4-4');
  await expect(tile).toBeVisible();
  await tile.scrollIntoViewIfNeeded();
  const bounds = (await tile.boundingBox())!;
  await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await expect(page.locator('.territory-location')).toContainText('37.529');
  const link = page.getByRole('link', { name: 'View this location on OpenStreetMap' });
  await expect(link).toHaveAttribute('href', /mlat=37\.52.*mlon=127\.09/);
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
  await page.goto('/region/earth2:873:725');
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
  await expect(page).toHaveURL(/\/region\/earth2:\d+:\d+$/);
  await page.locator('.coordinate-search > summary').click();
  await page.getByLabel('Longitude', { exact: true }).fill('127');
  await page.getByLabel('Latitude', { exact: true }).fill('37.5');
  await page.getByRole('button', { name: 'Explore a world tile', exact: true }).click();
  await expect(page).toHaveURL('/region/earth2:873:725');
  await expect(page.getByTestId('tile-0-0')).toBeVisible();
  await page.getByRole('button', { name: 'Join the world', exact: true }).click();
  await expect(page.getByLabel('Starting region')).toHaveValue(/37\.529.*127\.090/);
  await page.getByLabel('Settler name').fill(unique());
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Enter local playtest' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const state = await (await page.request.get('/api/me/state')).json();
  expect(state.territories[0].region_id).toBe('earth2:873:725');
  expect(state.territory_count).toBe(1);
  expect(errors).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
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
  await expect(page).toHaveURL(/\/region\/earth2:\d+:\d+$/);
  expect(errors).toEqual([]);
});
