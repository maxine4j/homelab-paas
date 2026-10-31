import type { HealthStatus, SyncStatus } from "@homelab-paas/shared-contracts";

type BadgeProps = { kind: "Health"; status: HealthStatus } | { kind: "Sync"; status: SyncStatus };

export const StatusBadge = ({ kind, status }: BadgeProps) => {
	return (
		<span
			className={`badge badge-${status.toLowerCase()}`}
			aria-label={`${kind}: ${status}`}
			title={`${kind}: ${status}`}
		>
			<span aria-hidden='true'>{kind === "Health" ? "♥" : "↻"}</span> {status}
		</span>
	);
};

export const StatusBadges = ({ health, sync }: { health: HealthStatus; sync: SyncStatus }) => (
	<span className='status-badges'>
		<StatusBadge kind='Health' status={health} />
		<StatusBadge kind='Sync' status={sync} />
	</span>
);
