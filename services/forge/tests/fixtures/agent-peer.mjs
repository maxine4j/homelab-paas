import { createInterface } from "node:readline";

const threads = new Map();
let sequence = 0;
const write = (value) => process.stdout.write(JSON.stringify(value) + "\n");
const notify = (method, params) => write({ method, params });
createInterface({ input: process.stdin }).on("line", (line) => {
	const message = JSON.parse(line);
	if (!message.method) return;
	const { id, method, params } = message;
	if (method === "initialized") return;
	let result = {};
	if (method === "initialize")
		result = {
			userAgent: "controlled-peer",
			codexHome: process.env.CODEX_HOME,
			platformFamily: "unix",
			platformOs: "linux",
		};
	if (method === "thread/start") {
		if (
			params.sandbox !== "danger-full-access"
			|| params.approvalPolicy !== "on-request"
			|| !params.cwd.includes("/worktrees/")
		)
			throw new Error("Unexpected runtime policy");
		const thread = {
			id: `codex-${++sequence}`,
			cwd: params.cwd,
			historyMode: "paginated",
			status: { type: "idle" },
			turns: [],
		};
		threads.set(thread.id, thread);
		result = { thread };
	}
	if (method === "thread/resume" || method === "thread/read") result = { thread: threads.get(params.threadId) };
	if (method === "thread/turns/list")
		result = { data: [...threads.get(params.threadId).turns].reverse(), nextCursor: null };
	if (method === "turn/start") {
		const thread = threads.get(params.threadId);
		const turn = {
			id: `turn-${++sequence}`,
			status: "inProgress",
			items: [{ id: `user-${sequence}`, type: "userMessage", content: params.input }],
		};
		thread.turns.push(turn);
		notify("turn/started", { threadId: thread.id, turn });
		notify("item/agentMessage/delta", {
			threadId: thread.id,
			turnId: turn.id,
			itemId: `answer-${sequence}`,
			delta: "Working",
		});
		result = { turn };
	}
	if (method === "turn/interrupt") {
		const thread = threads.get(params.threadId);
		const turn = thread.turns.at(-1);
		turn.status = "interrupted";
		notify("turn/completed", { threadId: thread.id, turn });
	}
	write({ id, result });
});
