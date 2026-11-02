import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { ApiClient } from "./api/api-client.ts";
import { App } from "./app.tsx";

import "./style.css";
const root = document.getElementById("root");
if (!root) throw new Error("Missing application root");
const api = new ApiClient(window.fetch.bind(window));
createRoot(root).render(
	<StrictMode>
		<App api={api} />
	</StrictMode>,
);
