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
export interface InternalRetention {
	/** Keep publications created during plan preparation, before they have a route. */
	before?: number;
	services: ReadonlySet<string>;
	git: ReadonlySet<string>;
	/** Absent entry preserves all static publications when desired inputs are unavailable. */
	static?: ReadonlyMap<string, ReadonlySet<string>>;
}
