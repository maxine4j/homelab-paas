import { beforeEach, describe, expect, test, vi } from "vitest";

import { FileSystemKeyValueStore } from "./file-system-store.ts";
import { InMemoryKeyValueStore } from "./in-memory-store.ts";
import type { KeyValueStore } from "./types.ts";

test("rejects unsafe codec extensions before filesystem access", async () => {
	const read = vi.fn(async () => undefined);
	const write = vi.fn(async () => {});
	const remove = vi.fn(async () => {});
	const store = new FileSystemKeyValueStore<string>("/state", read, write, remove, {
		extension: "/../../escape",
		serialize: (value) => value,
		deserialize: (value) => value,
	});
	await expect(store.get("demo")).rejects.toThrow("Invalid store extension");
	await expect(store.set("demo", "data")).rejects.toThrow("Invalid store extension");
	await expect(store.delete("demo")).rejects.toThrow("Invalid store extension");
	expect(read).not.toHaveBeenCalled();
	expect(write).not.toHaveBeenCalled();
	expect(remove).not.toHaveBeenCalled();
});

test("supports explicit text codecs without changing PEM bytes", async () => {
	const files = new Map<string, string>();
	const store = new FileSystemKeyValueStore<string>(
		"/state",
		async (path) => files.get(path),
		async (path, value) => {
			files.set(path, value);
		},
		async () => {},
		{ extension: "pem", serialize: (value) => value, deserialize: (value) => value },
	);
	await store.set("acme-account", "PRIVATE KEY\n");
	expect(files.get("/state/acme-account.pem")).toBe("PRIVATE KEY\n");
	expect(await store.get("acme-account")).toBe("PRIVATE KEY\n");
});

test("uses explicit JSON/YAML extensions and supports logical dotted keys", async () => {
	const files = new Map<string, string>();
	const read = async (path: string) => files.get(path);
	const write = async (path: string, content: string) => {
		files.set(path, content);
	};
	const remove = async (path: string) => {
		files.delete(path);
	};
	const json = new FileSystemKeyValueStore("/state", read, write, remove, "json");
	const yaml = new FileSystemKeyValueStore("/state", read, write, remove, "yaml");
	await json.set("demo.state", { phase: "ready" });
	await yaml.set("demo.state", { phase: "ready" });
	expect(files.get("/state/demo.state.json")).toBe('{"phase":"ready"}');
	expect(files.get("/state/demo.state.yaml")).toBe("phase: ready\n");
	expect(await yaml.get("demo.state")).toEqual({ phase: "ready" });
});

type Value = { count: number } | number | boolean | string | null;

function testStore(givenStore: () => Promise<KeyValueStore<Value>>) {
	let store: KeyValueStore<Value>;

	beforeEach(async () => {
		store = await givenStore();
	});

	test("returns undefined for missing keys", async () => {
		expect(await store.get("missing")).toBeUndefined();
	});

	test("stores, overwrites, and isolates values by key", async () => {
		await store.set("demo", { count: 2 });
		await store.set("other", { count: 3 });
		expect(await store.get("demo")).toEqual({ count: 2 });
		await store.set("demo", { count: 4 });
		expect(await store.get("demo")).toEqual({ count: 4 });
		expect(await store.get("other")).toEqual({ count: 3 });
	});

	test.each([0, false, "", null])("stores and updates falsy value %j", async (value) => {
		await store.set("demo", value);
		expect(await store.get("demo")).toBe(value);
		await store.set("demo", 1);
		await store.update("demo", async () => value);
		expect(await store.get("demo")).toBe(value);
	});

	test("updates existing and missing values and deletes on undefined", async () => {
		await store.update("demo", async (previous) => {
			expect(previous).toBeUndefined();
			return 2;
		});
		await store.update("demo", async (previous) => {
			expect(previous).toBe(2);
			return 3;
		});
		expect(await store.get("demo")).toBe(3);
		await store.update("demo", async () => undefined);
		expect(await store.get("demo")).toBeUndefined();
		await store.update("missing", async () => undefined);
		expect(await store.get("missing")).toBeUndefined();
	});

	test("deletes only the requested key and tolerates missing keys", async () => {
		await store.set("demo", 1);
		await store.set("other", 2);
		await store.delete("demo");
		await store.delete("missing");
		expect(await store.get("demo")).toBeUndefined();
		expect(await store.get("other")).toBe(2);
	});

	test("preserves the value when the update callback fails", async () => {
		await store.set("demo", 1);
		const failure = new Error("Update failed");
		await expect(
			store.update("demo", async () => {
				throw failure;
			}),
		).rejects.toBe(failure);
		expect(await store.get("demo")).toBe(1);
	});
}

