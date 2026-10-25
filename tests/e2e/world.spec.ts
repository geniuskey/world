import { test, expect, type Page } from '@playwright/test';

const unique = () => `Explorer ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
async function signup(page: Page, name = unique()) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Join the world', exact: true }).click();
  await page.getByLabel('Settler name').pressSequentially(name, { delay: 5 });
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Enter local playtest' }).click();
  await expect(page).toHaveURL(/\/region\/han/);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  return name;
}
test('public exploration, language, regional navigation and no overflow', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'A little piece of your own.' })).toBeVisible();
  await expect(page.getByRole('img', { name: 'World map' })).toBeVisible();
  await page.getByRole('button', { name: '한국어로 변경' }).click();
  await expect(page.getByRole('heading', { name: '나만의 작은 시작.' })).toBeVisible();
  await page.getByRole('button', { name: 'Switch to English' }).click();
  await page.getByRole('button', { name: 'Han River', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL('/region/han');
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
  await page.goto('/region/tagus');
  await expect(page.locator('[data-testid^="tile-"]').first()).toBeVisible();
  const map = page.getByRole('img', { name: 'Regional territory map' }),
    box = (await map.boundingBox())!;
  const before = await map.getAttribute('viewBox');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 70, box.y + box.height / 2 + 40, { steps: 10 });
  await page.mouse.up();
  expect(await map.getAttribute('viewBox')).not.toBe(before);
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
  await page.goto('/region/tagus');
  await expect(page.locator('[data-testid^="tile-"]').first()).toBeVisible();
  const map = page.getByRole('img', { name: 'Regional territory map' });
  await map.scrollIntoViewIfNeeded();
  const box = (await map.boundingBox())!,
    x = box.x + box.width / 2,
    y = box.y + box.height / 2;
  const widthBefore = Number((await map.getAttribute('viewBox'))!.split(' ')[2]);
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
    .poll(async () => Number((await map.getAttribute('viewBox'))!.split(' ')[2]))
    .toBeLessThan(widthBefore * 0.8);
  await expect(page.getByRole('button', { name: 'Claim territory', exact: true })).toHaveCount(0);
  await cdp.detach();
});
