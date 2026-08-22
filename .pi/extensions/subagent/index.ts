import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { Agent, fetch } from "undici";
import { readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";

const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
const THINKING_SETTINGS = ["inherit", ...THINKING_LEVELS] as const;
const LEYLINE_API_DISPATCHER = new Agent({ headersTimeout: 0, bodyTimeout: 0 });
type ThinkingLevel = typeof THINKING_LEVELS[number];

interface AgentDef {
  name: string;
  description: string;
  model: string;
  thinking: string;
  tools: string[];
  strictTools?: boolean;
  systemPrompt: string;
  source: "user" | "project" | "bundled" | "unknown";
  key: string;
}

interface SingleResult {
  agent: string;
  agentSource: "user" | "project" | "bundled" | "unknown";
  task: string;
  status?: "queued" | "running" | "done" | "error";
  research?: {
    threadId?: string;
    title?: string;
    summary?: string;
    sources?: Array<Record<string, unknown>>;
  };
  requestedModel?: string;
  requestedThinking?: string;
  childSession: { path: string; id: string; cwd?: string } | null;
  exitCode: number;
  messages: Array<{ role: string; content: string }>;
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    cost: number;
    turns: number;
  };
  model?: string;
  thinkingLevel?: ThinkingLevel;
  stopReason?: string;
  error?: string;
}

interface SubagentDetails {
  mode: "single" | "parallel" | "chain";
  results: SingleResult[];
  background: boolean;
}

const SAFE_RESEARCH_BUILTINS = new Set([
  "read",
  "grep",
  "find",
  "ls",
]);
const SAFE_RESEARCH_EXTERNAL_TOOLS = new Set([
  "exa_search",
  "exa_contents",
  "list_memory",
  "search_memory",
  "web_search",
  "web_fetch",
]);

const BUNDLED_RESEARCHER: AgentDef = {
  name: "researcher",
  description: "Investigate one bounded research thread and return structured source evidence",
  model: "inherit",
  thinking: "inherit",
  tools: [],
  strictTools: true,
  systemPrompt: `You are a research worker for one bounded thread in a larger investigation.

Search broadly, then read the strongest sources in depth. Prefer primary sources, official documentation, direct datasets, and reproducible benchmarks. Check dates, methods, and conflicts. Do not make the final cross-thread recommendation.

End your response with exactly one structured block in this form:
<research_result>
{"threadId":"T1","title":"short thread title","summary":"concise findings","sources":[{"url":"https://...","title":"source title","publisher":"publisher","publishedAt":"YYYY-MM-DD when known","kind":"primary|benchmark|vendor|analysis|project","claim":"what this source supports","evidence":"specific evidence or limitation"}]}
</research_result>

Use the thread ID from the task. Include only sources that you read. Use a project path instead of url for local evidence. Keep the JSON valid and put no Markdown inside the structured block.`,
  source: "bundled",
  key: "bundled:leyline-researcher",
};

function discoverAgents(cwd: string): Map<string, AgentDef> {
  const agents = new Map<string, AgentDef>();
  const userDir = join(homedir(), ".pi", "agent", "agents");
  const projectDir = findNearestProjectAgentsDir(cwd);

  if (userDir) loadAgentsFromDir(userDir, "user", agents);
  if (projectDir) loadAgentsFromDir(projectDir, "project", agents);
  agents.set(BUNDLED_RESEARCHER.name, {
    ...BUNDLED_RESEARCHER,
    tools: [...BUNDLED_RESEARCHER.tools],
  });

  return agents;
}

function loadAgentsFromDir(
  dir: string,
  source: "user" | "project",
  map: Map<string, AgentDef>,
): void {
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.name.endsWith(".md")) continue;
      if (!entry.isFile()) continue;

      try {
        const content = readFileSync(join(dir, entry.name), "utf8");
        const def = parseAgentDef(content, source, join(dir, entry.name));
        if (def) map.set(def.name, def);
      } catch {}
    }
  } catch {}
}

