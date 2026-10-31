import { expect, test, vi } from "vitest";

import { ImageRetention } from "./image-retention.ts";

test("resolves mutable source tags to immutable image IDs before tests start", async () => {
	const ids = [`sha256:${"a".repeat(64)}`, `sha256:${"b".repeat(64)}`];
	const docker = vi
		.fn<(args: string[]) => Promise<string>>()
		.mockResolvedValueOnce(`${ids[0]}\n`)
		.mockResolvedValueOnce(`${ids[1]}\n`);
	const retention = new ImageRetention("test-cluster", docker);

	expect(await retention.resolve(["paas:local", "workload:local"])).toEqual(ids);
	expect(docker.mock.calls).toEqual([
		[["image", "inspect", "--format", "{{.Id}}", "paas:local"]],
		[["image", "inspect", "--format", "{{.Id}}", "workload:local"]],
	]);
});

test("keeps each local image running and isolated under cluster ownership before returning", async () => {
	const docker = vi.fn<(args: string[]) => Promise<string>>().mockResolvedValue("container-id");
	const retention = new ImageRetention("test-cluster", docker);

	await retention.retain(["paas:local", "workload:local", "browser:local", "envoy:local"]);

	expect(docker.mock.calls.map(([args]) => args)).toEqual(
		["paas:local", "workload:local", "browser:local", "envoy:local"].map((image, index) => [
			"run",
			"-d",
			"--pull=never",
			"--name",
			`test-cluster-image-${index}`,
			"--label",
			"homelab-paas.cluster=test-cluster",
			"--network",
			"none",
			"--entrypoint",
			"/bin/sleep",
			image,
			"infinity",
		]),
	);
});

test("fails setup immediately if an image cannot be retained", async () => {
	const failure = new Error("image missing");
	const docker = vi
		.fn<(args: string[]) => Promise<string>>()
		.mockResolvedValueOnce("first-container")
		.mockRejectedValueOnce(failure);
	const retention = new ImageRetention("test-cluster", docker);

	await expect(retention.retain(["paas:local", "missing:local", "browser:local"])).rejects.toBe(failure);
	expect(docker).toHaveBeenCalledTimes(2);
});
