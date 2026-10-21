export const StatusBadge = ({ status }: { status: string }) => (
	<span className={`badge badge-${status}`}>
		<span aria-hidden='true'>●</span> {status}
	</span>
);
