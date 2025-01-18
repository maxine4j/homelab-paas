import sqlite, { Database } from 'better-sqlite3';
import { KeyValueStore } from './types';

export class SqliteKeyValueStore<TValue> implements KeyValueStore<TValue> {
  private readonly db: Database;

  constructor(
    private readonly config: {
      databaseFilename: string;
      tableName: string;
    },
  ) {
    this.db = sqlite(this.config.databaseFilename);
    this.db
      .prepare(
        `
      CREATE TABLE IF NOT EXISTS ${this.config.tableName} (
        key TEXT PRIMARY KEY,
        value TEXT
      );
    `,
      )
      .run();
  }

  public get(key: string) {
    const row = this.db
      .prepare(`SELECT value FROM ${this.config.tableName} WHERE key = @key`)
      .get({ key }) as { value: string };
    if (!row) {
      return undefined;
    }
    return JSON.parse(row.value) as TValue;
  }

  public set(key: string, value: TValue) {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO ${this.config.tableName} (key, value) VALUES (@key, @value)`,
      )
      .run({
        key,
        value: JSON.stringify(value),
      });
  }

  public update(
    key: string,
    updateFn: (existingValue: TValue | undefined) => TValue,
  ) {
    // FIXME: db.transaction is not working
    const existingValue = this.get(key);
    const newValue = updateFn(existingValue);
    this.set(key, newValue);
  }

  public values() {
    const rows = this.db
      .prepare(`SELECT value FROM ${this.config.tableName}`)
      .all() as Array<{ value: string }>;
    return rows.map((row) => JSON.parse(row.value));
  }
}
