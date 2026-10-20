import type { KeyValueStore } from "../../store/types.ts";

export interface IAcmeAccountStore {
	readAccountKey(): Promise<string | undefined>;
	writeAccountKey(key: string): Promise<void>;
}

export class AcmeAccountStore implements IAcmeAccountStore {
	constructor(private readonly store: KeyValueStore<string>) {}
	async readAccountKey(): Promise<string | undefined> {
		try {
			const key = await this.store.get("acme-account");
			if (key !== undefined && typeof key !== "string") throw new Error();
			return key;
		} catch {
			throw new Error("Cannot read TLS state");
		}
	}
	async writeAccountKey(key: string): Promise<void> {
		try {
			if (typeof key !== "string") throw new Error();
			await this.store.set("acme-account", key);
		} catch {
			throw new Error("Cannot write TLS state");
		}
	}
}
