import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

/** Seed missing discovery files before Envoy starts; preserve all existing state. */
export async function bootstrap(stateDirectory: string): Promise<void> {
	try {
		await mkdir(stateDirectory, { recursive: true, mode: 0o700 });
		for (const name of ["cds.yaml", "lds.yaml"]) {
			try {
				await writeFile(join(stateDirectory, name), "version_info: bootstrap\nresources: []\n", {
					flag: "wx",
					mode: 0o600,
				});
			} catch (error) {
				if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
			}
		}
	} catch {
		throw new Error("Cannot bootstrap platform state; check state directory and discovery file permissions");
	}
}
