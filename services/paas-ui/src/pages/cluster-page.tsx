import type { UiCluster } from "@homelab-paas/shared-contracts";

import { ConfigEditor } from "../components/config-editor.tsx";

export const ClusterPage = ({ cluster }: { cluster: UiCluster }) => (
	<>
		<div className='page-heading'>
			<div>
				<p className='eyebrow'>Cluster</p>
				<h1>Cluster configuration</h1>
				<p>Save live settings to the host configuration. Credentials remain private.</p>
			</div>
		</div>
		<section aria-label='Cluster details'>
			<dl className='summary'>
				<div>
					<dt>Cluster ID</dt>
					<dd>{cluster.clusterId}</dd>
				</div>
				{[
					["Base domain", "ingress.baseDomain"],
					["HTTP port", "ingress.httpPort"],
					["HTTPS port", "ingress.httpsPort"],
				].map(([label, path]) => (
					<div key={path}>
						<dt>{label}</dt>
						<dd>
							{String(
								cluster.fields.find((field) => field.path === path)?.value
									?? (path === "ingress.httpsPort" ? "Not configured" : "Unavailable"),
							)}
						</dd>
					</div>
				))}
			</dl>
		</section>
		<ConfigEditor snapshot={cluster} />
	</>
);
