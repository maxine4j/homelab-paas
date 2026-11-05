import { Copy, Pause, Play } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { CodeHighlight } from "./code-highlight.tsx";
import { LogEntry } from "./log-entry.tsx";
import { presentLog } from "./structured-log.ts";

export const copyRecentLogs = async (
	content: string,
	clipboard: Pick<Clipboard, "writeText"> | undefined,
): Promise<string> => {
	try {
		if (!clipboard) return "Unable to copy logs";
		const lines = content.split("\n");
		await clipboard.writeText(lines.slice(content.endsWith("\n") ? -201 : -200).join("\n"));
		return "Copied recent logs";
	} catch {
		return "Unable to copy logs";
	}
};

export const ContainerLogs = ({ content }: { content?: string }) => {
	const element = useRef<HTMLDivElement>(null);
	const [frozen, setFrozen] = useState<string>();
	const [feedback, setFeedback] = useState("");
	const paused = frozen !== undefined;
	const displayed = paused ? frozen : content;
	const lines = displayed?.split("\n");
	if (lines?.at(-1) === "") lines.pop();
	const occurrences = new Map<string, number>();
	const entries = lines?.map((raw) => {
		const occurrence = occurrences.get(raw) ?? 0;
		occurrences.set(raw, occurrence + 1);
		return { raw, entry: presentLog(raw), key: `${raw}\0${occurrence}` };
	});
	useEffect(() => {
		if (!paused && element.current) element.current.scrollTop = element.current.scrollHeight;
	}, [content, paused]);
	return (
		<>
			<div className='log-actions'>
				<button onClick={() => setFrozen(paused ? undefined : (content ?? ""))}>
					{paused ? <Play aria-hidden='true' /> : <Pause aria-hidden='true' />}
					{paused ? "Resume follow" : "Pause follow"}
				</button>
				<button
					type='button'
					disabled={content === undefined || content === ""}
					onClick={async () => setFeedback(await copyRecentLogs(content ?? "", navigator.clipboard))}
				>
					<Copy aria-hidden='true' />
					Copy recent logs
				</button>
				<span role='status'>{feedback}</span>
			</div>
			<div
				className='code-view logs log-viewer'
				tabIndex={0}
				aria-label='Container logs'
				ref={element}
				onScroll={() => {
					const view = element.current;
					if (!paused && view && view.scrollHeight - view.scrollTop - view.clientHeight > 24)
						setFrozen(content ?? "");
				}}
			>
				{entries?.some(({ entry }) => entry) ? (
					entries.map(({ raw, entry, key }) =>
						entry ? (
							<LogEntry key={key} entry={entry} />
						) : (
							<pre className='log-plain' key={key}>
								<CodeHighlight language='log'>{raw + "\n"}</CodeHighlight>
							</pre>
						),
					)
				) : (
					<pre className='log-plain'>
						<CodeHighlight language='log'>
							{displayed === undefined ? "Loading logs…" : displayed || "No log output yet."}
						</CodeHighlight>
					</pre>
				)}
			</div>
		</>
	);
};
