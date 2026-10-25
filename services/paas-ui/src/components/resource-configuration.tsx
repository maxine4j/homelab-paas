import type { JsonValue } from "@homelab-paas/shared-contracts";

import { ConfigView } from "./config-view.tsx";

const labels: Record<string, string> = {
	cpus: "CPU cores",
	memoryMiB: "Memory (MiB)",
	env: "Environment",
	healthcheckUrl: "Health check path",
	healthcheckPort: "Health check port",
	hostPath: "Host path",
	mountPath: "Mount path",
	readOnly: "Read only",
};
const label = (key: string): string =>
	labels[key] ?? key.replace(/([A-Z])/g, " $1").replace(/^./, (letter) => letter.toUpperCase());

const SettingValue = ({ value }: { value: JsonValue }) => {
	if (value === null) return <span className='muted'>Not configured</span>;
	if (Array.isArray(value))
		return value.length ? (
			<div className='setting-list'>
				{value.map((item, index) => (
					<div key={index}>
						<SettingValue value={item} />
					</div>
				))}
			</div>
		) : (
			<span className='muted'>None</span>
		);
	if (typeof value === "object")
		return (
			<dl className='settings'>
				{Object.entries(value).map(([key, item]) => (
					<div key={key}>
						<dt>{label(key)}</dt>
						<dd>
							<SettingValue value={item} />
						</dd>
					</div>
				))}
			</dl>
		);
	return <span>{typeof value === "boolean" ? (value ? "Yes" : "No") : String(value)}</span>;
};

export const ResourceConfiguration = ({ config }: { config?: JsonValue }) => {
	if (!config || typeof config !== "object" || Array.isArray(config))
		return <p className='empty'>Configuration unavailable.</p>;
	const groups = [
		["Runtime", ["type", "image", "replicas", "rolloutStrategy", "command", "termination"]],
		["Networking", ["primary", "ingress", "healthcheckUrl", "healthcheckPort", "egress", "hostPorts"]],
		["Environment", ["env"]],
		["Storage & devices", ["volumes", "devices", "supplementaryGroups"]],
		["Resource limits", ["limits"]],
	] as const;
	const known = new Set<string>(groups.flatMap(([, keys]) => [...keys]));
	const extra = Object.fromEntries(Object.entries(config).filter(([key]) => !known.has(key)));
	return (
		<>
			<p>Desired descriptor configuration. Environment values and commands are redacted.</p>
			<div className='inspection-grid'>
				{groups.map(([title, keys]) => {
					const fields = Object.fromEntries(
						keys.filter((key) => config[key] !== undefined).map((key) => [key, config[key]!]),
					);
					return Object.keys(fields).length ? (
						<section className='inspection-panel' key={title}>
							<h2>{title}</h2>
							<SettingValue value={fields} />
						</section>
					) : undefined;
				})}
				{Object.keys(extra).length > 0 && (
					<section className='inspection-panel'>
						<h2>Additional settings</h2>
						<SettingValue value={extra} />
					</section>
				)}
			</div>
			<details className='json-disclosure'>
				<summary>Configuration JSON</summary>
				<ConfigView value={config} />
			</details>
		</>
	);
};
