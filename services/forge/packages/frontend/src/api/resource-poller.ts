/** One in-flight read/action, next poll scheduled only after completion. */
export class ResourcePoller<T> {
	private readonly controller = new AbortController();
	private timer: ReturnType<typeof setTimeout> | undefined;
	private queue: Promise<void> = Promise.resolve();
	private reading = false;
	constructor(
		private readonly read: (signal: AbortSignal) => Promise<T>,
		private readonly changed: (value: T) => void,
		private readonly failed: (message: string) => void,
		private readonly interval = 4000,
	) {}
	refresh(): void {
		if (this.reading || this.controller.signal.aborted) return;
		this.reading = true;
		void this.mutate(this.read).finally(() => {
			this.reading = false;
		});
	}
	mutate(operation: (signal: AbortSignal) => Promise<T>): Promise<void> {
		clearTimeout(this.timer);
		this.queue = this.queue.then(async () => {
			clearTimeout(this.timer);
			if (this.controller.signal.aborted) return;
			try {
				const value = await operation(this.controller.signal);
				if (!this.controller.signal.aborted) this.changed(value);
			} catch (error) {
				if (!this.controller.signal.aborted)
					this.failed(error instanceof Error ? error.message : "Request failed. Try again.");
			} finally {
				if (!this.controller.signal.aborted) this.timer = setTimeout(() => this.refresh(), this.interval);
			}
		});
		return this.queue;
	}
	stop(): void {
		this.controller.abort();
		clearTimeout(this.timer);
	}
}
