export class Db {
  rowsRead = 0;
  rowsWritten = 0;
  constructor(readonly raw: D1Database) {}
  track<T>(r: D1Result<T>) {
    this.rowsRead += r.meta.rows_read ?? 0;
    this.rowsWritten += r.meta.rows_written ?? 0;
    return r;
  }
  statement(sql: string, args: unknown[] = []) {
    return this.raw.prepare(sql).bind(...args);
  }
  async all<T = Record<string, unknown>>(sql: string, ...args: unknown[]): Promise<T[]> {
    return this.track(await this.statement(sql, args).all<T>()).results;
  }
  async first<T = Record<string, unknown>>(sql: string, ...args: unknown[]): Promise<T | null> {
    return (await this.all<T>(sql, ...args))[0] ?? null;
  }
  async run(sql: string, ...args: unknown[]) {
    return this.track(await this.statement(sql, args).run());
  }
  async batch(statements: D1PreparedStatement[]) {
    return (await this.raw.batch(statements)).map((r) => this.track(r));
  }
}
