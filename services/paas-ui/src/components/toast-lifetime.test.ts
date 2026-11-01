import { afterEach, expect, test, vi } from "vitest";

import { ToastLifetime } from "./toast-lifetime.ts";

afterEach(() => vi.useRealTimers());

test("toast expires after five seconds and hovering pauses until a fresh five-second countdown", () => {
	vi.useFakeTimers();
	const dismiss = vi.fn();
	const lifetime = new ToastLifetime(dismiss);
	lifetime.restart();
	vi.advanceTimersByTime(4000);
	expect(dismiss).not.toHaveBeenCalled();
	lifetime.pause();
	vi.advanceTimersByTime(10000);
	expect(dismiss).not.toHaveBeenCalled();
	lifetime.restart();
	vi.advanceTimersByTime(4999);
	expect(dismiss).not.toHaveBeenCalled();
	vi.advanceTimersByTime(1);
	expect(dismiss).toHaveBeenCalledTimes(1);
});

test("dismissal cancels expiry, while cleanup prevents updates after unmount or replacement", () => {
	vi.useFakeTimers();
	const dismiss = vi.fn();
	const lifetime = new ToastLifetime(dismiss);
	lifetime.restart();
	lifetime.dismiss();
	vi.advanceTimersByTime(5000);
	expect(dismiss).toHaveBeenCalledTimes(1);
	const replacement = new ToastLifetime(dismiss);
	replacement.restart();
	replacement.restart();
	replacement.pause();
	vi.advanceTimersByTime(5000);
	expect(dismiss).toHaveBeenCalledTimes(1);
});
