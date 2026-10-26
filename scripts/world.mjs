import { writeFile, mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

// Land ownership v2: worlds are permanent by default. 7/30-day seasons remain for isolated pilots.
const PERMANENT_ENDS_AT = 253402300799;
export function worldSQL(season = 's1', days = 'permanent', start = 'unixepoch()') {
  if (
    !/^[a-z0-9_-]{1,32}$/.test(season) ||
    !['permanent', 7, 30].includes(days) ||
    !/^(unixepoch\(\)|\d+)$/.test(String(start))
  )
    throw Error('Invalid season options');
  const statements = [
    days === 'permanent'
      ? `INSERT INTO seasons VALUES('${season}',${start},${PERMANENT_ENDS_AT},'active','land-v2')`
      : `INSERT INTO seasons VALUES('${season}',${start},${start}+${days * 86400},'active','global-v1')`,
  ];
  return statements.map((s) => `-- statement\n${s};`).join('\n');
}
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const season = process.argv[2] || 's1';
  const days =
    process.argv[3] && process.argv[3] !== 'permanent' ? Number(process.argv[3]) : 'permanent';
  const output = process.argv[4] || `.wrangler/season-${season}.sql`;
  await mkdir('.wrangler', { recursive: true });
  await writeFile(output, worldSQL(season, days));
  console.log(
    `Generated ${output}: ${season}, ${days === 'permanent' ? 'permanent' : `${days} days`}, global on-demand grid; no preset regions. Apply only to a new database or after ending the prior season.`,
  );
}
