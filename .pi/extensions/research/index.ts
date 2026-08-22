import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import {
  RESEARCH_CUSTOM_TYPE,
  RESEARCH_VERSION,
  applyResearchEvent,
  canonicalResearchSourceKey,
  researchStateFromEntries,
} from "../../../lib/research-state.js";
import { auditResearchReportCitations } from "../../../lib/research-citations.js";

type ResearchState = ReturnType<typeof researchStateFromEntries>;

type ResearchSource = {
  id?: number;
  url?: string;
  path?: string;
  title?: string;
  publisher?: string;
  publishedAt?: string;
  kind?: string;
  status?: "candidate" | "cited" | "excluded";
  threadId?: string;
  threadIds?: string[];
  claim?: string;
  evidence?: string;
  exclusionReason?: string;
};

const RESEARCH_LEAD_PROMPT = `You are the lead researcher for a Leyline deep research session.

Run the research automatically. Do not wait for plan approval unless the user asks you to pause.

Use this protocol:
1. Turn the objective into 2 to 5 independent research threads. Scale the number of threads to the question.
2. State the short plan for the user, then call research_update with action "plan" before you delegate. Give each thread a stable ID such as T1, a short title, and a precise task.
3. Call the subagent tool in parallel mode. Use the "researcher" agent for every thread. Keep tasks in the same order as the plan and start each task with its thread ID in square brackets.
4. Read every thread result. If a thread did not return structured sources, call research_update with action "sources" and register the useful sources yourself.
5. Call research_update with phase "synthesize" before you compare findings. The tool response returns the canonical citation ledger.
6. Prefer primary sources, official documentation, direct datasets, and reproducible benchmarks. Keep contrary evidence and exclusion reasons visible.
7. Cite each material claim with the exact ledger number and URL in standard Markdown, for example [3](https://example.com/source).
8. Before the final response, call research_update with phase "report", the report title, and the source IDs you intend to cite.
9. Then write the complete report as the next assistant response. Do not call another tool after the report checkpoint.

Use queued steering at the next checkpoint. If the user changes scope, update the plan or run more threads before synthesis. Keep the final report direct and decision-oriented. Include the recommendation, evidence, tradeoffs, and clear revisit conditions.`;

const sourceSchema = Type.Object({
  id: Type.Optional(Type.Integer({ minimum: 1 })),
  url: Type.Optional(Type.String()),
  path: Type.Optional(Type.String()),
  title: Type.String(),
  publisher: Type.Optional(Type.String()),
  publishedAt: Type.Optional(Type.String()),
  kind: Type.Optional(Type.String()),
  status: Type.Optional(StringEnum(["candidate", "cited", "excluded"] as const)),
  threadId: Type.Optional(Type.String()),
  claim: Type.Optional(Type.String()),
  evidence: Type.Optional(Type.String()),
  exclusionReason: Type.Optional(Type.String()),
});

function isObject(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null;
}

function messageText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((block) => block?.type === "text")
    .map((block) => block.text || "")
    .join("\n")
    .trim();
}

function threadIdFromTask(task: unknown): string {
  if (typeof task !== "string") return "";
  return task.match(/^\s*\[([^\]]+)\]/)?.[1]?.trim() || "";
}

function resultStatus(result: Record<string, any>): "queued" | "running" | "done" | "error" {
  if (["queued", "running", "done", "error"].includes(result.status)) {
    return result.status;
  }
  if (result.error || result.exitCode !== 0 || result.stopReason === "error") {
    return "error";
  }
  if (result.childSession || result.messages?.length) return "done";
  return "running";
}

function stateForModel(state: NonNullable<ResearchState>): string {
  const threads = state.threads.map((thread) => ({
    id: thread.id,
    title: thread.title,
    status: thread.status,
    sourceIds: thread.sourceIds,
  }));
  const sources = state.sources.map((source) => ({
    id: source.id,
    title: source.title,
    url: source.url,
    path: source.path,
    kind: source.kind,
    status: source.status,
    threadIds: source.threadIds,
    claim: source.claim,
  }));
  return JSON.stringify({
    phase: state.phase,
    status: state.status,
    threads,
    sources,
  }, null, 2);
}

