export const StatusBadge = ({ status }: { status: string }) => {
	const label =
		status === "ready" ? "healthy" : status === "failed" ? "unhealthy" : status === "unknown" ? "missing" : status;
	return (
		<span className={`badge badge-${label}`}>
			<span aria-hidden='true'>●</span> {label}
		</span>
	);
};
