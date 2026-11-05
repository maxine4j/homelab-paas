import { Copy } from "lucide-react";
import { useState } from "react";

import { CodeHighlight } from "./code-highlight.tsx";
import type { presentLog } from "./structured-log.ts";

export const copyLogJson = async (
	data: Record<string, unknown>,
	clipboard: Pick<Clipboard, "writeText"> | undefined,
): Promise<string> => {
	try {
		if (!clipboard) return "Unable to copy JSON";
		await clipboard.writeText(JSON.stringify(data, undefined, 2));
		return "Copied JSON";
	} catch {
		return "Unable to copy JSON";
	}
};

export const LogEntry = ({ entry }: { entry: NonNullable<ReturnType<typeof presentLog>> }) => {
	const [feedback, setFeedback] = useState("");
	return (
		<details className={`log-entry log-entry-${entry.level}`}>
			<summary>
				<span className='log-level'>{entry.level}</span>
				<span className='log-message'>{entry.message}</span>
				{entry.time && (
					<time dateTime={entry.time.toISOString()}>
						{entry.time.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true })}
					</time>
				)}
			</summary>
			<div className='log-details event-diagnostics'>
				<div className='log-detail-heading'>
					{entry.time && (
						<time dateTime={entry.time.toISOString()}>
							{entry.time.toLocaleString("en-US", {
								year: "numeric",
								month: "short",
								day: "numeric",
								hour: "2-digit",
								minute: "2-digit",
								second: "2-digit",
								hour12: true,
							})}
						</time>
					)}
					<div className='event-copy'>
						<span role='status'>{feedback}</span>
						<button
							type='button'
							className='text-action'
							onClick={async () => setFeedback(await copyLogJson(entry.data, navigator.clipboard))}
						>
							<Copy aria-hidden='true' />
							Copy JSON
						</button>
					</div>
				</div>
				<h3>Context</h3>
				<pre tabIndex={0}>
					<CodeHighlight language='json'>{JSON.stringify(entry.context, undefined, 2)}</CodeHighlight>
				</pre>
				{entry.stack && (
					<>
						<h3>Stack trace</h3>
						<pre tabIndex={0}>
							<CodeHighlight language='stacktrace'>{entry.stack}</CodeHighlight>
						</pre>
					</>
				)}
			</div>
		</details>
	);
};