function reportTitle(text: string): string {
  return text.match(/^#\s+(.+)$/m)?.[1]?.trim().slice(0, 240) || "Research report";
}

export default function researchExtension(pi: ExtensionAPI) {
  let state: ResearchState = null;
  let active = false;
  let sessionId = "";
  let toolRegistered = false;

  function updateUi(ctx?: ExtensionContext) {
    if (!ctx) return;
    if (!active || !state) {
      ctx.ui.setStatus("research", undefined);
      return;
    }
    const progress = state.threadCount
      ? ` ${state.completedThreadCount}/${state.threadCount}`
      : "";
    ctx.ui.setStatus("research", `research: ${state.phase}${progress}`);
  }

  function restore(ctx: ExtensionContext) {
    sessionId = ctx.sessionManager.getSessionId();
    state = researchStateFromEntries(ctx.sessionManager.getBranch(), sessionId);
    active = Boolean(state);
    if (active) registerResearchTool();
    const tools = pi.getActiveTools().filter((name) => name !== "research_update");
    pi.setActiveTools(active ? [...new Set([...tools, "research_update"])] : tools);
    updateUi(ctx);
  }

  function persist(data: Record<string, unknown>, ctx?: ExtensionContext) {
    if (!active || !sessionId || !state) return;
    const event = {
      version: RESEARCH_VERSION,
      sessionId,
      updatedAt: Date.now(),
      ...data,
    };
    pi.appendEntry(RESEARCH_CUSTOM_TYPE, event);
    state = applyResearchEvent(state, event);
    updateUi(ctx);
  }

  function persistPhase(phase: string, data: Record<string, unknown> = {}, ctx?: ExtensionContext) {
    if (!state || (state.phase === phase && !Object.keys(data).length)) return;
    persist({ kind: "phase", phase, ...data }, ctx);
  }

  function persistThread(thread: Record<string, any>, ctx?: ExtensionContext) {
    if (!state || !thread.id) return;
    const current = state.threads.find((item) => item.id === thread.id);
    const next = {
      ...current,
      ...thread,
      sourceIds: thread.sourceIds || current?.sourceIds || [],
    };
    const signature = JSON.stringify(next);
    if (current && JSON.stringify(current) === signature) return;
    persist({ kind: "thread", thread: next }, ctx);
  }

  function registerSources(threadId: string, sources: unknown, ctx?: ExtensionContext): number[] {
    if (!state || !Array.isArray(sources)) return [];
    const ids: number[] = [];
    for (const item of sources.slice(0, 20)) {
      if (!isObject(item)) continue;
      const source: ResearchSource = { ...item, threadId: item.threadId || threadId };
      const key = canonicalResearchSourceKey(source);
      if (!key) continue;
      const existing = state.sources.find((candidate) => candidate.key === key);
      if (!existing && state.sources.length >= 60) continue;
      const id = existing?.id || state.sources.reduce((max, candidate) => {
        return Math.max(max, candidate.id);
      }, 0) + 1;
      persist({ kind: "source", source: { ...source, id } }, ctx);
      ids.push(id);
    }
    return [...new Set(ids)];
  }

  function processSubagentDetails(value: unknown, ctx?: ExtensionContext) {
    if (!state || !isObject(value)) return;
    const details = isObject(value.details) ? value.details : value;
    const results = Array.isArray(details.results) ? details.results : [];
    results.forEach((result, index) => {
      if (!isObject(result)) return;
      const research = isObject(result.research) ? result.research : {};
      const threadId = String(
        research.threadId
          || threadIdFromTask(result.task)
          || state?.threads[index]?.id
          || `T${index + 1}`,
      );
      const sourceIds = registerSources(threadId, research.sources, ctx);
      const status = resultStatus(result);
      const current = state?.threads.find((thread) => thread.id === threadId);
      persistThread({
        id: threadId,
        title: current?.title || String(research.title || result.task || threadId),
        task: current?.task || String(result.task || ""),
        status,
        summary: String(research.summary || current?.summary || ""),
        sourceIds: [...new Set([...(current?.sourceIds || []), ...sourceIds])],
        childSession: result.childSession || current?.childSession || null,
        error: String(result.error || ""),
        startedAt: current?.startedAt || (status !== "queued" ? Date.now() : 0),
        completedAt: status === "done" || status === "error" ? Date.now() : 0,
      }, ctx);
    });
  }

  pi.on("session_start", async (_event, ctx) => {
    restore(ctx);
  });

  pi.on("session_tree", async (_event, ctx) => {
    restore(ctx);
  });

  pi.on("before_agent_start", async (event, ctx) => {
    if (!active || !state) return;
    if (!state.objective && event.prompt.trim()) {
      persist({ kind: "objective", objective: event.prompt.trim() }, ctx);
    }
    return {
      systemPrompt: `${event.systemPrompt}\n\n${RESEARCH_LEAD_PROMPT}\n\nCurrent research state:\n${stateForModel(state)}`,
    };
  });

  function registerResearchTool() {
    if (toolRegistered) return;
    toolRegistered = true;
    pi.registerTool({
    name: "research_update",
    label: "Research Update",
    description: "Persist a deep research plan, phase, source ledger update, exclusion, or final report checkpoint. This tool is available only in research sessions.",
    parameters: Type.Object({
      action: StringEnum(["plan", "phase", "sources", "exclude"] as const),
      phase: Type.Optional(StringEnum(["plan", "gather", "synthesize", "report"] as const)),
      strategy: Type.Optional(Type.String()),
      threads: Type.Optional(Type.Array(Type.Object({
        id: Type.String(),
        title: Type.String(),
        task: Type.String(),
      }))),
      threadId: Type.Optional(Type.String()),
      sources: Type.Optional(Type.Array(sourceSchema)),
      sourceId: Type.Optional(Type.Integer({ minimum: 1 })),
      reason: Type.Optional(Type.String()),
      note: Type.Optional(Type.String()),
      title: Type.Optional(Type.String()),
      citedSourceIds: Type.Optional(Type.Array(Type.Integer({ minimum: 1 }))),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      if (!active || !state) throw new Error("research_update requires a research session");

      if (params.action === "plan") {
        if (!params.threads?.length) throw new Error("plan requires threads");
        persist({
          kind: "plan",
          strategy: params.strategy || "",
          threads: params.threads.map((thread) => ({ ...thread, status: "queued" })),
        }, ctx);
      }

      if (params.action === "phase") {
        if (!params.phase) throw new Error("phase action requires phase");
        persistPhase(params.phase, {
          note: params.note || "",
          title: params.title || "",
          citedSourceIds: params.citedSourceIds || [],
        }, ctx);
      }

      if (params.action === "sources") {
        if (!params.sources?.length) throw new Error("sources action requires sources");
        registerSources(params.threadId || "", params.sources, ctx);
      }

      if (params.action === "exclude") {
        const source = state.sources.find((item) => item.id === params.sourceId);
        if (!source) throw new Error("sourceId does not exist");
        persist({
          kind: "source",
          source: {
            ...source,
            status: "excluded",
            exclusionReason: params.reason || "Excluded during synthesis",
          },
        }, ctx);
      }

      return {
        content: [{
          type: "text",
          text: `Research state saved. Use this canonical citation ledger:\n${stateForModel(state)}`,
        }],
        details: {
          action: params.action,
          phase: state.phase,
          threadCount: state.threadCount,
          sourceCount: state.sourceCount,
        },
      };
    },
    });
  }

  pi.on("tool_execution_start", async (event, ctx) => {
    if (!active || !state || event.toolName !== "subagent") return;
    const tasks = Array.isArray(event.args?.tasks) ? event.args.tasks : [];
    if (!tasks.length) return;
    persistPhase("gather", {}, ctx);
    tasks.forEach((task, index) => {
      const planned = state?.threads[index];
      const id = threadIdFromTask(task?.task) || planned?.id || `T${index + 1}`;
      persistThread({
        ...planned,
        id,
        title: planned?.title || String(task?.task || id),
        task: planned?.task || String(task?.task || ""),
        status: index < 4 ? "running" : "queued",
        startedAt: index < 4 ? Date.now() : 0,
      }, ctx);
    });
  });

  pi.on("tool_execution_update", async (event, ctx) => {
    if (!active || event.toolName !== "subagent") return;
    processSubagentDetails(event.partialResult, ctx);
  });

  pi.on("tool_execution_end", async (event, ctx) => {
    if (!active || !state || event.toolName !== "subagent") return;
    processSubagentDetails(event.result, ctx);
    const settled = state.threads.length > 0 && state.threads.every((thread) => {
      return thread.status === "done" || thread.status === "error";
    });
    if (settled && state.phase === "gather") persistPhase("synthesize", {}, ctx);
  });

  pi.on("turn_end", async (event, ctx) => {
    if (!active || !state || state.status !== "running") return;
    if (state.phase !== "report" || event.message?.role !== "assistant") return;
    if (event.message.stopReason !== "stop") return;
    const text = messageText(event.message.content);
    if (!text) return;
    const report = [...ctx.sessionManager.getBranch()].reverse().find((entry) => {
      if (entry.type !== "message" || entry.message?.role !== "assistant") return false;
      return entry.message.timestamp === event.message.timestamp
        && messageText(entry.message.content) === text;
    });
    if (!report || report.type !== "message") return;
    const citationAudit = auditResearchReportCitations(text, state.sources);
    const usableSources = state.sources.filter((source) => {
      return source.status !== "excluded";
    });
    if (citationAudit.invalid || (usableSources.length && !citationAudit.ids.length)) {
      persist({
        kind: "error",
        message: citationAudit.invalid
          ? `The report contained ${citationAudit.invalid} citation link${citationAudit.invalid === 1 ? "" : "s"} that did not match the source ledger.`
          : "The report did not contain any citations that matched the source ledger.",
      }, ctx);
      return;
    }
    persist({
      kind: "report",
      reportEntryId: report.id,
      title: state.reportTitle || reportTitle(text),
      citedSourceIds: citationAudit.ids,
    }, ctx);
  });

  pi.on("agent_settled", async (_event, ctx) => {
    if (!active || !state || state.status !== "running") return;
    persist({
      kind: "error",
      message: `Research stopped during the ${state.phase} phase before a valid report was written.`,
    }, ctx);
  });

  pi.on("session_shutdown", () => {
    state = null;
    active = false;
    sessionId = "";
  });
}
