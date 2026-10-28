import { useEffect, useRef, useState } from "react";

export const ContainerLogs = ({ content }: { content?: string }) => {
	const element = useRef<HTMLPreElement>(null);
	const [frozen, setFrozen] = useState<string>();
	const paused = frozen !== undefined;
	useEffect(() => {
		if (!paused && element.current) element.current.scrollTop = element.current.scrollHeight;
	}, [content, paused]);
	return (
		<>
			<button onClick={() => setFrozen(paused ? undefined : (content ?? ""))}>
				{paused ? "Resume follow" : "Pause follow"}
			</button>
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
