import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";

import { FileCertificateStore } from "../../src/ingress/tls/certificate-store.ts";
import { atomicWriteFile, mkdir, readFile, writeFile } from "../../src/util/file.ts";

const execute = promisify(execFile);

/** Private test CA, plus a base-domain/wildcard leaf. No TLS verification bypass. */
export const createTls = async (directory: string, baseDomain: string, services: string[] = []) => {
	await mkdir(directory, { recursive: true, mode: 0o700 });
	const path = (name: string) => join(directory, name);
	await writeFile(
		path("ca.cnf"),
		"[req]\ndistinguished_name=dn\nx509_extensions=ca\nprompt=no\n[dn]\nCN=homelab-paas test CA\n[ca]\nbasicConstraints=critical,CA:TRUE\nkeyUsage=critical,keyCertSign,cRLSign\n",
		{ mode: 0o600 },
	);
	await writeFile(
		path("leaf.cnf"),
		`basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=${[baseDomain, `*.${baseDomain}`, ...services.map((id) => `*.${id}.${baseDomain}`)].map((domain) => `DNS:${domain}`).join(",")}\n`,
		{ mode: 0o600 },
	);
	const openssl = async (args: string[]) => execute("openssl", args, { cwd: directory, timeout: 15_000 });
	await openssl([
		"req",
		"-x509",
		"-newkey",
		"rsa:2048",
		"-nodes",
		"-days",
		"365",
		"-config",
		"ca.cnf",
		"-keyout",
		"ca.key",
		"-out",
		"ca.pem",
	]);
	await openssl([
		"req",
		"-new",
		"-newkey",
		"rsa:2048",
		"-nodes",
		"-subj",
		`/CN=${baseDomain}`,
		"-keyout",
		"leaf.key",
		"-out",
		"leaf.csr",
	]);
	await openssl([
		"x509",
		"-req",
		"-in",
		"leaf.csr",
		"-CA",
		"ca.pem",
		"-CAkey",
		"ca.key",
		"-CAcreateserial",
		"-days",
		"365",
		"-extfile",
		"leaf.cnf",
		"-out",
		"leaf.pem",
	]);
	return {
		caPath: path("ca.pem"),
		ca: (await readFile(path("ca.pem")))!,
		cert: (await readFile(path("leaf.pem")))!,
		key: (await readFile(path("leaf.key")))!,
	};
};

export const seedTls = async (
	directory: string,
	certificate: { cert: string; key: string },
	runtimeDirectory = directory,
): Promise<void> => {
	await mkdir(directory, { recursive: true, mode: 0o700 });
	const store = new FileCertificateStore(runtimeDirectory, readFile, (path, content) =>
		atomicWriteFile(path.replace(runtimeDirectory, directory), content, { mode: 0o600 }),
	);
	await store.publish(certificate);
};
