import { DockerLogDecoder } from "./docker-log-decoder.ts";
import type { IDockerLogTransport } from "./docker-transport.ts";
import { DockerClientError } from "./errors.ts";

export interface IDockerLogClient {
	/** Streams decoded text until EOF/cancellation. Throws sanitized DockerClientError. */
	follow(containerId: string, receive: (text: string) => void, signal: AbortSignal): Promise<void>;
}

export class DockerLogClient implements IDockerLogClient {
	constructor(private readonly transport: IDockerLogTransport) {}
	async follow(containerId: string, receive: (text: string) => void, signal: AbortSignal): Promise<void> {
		try {
			const stream = await this.transport.stream(
				`/containers/${encodeURIComponent(containerId)}/logs?stdout=true&stderr=true&timestamps=true&tail=200&follow=true`,
				signal,
			);
			const decoder = new DockerLogDecoder(262144);
			for await (const chunk of stream) {
				if (signal.aborted) return;
				receive(decoder.push(chunk));
			}
			if (signal.aborted) return;
			receive(decoder.end());
		} catch (cause) {
			if (signal.aborted) return;
			throw new DockerClientError("unavailable", { cause });
		}
	}
}
