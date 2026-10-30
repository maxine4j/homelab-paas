import type { UiRevisionMetadata } from "@homelab-paas/shared-contracts";

export const ServiceRevision = ({
	label,
	revision,
	metadata,
	fallback,
	href,
}: {
	label: string;
	revision?: string;
	metadata?: UiRevisionMetadata;
	fallback: string;
	href?: string;
}) => {
	return (
		<div className='service-revision'>
			<div className='service-revision-heading'>
				<span className='muted'>{label}</span>
				{revision && href ? (
					<a
						href={href}
						className='revision-link'
						target='_blank'
						rel='noreferrer'
						title={revision}
						aria-label={`View ${label.toLowerCase()} ${revision} on GitHub`}
					>
						{revision.slice(0, 7)}
					</a>
				) : (
					<span title={revision}>{revision?.slice(0, 7) ?? fallback}</span>
				)}
			</div>
			{revision
				&& (metadata ? (
					<div className='revision-details'>
						<p className='revision-message'>{metadata.message || "No commit message"}</p>
						<p className='muted'>
							{metadata.authorName || "Unknown author"} ·{" "}
							<time dateTime={metadata.authoredAt}>{new Date(metadata.authoredAt).toLocaleString()}</time>
						</p>
					</div>
				) : (
					<p className='revision-details muted'>Commit details unavailable</p>
				))}
		</div>
	);
};
