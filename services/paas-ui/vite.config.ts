import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

import { mockApi } from "./dev/mock-api.ts";

export default defineConfig(({ mode }) => ({
	define: { "import.meta.env.VITE_BUILD_SHA": JSON.stringify(process.env["BUILD_SHA"] || "unknown") },
	plugins: [react(), ...(mode === "mock" ? [mockApi()] : [])],
	server: mode === "mock" ? {} : { proxy: { "/api": { target: "http://127.0.0.1:8080", ws: true } } },
}));
