export class CommitNotFoundError extends Error {
	readonly code = "commit-not-found";
	constructor() {
		super("commit-not-found");
		this.name = "CommitNotFoundError";
	}
}
