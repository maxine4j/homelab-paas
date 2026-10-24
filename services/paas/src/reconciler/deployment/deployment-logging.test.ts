import { expect, test } from "vitest";

import { captureLogs } from "../../util/test/logs.ts";
import { DeploymentService } from "./deployment-service.ts";

test("records deployment action, completion and full failure with resource identities", async () => {
	const capture = captureLogs();
	let fail = false;
	const deployment = new DeploymentService([
		{
			name: "recreate",
			async deploy() {
				if (fail) throw new Error("SECRET");
			},
		},
	]);
	const request = {
		serviceId: "demo",
		resourceId: "web",
		revision: "rev",
		spec: "hash",
		resource: { type: "web" as const, image: "SECRET", ingress: { public: true, port: 80 } },
	};
	try {
		await deployment.deploy(request);
		fail = true;
		await expect(deployment.deploy(request)).rejects.toThrow("SECRET");
	} finally {
		capture.restore();
	}
	const records = capture.lines.map((line) => JSON.parse(line));
	expect(records.map(({ event }) => event)).toEqual([
		"deployment.started",
		"deployment.completed",
		"deployment.started",
		"deployment.failed",
	]);
	for (const record of records)
		expect(record).toMatchObject({
			component: "DeploymentService",
			serviceId: "demo",
			resourceId: "web",
			strategy: "recreate",
			revision: "rev",
		});
	expect(records.at(-1).err).toMatchObject({ message: "SECRET", stack: expect.stringContaining("SECRET") });
});
