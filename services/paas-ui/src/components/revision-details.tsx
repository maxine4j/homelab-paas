import type { UiRevisionMetadata } from "@homelab-paas/shared-contracts";

export const RevisionDetails = ({
	revision,
	metadata,
	fallback,
	compact = false,
}: {
	revision?: string;
	metadata?: UiRevisionMetadata;
	fallback: string;
	compact?: boolean;
}) =>
	compact ? (
		<dd className='revision-summary'>
			<span className='revision-hash'>{revision ?? fallback}</span>
			{revision
				&& (metadata ? (
					<>
						<span className='revision-summary-message' title={metadata.message}>
							{metadata.message || "No commit message"}
						</span>
						<span className='revision-summary-author' title={metadata.authorName}>
							{metadata.authorName || "Unknown author"}
						</span>
						<time dateTime={metadata.authoredAt} title={new Date(metadata.authoredAt).toLocaleString()}>
							{new Date(metadata.authoredAt).toLocaleDateString()}
						</time>
					</>
				) : (
					<span className='muted'>Commit details unavailable</span>
				))}
		</dd>
	) : (
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