function parseAgentDef(content: string, source: "user" | "project", path: string): AgentDef | null {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/);
  if (!match) return null;

  const frontmatter = match[1];
  const body = match[2].trim();

  const name = extractField(frontmatter, "name");
  const description = extractField(frontmatter, "description");
  const model = extractField(frontmatter, "model") || "";
  const thinking = extractField(frontmatter, "thinking") || "";
  const toolsRaw = extractField(frontmatter, "tools") || "";
  const tools = toolsRaw
    ? toolsRaw.split(",").map((t) => t.trim()).filter(Boolean)
    : [];

  if (!name || !description) return null;

  let canonicalPath = path;
  try { canonicalPath = realpathSync(path); } catch {}
  return { name, description, model, thinking, tools, systemPrompt: body, source, key: `${source}:${canonicalPath}:${name}` };
}

function extractField(frontmatter: string, field: string): string | null {
  const re = new RegExp(`^${field}:\\s*(.+)$`, "m");
  const m = frontmatter.match(re);
  return m ? m[1].trim() : null;
}

function findNearestProjectAgentsDir(cwd: string): string | null {
  let current = cwd;
  while (true) {
    const candidate = join(current, ".pi", "agents");
    if (isDir(candidate)) return candidate;
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function isDir(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function leylineApiBaseUrl(): string {
  return (process.env.LEYLINE_SERVER_URL || process.env.LEYLINE_DEV_SERVER_URL || "http://127.0.0.1:5173").replace(/\/$/, "");
}

async function callLeylineApi(
  path: string,
  body: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<unknown> {
  const response = await fetch(`${leylineApiBaseUrl()}/api/pi${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
    dispatcher: LEYLINE_API_DISPATCHER,
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || `API error: ${response.status}`);
  }
  return data;
}

async function resolveSubagentConfig(params: {
  agent: AgentDef;
  cwd: string;
  parentSessionPath: string | null;
  signal?: AbortSignal;
}): Promise<{ model?: string; thinking?: string }> {
  return callLeylineApi("/subagents/resolve", {
    agentKey: params.agent.key,
    cwd: params.cwd,
    sessionPath: params.parentSessionPath,
    staticModel: params.agent.model,
    staticThinking: params.agent.thinking,
  }, params.signal) as Promise<{ model?: string; thinking?: string }>;
}

async function runSubagentViaApi(params: {
  task: string;
  cwd: string;
  parentSessionPath: string | null;
  model: string | { provider: string; id: string } | undefined;
  thinkingLevel: ThinkingLevel | undefined;
  tools?: string[];
  systemPrompt: string;
  signal?: AbortSignal;
}): Promise<{
  childSession: { path: string; id: string; cwd?: string };
  messages: Array<{ role: string; content: string }>;
  usage: { inputTokens: number; outputTokens: number; totalTokens: number; cost: number; turns: number };
  model?: string;
  thinkingLevel?: ThinkingLevel;
  stopReason?: string;
}> {
  return callLeylineApi("/subagent", {
    task: params.task,
    cwd: params.cwd,
    parentSessionPath: params.parentSessionPath,
    model: params.model || undefined,
    thinkingLevel: params.thinkingLevel,
    tools: params.tools,
    systemPrompt: params.systemPrompt || undefined,
  }, params.signal) as Promise<any>;
}

function errorText(error: any): string {
  const cause = error?.cause;
  const message = cause?.message || error?.message || String(error);
  const code = cause?.code || error?.code;
  return code && !message.includes(code) ? `${message} (${code})` : message;
}

function getParentSessionPath(ctx: ExtensionContext): string | null {
  try {
    return ctx.sessionManager.getSessionFile?.() || null;
  } catch {
    return null;
  }
}

function agentModel(agent: AgentDef, ctx: ExtensionContext): string | { provider: string; id: string } | undefined {
  if (agent.model === "inherit") {
    return ctx.model ? { provider: ctx.model.provider, id: ctx.model.id } : undefined;
  }
  return agent.model || undefined;
}

function selectedAgentModel(
  agent: AgentDef,
  modelOverride: string | undefined,
  ctx: ExtensionContext,
): string | { provider: string; id: string } | undefined {
  const override = modelOverride?.trim();
  if (!override) return agentModel(agent, ctx);
  if (override === "inherit") return ctx.model ? { provider: ctx.model.provider, id: ctx.model.id } : undefined;
  return override;
}

function selectedAgentThinking(
  agent: AgentDef,
  thinkingOverride: string | undefined,
  parentThinkingLevel: ThinkingLevel,
): ThinkingLevel | undefined {
  const setting = thinkingOverride?.trim() || agent.thinking.trim();
  if (!setting) return undefined;
  if (setting === "inherit") return parentThinkingLevel;
  if (THINKING_LEVELS.includes(setting as ThinkingLevel)) return setting as ThinkingLevel;
  throw new Error(`Invalid subagent thinking level: ${setting}`);
}

export default function subagentExtension(pi: ExtensionAPI) {
  let knownAgents = new Map<string, AgentDef>();

  function refreshAgents(ctx: ExtensionContext) {
    knownAgents = discoverAgents(ctx.cwd);
    const researcher = knownAgents.get(BUNDLED_RESEARCHER.name);
    if (!researcher) return;
    researcher.tools = pi.getAllTools().filter((tool) => {
      if (SAFE_RESEARCH_BUILTINS.has(tool.name)) {
        return tool.sourceInfo?.source === "builtin";
      }
      if (!SAFE_RESEARCH_EXTERNAL_TOOLS.has(tool.name)) return false;
      return tool.sourceInfo?.scope !== "project"
        && tool.sourceInfo?.source !== "builtin";
    }).map((tool) => tool.name);
  }

  pi.on("session_start", async (_event, ctx) => {
    refreshAgents(ctx);
  });

  pi.on("resources_discover", async (_event, ctx) => {
    refreshAgents(ctx);
  });

  pi.registerCommand("subagent", {
    description: "List available subagent definitions",
    handler: async (_args, ctx) => {
      refreshAgents(ctx);
      if (knownAgents.size === 0) {
        ctx.ui.notify(
          "No agents configured.\n\n" +
          "Create .md files in:\n" +
          "  ~/.pi/agent/agents/ (global)\n" +
          "  .pi/agents/ (project-local)\n\n" +
          "See .pi/agents/ for examples.",
          "info",
        );
        return;
      }

      const lines = Array.from(knownAgents.values()).map((a) => {
        return `  ${a.name} (${a.source}): ${a.description}`;
      });
      ctx.ui.notify(`Available agents:\n${lines.join("\n")}`, "info");
    },
  });

  pi.registerTool({
    name: "subagent",
    label: "Subagent",
    description:
      "Delegate tasks to specialized child agents with isolated context.\n" +
      "Modes:\n" +
      "- single (default): { agent, task, model?, thinking? }\n" +
      "- parallel: { tasks: [{ agent, task, model?, thinking? }] } — runs concurrently\n" +
      "- chain: { chain: [{ agent, task, model?, thinking? }] } — sequential, {previous} replaced by prior output",
    parameters: Type.Object({
      agent: Type.Optional(Type.String({
        description: "Agent name. From .md files in ~/.pi/agent/agents/ and .pi/agents/",
      })),
      task: Type.Optional(Type.String({
        description: "The task to delegate to the subagent",
      })),
      model: Type.Optional(Type.String({
        description: "Optional model override for the child agent. Use 'inherit', a model id, or provider/model-id.",
      })),
      thinking: Type.Optional(StringEnum(THINKING_SETTINGS, {
        description: "Optional thinking-level override for child agents. Use 'inherit' for the parent session's current level.",
      })),
      mode: Type.Optional(
        Type.Enum({
          single: "single",
          parallel: "parallel",
          chain: "chain",
        } as const, {
          description: "Execution mode (default: single)",
        }),
      ),
      cwd: Type.Optional(
        Type.String({
          description: "Working directory for the child agent",
        }),
      ),
      tasks: Type.Optional(
        Type.Array(
          Type.Object({
            agent: Type.String({ description: "Agent name" }),
            task: Type.String({ description: "Task for this agent" }),
            model: Type.Optional(Type.String({ description: "Optional model override for this child agent" })),
            thinking: Type.Optional(StringEnum(THINKING_SETTINGS, { description: "Optional thinking-level override for this child agent" })),
            cwd: Type.Optional(Type.String({ description: "Working directory" })),
          }),
          { description: "For parallel mode: concurrent tasks" },
        ),
      ),
      chain: Type.Optional(
        Type.Array(
          Type.Object({
            agent: Type.String({ description: "Agent name" }),
            task: Type.String({
              description: "Task with {previous} replaced by prior step output",
            }),
            model: Type.Optional(Type.String({ description: "Optional model override for this child agent" })),
            thinking: Type.Optional(StringEnum(THINKING_SETTINGS, { description: "Optional thinking-level override for this child agent" })),
            cwd: Type.Optional(Type.String({ description: "Working directory" })),
          }),
          { description: "For chain mode: sequential tasks" },
        ),
      ),
    }),
    async execute(
      _toolCallId: string,
      params: any,
      signal: AbortSignal,
      onUpdate: ((partial: any) => void) | undefined,
      ctx: ExtensionContext,
    ) {
      refreshAgents(ctx);

      if (knownAgents.size === 0) {
        return {
          content: [{ type: "text", text: "No agents configured. Create .md files in ~/.pi/agent/agents/ or .pi/agents/" }],
          details: { mode: "single", results: [], background: false } as SubagentDetails,
        };
      }

      const mode = params.mode || (params.tasks?.length ? "parallel" : params.chain?.length ? "chain" : "single");
      const agent = params.agent ? knownAgents.get(params.agent) : undefined;
      if (mode === "single" && (!params.agent || !params.task)) {
        throw new Error("Single mode requires 'agent' and 'task'");
      }
      if (params.agent && !agent) {
        const available = Array.from(knownAgents.values())
          .map((a) => `"${a.name}" (${a.source}): ${a.description}`)
          .join("; ");
        throw new Error(`Unknown agent: "${params.agent}". Available: ${available}`);
      }
      const parentPath = getParentSessionPath(ctx);
      const parentThinkingLevel = pi.getThinkingLevel();
      const baseCwd = params.cwd || ctx.cwd;

      if (mode === "single") {
        const result = await executeSingle(
          agent!, params.task, baseCwd, parentPath, params.model, params.thinking,
          parentThinkingLevel, signal, ctx,
        );
        const output = resultOutput(result);
        return {
          content: [{ type: "text", text: output }],
          details: {
            mode: "single",
            results: [result],
            background: false,
          } as SubagentDetails,
          isError: resultFailed(result),
        };
      }

      if (mode === "parallel") {
        const tasks = params.tasks;
        if (!tasks?.length) {
          throw new Error("Parallel mode requires 'tasks' array");
        }

        const maxConcurrency = 4;
        const results = new Array<SingleResult>(tasks.length);
        const progress = tasks.map((task: any, index: number) => pendingResult(
          task,
          index < maxConcurrency ? "running" : "queued",
        ));
        const publishProgress = () => {
          const completed = progress.filter((result) => {
            return result.status === "done" || result.status === "error";
          }).length;
          onUpdate?.({
            content: [{
              type: "text",
              text: `${completed} of ${tasks.length} subagent tasks complete`,
            }],
            details: {
              mode: "parallel",
              results: progress.map(progressResult),
              background: true,
            } as SubagentDetails,
          });
        };
        publishProgress();

        for (let i = 0; i < tasks.length; i += maxConcurrency) {
          const batch = tasks.slice(i, i + maxConcurrency);
          if (i > 0) {
            batch.forEach((_task: any, batchIndex: number) => {
              progress[i + batchIndex].status = "running";
            });
            publishProgress();
          }
          await Promise.all(batch.map(async (task: any, batchIndex: number) => {
            const resultIndex = i + batchIndex;
            const childAgent = knownAgents.get(task.agent);
            const result = childAgent
              ? await executeSingle(
                childAgent, task.task, task.cwd || baseCwd, parentPath,
                task.model ?? params.model, task.thinking ?? params.thinking,
                parentThinkingLevel, signal, ctx,
              )
              : {
                  agent: task.agent,
                  agentSource: "unknown" as const,
                  task: task.task,
                  status: "error" as const,
                  childSession: null,
                  exitCode: 1,
                  messages: [],
                  usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, cost: 0, turns: 0 },
                  error: `Unknown agent: ${task.agent}`,
                };
            results[resultIndex] = result;
            progress[resultIndex] = result;
            publishProgress();
          }));
        }

        const finalResults = results.filter(Boolean);
        const output = finalResults.map((result, index) => {
          return `### Agent ${index + 1}: ${result.agent}\n${resultOutput(result)}`;
        }).join("\n\n");

        return {
          content: [{ type: "text", text: output }],
          details: { mode: "parallel", results: finalResults, background: false } as SubagentDetails,
          isError: finalResults.some(resultFailed),
        };
      }

      if (mode === "chain") {
        const chain = params.chain;
        if (!chain?.length) {
          throw new Error("Chain mode requires 'chain' array");
        }

        const results: SingleResult[] = [];
        let previousOutput = "";

        for (const step of chain) {
          const a = knownAgents.get(step.agent);
          if (!a) {
            const result = {
              agent: step.agent,
              agentSource: "unknown",
              task: step.task,
              childSession: null,
              exitCode: 1,
              messages: [],
              usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, cost: 0, turns: 0 },
              error: `Unknown agent: ${step.agent}`,
            } as SingleResult;
            results.push(result);
            return {
              content: [{ type: "text", text: `Chain stopped at step ${results.length} (${step.agent}): ${resultOutput(result)}` }],
              details: { mode: "chain", results, background: false } as SubagentDetails,
              isError: true,
            };
          }

          const taskWithPrev = step.task.replace(/\{previous\}/g, previousOutput);
          const result = await executeSingle(
            a, taskWithPrev, step.cwd || baseCwd, parentPath,
            step.model ?? params.model, step.thinking ?? params.thinking,
            parentThinkingLevel, signal, ctx,
          );
          results.push(result);
          if (result.error || result.exitCode !== 0) {
            return {
              content: [{ type: "text", text: `Chain stopped at step ${results.length} (${step.agent}): ${resultOutput(result)}` }],
              details: { mode: "chain", results, background: false } as SubagentDetails,
              isError: true,
            };
          }
          previousOutput = resultOutput(result);
        }

        const output = results.map((r, i) => {
          return `### Step ${i + 1}: ${r.agent}\n${resultOutput(r)}`;
        }).join("\n\n");

        return {
          content: [{ type: "text", text: output }],
          details: { mode: "chain", results, background: false } as SubagentDetails,
        };
      }

      throw new Error(`Unknown mode: ${mode}`);
    },
  });
}

