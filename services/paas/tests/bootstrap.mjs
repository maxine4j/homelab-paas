import { start } from "../dist/start.js";
import { runProcess } from "../dist/util/run-process.js";

// Mounted only by tests. Production always uses dist/main.js and official endpoints.
const origin = process.env["MOCK_GITHUB_ORIGIN"];
if (!origin) throw new Error("MOCK_GITHUB_ORIGIN is required by the test composition");
runProcess((lifecycle) =>
	start(lifecycle, {
		githubEndpoints: {
			authorization: `${process.env["MOCK_GITHUB_BROWSER_ORIGIN"]}/authorize`,
			token: `${origin}/token`,
			profile: `${origin}/user`,
		},
	}),
);
