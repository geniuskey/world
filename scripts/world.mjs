import { writeFile, mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export function worldSQL(season = 's1', days = 30, start = 'unixepoch()') {
  if (
    !/^[a-z0-9_-]{1,32}$/.test(season) ||
    ![7, 30].includes(days) ||
    !/^(unixepoch\(\)|\d+)$/.test(String(start))
  )
    throw Error('Invalid season options');
  const statements = [
    `INSERT INTO seasons VALUES('${season}',${start},${start}+${days * 86400},'active','global-v1')`,
  ];
  return statements.map((s) => `-- statement\n${s};`).join('\n');
}
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const season = process.argv[2] || 's1';
  const days = Number(process.argv[3] || 30);
  const output = process.argv[4] || `.wrangler/season-${season}.sql`;
  await mkdir('.wrangler', { recursive: true });
  await writeFile(output, worldSQL(season, days));
  console.log(
    `Generated ${output}: ${season}, ${days} days, global on-demand grid; no preset regions. Apply only to a new season; end the prior season first.`,
  );
}
