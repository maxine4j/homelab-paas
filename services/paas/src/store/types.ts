export interface KeyValueStore<TValue> {
	get(key: string): Promise<TValue | undefined>;
	set(key: string, value: TValue): Promise<void>;
	update(key: string, updateFn: (value: TValue | undefined) => Promise<TValue | undefined>): Promise<void>;
	delete(key: string): Promise<void>;
}
export interface StoreCodec<TValue> {
	extension: string;
	serialize(value: TValue): string;
	deserialize(content: string): unknown;
}
