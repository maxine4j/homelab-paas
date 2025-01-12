import sqlite from 'better-sqlite3';
import { KeyValueStore } from './types';

export const createSqliteKeyValueStore = <TValue>(args: {
  databaseFilename: string,
  tableName: string,
}): KeyValueStore<TValue> => {
  const db = sqlite(args.databaseFilename);

  db.prepare(`
    CREATE TABLE IF NOT EXISTS ${args.tableName} (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `).run();

  const get = (key: string) => {
    const row = db.prepare(`SELECT value FROM ${args.tableName} WHERE key = @key`).get({ key }) as { value: string };
    if (!row) {
      return undefined;
    }
    return JSON.parse(row.value) as TValue;
  };

  const set = (key: string, value: TValue) => {
    db.prepare(`INSERT OR REPLACE INTO ${args.tableName} (key, value) VALUES (@key, @value)`).run({
      key,
      value: JSON.stringify(value),
    });
  };

  const update = (key: string, updateFn: (existingValue: TValue | undefined) => TValue) => {
    db.transaction(() => {
      const existingValue = get(key);
      const newValue = updateFn(existingValue);
      set(key, newValue);
    });
  };

  const values = () => {
    const rows = db.prepare(`SELECT value FROM ${args.tableName}`).all() as Array<{ value: string }>;
    return rows.map(row => JSON.parse(row.value));
  };

  return {
    get,
    set,
    update,
    values,
  };
};
