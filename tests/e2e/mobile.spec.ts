import { test, expect, type Locator, type Page } from '@playwright/test';

test.beforeEach(async ({ page, isMobile }) => {
  test.skip(!isMobile, 'Touch interaction and mobile viewport checks');
  await page.route('https://tiles.openfreemap.org/**', (route) =>
    new URL(route.request().url()).pathname === '/planet'
      ? route.fulfill({
          json: {
            tilejson: '3.0.0',
            tiles: ['https://tiles.openfreemap.org/test/{z}/{x}/{y}.pbf'],
            minzoom: 0,
            maxzoom: 14,
          },
        })
      : route.fulfill({ status: 204 }),
  );
});

async function insideViewport(page: Page, locator: Locator) {
  const box = (await locator.boundingBox())!;
  expect(box).toBeTruthy();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize()!.width + 1);
  expect(box.y + box.height).toBeLessThanOrEqual(page.viewportSize()!.height + 1);
}

for (const viewport of [
  { width: 320, height: 568 },
  { width: 390, height: 844 },
  { width: 740, height: 360 },
]) {
  test(`map and panels fit ${viewport.width} × ${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto('/');
    const atlas = page.locator('.earth-atlas');
    await expect(atlas).toHaveAttribute('data-map-ready', 'true');
    await insideViewport(page, atlas);
    expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(
      viewport.height + 1,
    );
    await page.locator('.coordinate-search > summary').tap();
    await insideViewport(page, page.locator('.coordinate-search'));
    await page.getByLabel('Longitude', { exact: true }).fill('127');
    await page.getByLabel('Latitude', { exact: true }).fill('37.5');
    await expect(page.getByLabel('Longitude', { exact: true })).toHaveCSS('font-size', '16px');
    await page.getByRole('button', { name: 'Explore a world tile', exact: true }).tap();
    await expect(page).toHaveURL('/region/earth2:873:725');
    await page.locator('.coordinate-search > summary').tap();
    await page.locator('.map-tools > summary').tap();
    await expect(page.locator('.coordinate-search')).not.toHaveAttribute('open');
    await insideViewport(page, page.locator('.map-tools'));
    await page.getByRole('tab', { name: 'Layers', exact: true }).tap();
    await page.getByRole('combobox', { name: 'Resource distribution' }).selectOption('all');
    await page.getByRole('checkbox', { name: 'Game landmarks' }).check();
    await page.getByRole('tab', { name: 'Landmarks', exact: true }).tap();
    await page
      .locator('.map-tools')
      .getByRole('button', { name: /High peak/ })
      .tap();
    const detail = page.locator('.detail-sidebar.has-selection');
    await expect(detail).toBeVisible();
    await insideViewport(page, detail);
    await page.getByRole('button', { name: 'Close', exact: true }).tap();
    await expect(detail).toHaveCount(0);
    await page.locator('.map-tools > summary').tap();
    await page.locator('.region-sidebar > summary').tap();
    await expect(page.locator('.map-tools')).not.toHaveAttribute('open');
    await page.locator('.region-sidebar > summary').tap();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(viewport.width);
    await page.screenshot({ path: test.info().outputPath('mobile-map.png') });
  });
}

test('touch signup, territory claim, construction and mobile navigation', async ({ page }) => {
  // Keep these settlement writes away from the shared map rendering fixtures.
  await page.goto('/region/earth2:875:725');
  await page.getByRole('button', { name: 'Join the world', exact: true }).tap();
  await page.getByLabel('Settler name').fill(`Touch ${Date.now().toString(36)}`);
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Enter local playtest' }).tap();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const state = await (await page.request.get('/api/me/state')).json();
  const home = state.territories[0];
  await page.getByRole('button', { name: 'Find my land', exact: true }).tap();
  const target = page.getByTestId(`tile-${home.x + 1}-${home.y}`);
  await expect(target).toBeVisible();
  const atlas = (await page.locator('.earth-atlas').boundingBox())!;
  await expect
    .poll(async () => {
      const box = (await target.boundingBox())!;
      return Math.abs(box.y + box.height / 2 - (atlas.y + atlas.height / 2));
    })
    .toBeLessThan(2);
  const bounds = (await target.boundingBox())!;
  await page.touchscreen.tap(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.getByRole('button', { name: 'Claim territory', exact: true }).tap();
  await page.getByRole('button', { name: 'Build facility', exact: true }).tap();
  await expect(page.getByText('Facility established')).toBeVisible();
  await page.getByRole('button', { name: 'Menu', exact: true }).tap();
  await page.locator('#main-navigation').getByRole('link', { name: 'My territory' }).tap();
  await expect(page).toHaveURL('/me');
  await expect(page.getByRole('button', { name: 'Menu', exact: true })).toHaveAttribute(
    'aria-expanded',
    'false',
  );
  await expect(page.getByText('Facility built', { exact: true }).first()).toBeVisible();
});
