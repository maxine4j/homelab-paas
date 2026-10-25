import { MockHttpServer } from "../util/http-server.ts";

export class MockDigitalOcean {
	readonly records = new Map<number, unknown>();
	failCreate = false;
	private nextId = 1;
	readonly server = new MockHttpServer(({ method, url, headers, body }) => {
		if (headers.authorization !== "Bearer token") return new Response("Unauthorized", { status: 401 });
		if (method === "GET" && url.pathname === "/v2/domains/example.test")
			return Response.json({ domain: { name: "example.test" } });
		if (method === "GET" && url.pathname === "/v2/domains/apps.example.test")
			return new Response(null, { status: 404 });
		if (method === "POST" && url.pathname === "/v2/domains/example.test/records") {
			if (this.failCreate) return new Response("Unavailable", { status: 503 });
			const id = this.nextId++;
			this.records.set(id, JSON.parse(body));
			return Response.json({ domain_record: { id } }, { status: 201 });
		}
		if (method === "DELETE" && /^\/v2\/domains\/example.test\/records\/\d+$/.test(url.pathname)) {
			const removed = this.records.delete(Number(url.pathname.split("/").at(-1)));
			return new Response(null, { status: removed ? 204 : 404 });
		}
		return undefined;
	});
}
