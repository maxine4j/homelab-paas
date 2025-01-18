import { KeyValueStore } from './types';

export class InMemoryKeyValueStore<TValue> {
  private readonly store = new Map<string, TValue>();

  public get(key: string) {
    return this.store.get(key);
  }

  public set(key: string, value: TValue) {
    this.store.set(key, value);
  }

  public update(
    key: string,
    updateFn: (existingValue: TValue | undefined) => TValue,
  ) {
    const existingValue = this.get(key);
    const newValue = updateFn(existingValue);
    this.set(key, newValue);
  }

  public values() {
    return Array.from(this.store.values());
  }
}
