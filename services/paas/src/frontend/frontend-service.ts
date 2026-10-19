export type UiEntry = "file" | "missing" | "blocked";
export type FrontendResult = { kind: "file"; path: string; content: Uint8Array } | { kind: "missing" };

export class UiUnavailableError extends Error {
	constructor(options?: ErrorOptions) {
		super("UI content is unavailable", options);
		this.name = "UiUnavailableError";
	}
}

export interface UiFiles {
	/** Reads immutable UI content. Throws UiUnavailableError on I/O failure. */
	read(path: string): Promise<Uint8Array>;
	/** Inspects a relative path without following symbolic links. Throws UiUnavailableError on I/O failure. */
	inspect(path: string): Promise<UiEntry>;
}

export interface Frontend {
	/** Resolves a decoded navigation path. Throws UiUnavailableError when content cannot be inspected. */
	resolve(path: string): Promise<FrontendResult>;
}

export class FrontendService implements Frontend {
	private readonly files: UiFiles;
	constructor(files: UiFiles) {
		this.files = files;
	}

	async resolve(path: string): Promise<FrontendResult> {
		if (path.includes("\\") || path.includes("\0") || path.split("/").some((part) => part.startsWith(".")))
			return { kind: "missing" };
		const file = path.replace(/^\/+/, "");
		const entry = await this.files.inspect(file);
		if (entry === "blocked") return { kind: "missing" };
		if (entry === "file") return { kind: "file", path: file, content: await this.files.read(file) };
		if (
			path.startsWith("/assets/")
			|| path === "/assets"
			|| path === "/favicon.ico"
			|| path.split("/").at(-1)?.includes(".")
		)
			return { kind: "missing" };
		return { kind: "file", path: "index.html", content: await this.files.read("index.html") };
	}
}
