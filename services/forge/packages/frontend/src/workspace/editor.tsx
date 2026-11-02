import { javascript } from "@codemirror/lang-javascript";
import { EditorView } from "@codemirror/view";
import { basicSetup } from "codemirror";
import { useEffect, useRef, useState } from "react";

export const Editor = ({
	content,
	path,
	change,
}: {
	content: string;
	path: string;
	change: (content: string) => void;
}) => {
	const element = useRef<HTMLDivElement>(null);
	const callback = useRef(change);
	const [initialContent] = useState(content);
	useEffect(() => {
		callback.current = change;
	}, [change]);
	useEffect(() => {
		if (!element.current) return;
		const view = new EditorView({
			parent: element.current,
			doc: initialContent,
			extensions: [
				basicSetup,
				...(/\.[cm]?[jt]sx?$/u.test(path)
					? [javascript({ typescript: /\.tsx?$/u.test(path), jsx: /\.[jt]sx$/u.test(path) })]
					: []),
				EditorView.contentAttributes.of({ "aria-label": "File editor" }),
				EditorView.updateListener.of((update) => {
					if (update.docChanged) callback.current(update.state.doc.toString());
				}),
			],
		});
		return () => view.destroy();
	}, [path, initialContent]);
	return <div className='code-editor' ref={element} />;
};
