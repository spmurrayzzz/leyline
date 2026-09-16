import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const OPAQUE_STATUS_ERRORS = new Set([
  "400 status code (no body)",
  "413 status code (no body)",
]);

export default function compactionGuardExtension(pi: ExtensionAPI) {
  pi.on("session_before_compact", (event, ctx) => {
    if (event.reason !== "overflow" || !ctx.model) return;

    const { reserveTokens } = event.preparation.settings;
    if (event.preparation.tokensBefore >= ctx.model.contextWindow - reserveTokens) return;

    for (let index = event.branchEntries.length - 1; index >= 0; index--) {
      const entry = event.branchEntries[index];
      if (entry.type !== "message" || entry.message.role !== "assistant") continue;

      const message = entry.message;
      if (message.stopReason !== "error") return;
      if (message.provider === "cerebras") return;
      if (!OPAQUE_STATUS_ERRORS.has(message.errorMessage || "")) return;
      return { cancel: true };
    }
  });
}
