import type { UiContainer } from "@homelab-paas/shared-contracts";

import { ConfigView } from "./config-view.tsx";

export const ResourceState = ({
	serviceId,
	resourceId,
	containers,
}: {
	serviceId: string;
	resourceId: string;
	containers: UiContainer[];
}) => (
	<>
		{containers.length ? (
			<div className='container-list'>
				{containers.map((container) => (
					<section className='inspection-panel' key={container.id}>
						<div className='section-heading'>
							<h2 title={container.id}>Container {container.id.slice(0, 12)}</h2>
							<span
								className={`badge ${container.running === true ? "badge-running" : container.running === false ? "badge-exited" : ""}`}
							>
								{container.state}
							</span>
						</div>
						<dl className='settings container-settings'>
							<div>
								<dt>Container ID</dt>
								<dd>{container.id}</dd>
							</div>
							<div>
								<dt>Running</dt>
								<dd>
									{container.running === undefined ? "Unknown" : container.running ? "Yes" : "No"}
								</dd>
							</div>
							<div>
								<dt>Image identity</dt>
								<dd>{container.imageId}</dd>
							</div>
							<div>
								<dt>Revision</dt>
								<dd>{container.revision}</dd>
							</div>
						</dl>
						<h3>Networks</h3>
						{container.networks === undefined ? (
							<p>Network snapshot unavailable.</p>
						) : Object.keys(container.networks).length ? (
							<div className='table-scroll'>
								<table>
									<thead>
										<tr>
											<th>Network</th>
											<th>Address</th>
											<th>Aliases</th>
										</tr>
									</thead>
									<tbody>
										{Object.entries(container.networks).map(([name, network]) => (
											<tr key={name}>
												<td>{name}</td>
												<td>{network.address || "Unavailable"}</td>
												<td>{network.aliases.join(", ") || "None"}</td>
											</tr>
										))}
									</tbody>
								</table>
							</div>
						) : (
							<p>No networks attached.</p>
						)}
						<a
							className='inspection-log-link'
							href={`#/services/${serviceId}/resources/${resourceId}/logs/${encodeURIComponent(container.id)}`}
						>
							View logs →
						</a>
					</section>
				))}
			</div>
		) : (
			<p className='empty'>No containers observed for this resource.</p>
		)}
		<details className='json-disclosure'>
			<summary>Live state JSON</summary>
			<ConfigView value={containers} label='Live container state' />
		</details>
	</>
);
