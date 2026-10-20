import { vi } from "vitest";

/** Capture the real shared logger's output without mocking application modules. */
export const captureLogs = () => {
	const lines: string[] = [];
	const write = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
		lines.push(String(chunk));
		return true;
	});
	return { lines, restore: () => write.mockRestore() };
};
