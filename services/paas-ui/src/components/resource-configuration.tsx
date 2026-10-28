import type { JsonValue } from "@homelab-paas/shared-contracts";

const labels: Record<string, string> = {
	cpus: "CPU cores",
	memoryMiB: "Memory (MiB)",
	env: "Environment",
	healthcheckUrl: "Health check path",
	healthcheckPort: "Health check port",
	hostPath: "Host path",
	mountPath: "Mount path",
	readOnly: "Read only",
	rolloutStrategy: "Strategy",
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
			<dl className='settings inline-settings'>
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

const Environment = ({ value }: { value: JsonValue }) => {
	if (!Array.isArray(value)) return <SettingValue value={value} />;
	if (!value.length) return <span className='muted'>None</span>;
	return (
		<ul className='environment-list'>
			{value.map((entry, index) => {
				if (!entry || typeof entry !== "object" || Array.isArray(entry))
					return (
						<li key={index}>
							<SettingValue value={entry} />
						</li>
					);
				return (
					<li key={index}>
						{String(entry["name"])}:{" "}
						{"secret" in entry ? (
							<span className='secret-badge' aria-label='Secret value hidden'>
								<svg
									viewBox='0 0 16 16'
									width='14'
									height='14'
									fill='none'
									stroke='currentColor'
									strokeWidth='1.5'
									aria-hidden='true'
								>
									<rect x='3' y='7' width='10' height='7' rx='2' />
									<path d='M5 7V5a3 3 0 0 1 6 0v2M8 10v2' />
								</svg>
								&lt;secret&gt;
							</span>
						) : (
							String(entry["value"] ?? "")
						)}
					</li>
				);
			})}
		</ul>
	);
};

export const ResourceConfiguration = ({ config, configYaml }: { config?: JsonValue; configYaml?: string }) => {
	if (!config || typeof config !== "object" || Array.isArray(config))
		return <p className='empty'>Configuration unavailable.</p>;
	const groups = [
		["Image", ["image", "type", "command"]],
		["Deployment strategy", ["rolloutStrategy", "replicas", "termination"]],
		["Networking", ["primary", "ingress", "healthcheckUrl", "healthcheckPort", "egress", "hostPorts"]],
		["Environment", ["env"]],
		["Storage & devices", ["volumes", "devices", "supplementaryGroups"]],
		["Resource limits", ["limits"]],
	] as const;
	const known = new Set<string>(groups.flatMap(([, keys]) => [...keys]));
	const extra = Object.fromEntries(Object.entries(config).filter(([key]) => !known.has(key)));
	return (
		<>
			<p>Desired descriptor configuration. Secrets and commands are redacted.</p>
			<div className='inspection-grid resource-configuration'>
				{groups.map(([title, keys]) => {
					const fields = Object.fromEntries(
						keys.filter((key) => config[key] !== undefined).map((key) => [key, config[key]!]),
					);
					return Object.keys(fields).length ? (
						<section
							className={`inspection-panel${title === "Environment" ? " environment-panel" : ""}`}
							key={title}
						>
							<h2>{title}</h2>
							{title === "Environment" ? (
								<Environment value={config["env"]!} />
							) : (
								<SettingValue value={fields} />
							)}
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
			<details>
				<summary>Descriptor YAML</summary>
				<pre className='code-view' tabIndex={0} aria-label='Resource descriptor YAML'>
					{configYaml ?? "Descriptor unavailable."}
				</pre>
			</details>
		</>
	);
};