describe("InMemoryKeyValueStore", () => {
	testStore(async () => new InMemoryKeyValueStore<Value>());
});

describe("FileSystemKeyValueStore YAML", () => {
	testStore(async () => {
		const files = new Map<string, string>();
		return new FileSystemKeyValueStore<Value>(
			"/state",
			async (path) => files.get(path),
			async (path, content) => {
				files.set(path, content);
			},
			async (path) => {
				files.delete(path);
			},
			"yaml",
		);
	});
});

describe("FileSystemKeyValueStore", () => {
	const files = new Map<string, string>();
	testStore(async () => {
		files.clear();
		return new FileSystemKeyValueStore<Value>(
			"/state",
			async (path) => files.get(path),
			async (path, data) => {
				files.set(path, data);
			},
			async (path) => {
				files.delete(path);
			},
		);
	});
	test("stores JSON values in separate files and reads them after recreation", async () => {
		const files = new Map<string, string>();
		const read = async (path: string) => files.get(path);
		const write = async (path: string, data: string) => {
			files.set(path, data);
		};
		const remove = async (path: string) => {
			files.delete(path);
		};
		const store = new FileSystemKeyValueStore<{ count: number }>("/state", read, write, remove);
		expect(await store.get("missing")).toBeUndefined();
		await store.set("demo", { count: 2 });
		expect(files.get("/state/demo.json")).toBe('{"count":2}');
		const restored = new FileSystemKeyValueStore<{ count: number }>("/state", read, write, remove);
		expect(await restored.get("demo")).toEqual({ count: 2 });
	});

	test.each([
		"",
		".",
		"..",
		"../../../../../../../../../../etc/passwd",
		"demo..state",
		".hidden",
		"trailing.",
		"../outside",
		"nested/file",
		"/absolute",
		"./relative",
		"./relative/nested",
		"nested\\file",
		"bad\0key",
	])("rejects unsafe key %j before any I/O or update callback", async (key) => {
		const read = vi.fn(async () => undefined);
		const write = vi.fn(async () => {});
		const remove = vi.fn(async () => {});
		const store = new FileSystemKeyValueStore<number>("/state", read, write, remove);
		const update = vi.fn(async () => 1);
		await expect(store.get(key)).rejects.toThrow("Invalid store key");
		await expect(store.set(key, 1)).rejects.toThrow("Invalid store key");
		await expect(store.update(key, update)).rejects.toThrow("Invalid store key");
		await expect(store.delete(key)).rejects.toThrow("Invalid store key");
		expect(read).not.toHaveBeenCalled();
		expect(write).not.toHaveBeenCalled();
		expect(remove).not.toHaveBeenCalled();
		expect(update).not.toHaveBeenCalled();
	});

	test("deletes files and treats an already missing file as deleted", async () => {
		const remove = vi.fn(async () => {});
		const store = new FileSystemKeyValueStore<number>(
			"/state",
			async () => undefined,
			async () => {},
			remove,
		);
		await store.delete("demo");
		expect(remove).toHaveBeenCalledWith("/state/demo.json");
		remove.mockRejectedValueOnce(Object.assign(new Error("Missing"), { code: "ENOENT" }));
		await expect(store.delete("missing")).resolves.toBeUndefined();
		const failure = new Error("Permission denied");
		remove.mockRejectedValueOnce(failure);
		await expect(store.delete("demo")).rejects.toBe(failure);
	});

	test("propagates read, parse, write, and callback failures without deleting stored data", async () => {
		const read = vi.fn(async () => "1");
		const write = vi.fn(async () => {});
		const remove = vi.fn(async () => {});
		const store = new FileSystemKeyValueStore<number>("/state", read, write, remove);
		const failure = new Error("Unavailable");
		read.mockRejectedValueOnce(failure);
		await expect(store.get("demo")).rejects.toBe(failure);
		read.mockResolvedValueOnce("invalid JSON");
		await expect(store.get("demo")).rejects.toThrow(SyntaxError);
		write.mockRejectedValueOnce(failure);
		await expect(store.set("demo", 2)).rejects.toBe(failure);
		await expect(
			store.update("demo", async () => {
				throw failure;
			}),
		).rejects.toBe(failure);
		expect(remove).not.toHaveBeenCalled();
	});

	test("rejects values without a JSON representation before writing", async () => {
		const write = vi.fn(async () => {});
		const store = new FileSystemKeyValueStore<unknown>(
			"/state",
			async () => undefined,
			write,
			async () => {},
		);
		await expect(store.set("demo", undefined)).rejects.toThrow("Value is not JSON serializable");
		expect(write).not.toHaveBeenCalled();
	});
});
