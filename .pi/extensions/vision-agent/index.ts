import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { Agent, fetch } from "undici";
import { readFileSync, statSync } from "node:fs";
import { extname, isAbsolute, resolve } from "node:path";

const LEYLINE_API_DISPATCHER = new Agent({ headersTimeout: 0, bodyTimeout: 0 });

const IMAGE_MIME_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

interface VisionRun {
  childSession: { path: string; id: string; cwd?: string };
  messages: Array<{ role: string; content: string }>;
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    cost: number;
    turns: number;
  };
  model?: string;
  error?: string;
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

const VISION_THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;

type ThinkingLevel = (typeof VISION_THINKING_LEVELS)[number];

function visionThinkingOverride(
  configured: string | undefined,
  parentThinkingLevel: ThinkingLevel | undefined,
): ThinkingLevel | undefined {
  const setting = configured?.trim();
  if (!setting) return undefined;
  if (setting === "inherit") return parentThinkingLevel;
  if ((VISION_THINKING_LEVELS as readonly string[]).includes(setting)) {
    return setting as ThinkingLevel;
  }
  return undefined;
}

function visionModelForOverride(
  override: string | undefined,
  scopedModel: string | undefined,
  ctx: ExtensionContext,
): string | { provider: string; id: string } | undefined {
  const setting = override?.trim() || scopedModel?.trim() || "";
  if (!setting) return undefined;
  if (setting === "inherit") {
    return ctx.model ? { provider: ctx.model.provider, id: ctx.model.id } : undefined;
  }
  return setting;
}

function resultOutput(result: VisionRun): string {
  if (result.error) return result.error;
  for (let i = (result.messages || []).length - 1; i >= 0; i--) {
    const message = result.messages[i];
    if (message.role === "assistant" || message.role === "error") {
      if (message.content?.trim()) return message.content.trim();
    }
  }
  return "(no description returned)";
}

function resultFailed(result: any): boolean {
  if (result.error || result.stopReason === "error" || result.stopReason === "aborted") {
    return true;
  }
  return Boolean((result.messages || []).some((message: any) => message.role === "error"));
}

export default function visionAgentExtension(pi: ExtensionAPI) {
  const toolName = "vision_agent";
  let suppressedForVision = false;

  function syncToolAvailability(model: ExtensionContext["model"]) {
    const activeTools = pi.getActiveTools();
    const isActive = activeTools.includes(toolName);

    if (model?.input?.includes("image")) {
      if (isActive) {
        suppressedForVision = true;
        pi.setActiveTools(activeTools.filter((name) => name !== toolName));
      }
      return;
    }

    if (suppressedForVision && !isActive) {
      pi.setActiveTools([...activeTools, toolName]);
    }
    suppressedForVision = false;
  }

  pi.registerTool({
    name: toolName,
    label: "Vision agent",
    description:
      "Inspect an image file using a separate vision-capable model and return a detailed text description.\n" +
      "Use this when the current model cannot receive images directly and you need to " +
      "understand an image: a screenshot, photo, diagram, UI mockup, or an error " +
      "screen. The vision agent runs as a child session with a model that supports " +
      "images, then returns its description as text.",
    parameters: Type.Object({
      path: Type.String({
        description: "Path to the image file to inspect, relative to cwd or absolute",
      }),
      question: Type.Optional(Type.String({
        description: "Optional specific question about the image; the agent answers this directly",
      })),
      model: Type.Optional(Type.String({
        description: "Optional vision model override: a model id, 'provider/model-id', or 'inherit' to reuse the parent session model",
      })),
      cwd: Type.Optional(Type.String({
        description: "Working directory for the image path (defaults to the session cwd)",
      })),
    }),
    async execute(
      _toolCallId: string,
      params: any,
      signal: AbortSignal,
      _onUpdate: ((partial: string) => void) | undefined,
      ctx: ExtensionContext,
    ) {
      if (ctx.model?.input?.includes("image")) {
        throw new Error("The current model supports image input. Use read to inspect the image file directly.");
      }

      const cwd = params.cwd || ctx.cwd;
      const rawPath = params.path || "";
      if (!rawPath) throw new Error("path is required");

      const imagePath = isAbsolute(rawPath) ? rawPath : resolve(cwd, rawPath);
      const mimeType = imageMimeType(imagePath);
      if (!mimeType) {
        return {
          content: [{ type: "text", text: `Unsupported image file: ${rawPath}. The vision agent supports PNG, JPEG, GIF, and WebP.` }],
          details: { childSession: null, messages: [], usage: emptyUsage(), model: undefined, error: `Unsupported image: ${rawPath}` },
          isError: true,
        };
      }

      let imageData: string;
      try {
        if (!statSync(imagePath).isFile()) throw new Error("not a file");
        imageData = readFileSync(imagePath).toString("base64");
      } catch (error: any) {
        return {
          content: [{ type: "text", text: `Cannot read image file: ${rawPath}. ${error.message || String(error)}` }],
          details: { childSession: null, messages: [], usage: emptyUsage(), error: String(error?.message || error) },
          isError: true,
        };
      }

      const parentSessionPath = getParentSessionPath(ctx);
      try {
        const resolved = await callLeylineApi("/vision/resolve", {
          cwd,
          sessionPath: parentSessionPath,
        }, signal) as { model?: string; modelSource?: string; thinking?: string; thinkingSource?: string };

        const selectedModel = visionModelForOverride(params.model, resolved.model, ctx);
        if (!selectedModel) {
          const hint = params.model ? "The requested vision model is unavailable in this child runtime." : "No vision model is configured. Set a default vision model in Leyline Settings, or pass a model parameter to this tool.";
          return {
            content: [{ type: "text", text: `vision_agent: ${hint}` }],
            details: { childSession: null, messages: [], usage: emptyUsage(), error: hint },
            isError: true,
          };
        }

        const selectedThinking = visionThinkingOverride(resolved.thinking, pi.getThinkingLevel());

        const result = await callLeylineApi("/vision", {
          question: params.question || "Describe this image in detail so an agent that cannot see it understands what it shows.",
          cwd,
          parentSessionPath,
          model: selectedModel,
          thinking: selectedThinking,
          image: { type: "image", data: imageData, mimeType },
        }, signal) as VisionRun;

        return {
          content: [{ type: "text", text: resultOutput(result) }],
          details: {
            childSession: result.childSession || null,
            messages: result.messages || [],
            usage: result.usage || emptyUsage(),
            model: result.model,
            error: result.error,
          },
          isError: resultFailed(result),
        };
      } catch (error: any) {
        if (signal?.aborted) throw error;
        const message = errorText(error);
        return {
          content: [{ type: "text", text: `vision_agent failed: ${message}` }],
          details: { childSession: null, messages: [], usage: emptyUsage(), error: message },
          isError: true,
        };
      }
    },
  });

  pi.on("session_start", (_event, ctx) => {
    syncToolAvailability(ctx.model);
  });

  pi.on("model_select", (event) => {
    syncToolAvailability(event.model);
  });
}

function imageMimeType(imagePath: string): string {
  try {
    if (!statSync(imagePath).isFile()) return "";
    return IMAGE_MIME_TYPES[extname(imagePath).toLowerCase()] || "";
  } catch {
    return "";
  }
}

function emptyUsage() {
  return { inputTokens: 0, outputTokens: 0, totalTokens: 0, cost: 0, turns: 0 };
}