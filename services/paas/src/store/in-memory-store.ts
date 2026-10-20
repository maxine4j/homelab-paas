import type { KeyValueStore } from "./types.ts";

export class InMemoryKeyValueStore<TValue> implements KeyValueStore<TValue> {
	private data = new Map<string, TValue>();

	async get(key: string): Promise<TValue | undefined> {
		return this.data.get(key);
	}

	async set(key: string, value: TValue): Promise<void> {
		this.data.set(key, value);
	}

	async update(key: string, updateFn: (v: TValue | undefined) => Promise<TValue | undefined>): Promise<void> {
		const previousValue = this.data.get(key);
		const nextValue = await updateFn(previousValue);
		if (nextValue !== undefined) {
			await this.set(key, nextValue);
		} else {
			await this.delete(key);
		}
	}

	async delete(key: string): Promise<void> {
		this.data.delete(key);
	}
}
