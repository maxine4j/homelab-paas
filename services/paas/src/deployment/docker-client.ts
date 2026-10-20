import type { WebResource } from "@homelab-paas/shared-contracts";
import { z } from "zod";

import { DeploymentError, type Container, type Endpoint, type WorkloadClient } from "./contracts.ts";

const labelsSchema = z.record(z.string(), z.string());
const listed = z.array(z.object({ Id: z.string(), State: z.string(), Labels: labelsSchema }));
const identity = z.object({ Id: z.string().min(1) });
function decode<T>(schema: z.ZodType<T>, value: unknown): T {
	const result = schema.safeParse(value);
	if (!result.success) throw new DeploymentError("Docker Engine returned invalid resource data");
	return result.data;
}

/** Internal Docker wire transport; not an application contract. */
export interface EngineTransport {
	request(method: string, path: string, body?: unknown): Promise<{ status: number; body: string }>;
}
export class DockerWorkloadClient implements WorkloadClient {
	constructor(
		private readonly engine: EngineTransport,
		private readonly clusterId: string,
		private readonly probe: (endpoint: Endpoint, path: string) => Promise<boolean>,
		private readonly pause: (ms: number) => Promise<void>,
	) {}
	private labels(serviceId: string): Record<string, string> {
		return { "homelab-paas.cluster": this.clusterId, "homelab-paas.service": serviceId };
	}
	private network(serviceId: string): string {
		return `paas-${this.clusterId}-${serviceId}`;
	}
	private async request(
		method: string,
		path: string,
		body?: unknown,
		statuses = [200, 201, 204],
	): Promise<{ status: number; body: string }> {
		try {
			const response = await this.engine.request(method, path, body);
			if (!statuses.includes(response.status)) throw new Error();
			return response;
		} catch {
			throw new DeploymentError("Docker Engine request failed; check socket access and managed resources");
		}
	}
	private async json(method: string, path: string, body?: unknown): Promise<unknown> {
		const response = await this.request(method, path, body);
		try {
			return JSON.parse(response.body);
		} catch {
			throw new DeploymentError("Docker Engine returned invalid resource data");
		}
	}
	private filter(labels: Record<string, string>): string {
		return encodeURIComponent(
			JSON.stringify({ label: Object.entries(labels).map(([key, value]) => `${key}=${value}`) }),
		);
	}
	async prepareNetwork(serviceId: string): Promise<void> {
		const name = this.network(serviceId);
		const result = await this.request("GET", `/networks/${name}`, undefined, [200, 404]);
		let attached: Record<string, unknown> = {};
		if (result.status === 404)
			await this.json("POST", "/networks/create", {
				Name: name,
				Driver: "bridge",
				Labels: this.labels(serviceId),
			});
		else {
			let data: unknown;
			try {
				data = JSON.parse(result.body);
			} catch {
				throw new DeploymentError("Invalid Docker network data");
			}
			const network = decode(
				z.object({ Labels: labelsSchema, Containers: z.record(z.string(), z.unknown()).nullish() }),
				data,
			);
			if (Object.entries(this.labels(serviceId)).some(([key, value]) => network.Labels[key] !== value))
				throw new DeploymentError("Service network exists without platform ownership labels");
			attached = network.Containers ?? {};
		}
		for (const role of ["control-plane", "envoy"]) {
			const peers = decode(
				z.array(identity),
				await this.json(
					"GET",
					`/containers/json?all=true&filters=${this.filter({ "homelab-paas.cluster": this.clusterId, "homelab-paas.role": role })}`,
				),
			);
			const peer = peers.at(0);
			if (peers.length !== 1 || !peer)
				throw new DeploymentError("Expected one labeled control-plane and Envoy container for this cluster");
			if (!(peer.Id in attached)) await this.request("POST", `/networks/${name}/connect`, { Container: peer.Id });
		}
	}
	async list(serviceId: string): Promise<Container[]> {
		return decode(
			listed,
			await this.json("GET", `/containers/json?all=true&filters=${this.filter(this.labels(serviceId))}`),
		).map((container) => {
			const resourceId = container.Labels["homelab-paas.resource"];
			const revision = container.Labels["homelab-paas.revision"];
			const spec = container.Labels["homelab-paas.spec"];
			if (!resourceId || !revision || !spec)
				throw new DeploymentError("Managed container is missing deployment identity labels");
			return { id: container.Id, resourceId, revision, spec, running: container.State === "running" };
		});
	}
	async resolveImage(image: string): Promise<string> {
		const path = `/images/${encodeURIComponent(image)}/json`;
		const existing = await this.request("GET", path, undefined, [200, 404]);
		if (image.endsWith(":local") && existing.status === 200) {
			try {
				return decode(identity, JSON.parse(existing.body)).Id;
			} catch {
				throw new DeploymentError("Cannot inspect local workload image");
			}
		}
		const result = await this.request("POST", `/images/create?fromImage=${encodeURIComponent(image)}`);
		try {
			for (const line of result.body.split("\n").filter(Boolean)) {
				const event = decode(
					z.object({ error: z.string().optional(), errorDetail: z.unknown().optional() }),
					JSON.parse(line),
				);
				if (event.error || event.errorDetail) throw new Error();
			}
		} catch {
			throw new DeploymentError("Cannot pull workload image; check image reference and registry access");
		}
		return decode(identity, await this.json("GET", path)).Id;
	}
	async create(
		serviceId: string,
		resourceId: string,
		revision: string,
		spec: string,
		resource: WebResource,
		imageId: string,
	): Promise<string> {
		const name = `paas-${this.clusterId}-${serviceId}-${resourceId}-${spec.slice(0, 12)}`;
		return decode(
			identity,
			await this.json("POST", `/containers/create?name=${encodeURIComponent(name)}`, {
				Image: imageId,
				Cmd: resource.command,
				Env: resource.env?.map(({ name, value }) => `${name}=${value}`) ?? [],
				Labels: {
					...this.labels(serviceId),
					"homelab-paas.resource": resourceId,
					"homelab-paas.revision": revision,
					"homelab-paas.spec": spec,
				},
				HostConfig: { NetworkMode: this.network(serviceId), RestartPolicy: { Name: "unless-stopped" } },
				NetworkingConfig: { EndpointsConfig: { [this.network(serviceId)]: { Aliases: [resourceId] } } },
			}),
		).Id;
	}
	async start(id: string): Promise<void> {
		await this.request("POST", `/containers/${id}/start`, undefined, [204, 304]);
	}
	async stop(id: string, timeoutSeconds: number): Promise<void> {
		await this.request("POST", `/containers/${id}/stop?t=${timeoutSeconds}`, undefined, [204, 304, 404]);
	}
	async remove(id: string): Promise<void> {
		await this.request("DELETE", `/containers/${id}`, undefined, [204, 404]);
	}
	async waitReady(id: string, resource: WebResource): Promise<Endpoint> {
		const schema = z.object({
			State: z.object({ Running: z.boolean() }),
			Config: z.object({ Labels: labelsSchema }),
			NetworkSettings: z.object({ Networks: z.record(z.string(), z.object({ IPAddress: z.string() })) }),
		});
		for (let attempt = 0; attempt < 30; attempt++) {
			const data = decode(schema, await this.json("GET", `/containers/${id}/json`));
			const serviceId = data.Config.Labels["homelab-paas.service"];
			const address = serviceId ? data.NetworkSettings.Networks[this.network(serviceId)]?.IPAddress : undefined;
			const endpoint = {
				address: address ?? "",
				port: resource.ingress.port,
				healthcheckPath: resource.healthcheckUrl ?? "/healthcheck",
			};
			if (data.State.Running && address && (await this.probe(endpoint, endpoint.healthcheckPath)))
				return endpoint;
			await this.pause(1000);
		}
		throw new DeploymentError("Workload readiness failed; check container startup and healthcheckUrl");
	}
}
