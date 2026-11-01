import type { IGitDirectoryService } from "../../../git/git-service.ts";
import type { IStaticStore } from "../../../static/static-store.ts";
import type { INetworkingService } from "../../networking/networking-service.ts";
import type { StaticReconciliationRequest } from "./types.ts";

export interface IStaticResourceReconciler {
	/** Publishes exact committed files before routing; all failures propagate for retry. */
	reconcile(request: StaticReconciliationRequest): Promise<void>;
}

export class StaticResourceReconciler implements IStaticResourceReconciler {
	constructor(
		private readonly git: IGitDirectoryService,
		private readonly store: { inspect: IStaticStore["inspect"]; publish: IStaticStore["publish"] },
		private readonly networking: INetworkingService,
	) {}
	async reconcile(request: StaticReconciliationRequest): Promise<void> {
		const { serviceId, resourceId, revision, resource, source } = request;
		const identity = { serviceId, resourceId, revision, path: resource.path };
		if (request.force || (await this.store.inspect(identity)) !== "current") {
			const bundle = await this.git.readDirectory(serviceId, source, revision, resource.path);
			await this.store.publish(identity, bundle);
		}
		await this.networking.routeTo(`${resourceId}.${serviceId}`, {
			address: "127.0.0.1",
			port: 8081,
			static: true,
			public: resource.ingress?.public ?? false,
			primary: resource.primary ?? false,
		});
	}
}
