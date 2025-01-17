export interface KeyValueStore<TValue> {
  get(key: string): TValue | undefined
  set(key: string, value: TValue): void
  update(key: string, updateFn: (existingValue: TValue | undefined) => TValue): void
  values(): TValue[]
}
