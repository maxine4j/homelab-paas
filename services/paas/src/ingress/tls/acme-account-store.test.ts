import { expect, test } from "vitest";

import { InMemoryKeyValueStore } from "../../store/in-memory-store.ts";
import { AcmeAccountStore } from "./acme-account-store.ts";

test("wraps account material in the injected store and sanitizes invalid persisted values", async () => {
	const values = new InMemoryKeyValueStore<string>();
	const store = new AcmeAccountStore(values);
	expect(await store.readAccountKey()).toBeUndefined();
	await store.writeAccountKey("account-key\n");
	expect(await values.get("acme-account")).toBe("account-key\n");
	expect(await store.readAccountKey()).toBe("account-key\n");
	Object.assign(values, { get: async () => ({ secret: "credential" }) });
	await expect(store.readAccountKey()).rejects.toThrow("Cannot read TLS state");
});
