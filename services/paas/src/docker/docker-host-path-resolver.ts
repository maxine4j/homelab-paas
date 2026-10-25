import path from "node:path/posix";

import type { HostPathDocker, Labels } from "./types.ts";

export interface IHostPathResolver {
	/** Resolves the actual Docker host bind path; absence means no unambiguous bind mapping. Throws on Docker access failure. */
	resolve(containerPath: string): Promise<string | undefined>;
}

export class DockerHostPathResolver implements IHostPathResolver {
	constructor(
		private readonly docker: HostPathDocker,
		private readonly clusterId: string,
	) {}
	async resolve(containerPath: string): Promise<string | undefined> {
		if (!this.validPath(containerPath)) throw new Error("Invalid container path");
		const labels = { "homelab-paas.cluster": this.clusterId, "homelab-paas.role": "control-plane" };
		try {
			const peers = await this.docker.listContainers({ all: false, labels });
			const peer = peers.at(0);
			if (peers.length !== 1 || !peer || !this.matches(peer.labels, labels)) return undefined;
			const controller = await this.docker.inspectContainer(peer.id);
			if (
				!controller
				|| controller.id !== peer.id
				|| !controller.running
				|| !this.matches(controller.labels, labels)
			)
				return undefined;
			const mount = controller.mounts
				?.filter(
					(entry) =>
						this.validPath(entry.destination)
						&& (containerPath === entry.destination
							|| containerPath.startsWith(entry.destination === "/" ? "/" : `${entry.destination}/`)),
				)
				.sort((a, b) => b.destination.length - a.destination.length)
				.at(0);
			if (!mount || mount.type !== "bind" || !this.validPath(mount.source)) return undefined;
			return path.join(mount.source, path.relative(mount.destination, containerPath));
		} catch (cause) {
			throw new Error("Cannot resolve host secret file path; check Docker control-plane mounts", { cause });
		}
	}

	private matches(actual: Labels, expected: Labels): boolean {
		return Object.entries(expected).every(([name, value]) => actual[name] === value);
	}

	private validPath(value: string): boolean {
		return value.startsWith("/") && !/[\0\r\n]/.test(value) && path.normalize(value) === value;
	}
}