function pendingResult(
  task: any,
  status: "queued" | "running",
): SingleResult {
  return {
    agent: String(task.agent || "subagent"),
    agentSource: task.agent === "researcher" ? "bundled" : "unknown",
    task: String(task.task || ""),
    status,
    childSession: null,
    exitCode: 0,
    messages: [],
    usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, cost: 0, turns: 0 },
  };
}

function progressResult(result: SingleResult): SingleResult {
  const output = finalAssistantOutput(result).slice(0, 2000);
  return {
    ...result,
    messages: output ? [{ role: "assistant", content: output }] : [],
  };
}

function researchResultFromMessages(
  messages: Array<{ role: string; content: string }>,
): SingleResult["research"] {
  const text = [...messages].reverse().find((message) => {
    return message.role === "assistant" && message.content.includes("<research_result>");
  })?.content;
  if (!text) return undefined;
  const match = text.match(/<research_result>\s*([\s\S]*?)\s*<\/research_result>/i);
  if (!match) return undefined;
  try {
    const value = JSON.parse(match[1]);
    if (!value || typeof value !== "object") return undefined;
    return {
      threadId: typeof value.threadId === "string" ? value.threadId.slice(0, 32) : undefined,
      title: typeof value.title === "string" ? value.title.slice(0, 240) : undefined,
      summary: typeof value.summary === "string" ? value.summary.slice(0, 2000) : undefined,
      sources: Array.isArray(value.sources)
        ? value.sources.filter((source: unknown) => source && typeof source === "object").slice(0, 20)
        : [],
    };
  } catch {
    return undefined;
  }
}

