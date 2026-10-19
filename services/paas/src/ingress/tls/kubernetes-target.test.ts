import { expect, test } from "vitest";

import * as targetAdapter from "./kubernetes-target.ts";

const config = {
	namespace: "homelab-paas",
	name: "wildcard-tls",
	uid: "secret-uid",
	ownershipToken: "owner-token",
};
const secret = {
	apiVersion: "v1",
	kind: "Secret",
	type: "kubernetes.io/tls",
	metadata: {
		name: config.name,
		namespace: config.namespace,
		uid: config.uid,
		resourceVersion: "7",
		annotations: { "homelab-paas.io/ownership-token": config.ownershipToken },
	},
};

test("publishes both TLS fields with UID/version preconditions and without forced adoption", async () => {
	const patches: unknown[] = [];
	const target = new targetAdapter.KubernetesCertificateTarget(config, {
		readNamespacedSecret: async () => secret,
		patchNamespacedSecret: async (request) => {
			patches.push(request);
			return { ...secret, data: request.body.data };
		},
	});
	await target.activate({ key: "private-key", cert: "certificate-chain" });
	expect(patches).toEqual([
		{
			namespace: config.namespace,
			name: config.name,
			fieldManager: "homelab-paas-tls",
			force: false,
			body: {
				apiVersion: "v1",
				kind: "Secret",
				type: "kubernetes.io/tls",
				metadata: {
					name: config.name,
					namespace: config.namespace,
					uid: config.uid,
					resourceVersion: "7",
				},
				data: {
					"tls.key": Buffer.from("private-key").toString("base64"),
					"tls.crt": Buffer.from("certificate-chain").toString("base64"),
				},
			},
		},
	]);
});

test.each([
	{ ...secret, metadata: { ...secret.metadata, uid: "foreign-uid" } },
	{ ...secret, metadata: { ...secret.metadata, annotations: {} } },
	{ ...secret, type: "Opaque" },
	{ kind: "Secret" },
])("refuses missing or mismatched bootstrap ownership", async (observed) => {
	let patched = false;
	const target = new targetAdapter.KubernetesCertificateTarget(config, {
		readNamespacedSecret: async () => observed,
		patchNamespacedSecret: async () => {
			patched = true;
			return secret;
		},
	});
	await expect(target.activate({ key: "key", cert: "cert" })).rejects.toThrow("Certificate publication failed");
	expect(patched).toBe(false);
});

test("redacts SDK failures and refuses to recreate a missing Secret", async () => {
	const target = new targetAdapter.KubernetesCertificateTarget(config, {
		readNamespacedSecret: async () => {
			throw new Error("secret-canary");
		},
		patchNamespacedSecret: async () => {
			throw new Error("must not patch");
		},
	});
	await expect(target.activate({ key: "key", cert: "cert" })).rejects.toThrow(/^Certificate publication failed$/);
});
