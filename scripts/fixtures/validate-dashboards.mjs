import assert from "node:assert/strict";

for (const uid of ["paas-docker", "paas-control-plane"]) {
	const response = await fetch(`http://grafana:3000/api/dashboards/uid/${uid}`);
	assert.equal(response.status, 200);
	const { dashboard } = await response.json();
	for (const panel of dashboard.panels) {
		for (const target of panel.targets) {
			const query = target.expr
				.replaceAll("$__rate_interval", "2m")
				.replace(/\$(engine|serviceId|revision|cluster)\b/g, ".*");
			const url = new URL("http://victoriametrics:8428/api/v1/query");
			url.searchParams.set("query", query);
			const result = await fetch(url);
			assert.equal(result.status, 200, `${uid}: ${panel.title}: ${await result.clone().text()}`);
			assert.equal((await result.json()).status, "success", `${uid}: ${panel.title}`);
		}
	}
}
console.log("All provisioned dashboard queries accepted by VictoriaMetrics");
