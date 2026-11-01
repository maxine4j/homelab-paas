import type { HealthStatus, SyncStatus } from "@homelab-paas/shared-contracts";
import { Heart, RefreshCw } from "lucide-react";

type BadgeProps = { kind: "Health"; status: HealthStatus } | { kind: "Sync"; status: SyncStatus };

export const StatusBadge = ({ kind, status }: BadgeProps) => {
	return (
		<span
			className={`badge badge-${status.toLowerCase()}`}
			aria-label={`${kind}: ${status}`}
			title={`${kind}: ${status}`}
		>
			{kind === "Health" ? <Heart aria-hidden='true' /> : <RefreshCw aria-hidden='true' />} {status}
		</span>
	);
};

export const StatusBadges = ({ health, sync }: { health: HealthStatus; sync: SyncStatus }) => (
	<span className='status-badges'>
		<StatusBadge kind='Health' status={health} />
		<StatusBadge kind='Sync' status={sync} />
	</span>
);
