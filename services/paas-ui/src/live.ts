import { uiLiveServerSchema, uiLiveTargetFromPath } from "@homelab-paas/shared-contracts";
import type { UiServiceEvent } from "@homelab-paas/shared-contracts";

import type { ApiResult } from "./types.ts";

const eventKey = (event: UiServiceEvent): string =>
	JSON.stringify([
		event.timestamp,
		event.level,
		event.event,
		event.resourceId,
		event.revision,
		event.failures,
		event.retryAt,
		event.message,
	]);

export interface BrowserSocket {
	onopen: ((event: Event) => void) | null;
	onclose: ((event: CloseEvent) => void) | null;
	onerror: ((event: Event) => void) | null;
	onmessage: ((event: MessageEvent) => void) | null;
	send(text: string): void;
	close(): void;
}

/** Each mounted view owns its connection and reconnect timer; cancellation suppresses all stale callbacks. */
export const subscribeUi = <T>(
	path: string,
	update: (result: ApiResult<T>) => void,
	create: (url: string) => BrowserSocket = (url) => new WebSocket(url),
	origin = window.location.origin,
): (() => void) => {
	const target = uiLiveTargetFromPath(path);
	if (!target) {
		update({ error: "Requested item was not found" });
		return () => {};
	}
	let stopped = false;
	let socket: BrowserSocket;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let retry = 1000;
	let data: T | undefined;
	let transientEvents: UiServiceEvent[] = [];
	const connect = (): void => {
		if (stopped) return;
		const active = create(`${origin.replace(/^http/, "ws")}/api/ui/live`);
		socket = active;
		const current = (): boolean => !stopped && socket === active;
		active.onopen = () => {
			if (current()) {
				retry = 1000;
				active.send(JSON.stringify({ type: "subscribe", id: "view", target }));
				update({ data, connected: true });
			}
		};
		active.onmessage = (event) => {
			if (!current()) return;
			try {
				if (typeof event.data !== "string" || event.data.length > 1048576)
					throw new Error("Invalid live message");
				const message = uiLiveServerSchema.parse(JSON.parse(event.data));
				if (message.type === "event") {
					if (target.kind === "events" && message.serviceId === target.serviceId) {
						transientEvents = [
							message.event,
							...transientEvents.filter((entry) => eventKey(entry) !== eventKey(message.event)),
						].slice(0, 200);
						const events = (data ?? []) as UiServiceEvent[];
						data = [
							message.event,
							...events.filter((entry) => eventKey(entry) !== eventKey(message.event)),
						].slice(0, 200) as T;
						update({ data, connected: true });
					}
				} else if (message.id === "view") {
					if (message.type === "error") update({ data, error: message.message, connected: true });
					else if (JSON.stringify(message.target) === JSON.stringify(target)) {
						data = message.data as T;
						if (target.kind === "events" && Array.isArray(data)) {
							const history = data as UiServiceEvent[];
							transientEvents = transientEvents.filter(
								(entry) => !history.some((item) => eventKey(item) === eventKey(entry)),
							);
							data = [...transientEvents, ...history]
								.sort((a, b) => b.timestamp - a.timestamp)
								.slice(0, 200) as T;
						}
						update({ data, connected: true });
					}
				}
			} catch {
				active.close();
			}
		};
		active.onerror = () => {
			if (current()) active.close();
		};
		active.onclose = (event) => {
			if (current()) {
				if (event.code === 1008) {
					update({
						data,
						connected: false,
						error: "A platform session is required. Sign in again and refresh this page.",
					});
					return;
				}
				update({ data, connected: false });
				timer = setTimeout(connect, retry);
				retry = Math.min(retry * 2, 15000);
			}
		};
	};
	connect();
	return () => {
		stopped = true;
		clearTimeout(timer);
		socket?.close();
	};
};
