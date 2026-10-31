import type { IPaasConfig } from "../config/paas-config.ts";
import type { IDockerLogClient } from "./docker-log-client.ts";
import { DockerServiceError } from "./docker-service.ts";
import type { DockerContainerDetails } from "./types.ts";

export interface LogContainerInspector {
	/** Requires one running control plane with matching cluster/role labels; throws DockerServiceError otherwise. */
	inspectControlPlaneContainer(): Promise<DockerContainerDetails>;
	inspectServiceContainer(serviceId: string, containerId: string): Promise<DockerContainerDetails | null>;
}
export interface IDockerLogService {
	/** Discovers the owned control plane and streams redacted replacement tails; cancellation closes the stream. */
	followControlPlane(receive: (containerId: string, content: string) => void, signal: AbortSignal): Promise<void>;
	/** Receives safe replacement tails; cancellation closes the underlying stream. */
	follow(
		serviceId: string,
		containerId: string,
		secrets: string[],
		receive: (content: string) => void,
		signal: AbortSignal,
	): Promise<void>;
}

export class DockerLogService implements IDockerLogService {
	constructor(
		private readonly docker: LogContainerInspector,
		private readonly client: IDockerLogClient,
		private readonly config: IPaasConfig,
	) {}
	async follow(
		serviceId: string,
		containerId: string,
		secrets: string[],
		receive: (content: string) => void,
		signal: AbortSignal,
	): Promise<void> {
		const container = await this.docker.inspectServiceContainer(serviceId, containerId);
		if (!container) throw new DockerServiceError("not-found");
		await this.followContainer(container, secrets, receive, signal);
	}

	async followControlPlane(
		receive: (containerId: string, content: string) => void,
		signal: AbortSignal,
	): Promise<void> {
		const container = await this.docker.inspectControlPlaneContainer();
		await this.followContainer(container, [], (content) => receive(container.id, content), signal);
	}

	private async followContainer(
		container: DockerContainerDetails,
		secrets: string[],
		receive: (content: string) => void,
		signal: AbortSignal,
	): Promise<void> {
		if (signal.aborted) return;
		const redactor = this.config.createLogRedactor([...Object.values(container.env ?? {}), ...secrets]);
		let tail = "";
		const append = (text: string): void => {
			if (signal.aborted) return;
			tail += text;
			const lines = tail.split("\n");
			const count = lines.at(-1) === "" ? 201 : 200;
			tail = lines.slice(-count).join("\n");
			// A single oversized line cannot force unbounded memory or output.
			if (tail.length > 131072) tail = tail.slice(-131072);
			receive(tail);
		};
		append("");
		await this.client.follow(container.id, (text) => append(redactor.push(text)), signal);
		if (!signal.aborted) append(redactor.push("", true));
	}
}
