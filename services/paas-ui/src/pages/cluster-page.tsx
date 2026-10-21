import type { UiCluster } from "@homelab-paas/shared-contracts";

import { ConfigView } from "../components/config-view.tsx";

export const ClusterPage = ({ cluster }: { cluster: UiCluster }) => (
	<>
		<div className='page-heading'>
			<div>
				<p className='eyebrow'>{cluster.clusterId}</p>
				<h1>Cluster configuration</h1>
				<p>Effective startup configuration. Credentials are redacted.</p>
			</div>
			<span className='pill'>Read only</span>
		</div>
		<ConfigView value={cluster.config} label='Cluster configuration' />
	</>
);
