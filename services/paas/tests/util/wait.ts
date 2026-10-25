import { sleep } from "../../src/util/sleep.ts";

/** Retries observations, never mutations. Retains the last error for diagnostics. */
export const waitFor = async <T>(
	description: string,
	observe: () => Promise<T | undefined | false>,
	timeoutMs = 60_000,
	signal?: AbortSignal,
): Promise<T> => {
	const deadline = Date.now() + timeoutMs;
	let failure: unknown;
	while (Date.now() < deadline) {
		signal?.throwIfAborted();
		try {
			const value = await observe();
			if (value !== undefined && value !== false) return value;
		} catch (error) {
			failure = error;
		}
		await sleep(200, signal);
	}
	throw new Error(`Timed out waiting for ${description}`, { cause: failure });
};
