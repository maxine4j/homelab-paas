import type { CommitDiffFile, CommitDiffLine } from "@homelab-paas/forge-contracts";
import { Fragment, useState } from "react";

const sign = (line?: CommitDiffLine): string =>
	line?.kind === "addition" ? "+" : line?.kind === "deletion" ? "−" : line?.kind === "no-newline" ? "\\" : " ";

const SplitLines = ({ lines }: { lines: CommitDiffLine[] }) => {
	const rows: { old?: CommitDiffLine; next?: CommitDiffLine }[] = [];
	for (let index = 0; index < lines.length;) {
		const line = lines.at(index)!;
		if (line.kind === "context" || line.kind === "no-newline") {
			rows.push({ old: line, next: line });
			index++;
			continue;
		}
		const old: CommitDiffLine[] = [];
		const next: CommitDiffLine[] = [];
		let side = old;
		while (index < lines.length && lines.at(index)?.kind !== "context") {
			const changed = lines.at(index++)!;
			if (changed.kind === "addition") side = next;
			if (changed.kind === "deletion") side = old;
			side.push(changed);
		}
		for (let row = 0; row < Math.max(old.length, next.length); row++)
			rows.push({ old: old.at(row), next: next.at(row) });
	}
	return rows.map((row, index) => (
		<tr key={index}>
			<td className={`line-number ${row.old?.kind ?? ""}`}>{row.old?.oldLine}</td>
			<td className={`diff-text ${row.old?.kind ?? ""}`}>
				<span aria-hidden='true'>{sign(row.old)}</span>
				{row.old?.text}
			</td>
			<td className={`line-number ${row.next?.kind ?? ""}`}>{row.next?.newLine}</td>
			<td className={`diff-text ${row.next?.kind ?? ""}`}>
				<span aria-hidden='true'>{sign(row.next)}</span>
				{row.next?.text}
			</td>
		</tr>
	));
};

export const CommitDiff = ({ file, id, mode }: { file: CommitDiffFile; id: string; mode: "unified" | "split" }) => {
	const [collapsed, setCollapsed] = useState(false);
	const name = file.status === "deleted" ? file.oldPath : file.newPath;
	return (
		<section className='commit-file' id={id} aria-label={`Changes to ${name}`}>
			<header>
				<button
					aria-label={`${collapsed ? "Expand" : "Collapse"} ${name}`}
					aria-expanded={!collapsed}
					aria-controls={`${id}-content`}
					onClick={() => setCollapsed(!collapsed)}
				>
					{collapsed ? "▸" : "▾"}
				</button>
				<strong>{file.status === "renamed" ? `${file.oldPath} → ${file.newPath}` : name}</strong>
				<span>{file.status}</span>
				<span className='diff-stat'>
					{file.additions === undefined ? "Counts unavailable" : `+${file.additions} −${file.deletions}`}
				</span>
			</header>
			<div id={`${id}-content`} hidden={collapsed}>
				{file.oldMode !== file.newMode && (
					<p className='diff-note'>
						Mode {file.oldMode} → {file.newMode}
					</p>
				)}
				{file.binary && <p className='diff-note'>Binary or non-UTF-8 content. Diff unavailable.</p>}
				{file.unsupported && (
					<p className='diff-note'>
						Unsupported path or file type (symlink or submodule). Content is not displayed.
					</p>
				)}
				{file.truncated && <p className='notice diff-note'>Diff limit reached. Some content is omitted.</p>}
				{!file.binary && !file.unsupported && !file.truncated && file.hunks.length === 0 && (
					<p className='diff-note'>No text changes.</p>
				)}
				{file.hunks.length > 0 && (
					<div className='diff-scroll' tabIndex={0} role='region' aria-label={`Diff for ${name}`}>
						<table
							className={`commit-diff ${mode}`}
							aria-label={`${mode === "split" ? "Split" : "Unified"} diff for ${name}`}
						>
							<thead>
								<tr>
									{mode === "split" ? (
										<>
											<th scope='col'>Old line</th>
											<th scope='col'>Before</th>
											<th scope='col'>New line</th>
											<th scope='col'>After</th>
										</>
									) : (
										<>
											<th scope='col'>Old</th>
											<th scope='col'>New</th>
											<th scope='col'>+/−</th>
											<th scope='col'>Code</th>
										</>
									)}
								</tr>
							</thead>
							<tbody>
								{file.hunks.map((hunk, index) => (
									<Fragment key={index}>
										<tr className='diff-hunk'>
											<td colSpan={4}>
												@@ −{hunk.oldStart},{hunk.oldCount} +{hunk.newStart},{hunk.newCount} @@
											</td>
										</tr>
										{mode === "split" ? (
											<SplitLines lines={hunk.lines} />
										) : (
											hunk.lines.map((line, row) => (
												<tr key={row} className={line.kind}>
													<td className='line-number'>{line.oldLine}</td>
													<td className='line-number'>{line.newLine}</td>
													<td aria-hidden='true'>{sign(line)}</td>
													<td className='diff-text'>{line.text}</td>
												</tr>
											))
										)}
									</Fragment>
								))}
							</tbody>
						</table>
					</div>
				)}
			</div>
		</section>
	);
};