function resultOutput(result: SingleResult): string {
  return result.error || finalAssistantOutput(result) || "(no output)";
}

function finalAssistantOutput(result: SingleResult): string {
  for (let i = result.messages.length - 1; i >= 0; i--) {
    const message = result.messages[i];
    if (message.role === "assistant" || message.role === "error") return message.content.trim();
  }
  return "";
}

function failedResult(result: any): boolean {
  return result.error || result.stopReason === "error" || result.stopReason === "aborted" || result.messages?.some((m: any) => m.role === "error");
}

function resultFailed(result: SingleResult): boolean {
  return Boolean(result.error || result.exitCode !== 0);
}

async function executeSingle(
  agent: AgentDef,
  task: string,
  cwd: string,
  parentSessionPath: string | null,
  modelOverride: string | undefined,
  thinkingOverride: string | undefined,
  parentThinkingLevel: ThinkingLevel,
  signal: AbortSignal | undefined,
  ctx: ExtensionContext,
): Promise<SingleResult> {
  const emptyUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0, cost: 0, turns: 0 };

  try {
    const configured = await resolveSubagentConfig({ agent, cwd: ctx.cwd, parentSessionPath, signal });
    const selectedModel = modelOverride?.trim() || configured.model;
    const selectedThinking = thinkingOverride?.trim() || configured.thinking;
    const result = await runSubagentViaApi({
      task,
      cwd,
      parentSessionPath,
      model: selectedAgentModel(agent, selectedModel, ctx),
      thinkingLevel: selectedAgentThinking(agent, selectedThinking, parentThinkingLevel),
      tools: agent.strictTools
        ? agent.tools
        : agent.tools.length ? agent.tools : undefined,
      systemPrompt: agent.systemPrompt,
      signal,
    });

    const data = result as any;
    const messages = data.messages || [];
    const failed = failedResult(data);
    return {
      agent: agent.name,
      agentSource: agent.source,
      task,
      status: failed ? "error" : "done",
      research: agent.name === BUNDLED_RESEARCHER.name
        ? researchResultFromMessages(messages)
        : undefined,
      requestedModel: modelOverride,
      requestedThinking: thinkingOverride,
      childSession: data.childSession || null,
      exitCode: failed ? 1 : 0,
      messages,
      usage: data.usage || emptyUsage,
      model: data.model,
      thinkingLevel: data.thinkingLevel,
      stopReason: data.stopReason,
      error: data.error,
    };
  } catch (error: any) {
    if (signal?.aborted) throw error;
    return {
      agent: agent.name,
      agentSource: agent.source,
      task,
      status: "error",
      requestedModel: modelOverride,
      requestedThinking: thinkingOverride,
      childSession: null,
      exitCode: 1,
      messages: [],
      usage: emptyUsage,
      error: errorText(error),
    };
  }
}
