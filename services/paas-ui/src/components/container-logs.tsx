import { useEffect, useRef, useState } from "react";

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
	const element = useRef<HTMLPreElement>(null);
	const [frozen, setFrozen] = useState<string>();
	const [feedback, setFeedback] = useState("");
	const paused = frozen !== undefined;
	useEffect(() => {
		if (!paused && element.current) element.current.scrollTop = element.current.scrollHeight;
	}, [content, paused]);
	return (
		<>
			<div className='log-actions'>
				<button onClick={() => setFrozen(paused ? undefined : (content ?? ""))}>
					{paused ? "Resume follow" : "Pause follow"}
				</button>
				<button
					type='button'
					disabled={content === undefined || content === ""}
					onClick={async () => setFeedback(await copyRecentLogs(content ?? "", navigator.clipboard))}
				>
					Copy recent logs
				</button>
				<span role='status'>{feedback}</span>
			</div>
			<pre
				className='code-view logs'
				tabIndex={0}
				aria-label='Container logs'
				ref={element}
				onScroll={() => {
					const view = element.current;
					if (!paused && view && view.scrollHeight - view.scrollTop - view.clientHeight > 24)
						setFrozen(content ?? "");
				}}
			>
				{paused
					? frozen || "No log output yet."
					: content === undefined
						? "Loading logs…"
						: content || "No log output yet."}
			</pre>
		</>
	);
};
