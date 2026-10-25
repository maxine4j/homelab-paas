import { once } from "node:events";
import { createServer } from "node:net";

interface ReservedPort {
	port: number;
	release(): Promise<void>;
}

const reservePort = async (): Promise<ReservedPort> => {
	const server = createServer().listen(0, "127.0.0.1");
	await once(server, "listening");
	const address = server.address();
	if (!address || typeof address === "string") throw new Error("Cannot reserve port");
	return {
		port: address.port,
		release: () => new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
	};
};

export const ingressPorts = async (reserve = reservePort): Promise<[number, number]> => {
	const http = await reserve();
	try {
		const https = await reserve();
		try {
			return [http.port, https.port];
		} finally {
			await https.release();
		}
	} finally {
		await http.release();
	}
};
