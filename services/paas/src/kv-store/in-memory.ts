import { KeyValueStore } from './types';

export const createInMemoryKeyValueStore = <TValue>(): KeyValueStore<TValue> => {
  
  const store = new Map<string, TValue>();

  const get = (key: string) => {
    return store.get(key);
  };

  const set = (key: string, value: TValue) => {
    store.set(key, value);
  };

  const update = (key: string, updateFn: (existingValue: TValue | undefined) => TValue) => {
    const existingValue = get(key);
    const newValue = updateFn(existingValue);
    set(key, newValue);
  }

  const values = () => {
    return Array.from(store.values());
  };

  return {
    get,
    set,
    update,
    values,
  };
};
