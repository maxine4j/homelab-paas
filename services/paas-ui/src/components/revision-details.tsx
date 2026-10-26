import type { UiRevisionMetadata } from "@homelab-paas/shared-contracts";

export const RevisionDetails = ({
	revision,
	metadata,
	fallback,
}: {
	revision?: string;
	metadata?: UiRevisionMetadata;
	fallback: string;
}) => (
	<dd>
		{revision ?? fallback}
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
	</dd>
);
