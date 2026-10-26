export interface GitCommit {
	authorName: string;
	authoredAt: string;
	message: string;
}

export interface GitFile {
	revision: string;
	content: string;
}

export interface GitFileSource {
	remote: string;
	branch?: string;
	descriptorPath: string;
}

export class GitClientError extends Error {
	override readonly name = "GitClientError";
	constructor(options?: ErrorOptions) {
		super("Git operation failed; check repository, branch and committed file path", options);
	}
}

export class GitServiceError extends Error {
	override readonly name = "GitServiceError";
	constructor() {
		super("Invalid Git service identity or file path");
	}
}
