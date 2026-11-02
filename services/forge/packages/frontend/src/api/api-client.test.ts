import { expect, test, vi } from "vitest";

import { ApiClient } from "./api-client.ts";

const project = {
	id: "123e4567-e89b-42d3-a456-426614174000",
	name: "Site",
	status: "ready",
	createdAt: "2026-11-02T00:00:00.000Z",
};
test("validates successful responses and never leaks raw response errors", async () => {
	const request = vi.fn<typeof fetch>();
	const api = new ApiClient(request);
	request.mockResolvedValueOnce(Response.json([project]));
	expect(await api.projects()).toEqual([project]);
	request.mockResolvedValueOnce(Response.json({ ...project, secret: "TOKEN" }));
	await expect(api.create({ name: "Site" })).rejects.toThrow("Unexpected server response. Refresh and try again.");
	request.mockResolvedValueOnce(new Response("TOKEN", { status: 500 }));
	await expect(api.projects()).rejects.toThrow("Request failed. Try again.");
	request.mockResolvedValueOnce(Response.json({ error: "access-denied" }, { status: 403 }));
	await expect(api.projects()).rejects.toThrow(
		"Access denied. Sign in through PaaS with the configured owner account.",
	);
});
test("mutations use same-origin credentials and JSON; unsafe account links and incomplete pending codes fail closed", async () => {
	const request = vi.fn<typeof fetch>().mockResolvedValue(Response.json(project));
	const api = new ApiClient(request);
	await api.create({ name: "Site" });
	expect(request).toHaveBeenCalledWith(
		"/api/projects",
		expect.objectContaining({ method: "POST", credentials: "same-origin", body: '{"name":"Site"}' }),
	);
	for (const login of [
		{ state: "pending" },
		{ state: "pending", verificationUrl: "javascript:alert(1)", userCode: "ABCD" },
		{ state: "completed", verificationUrl: "https://github.com/login/device", userCode: "ABCD" },
	]) {
		request.mockResolvedValueOnce(Response.json({ connection: "available", login }));
		await expect(api.account("github", "login")).rejects.toThrow("Unexpected server response");
	}
});
