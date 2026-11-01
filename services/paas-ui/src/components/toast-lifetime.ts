export interface IToastLifetime {
	/** Cancel expiry while hovered or when the toast unmounts. */
	pause(): void;
	/** Start a fresh five-second countdown. */
	restart(): void;
	dismiss(): void;
}

export class ToastLifetime implements IToastLifetime {
	private timer: ReturnType<typeof setTimeout> | undefined;

	constructor(private readonly onDismiss: () => void) {}

	pause(): void {
		clearTimeout(this.timer);
		this.timer = undefined;
	}

	restart(): void {
		this.pause();
		this.timer = setTimeout(() => this.dismiss(), 5000);
	}

	dismiss(): void {
		this.pause();
		this.onDismiss();
	}
}
