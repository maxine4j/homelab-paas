export class DockerClientError extends Error {
	override readonly name = "DockerClientError";
	constructor(
		public readonly kind: "not-found" | "conflict" | "unavailable" | "invalid-response",
		options?: ErrorOptions,
	) {
		super(`Docker operation failed (${kind})`, options);
	}
}
