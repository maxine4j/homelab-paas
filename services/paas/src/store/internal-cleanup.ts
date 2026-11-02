import { gitCacheKey, gitRepositoryKey } from "../git/git-cache-key.ts";
import type { IGitService } from "../git/git-service.ts";
import type { GitFileSource } from "../git/types.ts";
import type { IRouteCleanup } from "../reconciler/networking/networking-service.ts";
import type { DescriptorDecoder } from "../reconciler/types.ts";
import type { InternalRetention } from "./types.ts";

export interface IInternalCleanup {
	/** Removes only proven-obsolete platform artifacts; unavailable descriptors preserve static publications. */
	run(): Promise<void>;
}

export interface IInternalArtifactStore {
	cleanup(retain: () => InternalRetention): Promise<void>;
}

export interface ICleanupConfiguration {
	getServices(): Record<string, GitFileSource>;
}

export class InternalCleanup implements IInternalCleanup {
	constructor(
		private readonly config: ICleanupConfiguration,
		private readonly git: IGitService,
		private readonly decode: DescriptorDecoder,
		private readonly networking: IRouteCleanup,
		private readonly storage: IInternalArtifactStore,
		private readonly now: () => number,
	) {}

	async run(): Promise<void> {
		const before = this.now();
		const snapshot = await this.networking.pruneServices((id) => Object.hasOwn(this.config.getServices(), id));
		const publications = new Map<string, { key: string; resources: Set<string> }>();
		for (const [id, source] of Object.entries(this.config.getServices())) {
			try {
				const file = await this.git.fetchFile(id, source);
				const descriptor = this.decode(file.content, id, file.revision);
				const resources = new Set(
					Object.entries(descriptor.resources)
						.filter(([, resource]) => resource.type === "static")
						.map(([resource]) => resource),
				);
				for (const [route, endpoint] of Object.entries(snapshot.routes))
					if (endpoint.static && route.split(".").at(1) === id) resources.add(route.split(".")[0]!);
				publications.set(id, { key: gitCacheKey(id, source), resources });
			} catch {
				// Unavailable or invalid desired inputs cannot prove a published bundle obsolete.
			}
		}
		await this.storage.cleanup(() => {
			const sources = this.config.getServices();
			return {
				before,
				services: new Set(Object.keys(sources)),
				git: new Set(
					Object.entries(sources)
						.filter(([, source]) => source.remote !== "local")
						.map(([, source]) => gitRepositoryKey(source)),
				),
				static: new Map(
					Object.entries(sources).flatMap(([id, source]) => {
						const publication = publications.get(id);
						return publication?.key === gitCacheKey(id, source)
							&& this.networking.isCurrent(snapshot.generation)
							? [[id, publication.resources] as const]
							: [];
					}),
				),
			};
		});
	}
}
