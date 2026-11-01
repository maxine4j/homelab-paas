import Prism from "prismjs";
import "prismjs/components/prism-json.js";
import "prismjs/components/prism-log.js";
import "prismjs/components/prism-yaml.js";
import { memo } from "react";
import type { ReactNode } from "react";

// React owns the rendered tokens; prevent Prism's automatic DOM rewriting.
Prism.manual = true;

const diagnosticGrammar: Prism.Grammar = {
	frame: {
		pattern: /^[\t ]*at .+$/m,
		inside: {
			function: { pattern: /(\bat\s+(?:async\s+|new\s+)?)[\w.$<>]+(?=\s*\()/, lookbehind: true },
			keyword: /^\s*at\b/,
			location: { pattern: /(?:file:\/\/\/|node:|\/?[\w.@-]+\/)[^\s()]+|[\w.-]+:\d+(?::\d+)?/, alias: "string" },
			punctuation: /[()]/,
		},
	},
	"error-type": { pattern: /\b(?:[\w.]*Error|[\w.]*Exception)\b/, alias: "class-name" },
	...Prism.languages["json"],
	...Prism.languages["log"],
	property: Prism.languages["json"]!["property"]!,
};

const renderTokens = (tokens: (string | Prism.Token)[]): ReactNode =>
	tokens.map((token, index) =>
		typeof token === "string" ? (
			token
		) : (
			<span key={index} className={["token", token.type, ...[token.alias ?? []].flat()].join(" ")}>
				{typeof token.content === "string"
					? token.content
					: renderTokens(Array.isArray(token.content) ? token.content : [token.content])}
			</span>
		),
	);

export const CodeHighlight = memo(
	({ children, language }: { children: string; language: "yaml" | "json" | "stacktrace" | "log" }) => (
		<code className={`language-${language}`}>
			{renderTokens(
				Prism.tokenize(
					children,
					language === "stacktrace" || language === "log" ? diagnosticGrammar : Prism.languages[language]!,
				),
			)}
		</code>
	),
);
