import type { UiCluster } from "@homelab-paas/shared-contracts";

import { ConfigEditor } from "../components/config-editor.tsx";

export const ClusterPage = ({ cluster }: { cluster: UiCluster }) => (
	<>
		<div className='page-heading'>
			<div>
				<p className='eyebrow'>{cluster.clusterId}</p>
				<h1>Cluster configuration</h1>
				<p>Save live settings to the host configuration. Credentials remain private.</p>
			</div>
		</div>
		<ConfigEditor snapshot={cluster} />
	</>
);
