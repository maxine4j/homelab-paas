import {
	agentThreadsSchema,
	agentViewSchema,
	type AgentRequest,
	type AgentReply,
	type AgentThread,
	type AgentView,
} from "@homelab-paas/forge-contracts/agents";
import { useEffect, useId, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router";

import { ResourcePoller } from "../api/resource-poller.ts";
import type { IWorkspaceApi } from "../api/workspace-api.ts";
import { resolveRoute } from "../navigation/routes.ts";

const RequestCard = ({
	request,
	busy,
	reply,
}: {
	request: AgentRequest;
	busy: boolean;
	reply: (input: AgentReply) => void;
}) => {
	const [answers, setAnswers] = useState<Record<string, string>>({});
	const formId = useId();
	return (
		<form
			className='agent-request'
			onSubmit={(event) => {
				event.preventDefault();
				reply({ requestId: request.id, answers });
			}}
		>
			<h4>
				{request.kind === "input"
					? "Input requested"
					: request.kind === "file"
						? "File change approval"
						: "Command approval"}
			</h4>
			<pre>{request.description}</pre>
			{request.questions.map((question, index) => (
				<div key={question.id} className='agent-question'>
					<label htmlFor={`${formId}-${index}`}>{question.question}</label>
					{question.secret ? (
						<input
							id={`${formId}-${index}`}
							type='password'
							required
							maxLength={4000}
							value={answers[question.id] ?? ""}
							onChange={(event) => setAnswers({ ...answers, [question.id]: event.target.value })}
							disabled={busy}
						/>
					) : (
						<textarea
							id={`${formId}-${index}`}
							required
							maxLength={4000}
							value={answers[question.id] ?? ""}
							onChange={(event) => setAnswers({ ...answers, [question.id]: event.target.value })}
							disabled={busy}
							rows={2}
						/>
					)}
					{!question.secret && (
						<div className='agent-actions'>
							{question.options.map((option) => (
								<button
									key={option}
									type='button'
									disabled={busy}
									onClick={() => setAnswers({ ...answers, [question.id]: option })}
								>
									{option}
								</button>
							))}
						</div>
					)}
				</div>
			))}
			<div className='agent-actions'>
				{request.kind === "input" ? (
					<button disabled={busy || request.questions.some((question) => !answers[question.id]?.trim())}>
						Submit answers
					</button>
				) : (
					<>
						<button
							type='button'
							disabled={busy}
							onClick={() => reply({ requestId: request.id, decision: "accept" })}
						>
							Allow once
						</button>
						<button
							type='button'
							disabled={busy}
							onClick={() => reply({ requestId: request.id, decision: "decline" })}
						>
							Decline
						</button>
					</>
				)}
			</div>
		</form>
	);
};

const Conversation = ({
	id,
	api,
	changed,
	selected,
}: {
	id: string;
	api: IWorkspaceApi;
	changed: () => void;
	selected: boolean;
}) => {
	const [view, setView] = useState<AgentView>();
	const [draft, setDraft] = useState("");
	const [error, setError] = useState("");
	const [busy, setBusy] = useState(false);
	const [connected, setConnected] = useState(false);
	const poller = useRef<ResourcePoller<AgentView> | undefined>(undefined);
	const acting = useRef(false);
	const [loadingHistory, setLoadingHistory] = useState(true);
	const [historyFailed, setHistoryFailed] = useState(false);
	const historyNeeded = useRef(true);
	const recoveryBlocked = useRef(false);
	const selection = useRef(selected);
	const messageId = useId();
	useEffect(() => {
		const resource = new ResourcePoller(
			async (signal) => {
				if (selection.current && historyNeeded.current) setLoadingHistory(true);
				const value = await api.read(`agents/${id}`, agentViewSchema);
				if (signal.aborted) return value;
				if (!selection.current || recoveryBlocked.current) return value;
				const status = value.thread.status;
				const recover = historyNeeded.current || status === "uncertain";
				historyNeeded.current = false;
				if (!recover || ["idle", "creating", "running", "waiting"].includes(status)) return value;
				setLoadingHistory(true);
				try {
					const recovered = await api.read(`agents/${id}/resume`, agentViewSchema, "POST", {});
					if (recovered.thread.status === "uncertain") throw new Error("History recovery incomplete");
					if (!signal.aborted) {
						historyNeeded.current = false;
						setHistoryFailed(false);
						setError("");
					}
					return recovered;
				} catch {
					recoveryBlocked.current = true;
					if (!signal.aborted) {
						setHistoryFailed(true);
						setError(
							"Could not load chat history. Retry loading history, or create a new chat if recovery keeps failing. This chat’s work is retained.",
						);
					}
					return value;
				}
			},
			(value) => {
				setView(value);
				setLoadingHistory(false);
				changed();
			},
			(message) => {
				setLoadingHistory(false);
				setError(message);
			},
		);
		poller.current = resource;
		resource.refresh();
		const events = new EventSource(`/api/agents/${id}/events`);
		events.onopen = () => {
			setConnected(true);
			resource.refresh();
		};
		events.onmessage = () => resource.refresh();
		events.onerror = () => {
			setConnected(false);
			resource.refresh();
		};
		return () => {
			resource.stop();
			events.close();
			poller.current = undefined;
		};
	}, [api, id, changed]);
	useEffect(() => {
		selection.current = selected;
		if (!selected) return;
		historyNeeded.current = true;
		recoveryBlocked.current = false;
		poller.current?.refresh();
	}, [selected]);
	const act = (suffix: string, body: unknown, sent = false) => {
		if (acting.current || !poller.current) return;
		acting.current = true;
		setBusy(true);
		setError("");
		void poller.current
			.mutate(async () => {
				try {
					const value = await api.read(`agents/${id}/${suffix}`, agentViewSchema, "POST", body);
					if (sent) setDraft("");
					return value;
				} finally {
					// Refresh may reload history, but never replays messages or approval replies.
					poller.current?.refresh();
				}
			})
			.finally(() => {
				acting.current = false;
				setBusy(false);
			});
	};
	const status = view?.thread.status;
	const active = status === "running" || status === "waiting";
	const sendable =
		status
		&& !loadingHistory
		&& !historyFailed
		&& !["creating", "running", "waiting", "uncertain"].includes(status);
	const displayStatus = status === "uncertain" ? (historyFailed ? "unavailable" : "loading") : status;
	return (
		<section className='agent-conversation' aria-label='Chat conversation'>
			<div className='agent-chat-heading'>
				<div>
					<span className={`agent-status agent-status-${displayStatus}`}>{displayStatus ?? "loading"}</span>
				</div>
				<div className='agent-actions'>
					{historyFailed && (
						<button
							disabled={busy || loadingHistory}
							onClick={() => {
								recoveryBlocked.current = false;
								historyNeeded.current = true;
								setLoadingHistory(true);
								setError("");
								poller.current?.refresh();
							}}
						>
							Retry loading history
						</button>
					)}
					{active && (
						<button disabled={busy || !view?.thread.turnId} onClick={() => act("interrupt", {})}>
							Interrupt
						</button>
					)}
				</div>
			</div>
			{!connected && (
				<p className='agent-notice' role='status'>
					Reconnecting to live updates…
				</p>
			)}
			{error && (
				<p className='error' role='alert'>
					{error}
				</p>
			)}
			{loadingHistory && (
				<p className='agent-notice' role='status'>
					Loading history…
				</p>
			)}
			{view?.truncated && <p className='agent-notice'>Some history or output was omitted.</p>}
			<div className='agent-messages' tabIndex={0} aria-label='Conversation history'>
				{view && !loadingHistory && !historyFailed && status !== "uncertain" && !view.items.length && (
					<p className='agent-empty'>
						Start a conversation about this project. Each chat works in its own managed worktree.
					</p>
				)}
				{view?.items.map((item) =>
					item.role === "activity" ? (
						<details key={item.id} className='agent-activity' open>
							<summary>Tool activity</summary>
							<pre>{item.text}</pre>
						</details>
					) : (
						<article key={item.id} className={`agent-message agent-message-${item.role}`}>
							<h4>{item.role === "user" ? "You" : "Codex"}</h4>
							<div>{item.text}</div>
						</article>
					),
				)}
				{active && (
					<p className='agent-notice' role='status'>
						{status === "waiting" ? "Waiting for your response" : "Codex is working…"}
					</p>
				)}
				{view?.requests.map((request) => (
					<RequestCard
						key={request.id}
						request={request}
						busy={busy}
						reply={(input) => act("replies", input)}
					/>
				))}
			</div>
			<form
				className='agent-composer'
				onSubmit={(event) => {
					event.preventDefault();
					if (sendable && draft.trim()) act("messages", { text: draft }, true);
				}}
			>
				<label htmlFor={messageId}>Message</label>
				<textarea
					id={messageId}
					rows={3}
					maxLength={8000}
					placeholder='Ask Codex to work on this project…'
					value={draft}
					disabled={busy}
					onChange={(event) => setDraft(event.target.value)}
				/>
				<div className='agent-composer-footer'>
					<span>{draft.length}/8000 · Draft kept in this open chat</span>
					<button disabled={busy || !sendable || !draft.trim()}>Send message</button>
				</div>
			</form>
		</section>
	);
};

export const AgentChat = ({ projectId, api }: { projectId: string; api: IWorkspaceApi }) => {
	const location = useLocation();
	const navigate = useNavigate();
	const route = resolveRoute(location.pathname);
	const selectFirst = route.page === "project" && route.section === "agents" && !route.threadId;
	const [threads, setThreads] = useState<AgentThread[]>([]);
	const [loaded, setLoaded] = useState(false);
	const [opened, setOpened] = useState<string[]>([]);
	const [retained, setRetained] = useState("");
	const selected = route.page === "project" && route.section === "agents" ? (route.threadId ?? "") : retained;
	if (retained !== selected) setRetained(selected);
	if (selected && !opened.includes(selected)) setOpened([...opened, selected]);
	const [error, setError] = useState("");
	const [creating, setCreating] = useState(false);
	const acting = useRef(false);
	const poller = useRef<ResourcePoller<AgentThread[]> | undefined>(undefined);
	const [refresh] = useState(() => () => poller.current?.refresh());
	useEffect(() => {
		const resource = new ResourcePoller(
			() => api.read(`projects/${projectId}/agents`, agentThreadsSchema),
			(values) => {
				setThreads(values);
				setLoaded(true);
				setError("");
			},
			setError,
		);
		poller.current = resource;
		resource.refresh();
		return () => {
			resource.stop();
			poller.current = undefined;
		};
	}, [api, projectId]);
	const firstId = threads.at(0)?.id;
	useEffect(() => {
		if (selectFirst && firstId) {
			void navigate(`/projects/${projectId}/agents/${firstId}`, { replace: true });
		}
	}, [selectFirst, firstId, projectId, navigate]);
	const open = (id: string) => {
		void navigate(`/projects/${projectId}/agents/${id}`);
	};
	return (
		<div className='agent-panel'>
			<aside className='agent-sidebar' aria-label='Chats'>
				<button
					disabled={creating}
					onClick={() => {
						if (acting.current) return;
						acting.current = true;
						setCreating(true);
						setError("");
						void api
							.read(`projects/${projectId}/agents`, agentViewSchema, "POST", {
								title: `Chat ${threads.length + 1}`,
							})
							.then((view) => {
								setThreads((values) => [...values, view.thread]);
								open(view.thread.id);
								refresh();
							})
							.catch((cause: unknown) =>
								setError(cause instanceof Error ? cause.message : "Could not create chat."),
							)
							.finally(() => {
								acting.current = false;
								setCreating(false);
							});
					}}
				>
					{creating ? "Creating…" : "Create chat"}
				</button>
				{error && (
					<p className='error' role='alert'>
						{error}
					</p>
				)}
				<nav aria-label='Chat threads'>
					{threads.map((thread) => (
						<button
							key={thread.id}
							aria-label={`Open chat ${thread.title}`}
							aria-current={selected === thread.id ? "true" : undefined}
							onClick={() => open(thread.id)}
						>
							<span>{thread.title}</span>
							{thread.status !== "uncertain" && (
								<small className={`agent-status agent-status-${thread.status}`}>{thread.status}</small>
							)}
						</button>
					))}
				</nav>
				{!threads.length && <p className='agent-notice'>No chats yet.</p>}
			</aside>
			<div className='agent-main'>
				{selected && !threads.some((thread) => thread.id === selected) && (
					<div className='agent-welcome'>
						<h3>{loaded || error ? "Chat unavailable" : "Loading chat…"}</h3>
						<p>Select another chat or create a new one.</p>
					</div>
				)}
				{!selected && (
					<div className='agent-welcome'>
						<h3>Work with Codex</h3>
						<p>Create or open a chat to get started.</p>
						<p>Chats keep working while you browse other project sections.</p>
					</div>
				)}
				{opened
					.filter((id) => threads.some((thread) => thread.id === id))
					.map((id) => (
						<div key={id} hidden={selected !== id}>
							<Conversation
								id={id}
								api={api}
								changed={refresh}
								selected={selected === id && route.page === "project" && route.section === "agents"}
							/>
						</div>
					))}
			</div>
		</div>
	);
};
