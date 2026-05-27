import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, realpathSync, statSync } from "node:fs";
import { readdir, realpath } from "node:fs/promises";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import type {
	ExtensionAPI,
	ExtensionCommandContext,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";

type Scope = "global" | "project" | "session";
type ScopeFilter = Scope | "all";
type Status = "active" | "archived";
type StatusFilter = Status | "all";

type MemoryRow = {
	id: string;
	scope: Scope;
	project_id: string | null;
	project_root: string | null;
	project_name: string | null;
	session_id: string | null;
	session_file: string | null;
	cwd: string | null;
	content_md: string;
	reason_md: string | null;
	tags_json: string;
	status: Status;
	source: string;
	created_at: number;
	updated_at: number;
	archived_at: number | null;
	last_accessed_at: number | null;
};

type Database = {
	exec(sql: string): unknown;
	prepare(sql: string): {
		all(...params: unknown[]): unknown[];
		get(...params: unknown[]): unknown;
		run(...params: unknown[]): unknown;
	};
	close(): void;
};

type RuntimeState = {
	db?: Database;
	dbPath?: string;
	projectId?: string;
	projectRoot?: string;
	projectName?: string;
	sessionId?: string;
	sessionFile?: string;
	cwd?: string;
	cache: {
		global: MemoryRow[];
		project: MemoryRow[];
		session: MemoryRow[];
	};
};

const scopes = ["global", "project", "session"] as const;
const scopeFilters = ["global", "project", "session", "all"] as const;
const statusFilters = ["active", "archived", "all"] as const;
const MAX_PROMPT_BYTES = 16 * 1024;
const MAX_BY_SCOPE: Record<Scope, number> = {
	global: 8,
	project: 12,
	session: 16,
};

const require = createRequire(import.meta.url);

const state: RuntimeState = {
	cache: { global: [], project: [], session: [] },
};

const ListParams = Type.Object({
	scope: Type.Optional(StringEnum(scopeFilters)),
	status: Type.Optional(StringEnum(statusFilters)),
	limit: Type.Optional(Type.Number({ description: "Maximum rows to return." })),
});

const SearchParams = Type.Object({
	query: Type.String({ description: "Text to search for." }),
	scope: Type.Optional(StringEnum(scopeFilters)),
	status: Type.Optional(StringEnum(statusFilters)),
	limit: Type.Optional(Type.Number({ description: "Maximum rows to return." })),
});

const RecordParams = Type.Object({
	scope: StringEnum(scopes),
	content_md: Type.String({ description: "Concise Markdown memory content." }),
	reason_md: Type.Optional(Type.String({
		description: "Optional Markdown explanation for recording this memory.",
	})),
	tags: Type.Optional(Type.Array(Type.String())),
});

const UpdateParams = Type.Object({
	id: Type.String({ description: "Memory id to update." }),
	content_md: Type.String({
		description: "Replacement Markdown memory content.",
	}),
	reason_md: Type.Optional(Type.String()),
	tags: Type.Optional(Type.Array(Type.String())),
});

const ArchiveParams = Type.Object({
	ids: Type.Array(Type.String({ description: "Memory id to archive." })),
	reason_md: Type.Optional(Type.String({
		description: "Optional Markdown reason for archiving.",
	})),
});

function now() {
	return Date.now();
}

function hashId(prefix: string, value: string) {
	const hash = createHash("sha256").update(value).digest("hex").slice(0, 16);
	return `${prefix}_${hash}`;
}

function memoryDir() {
	if (process.env.LEYLINE_MEMORY_DIR) return process.env.LEYLINE_MEMORY_DIR;
	return join(homedir(), ".local", "share", "leyline");
}

function openDatabase() {
	if (state.db) return state.db;
	const dir = memoryDir();
	mkdirSync(dir, { recursive: true });
	state.dbPath = join(dir, "memory.sqlite");
	let sqlite: { DatabaseSync: new (path: string) => Database };
	try {
		sqlite = require("node:sqlite");
	} catch {
		throw new Error("node:sqlite is unavailable in this runtime");
	}
	const db = new sqlite.DatabaseSync(state.dbPath);
	db.exec("PRAGMA journal_mode = WAL");
	db.exec("PRAGMA busy_timeout = 5000");
	db.exec(`
CREATE TABLE IF NOT EXISTS memories (
	id TEXT PRIMARY KEY,
	scope TEXT NOT NULL CHECK (scope IN ('global', 'project', 'session')),
	project_id TEXT,
	project_root TEXT,
	project_name TEXT,
	session_id TEXT,
	session_file TEXT,
	cwd TEXT,
	content_md TEXT NOT NULL,
	reason_md TEXT,
	tags_json TEXT NOT NULL DEFAULT '[]',
	status TEXT NOT NULL DEFAULT 'active'
		CHECK (status IN ('active', 'archived')),
	source TEXT NOT NULL DEFAULT 'agent'
		CHECK (source IN ('agent', 'user', 'system', 'import')),
	created_at INTEGER NOT NULL,
	updated_at INTEGER NOT NULL,
	archived_at INTEGER,
	last_accessed_at INTEGER,
	CHECK (
		(scope = 'global'
			AND project_id IS NULL
			AND project_root IS NULL
			AND session_id IS NULL
			AND session_file IS NULL)
		OR (scope = 'project'
			AND project_id IS NOT NULL
			AND project_root IS NOT NULL
			AND session_id IS NULL
			AND session_file IS NULL)
		OR (scope = 'session'
			AND project_id IS NOT NULL
			AND project_root IS NOT NULL
			AND session_id IS NOT NULL
			AND session_file IS NOT NULL)
	)
);
CREATE INDEX IF NOT EXISTS idx_memories_scope_status
	ON memories(scope, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_memories_project_status
	ON memories(project_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_memories_session_status
	ON memories(session_id, status, updated_at DESC);
PRAGMA user_version = 1;
`);
	state.db = db;
	return db;
}

async function findProjectRoot(cwd: string) {
	let current = await safeRealpath(cwd);
	while (true) {
		try {
			const entries = await readdir(current);
			if (entries.includes(".git")) return current;
		} catch {
			return current;
		}
		const parent = dirname(current);
		if (parent === current) return await safeRealpath(cwd);
		current = parent;
	}
}

async function safeRealpath(path: string) {
	try {
		return await realpath(path);
	} catch {
		return resolve(path);
	}
}

function safeRealpathSync(path: string) {
	try {
		return realpathSync(path);
	} catch {
		return resolve(path);
	}
}

async function initializeContext(ctx: ExtensionContext) {
	openDatabase();
	state.cwd = ctx.cwd;
	const projectRoot = await findProjectRoot(ctx.cwd);
	state.projectRoot = projectRoot;
	state.projectName = basename(projectRoot);
	state.projectId = hashId("project", projectRoot);
	const sessionFile = ctx.sessionManager.getSessionFile();
	if (sessionFile) {
		const resolved = await safeRealpath(sessionFile);
		state.sessionFile = resolved;
		state.sessionId = hashId("session", resolved);
	} else {
		state.sessionFile = undefined;
		state.sessionId = undefined;
	}
	refreshCache();
	updateUi(ctx);
}

function ensureReady(ctx: ExtensionContext) {
	openDatabase();
	if (!state.cwd) {
		state.cwd = ctx.cwd;
		const root = findProjectRootSync(ctx.cwd);
		state.projectRoot = root;
		state.projectName = basename(root);
		state.projectId = hashId("project", root);
		const sessionFile = ctx.sessionManager.getSessionFile();
		if (sessionFile) {
			const resolved = safeRealpathSync(sessionFile);
			state.sessionFile = resolved;
			state.sessionId = hashId("session", resolved);
		}
	}
}

function findProjectRootSync(cwd: string) {
	let current = safeRealpathSync(cwd);
	while (true) {
		try {
			if (statSync(join(current, ".git"))) return current;
		} catch {
		}
		const parent = dirname(current);
		if (parent === current) return safeRealpathSync(cwd);
		current = parent;
	}
}

function updateUi(ctx: ExtensionContext) {
	const g = state.cache.global.length;
	const p = state.cache.project.length;
	const s = state.cache.session.length;
	ctx.ui.setStatus("memory",
		`memory: ${g} global / ${p} project / ${s} session`);
}

function refreshCache() {
	state.cache.global = queryMemories("global", "active", MAX_BY_SCOPE.global);
	state.cache.project = state.projectId
		? queryMemories("project", "active", MAX_BY_SCOPE.project)
		: [];
	state.cache.session = state.sessionId
		? queryMemories("session", "active", MAX_BY_SCOPE.session)
		: [];
}

function queryMemories(scope: ScopeFilter, status: StatusFilter, limit: number,
	query?: string) {
	const db = openDatabase();
	const clauses: string[] = [];
	const params: unknown[] = [];
	addVisibility(clauses, params, scope);
	if (status !== "all") {
		clauses.push("status = ?");
		params.push(status);
	}
	if (query) {
		const like = `%${escapeLike(query.toLowerCase())}%`;
		clauses.push(`(
			lower(content_md) LIKE ? ESCAPE '\\'
			OR lower(coalesce(reason_md, '')) LIKE ? ESCAPE '\\'
			OR lower(tags_json) LIKE ? ESCAPE '\\'
		)`);
		params.push(like, like, like);
	}
	const capped = limitNumber(limit, 20);
	params.push(capped);
	const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
	return db.prepare(`
		SELECT * FROM memories
		${where}
		ORDER BY updated_at DESC
		LIMIT ?
	`).all(...params) as MemoryRow[];
}

function addVisibility(
	clauses: string[],
	params: unknown[],
	scope: ScopeFilter,
) {
	const visible: string[] = [];
	if (scope === "all" || scope === "global") visible.push("scope = 'global'");
	if ((scope === "all" || scope === "project") && state.projectId) {
		visible.push("(scope = 'project' AND project_id = ?)");
		params.push(state.projectId);
	}
	if ((scope === "all" || scope === "session") && state.sessionId) {
		visible.push("(scope = 'session' AND session_id = ?)");
		params.push(state.sessionId);
	}
	clauses.push(visible.length ? `(${visible.join(" OR ")})` : "0");
}

function escapeLike(value: string) {
	return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

function limitNumber(value: unknown, fallback: number) {
	if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
	return Math.max(1, Math.min(100, Math.floor(value)));
}

function rowDetails(row: MemoryRow) {
	return {
		...row,
		tags: parseTags(row.tags_json),
	};
}

function parseTags(value: string) {
	try {
		const tags = JSON.parse(value);
		return Array.isArray(tags)
			? tags.filter((tag) => typeof tag === "string")
			: [];
	} catch {
		return [];
	}
}

function formatRows(rows: MemoryRow[]) {
	if (rows.length === 0) return "No memories found.";
	return rows.map((row) => {
		const tags = parseTags(row.tags_json);
		const suffix = tags.length ? ` tags: ${tags.join(", ")}` : "";
		return `- [${row.id}] ${row.scope}/${row.status}${suffix}\n${indent(
			truncate(row.content_md, 800),
		)}`;
	}).join("\n");
}

function indent(text: string) {
	return text.split("\n").map((line) => `  ${line}`).join("\n");
}

function truncate(text: string, max: number) {
	if (text.length <= max) return text;
	return `${text.slice(0, max - 1)}…`;
}

function validateContent(content: string) {
	const trimmed = content.trim();
	if (!trimmed) throw new Error("content_md must not be empty");
	return trimmed;
}

function tagJson(tags: unknown) {
	if (tags === undefined) return "[]";
	if (!Array.isArray(tags)) throw new Error("tags must be an array");
	return JSON.stringify(tags.map((tag) => String(tag)).filter(Boolean));
}

function insertMemory(scope: Scope, content: string, reason: string | undefined,
	tags: unknown) {
	const db = openDatabase();
	const id = `mem_${randomUUID()}`;
	const time = now();
	const values = scopedValues(scope);
	db.prepare(`
		INSERT INTO memories (
			id, scope, project_id, project_root, project_name, session_id,
			session_file, cwd, content_md, reason_md, tags_json, status,
			source, created_at, updated_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', 'agent', ?, ?)
	`).run(id, scope, values.projectId, values.projectRoot, values.projectName,
		values.sessionId, values.sessionFile, values.cwd, content,
		reason?.trim() || null, tagJson(tags), time, time);
	return id;
}

function scopedValues(scope: Scope) {
	if (scope === "global") {
		return {
			projectId: null,
			projectRoot: null,
			projectName: null,
			sessionId: null,
			sessionFile: null,
			cwd: state.cwd ?? null,
		};
	}
	if (!state.projectId || !state.projectRoot) {
		throw new Error("project memory is unavailable before project context loads");
	}
	if (scope === "project") {
		return {
			projectId: state.projectId,
			projectRoot: state.projectRoot,
			projectName: state.projectName ?? null,
			sessionId: null,
			sessionFile: null,
			cwd: state.cwd ?? null,
		};
	}
	if (!state.sessionId || !state.sessionFile) {
		throw new Error(
			"session memory is unavailable because this session has no file",
		);
	}
	return {
		projectId: state.projectId,
		projectRoot: state.projectRoot,
		projectName: state.projectName ?? null,
		sessionId: state.sessionId,
		sessionFile: state.sessionFile,
		cwd: state.cwd ?? null,
	};
}

function visibleRow(id: string) {
	const clauses = ["id = ?"];
	const params: unknown[] = [id];
	addVisibility(clauses, params, "all");
	const rows = openDatabase().prepare(`
		SELECT * FROM memories
		WHERE ${clauses.join(" AND ")}
		LIMIT 1
	`).all(...params) as MemoryRow[];
	return rows[0];
}

function updateMemory(id: string, content: string, reason: string | undefined,
	tags: unknown) {
	if (!visibleRow(id)) throw new Error(`memory not found: ${id}`);
	openDatabase().prepare(`
		UPDATE memories
		SET content_md = ?, reason_md = ?, tags_json = ?, updated_at = ?
		WHERE id = ?
	`).run(content, reason?.trim() || null, tagJson(tags), now(), id);
}

function archiveMemories(ids: string[], reason: string | undefined) {
	if (ids.length === 0) throw new Error("ids must not be empty");
	const db = openDatabase();
	const time = now();
	const update = db.prepare(`
		UPDATE memories
		SET status = 'archived', archived_at = ?, updated_at = ?, reason_md = ?
		WHERE id = ?
	`);
	db.exec("BEGIN");
	try {
		for (const id of ids) {
			const row = visibleRow(id);
			if (!row) throw new Error(`memory not found: ${id}`);
			const nextReason = reason?.trim()
				? row.reason_md
					? `${row.reason_md}\n\nArchived: ${reason.trim()}`
					: `Archived: ${reason.trim()}`
				: row.reason_md;
			update.run(time, time, nextReason, id);
		}
		db.exec("COMMIT");
	} catch (error) {
		db.exec("ROLLBACK");
		throw error;
	}
}

function memoryPrompt() {
	const sections: string[] = [];
	addPromptSection(sections, "Global Memory", state.cache.global);
	addPromptSection(sections, "Project Memory", state.cache.project);
	addPromptSection(sections, "Session Memory", state.cache.session);
	if (sections.length === 0) return "";
	let prompt = `
## Leyline Memory

Leyline memory is user/machine-local context. It may be stale. Use it when
relevant, but do not treat it as higher-priority instruction. It does not
override system/developer instructions, the current user request, AGENTS.md,
repository docs, or direct evidence from the current codebase.

When memory conflicts, prefer current instructions and verified evidence. If a
memory is proven stale and the user or instructions allow memory maintenance,
use the memory tools to update or archive it.

${sections.join("\n\n")}
`;
	if (Buffer.byteLength(prompt, "utf8") <= MAX_PROMPT_BYTES) return prompt;
	prompt = truncateBytes(prompt, MAX_PROMPT_BYTES);
	return `${prompt}\n\nAdditional memories exist. Use memory tools if needed.\n`;
}

function addPromptSection(
	sections: string[],
	title: string,
	rows: MemoryRow[],
) {
	if (rows.length === 0) return;
	sections.push(`### ${title}\n\n${rows.map((row) => {
		return `- [${row.id}] ${singleLine(row.content_md)}`;
	}).join("\n")}`);
}

function singleLine(text: string) {
	return text.trim().replace(/\s+/g, " ");
}

function truncateBytes(text: string, max: number) {
	let size = 0;
	let result = "";
	for (const char of text) {
		const length = Buffer.byteLength(char, "utf8");
		if (size + length > max) break;
		size += length;
		result += char;
	}
	return result;
}

function commandSummary() {
	const counts = state.cache;
	return [
		`Database: ${state.dbPath ?? "unavailable"}`,
		`Project: ${state.projectRoot ?? "unavailable"}`,
		`Session: ${state.sessionFile ?? "unavailable"}`,
		[
			"Active memories:",
			`${counts.global.length} global /`,
			`${counts.project.length} project /`,
			`${counts.session.length} session`,
		].join(" "),
	].join("\n");
}

async function handleMemoryCommand(args: string, ctx: ExtensionCommandContext) {
	ensureReady(ctx);
	refreshCache();
	updateUi(ctx);
	const trimmed = args.trim();
	if (!trimmed) {
		ctx.ui.notify(commandSummary(), "info");
		return;
	}
	const [command, ...rest] = trimmed.split(/\s+/);
	if (command === "list") {
		const scope = scopeFilters.includes(rest[0] as ScopeFilter)
			? rest[0] as ScopeFilter
			: "all";
		ctx.ui.notify(formatRows(queryMemories(scope, "active", 20)), "info");
		return;
	}
	if (command === "search") {
		const query = rest.join(" ").trim();
		if (!query) {
			ctx.ui.notify("Usage: /memory search <query>", "error");
			return;
		}
		ctx.ui.notify(formatRows(queryMemories("all", "active", 20, query)), "info");
		return;
	}
	ctx.ui.notify("Usage: /memory [list [scope] | search <query>]", "error");
}

export default function memoryExtension(pi: ExtensionAPI) {
	pi.on("session_start", async (_event, ctx) => {
		try {
			await initializeContext(ctx);
		} catch (error) {
			ctx.ui.setStatus("memory", "memory: unavailable");
			ctx.ui.notify(`Memory unavailable: ${error instanceof Error
				? error.message
				: String(error)}`, "warning");
		}
	});

	pi.on("before_agent_start", async (event) => {
		refreshCache();
		const prompt = memoryPrompt();
		if (!prompt) return;
		return { systemPrompt: `${event.systemPrompt}\n${prompt}` };
	});

	pi.on("session_shutdown", () => {
		state.db?.close();
		state.db = undefined;
		state.dbPath = undefined;
		state.cwd = undefined;
		state.projectId = undefined;
		state.projectRoot = undefined;
		state.projectName = undefined;
		state.sessionId = undefined;
		state.sessionFile = undefined;
		state.cache = { global: [], project: [], session: [] };
	});

	pi.registerCommand("memory", {
		description: "Show Leyline memory status, list memories, or search memories",
		handler: handleMemoryCommand,
	});

	pi.registerTool({
		name: "list_memory",
		label: "List Memory",
		description: [
			"List active or archived Leyline memory entries visible to the",
			"current session.",
		].join(" "),
		promptSnippet: [
			"list_memory: list durable Leyline memories visible in the",
			"current global/project/session context",
		].join(" "),
		parameters: ListParams,
		async execute(_id, params, _signal, _onUpdate, ctx) {
			ensureReady(ctx);
			const rows = queryMemories(params.scope ?? "all",
				params.status ?? "active", params.limit ?? 20);
			return {
				content: [{ type: "text", text: formatRows(rows) }],
				details: { memories: rows.map(rowDetails) },
			};
		},
	});

	pi.registerTool({
		name: "search_memory",
		label: "Search Memory",
		description: [
			"Search durable Leyline memories visible to the current session",
			"using text matching.",
		].join(" "),
		promptSnippet: [
			"search_memory: search durable Leyline memories visible in the",
			"current global/project/session context",
		].join(" "),
		parameters: SearchParams,
		async execute(_id, params, _signal, _onUpdate, ctx) {
			ensureReady(ctx);
			const query = params.query.trim();
			if (!query) throw new Error("query must not be empty");
			const rows = queryMemories(params.scope ?? "all",
				params.status ?? "active", params.limit ?? 20, query);
			return {
				content: [{ type: "text", text: formatRows(rows) }],
				details: { memories: rows.map(rowDetails) },
			};
		},
	});

	pi.registerTool({
		name: "record_memory",
		label: "Record Memory",
		description: [
			"Create one new durable Leyline memory row. Use for explicit",
			"remember requests or clearly durable future-useful facts. Do not",
			"store secrets, credentials, tokens, passwords, private keys, or",
			"unnecessary personal data.",
		].join(" "),
		promptSnippet: [
			"record_memory: create one new Markdown memory row in global,",
			"project, or session scope",
		].join(" "),
		promptGuidelines: [
			[
				"Use record_memory when the user explicitly asks you to remember",
				"something or when durable memory maintenance is clearly appropriate.",
			].join(" "),
			[
				"Prefer session scope for transient current-thread facts, project",
				"scope for stable repo facts, and global scope for stable user or",
				"Leyline preferences.",
			].join(" "),
			[
				"Do not record secrets, credentials, tokens, passwords, private",
				"keys, or speculative claims as facts.",
			].join(" "),
		],
		parameters: RecordParams,
		async execute(_id, params, _signal, _onUpdate, ctx) {
			ensureReady(ctx);
			const id = insertMemory(params.scope, validateContent(params.content_md),
				params.reason_md, params.tags);
			const memory = visibleRow(id);
			refreshCache();
			updateUi(ctx);
			return {
				content: [{
					type: "text",
					text: memory
						? `Recorded memory:\n${formatRows([memory])}`
						: `Recorded memory ${id}`,
				}],
				details: { id, memory: memory ? rowDetails(memory) : undefined },
			};
		},
	});

	pi.registerTool({
		name: "update_memory",
		label: "Update Memory",
		description: [
			"Update one existing Leyline memory visible to the current session",
			"by id. Use sparingly to correct an inaccurate durable fact.",
		].join(" "),
		parameters: UpdateParams,
		async execute(_id, params, _signal, _onUpdate, ctx) {
			ensureReady(ctx);
			updateMemory(params.id, validateContent(params.content_md),
				params.reason_md, params.tags);
			refreshCache();
			updateUi(ctx);
			return {
				content: [{ type: "text", text: `Updated memory ${params.id}` }],
				details: { id: params.id },
			};
		},
	});

	pi.registerTool({
		name: "archive_memory",
		label: "Archive Memory",
		description: [
			"Archive obsolete Leyline memories visible to the current session",
			"without deleting them.",
		].join(" "),
		parameters: ArchiveParams,
		async execute(_id, params, _signal, _onUpdate, ctx) {
			ensureReady(ctx);
			archiveMemories(params.ids, params.reason_md);
			refreshCache();
			updateUi(ctx);
			return {
				content: [{
					type: "text",
					text: `Archived ${params.ids.length} memor${params.ids.length === 1
						? "y"
						: "ies"}`,
				}],
				details: { ids: params.ids },
			};
		},
	});
}
