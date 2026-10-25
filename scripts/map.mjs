import { writeFile, mkdir } from 'node:fs/promises';
const source =
  'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_land.geojson';
const response = await fetch(source);
if (!response.ok) throw Error(`Map source: ${response.status}`);
const data = await response.json();
const paths = [];
for (const feature of data.features) {
  const polygons =
    feature.geometry.type === 'Polygon'
      ? [feature.geometry.coordinates]
      : feature.geometry.coordinates;
  for (const polygon of polygons) {
    const d = polygon
      .map(
        (ring) =>
          ring
            .map(
              ([lon, lat], i) =>
                `${i ? 'L' : 'M'}${((lon + 180) * 3).toFixed(1)},${((90 - lat) * 3).toFixed(1)}`,
            )
            .join('') + 'Z',
      )
      .join('');
    paths.push(`<path d="${d}"/>`);
  }
}
await mkdir('public', { recursive: true });
await writeFile(
  'public/world.svg',
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1080 540"><!-- Natural Earth 1:110m land. Public domain. ${source} --><g fill="#c8d8c3" stroke="#aabfa6" stroke-width="0.6" fill-rule="evenodd">${paths.join('')}</g></svg>`,
);
console.log('Wrote public/world.svg');
