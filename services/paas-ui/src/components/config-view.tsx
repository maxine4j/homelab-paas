import { CodeHighlight } from "./code-highlight.tsx";

export const ConfigView = ({ value, label = "Configuration" }: { value: unknown; label?: string }) => (
	<pre className='code-view' tabIndex={0} aria-label={label}>
		<CodeHighlight language='json'>{JSON.stringify(value, null, 2) ?? "Configuration unavailable"}</CodeHighlight>
	</pre>
);
