import { writeFile, mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export const regions = [
  ['han', 'Han River', 'East Asia', 127.0, 37.5],
  ['tagus', 'Tagus Coast', 'Western Europe', -9.1, 38.7],
  ['lakes', 'Great Lakes', 'North America', -87.6, 41.9],
];
export function worldSQL(season = 's1', days = 30, start = 'unixepoch()') {
  if (
    !/^[a-z0-9_-]{1,32}$/.test(season) ||
    ![7, 30].includes(days) ||
    !/^(unixepoch\(\)|\d+)$/.test(String(start))
  )
    throw Error('Invalid season options');
  const statements = [
    `INSERT INTO seasons VALUES('${season}',${start},${start}+${days * 86400},'active','v1')`,
  ];
  for (const [region, name, subtitle, lon, lat] of regions) {
    statements.push(
      `INSERT INTO regions(id,season_id,name,subtitle,longitude,latitude,width,height) VALUES('${region}','${season}','${name}','${subtitle}',${lon},${lat},24,24)`,
    );
    for (let cy = 0; cy < 3; cy++)
      for (let cx = 0; cx < 3; cx++)
        statements.push(`INSERT INTO chunk_versions VALUES('${season}','${region}',${cx},${cy},1)`);
    const values = [];
    let land = 0;
    for (let y = 0; y < 24; y++)
      for (let x = 0; x < 24; x++) {
        const noise = (x * 17 + y * 31 + x * y * 7 + region.length * 11) % 100;
        const river = Math.abs(x - (17 + Math.sin(y / 3) * 2)) < 1.1;
        const water = (x < 2 && y > 14) || river || (x > 21 && y < 4);
        const terrain = water
          ? 'water'
          : noise < 45
            ? 'meadow'
            : noise < 80
              ? 'forest'
              : 'mountain';
        if (!water) land++;
        const starter = terrain !== 'water' && x % 4 === 2 && y % 4 === 2 ? 1 : 0;
        values.push(
          `('${season}:${region}:${x}:${y}','${region}','${season}',${x},${y},${Math.floor(x / 8)},${Math.floor(y / 8)},'${terrain}',${starter})`,
        );
      }
    statements.push(
      `INSERT INTO territories(id,region_id,season_id,x,y,cx,cy,terrain_type,is_starter) VALUES\n${values.join(',\n')}`,
    );
    statements.push(
      `UPDATE regions SET land_count=${land} WHERE id='${region}' AND season_id='${season}'`,
    );
  }
  return statements.map((s) => `-- statement\n${s};`).join('\n');
}
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const season = process.argv[2] || 's1';
  const days = Number(process.argv[3] || 30);
  const output = process.argv[4] || 'migrations/0003_world.sql';
  await mkdir('migrations', { recursive: true });
  await writeFile(output, worldSQL(season, days));
  console.log(
    `Generated ${output}: ${season}, ${days} days, 1,728 logical cells. Apply only to a new season; end the prior season first.`,
  );
}
