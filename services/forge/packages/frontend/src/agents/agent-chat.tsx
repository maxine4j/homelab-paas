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

const Conversation = ({ id, api, changed }: { id: string; api: IWorkspaceApi; changed: () => void }) => {
	const [view, setView] = useState<AgentView>();
	const [draft, setDraft] = useState("");
	const [error, setError] = useState("");
	const [busy, setBusy] = useState(false);
	const [connected, setConnected] = useState(false);
	const poller = useRef<ResourcePoller<AgentView> | undefined>(undefined);
	const acting = useRef(false);
	const messageId = useId();
	useEffect(() => {
		const resource = new ResourcePoller(
			() => api.read(`agents/${id}`, agentViewSchema),
			(value) => {
				setView(value);
				changed();
			},
			setError,
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
					// Reconcile failures using reads only; mutations are never retried automatically.
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
	const sendable = status && !["creating", "running", "waiting", "uncertain"].includes(status);
	return (
		<section className='agent-conversation' aria-label='Chat conversation'>
			<div className='agent-chat-heading'>
				<div>
					<h3>{view?.thread.title ?? "Loading chat…"}</h3>
					<span className={`agent-status agent-status-${status}`}>{status ?? "loading"}</span>
				</div>
				<div className='agent-actions'>
					<button disabled={busy || !view || active} onClick={() => act("resume", {})}>
						Resume and load history
					</button>
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
			{status === "uncertain" && (
				<p className='agent-notice'>
					Execution state is uncertain. Resume and load history before sending. No message or approval will be
					replayed. If recovery fails, create a new chat; this chat’s work is retained.
				</p>
			)}
			{view?.truncated && <p className='agent-notice'>Some history or output was omitted.</p>}
			<div className='agent-messages' tabIndex={0} aria-label='Conversation history'>
				{view && !view.items.length && (
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
			</div>
			{view?.requests.map((request) => (
				<RequestCard key={request.id} request={request} busy={busy} reply={(input) => act("replies", input)} />
			))}
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
	const [threads, setThreads] = useState<AgentThread[]>([]);
	const [loaded, setLoaded] = useState(false);
	const [opened, setOpened] = useState<string[]>([]);
	const [retained, setRetained] = useState("");
	const selected = route.page === "project" && route.section === "agents" ? (route.threadId ?? "") : retained;
	if (retained !== selected) setRetained(selected);
	if (selected && !opened.includes(selected)) setOpened([...opened, selected]);
	const [title, setTitle] = useState("");
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
	const open = (id: string) => {
		void navigate(`/projects/${projectId}/agents/${id}`);
	};
	return (
		<div className='agent-panel'>
			<aside className='agent-sidebar' aria-label='Chats'>
				<h2>Agents</h2>
				<p>Independent chats for this project</p>
				<form
					onSubmit={(event) => {
						event.preventDefault();
						if (acting.current || !title.trim()) return;
						acting.current = true;
						setCreating(true);
						setError("");
						void api
							.read(`projects/${projectId}/agents`, agentViewSchema, "POST", { title })
							.then((view) => {
								setThreads((values) => [...values, view.thread]);
								open(view.thread.id);
								setTitle("");
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
					<label>
						Chat title
						<input
							maxLength={120}
							required
							value={title}
							disabled={creating}
							placeholder='A new conversation'
							onChange={(event) => setTitle(event.target.value)}
						/>
					</label>
					<button disabled={creating || !title.trim()}>{creating ? "Creating…" : "Create chat"}</button>
				</form>
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
							<small className={`agent-status agent-status-${thread.status}`}>{thread.status}</small>
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
							<Conversation id={id} api={api} changed={refresh} />
						</div>
					))}
			</div>
		</div>
	);
};
