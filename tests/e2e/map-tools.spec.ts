import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { gridPoint } from '../../shared/geography';
import { chunkValue, placeCell, placeFromIndex, placeName } from '../../shared/places';
import { plotAt, plotRegion, plotRegionName } from '../../shared/plots';
import { regionLandmarks } from '../../shared/mapFeatures';
import { virtualTerritories } from '../../worker/world';
import { terrainResource } from '../../shared/game';

const region = plotAt(127, 37.5).region;
const plots = virtualTerritories('s1', region);
test.beforeEach(async ({ page }) => {
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
  await page.route('https://elevation-tiles-prod.s3.amazonaws.com/**', (route) => route.abort());
});

test('neighbourhood search opens real places and saved regions survive reload', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await page.locator('.map-tools > summary').click();
  await page.getByLabel('Neighbourhood name').fill('Yeoksam 1');
  const result = page
    .locator('.map-tools')
    .getByRole('link', { name: 'Yeoksam 1(il)-dong, Gangnam-gu, Seoul', exact: true });
  await result.click();
  await expect(page).toHaveURL(/\/territory\/s1:z14:\d+:\d+:\d:\d$/);
  await expect(
    page.locator('.detail-sidebar.has-selection').getByRole('heading', { level: 2 }),
  ).toHaveText('Yeoksam 1(il)-dong, Gangnam-gu');
  const saved = decodeURIComponent(new URL(page.url()).pathname).split(':').slice(1, 4).join(':');
  await page.locator('.map-tools > summary').click();
  await page.getByRole('button', { name: 'Save this region', exact: true }).click();
  await expect(page.locator('.bookmark-marker')).toHaveCount(1);
  await page.reload();
  await page.locator('.map-tools > summary').click();
  await expect(
    page.locator('.map-tools').getByRole('link', { name: plotRegionName(saved)!, exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: '한국어로 변경' }).click();
  await expect(page.locator('.map-tools > summary')).toContainText('지도 도구');
  await page.getByLabel('동네 이름 (읍·면·동)').fill('성수2가');
  await expect(
    page.locator('.map-tools').getByRole('link', { name: '서울특별시 성동구 성수2가3동' }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test('resource, population, ownership and landmark layers work together', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/api/map/population?*', (route) =>
    route.fulfill({
      json: {
        samples: [
          {
            territory_id: `s1:${region}:2:2`,
            population: 1500,
            year: 2025,
            source: 'https://example.com/population',
          },
          {
            territory_id: `s1:${region}:3:2`,
            population: 0,
            year: 2025,
            source: 'https://example.com/population',
          },
        ],
      },
    }),
  );
  await page.goto(`/region/${region}`);
  await expect(page.getByTestId('tile-4-4')).toBeVisible();
  await page.locator('.map-tools > summary').click();
  await page.getByRole('tab', { name: 'Layers', exact: true }).click();
  await page.getByRole('combobox', { name: 'Resource distribution' }).selectOption('all');
  const resource = terrainResource[plots[4 * 8 + 4].terrain_type as 'meadow'];
  await expect(page.getByTestId('tile-4-4')).toHaveAttribute(
    'fill',
    { food: '#8daf4d', wood: '#277c70', iron: '#bf8b46' }[resource],
  );
  await expect(page.getByTestId('tile-4-4')).not.toHaveAttribute('mask', /url/);
  await page.getByRole('checkbox', { name: 'Population heatmap' }).check();
  await expect(page.locator('.map-population-key')).toContainText(
    'Population coverage: 2/64 plots',
  );
  await page.getByRole('checkbox', { name: 'Ownership boundaries' }).uncheck();
  await page.getByRole('checkbox', { name: 'Game landmarks' }).check();
  await expect(page.locator('.landmark-marker')).toHaveCount(regionLandmarks(plots).length);
  await page.screenshot({ path: test.info().outputPath('map-layers.png') });
  await page.getByRole('tab', { name: 'Landmarks', exact: true }).click();
  await page
    .locator('.map-tools')
    .getByRole('button', { name: /High peak/ })
    .click();
  await expect(page.locator('.detail-sidebar.has-selection')).toBeVisible();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.reload();
  await page.locator('.map-tools > summary').click();
  await page.getByRole('tab', { name: 'Layers', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Resource distribution' })).toHaveValue('all');
  await expect(page.getByRole('checkbox', { name: 'Ownership boundaries' })).not.toBeChecked();
  await expect(page.getByRole('checkbox', { name: 'Game landmarks' })).toBeChecked();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});

test('measuring consumes map clicks, resets and exits without navigating', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.earth-atlas')).toHaveAttribute('data-map-ready', 'true');
  await page.locator('.map-tools > summary').click();
  await page.getByRole('tab', { name: 'Measure', exact: true }).click();
  await page.getByRole('button', { name: 'Start measuring', exact: true }).click();
  const canvas = page.locator('.earth-map canvas');
  const bounds = (await canvas.boundingBox())!;
  await canvas.click({ position: { x: bounds.width * 0.8, y: bounds.height * 0.4 } });
  await expect(page.locator('.map-measure-banner')).toContainText('Choose the destination');
  await canvas.click({ position: { x: bounds.width * 0.9, y: bounds.height * 0.55 } });
  await expect(page.locator('.map-measure-banner')).toContainText('Distance:');
  await expect(page).toHaveURL('/');
  await page.locator('.map-tools > summary').click();
  await expect(page.locator('.map-measure-result')).toContainText('Initial bearing');
  await page.getByRole('button', { name: 'Clear points' }).click();
  await expect(page.locator('.map-measure-result')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.locator('.map-measure-banner')).toHaveCount(0);
  await expect(page.locator('.earth-atlas')).not.toHaveClass(/is-measuring/);
});

test('recent real settlement events appear in the feed and on the map', async ({ page }) => {
  await page.goto(`/region/${region}`);
  await page.getByRole('button', { name: 'Join the world', exact: true }).click();
  const explorer = `Map Explorer ${Date.now().toString(36)}`;
  await page.getByLabel('Settler name').fill(explorer);
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Enter local playtest' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.locator('.map-tools > summary').click();
  await page.getByRole('tab', { name: 'Activity', exact: true }).click();
  await expect(page.locator('.map-activity-list')).toContainText(`Settled · ${explorer}`);
  await page.getByRole('checkbox', { name: 'Recent activity markers' }).check();
  await expect(page.locator('.activity-marker').first()).toBeVisible();
  await page.locator('.map-activity-list').getByRole('link').filter({ hasText: explorer }).click();
  await expect(page).toHaveURL(new RegExp(`/territory/s1:${region}:`));
  await expect(page.locator('.detail-sidebar.has-selection')).toBeVisible();
});

test('plots in Korea show their real administrative area and source', async ({ page }) => {
  const index = JSON.parse(readFileSync('public/places/kor/index.json', 'utf8'));
  const point = gridPoint(plotRegion(region, 's1')!, 3.5, 3.5);
  const { root, row, column } = placeCell(point[0], point[1], index.cells);
  const chunk = JSON.parse(
    readFileSync(`public/places/kor/${root.replace(':', '-')}.json`, 'utf8'),
  );
  const place = placeFromIndex(index, chunkValue(chunk, row, column))!;
  await page.goto(`/territory/s1:${region}:3:3`);
  const sidebar = page.locator('.detail-sidebar.has-selection');
  await expect(sidebar.getByRole('heading', { level: 2 })).toHaveText(placeName(place, 'en', true));
  await expect(sidebar.locator('.territory-location strong')).toHaveText(placeName(place, 'en'));
  await expect(sidebar.getByRole('link', { name: /KOGL Type 1/ })).toBeVisible();
});
