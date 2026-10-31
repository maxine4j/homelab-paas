export interface IImageRetention {
	/** Snapshot image IDs before cleanup can remove their original tags. */
	resolve(images: string[]): Promise<string[]>;
	/** Keep local-only images in use until cluster cleanup removes their containers. */
	retain(images: string[]): Promise<void>;
}

export class ImageRetention implements IImageRetention {
	constructor(
		private readonly cluster: string,
		private readonly docker: (args: string[]) => Promise<string>,
	) {}

	async resolve(images: string[]): Promise<string[]> {
		const ids: string[] = [];
		for (const image of images)
			ids.push((await this.docker(["image", "inspect", "--format", "{{.Id}}", image])).trim());
		return ids;
	}

	async retain(images: string[]): Promise<void> {
		for (const [index, image] of images.entries())
			await this.docker([
				"run",
				"-d",
				"--pull=never",
				"--name",
				`${this.cluster}-image-${index}`,
				"--label",
				`homelab-paas.cluster=${this.cluster}`,
				"--network",
				"none",
				"--entrypoint",
				"/bin/sleep",
				image,
				"infinity",
			]);
	}
}
