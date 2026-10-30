import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { chromium } from 'playwright'
import { docsTraceTimeline, docsTraceEntryTimestamp, docsTraces, tracePage } from './fixtures/docs-traces.js'
import { THINKING_DEFAULT_SETTING_KEY } from '../lib/leyline-settings.js'
import { projectTranscriptEntries } from '../lib/transcript-projection.js'
import {
  canonicalResearchSourceKey,
  compactResearchState,
} from '../lib/research-state.js'
import { renderSessionExportHtml } from '../server/pi-api/export-renderer.js'
import { subagentTaskTitle } from '../lib/subagent-view.js'
import { docsDictation, docsDictationClient, docsDictationMeters } from './fixtures/docs-dictation.js'

const baseUrl = process.env.DOCS_SCREENSHOT_URL || 'http://localhost:5173/'
const screenshotFilter = (process.env.DOCS_SCREENSHOT_FILTER || '')
  .split(',').map((value) => value.trim()).filter(Boolean)
const docsOutputDir = path.resolve('docs/assets/screenshots')
const readmeOutputDir = path.resolve('assets/readme')
const eluneOutputDir = process.env.ELUNE_DOCS_SCREENSHOT_DIR
  ? path.resolve(process.env.ELUNE_DOCS_SCREENSHOT_DIR)
  : null
const fixedNow = Date.parse('2026-08-06T16:00:00.000Z')
const visionAlertImage = {
  type: 'image',
  data: (await fs.readFile(path.resolve('scripts/fixtures/vision-alert.webp'))).toString('base64'),
  mimeType: 'image/webp',
}
const model = {
  provider: 'local',
  id: 'glm-5.3-flash',
  name: 'GLM 5.3 Flash',
  supportsImages: false,
  supportsUltrafast: false,
  serviceTiers: ['standard'],
  contextWindow: 204800,
  availableThinkingLevels: ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'],
}
const ultrafastModel = {
  provider: 'openai-codex',
  id: 'gpt-6.1-sol',
  name: 'GPT-6.1 Sol',
  supportsImages: true,
  supportsUltrafast: true,
  serviceTiers: ['standard', 'fast', 'ultrafast'],
  contextWindow: 272000,
  availableThinkingLevels: ['off', 'low', 'medium', 'high', 'xhigh'],
}
const availableModels = [
  model,
  ultrafastModel,
  {
    provider: 'local',
    id: 'qwen3.6-27b',
    name: 'qwen3.6-27b',
    supportsImages: true,
    contextWindow: 262144,
    availableThinkingLevels: ['off', 'minimal', 'low', 'medium', 'high'],
  },
  {
    provider: 'openai',
    id: 'gpt-5.4',
    name: 'GPT-5.4',
    supportsImages: true,
    availableThinkingLevels: ['off', 'low', 'medium', 'high'],
  },
  {
    provider: 'local',
    id: 'text-only-coder',
    name: 'Text Only Coder',
    supportsImages: false,
    availableThinkingLevels: ['off', 'low', 'medium', 'high'],
  },
]
const backendRegistry = {
  connections: [
    {
      id: 'team-backend',
      name: 'Team backend',
      url: 'https://api.example.com',
      createdAt: fixedNow - 86400000,
      updatedAt: fixedNow - 3600000,
    },
  ],
  defaultConnectionId: 'builtin',
}
const backendInfo = {
  name: 'Leyline',
  version: '0.0.0',
  apiVersion: 2,
  capabilities: {
    events: true,
    exports: true,
    research: true,
    review: true,
    reviewWatch: true,
    terminal: true,
    fileLinks: true,
    piSettings: true,
    tracing: true,
  },
}
const providerSettings = {
  revision: 'docs-providers-v1',
  providers: [
    {
      id: 'local',
      name: 'Local',
      kind: 'custom',
      configured: true,
      authSource: null,
      authLabel: 'No API key set',
      authMethods: [{ id: 'api_key', label: 'API key' }],
      config: {
        name: 'Local',
        baseUrl: 'http://localhost:8000/v1',
        api: 'openai-completions',
        authHeader: null,
        apiKeyConfigured: false,
        headersConfigured: false,
        canEdit: true,
        hasConfiguration: true,
      },
      models: availableModels.filter((item) => item.provider === 'local').map((item) => ({
        id: item.id,
        name: item.name,
        contextWindow: item.contextWindow || 131072,
        maxTokens: 32768,
        reasoning: true,
        input: item.supportsImages ? ['text', 'image'] : ['text'],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        kind: 'custom',
        overrides: {},
      })),
    },
    {
      id: 'openai',
      name: 'OpenAI',
      kind: 'builtin',
      configured: false,
      authSource: null,
      authLabel: 'Not configured',
      authMethods: [{ id: 'api_key', label: 'API key' }],
      config: {
        name: '',
        baseUrl: '',
        api: '',
        authHeader: null,
        apiKeyConfigured: false,
        headersConfigured: false,
        canEdit: true,
        hasConfiguration: false,
      },
      models: [{
        id: 'gpt-5.4',
        name: 'GPT-5.4',
        contextWindow: 272000,
        maxTokens: 32768,
        reasoning: true,
        input: ['text', 'image'],
        cost: {},
        kind: 'catalog',
        overrides: {},
      }],
    },
  ],
}
const qwenCatalogModel = {
  providerId: 'openrouter',
  id: 'qwen/qwen3.8-27b',
  name: 'Qwen3.8 27B',
  api: 'openai-completions',
  reasoning: true,
  input: ['text', 'image'],
  contextWindow: 1000000,
  maxTokens: 131072,
  thinkingLevelMap: { off: 'none', minimal: null, low: 'low', medium: 'medium', high: null, xhigh: 'xhigh', max: null },
  compat: { supportsDeveloperRole: false, thinkingFormat: 'openrouter', supportsStrictMode: true },
}
const modelCatalog = [
  qwenCatalogModel,
  {
    ...qwenCatalogModel,
    providerId: 'huggingface',
    id: 'Qwen/Qwen3.8-27B',
    contextWindow: 262144,
    maxTokens: 32768,
    thinkingLevelMap: { ...qwenCatalogModel.thinkingLevelMap, off: null },
    compat: { supportsDeveloperRole: false, supportsStrictMode: true },
  },
  {
    ...qwenCatalogModel,
    providerId: 'groq',
    contextWindow: 131042,
    maxTokens: 16384,
    thinkingLevelMap: { ...qwenCatalogModel.thinkingLevelMap, high: 'high', xhigh: null },
    compat: { supportsStrictMode: true },
  },
]
const catalogProviderSettings = {
  ...providerSettings,
  providers: [
    ...providerSettings.providers,
    ...[['openrouter', 'OpenRouter'], ['huggingface', 'Hugging Face'], ['groq', 'Groq']].map(([id, name]) => ({
      ...providerSettings.providers[1], id, name, models: [],
    })),
  ],
}
const mcpSettings = {
  revision: 'docs-mcp-v1',
  servers: [
    {
      name: 'documentation',
      transport: 'http',
      enabled: true,
      url: 'https://docs.example.com/mcp',
      exposure: 'deferred',
      timeout: 30,
      headers: [],
      env: [],
      oauth: { scope: 'docs:read', clientSecretConfigured: false },
    },
    {
      name: 'project-files',
      transport: 'stdio',
      enabled: false,
      command: 'node',
      cwd: '/workspace/harbor',
      argsConfigured: true,
      argsCount: 2,
      exposure: 'direct',
      headers: [],
      env: [{ name: 'PROJECT_ROOT', configured: true }],
      oauth: {},
    },
  ],
}
const fileSettings = {
  editor: 'code --wait',
  environmentEditor: '',
  effectiveEditor: 'code --wait',
  editorMode: 'desktop',
  terminalEditor: false,
  revealLabel: 'Reveal in Finder',
}
const stagedReviewPatch = `diff --git a/scripts/release.js b/scripts/release.js
index 03b7821..f21bb35 100644
--- a/scripts/release.js
+++ b/scripts/release.js
@@ -1,4 +1,4 @@
 export async function release() {
-  await publish()
   await verify()
+  await publish()
 }
`
const workingReviewPatch = `diff --git a/scripts/release.js b/scripts/release.js
index f21bb35..7ef14a9 100644
--- a/scripts/release.js
+++ b/scripts/release.js
@@ -1,4 +1,7 @@
 export async function release() {
-  await verify()
+  const result = await verify()
+  if (!result.ok) {
+    throw new Error('Release verification failed')
+  }
   await publish()
 }
`
const reviewPayload = {
  additions: 27,
  available: true,
  branch: 'release-safety',
  conflicts: 0,
  deletions: 3,
  files: [
    {
      conflicted: false,
      indexStatus: 'M',
      kind: 'modified',
      oldPath: '',
      path: 'scripts/release.js',
      staged: true,
      unstaged: true,
      untracked: false,
      worktreeStatus: 'M',
    },
    {
      conflicted: false,
      indexStatus: '?',
      kind: 'untracked',
      oldPath: '',
      path: 'src/release-summary.js',
      staged: false,
      unstaged: true,
      untracked: true,
      worktreeStatus: '?',
    },
    {
      conflicted: false,
      indexStatus: 'A',
      kind: 'added',
      oldPath: '',
      path: 'tests/release.test.js',
      staged: true,
      unstaged: false,
      untracked: false,
      worktreeStatus: ' ',
    },
    {
      conflicted: false,
      indexStatus: ' ',
      kind: 'modified',
      oldPath: '',
      path: 'vite.config.js',
      staged: false,
      unstaged: true,
      untracked: false,
      worktreeStatus: 'M',
    },
  ],
  filesTruncated: false,
  lineStatsAvailable: true,
  root: '/workspace/harbor',
  totalFiles: 4,
}
const cleanReviewPayload = {
  ...reviewPayload,
  additions: 0,
  deletions: 0,
  files: [],
  totalFiles: 0,
}
const reviewDiffPayload = {
  path: 'scripts/release.js',
  diffs: [
    {
      binary: false,
      bytes: Buffer.byteLength(stagedReviewPatch),
      lines: stagedReviewPatch.split('\n').length - 1,
      patch: stagedReviewPatch,
      scope: 'staged',
      tooLarge: false,
    },
    {
      binary: false,
      bytes: Buffer.byteLength(workingReviewPatch),
      lines: workingReviewPatch.split('\n').length - 1,
      patch: workingReviewPatch,
      scope: 'working',
      tooLarge: false,
    },
  ],
}

const researchSources = [
  {
    id: 1,
    url: 'https://www.electronjs.org/docs/latest/api/auto-updater',
    title: 'autoUpdater',
    publisher: 'Electron',
    kind: 'documentation',
    status: 'cited',
    threadIds: ['T1'],
    claim: 'Electron provides platform-specific update events and installation controls.',
    evidence: 'The API documents update checks, downloads, error events, and restart-based installation.',
  },
  {
    id: 2,
    url: 'https://www.electronjs.org/docs/latest/tutorial/code-signing',
    title: 'Code Signing',
    publisher: 'Electron',
    kind: 'documentation',
    status: 'cited',
    threadIds: ['T2'],
    claim: 'Desktop releases need platform signing before distribution.',
    evidence: 'The guide describes signing requirements for macOS and Windows packages.',
  },
  {
    id: 3,
    url: 'https://docs.npmjs.com/generating-provenance-statements',
    title: 'Generating provenance statements',
    publisher: 'npm Docs',
    kind: 'documentation',
    status: 'cited',
    threadIds: ['T2'],
    claim: 'Published packages can include verifiable build provenance.',
    evidence: 'npm documents trusted publishing and provenance statements for supported CI systems.',
  },
  {
    id: 4,
    url: 'https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments',
    title: 'Deployments and environments',
    publisher: 'GitHub Docs',
    kind: 'documentation',
    status: 'cited',
    threadIds: ['T3'],
    claim: 'Protected environments can gate releases and retain deployment history.',
    evidence: 'Environment rules can require approval and restrict deployment branches.',
  },
  {
    id: 5,
    path: 'docs/release-checklist.md',
    title: 'Release checklist',
    publisher: 'harbor project',
    kind: 'project',
    status: 'candidate',
    threadIds: ['T1', 'T3'],
    claim: 'The project already checks packaging, signatures, and update metadata.',
    evidence: 'The checklist separates build verification from publication.',
  },
  {
    id: 6,
    url: 'https://example.com/fast-desktop-releases',
    title: 'Ship desktop updates in one step',
    publisher: 'Example Engineering',
    publishedAt: '2023-03-11',
    kind: 'analysis',
    status: 'excluded',
    threadIds: ['T3'],
    claim: 'A single unreviewed publication step reduces release time.',
    evidence: 'The article gives no rollback data or signing guidance.',
    exclusionReason: 'Excluded because the article has no reproducible evidence or platform security analysis.',
  },
].map((source) => ({
  ...source,
  key: canonicalResearchSourceKey(source),
}))

const researchThreads = [
  {
    id: 'T1',
    title: 'Distribution controls',
    task: 'Compare staged update channels and release gates.',
    status: 'done',
    summary: 'Use staged channels with explicit promotion criteria and a tested rollback path.',
    sourceIds: [1, 5],
    childSession: {
      id: 'research-child-distribution',
      path: '/workspace/harbor/sessions/research-child-distribution.jsonl',
      cwd: '/workspace/harbor',
    },
    startedAt: fixedNow - 420000,
    completedAt: fixedNow - 240000,
  },
  {
    id: 'T2',
    title: 'Signing and provenance',
    task: 'Review package signing and build provenance requirements.',
    status: 'done',
    summary: 'Sign every platform artifact and publish provenance from the release workflow.',
    sourceIds: [2, 3],
    childSession: {
      id: 'research-child-signing',
      path: '/workspace/harbor/sessions/research-child-signing.jsonl',
      cwd: '/workspace/harbor',
    },
    startedAt: fixedNow - 420000,
    completedAt: fixedNow - 210000,
  },
  {
    id: 'T3',
    title: 'Rollback and operations',
    task: 'Find release approval, monitoring, and rollback practices.',
    status: 'done',
    summary: 'Use protected release environments, observable rollout stages, and a rehearsed rollback action.',
    sourceIds: [4, 5, 6],
    childSession: {
      id: 'research-child-operations',
      path: '/workspace/harbor/sessions/research-child-operations.jsonl',
      cwd: '/workspace/harbor',
    },
    startedAt: fixedNow - 420000,
    completedAt: fixedNow - 180000,
  },
]

const researchState = {
  version: 1,
  sessionId: 'research-session',
  status: 'complete',
  phase: 'report',
  objective: 'Compare release strategies for a small desktop app and recommend a safe rollout plan.',
  strategy: 'Review distribution controls, artifact trust, and rollback operations in parallel.',
  note: 'Write a decision-oriented report with verifiable citations.',
  threads: researchThreads,
  sources: researchSources,
  reportTitle: 'Safer desktop release strategy',
  reportEntryId: 'research-report',
  reportRequestedAt: fixedNow - 120000,
  citedSourceIds: [1, 2, 3, 4],
  error: '',
  createdAt: fixedNow - 480000,
  updatedAt: fixedNow - 60000,
  completedAt: fixedNow - 60000,
  lastEventId: 'research-complete',
  threadCount: 3,
  completedThreadCount: 3,
  sourceCount: 6,
  citedSourceCount: 4,
  excludedSourceCount: 1,
}

const researchSession = session(
  'research-session',
  'Choose a safer desktop release strategy',
  '2026-08-06T15:52:00.000Z',
  7,
  '/workspace/harbor',
  compactResearchState(researchState),
)

const sessions = [
  session('demo-session', 'Review the release flow', '2026-08-06T15:42:00.000Z', 5),
  session('release-checks', 'Add release verification', '2026-08-06T14:25:00.000Z', 18),
  session('api-review', 'Review API error handling', '2026-08-05T18:10:00.000Z', 12),
  session('docs-navigation', 'Update documentation navigation', '2026-08-05T12:30:00.000Z', 9),
  session('terminal-resize', 'Fix terminal resize behavior', '2026-08-04T16:20:00.000Z', 7),
  session('mobile-header', 'Refine the mobile header', '2026-08-03T11:45:00.000Z', 14),
  session('export-layout', 'Check transcript export layout', '2026-08-02T09:15:00.000Z', 11),
  session('landing-copy', 'Tighten the landing page copy', '2026-08-01T13:20:00.000Z', 8, '/workspace/field-notes'),
  session('search-state', 'Preserve project search state', '2026-07-31T17:05:00.000Z', 6, '/workspace/field-notes'),
]

const projects = [
  { cwd: '/workspace/harbor', name: 'harbor', modified: '2026-08-06T15:49:00.000Z' },
  { cwd: '/workspace/field-notes', name: 'field-notes', modified: '2026-08-01T13:20:00.000Z' },
]

const projectDirectory = {
  parentPath: '/workspace',
  path: '/workspace',
  parent: '/',
  home: '/workspace',
  root: '/',
  entries: ['harbor', 'harbor-api', 'harbor-docs'].map((name) => ({
    name,
    fullPath: `/workspace/${name}`,
    path: `/workspace/${name}`,
    hidden: false,
  })),
}

const baseEntries = [
  messageEntry({
    id: 'user-1',
    role: 'user',
    label: 'You',
    text: 'Review `scripts/release.js` and make validation run before publication.',
    timestamp: docsTraceTimeline.timestamp,
  }),
  messageEntry({
    id: 'assistant-1',
    role: 'assistant',
    label: 'Agent',
    text: 'The script publishes before it checks the build. I will reverse those operations and keep failures visible.',
    thinking: 'I need to inspect the release order, preserve the existing error path, and make the smallest safe change.',
    timestamp: docsTraceEntryTimestamp('model1'),
  }),
  toolEntry({
    id: 'tool-read',
    label: 'Read',
    code: 'scripts/release.js',
    toolName: 'read',
    text: "export async function release() {\n  await publish()\n  await verify()\n}",
    preview: {
      kind: 'file',
      path: 'scripts/release.js',
      content: "export async function release() {\n  await publish()\n  await verify()\n}\n",
    },
    timestamp: docsTraceEntryTimestamp('read'),
  }),
  toolEntry({
    id: 'tool-edit',
    label: 'Edit',
    code: 'scripts/release.js',
    toolName: 'edit',
    text: 'Moved verification before publication.',
    preview: {
      kind: 'diff',
      path: 'scripts/release.js',
      oldText: "export async function release() {\n  await publish()\n  await verify()\n}\n",
      newText: "export async function release() {\n  await verify()\n  await publish()\n}\n",
    },
    timestamp: docsTraceEntryTimestamp('edit'),
  }),
  messageEntry({
    id: 'assistant-2',
    role: 'assistant',
    label: 'Agent',
    text: 'Updated `scripts/release.js`. Verification now finishes before publication begins.',
    timestamp: docsTraceEntryTimestamp('model3'),
    rolloutFeedback: 'helpful',
  }),
]

const fixtureGlobalInstructions = '# Shared guidelines\n\n- Use precise edits.\n- Show file paths.'
const fixtureProjectInstructions = '# Harbor\n\nRun release verification before publication.\n'
const fixtureProjectInstructionsChanged = '# Harbor\n\nRun release verification before publication. Keep this change limited to scripts/release.js.\n'
function fixtureProjectContext(projectInstructions) {
  return '<project_context>\nProject-specific instructions and guidelines:\n\n' +
    `<project_instructions path="/demo/home/.pi/agent/AGENTS.md">\n${fixtureGlobalInstructions}\n</project_instructions>\n\n` +
    `<project_instructions path="/demo/harbor/AGENTS.md">\n${projectInstructions}\n</project_instructions>\n</project_context>`
}
const fixtureInitialContext = fixtureProjectContext(fixtureProjectInstructions)
const fixtureDeltaContext = fixtureProjectContext(fixtureProjectInstructionsChanged)
const systemEntries = projectTranscriptEntries([
  {
    id: 'system-initial',
    type: 'message',
    timestamp: '2026-08-06T15:42:59.000Z',
    message: {
      role: 'system',
      timestamp: Date.parse('2026-08-06T15:42:59.000Z'),
      sections: {
        preamble: 'You are a coding assistant working on the harbor project.',
        project_context: fixtureInitialContext,
      },
      toolsAdded: [
        { name: 'read', description: 'Read project files.' },
        { name: 'bash', description: 'Run shell commands in the project directory.' },
        { name: 'edit', description: 'Make precise changes to project files.' },
      ],
    },
  },
  {
    id: 'system-delta',
    type: 'message',
    timestamp: docsTraceEntryTimestamp('edit'),
    message: {
      role: 'system',
      timestamp: Date.parse(docsTraceEntryTimestamp('edit')),
      sections: { project_context: fixtureDeltaContext },
      toolsAdded: [{ name: 'grep', description: 'Search project files for matching text.' }],
    },
  },
])
const systemTranscriptEntries = [
  systemEntries[0],
  ...baseEntries.slice(0, -1),
  systemEntries[1],
  baseEntries.at(-1),
]

const markdownPreviewContent = `# Release checklist

Complete these checks before publication.

## Required checks

- Run the production build.
- Review the generated package.
- Confirm the release notes.

\`\`\`bash
npm run build
\`\`\`

> Stop the release if a check fails.
`
const markdownPreviewEntries = [
  toolEntry({
    id: 'tool-markdown-read',
    label: 'Read',
    code: 'docs/release-checklist.md',
    toolName: 'read',
    text: markdownPreviewContent,
    preview: {
      kind: 'file',
      path: 'docs/release-checklist.md',
      content: markdownPreviewContent,
      language: 'markdown',
    },
    timestamp: '2026-08-06T15:45:00.000Z',
  }),
]

const skillPreviewContent = `---
name: release-review
description: Review release checks before publication.
---

# Release review

- Check that validation runs before publication.
- Confirm that a failed check stops the release.
`
const toolActivityEntries = [
  messageEntry({
    id: 'tools-user',
    role: 'user',
    label: 'You',
    text: `<skill name="release-review" location=".pi/skills/release-review/SKILL.md">\n${skillPreviewContent}\n</skill>\n\nCheck the release flow before publication.`,
    timestamp: '2026-08-06T15:43:00.000Z',
  }),
  toolEntry({
    id: 'tool-skill-read',
    label: 'Skill · release-review',
    code: '.pi/skills/release-review/SKILL.md',
    toolName: 'read-skill',
    text: skillPreviewContent,
    preview: {
      kind: 'file',
      path: '.pi/skills/release-review/SKILL.md',
      content: skillPreviewContent,
      language: 'markdown',
    },
    timestamp: '2026-08-06T15:44:00.000Z',
  }),
  toolEntry({
    id: 'tool-release-check',
    label: 'Bash',
    code: 'npm run verify',
    toolName: 'bash',
    text: 'Release checks passed.',
    timestamp: '2026-08-06T15:45:00.000Z',
  }),
]

const subagentOutcomeResults = [
  { agent: 'general', title: 'Release verification', task: 'Check release verification\n\nInspect the release script. Confirm that validation finishes before publication and that failed checks stop the release.' },
  { agent: 'explore', title: 'Packaging configuration', task: 'Inspect packaging configuration' },
  { agent: 'general', title: 'Rollback handling', task: 'Review rollback handling' },
  { agent: 'explore', title: 'Release notes', task: 'Check release notes' },
  { agent: 'general', title: 'Publication conditions', task: 'Review publication conditions' },
].map((task, index) => ({
  ...task,
  model: model.id,
  modelProvider: model.provider,
  modelName: model.name,
  modelSource: 'inherited',
  thinkingLevel: 'high',
  status: index === 2 ? 'stopped' : 'done',
  stopReason: index === 2 ? 'aborted' : 'stop',
  exitCode: index === 2 ? 1 : 0,
  childSession: {
    id: `release-check-${index + 1}`,
    path: `/workspace/harbor/sessions/release-check-${index + 1}.jsonl`,
  },
  messages: index === 2 ? [] : [{ role: 'assistant', content: index === 0
    ? '## Verification precedes publication\n\nThe release script completes validation before it publishes artifacts.\n\n- Build checks run first.\n- A failed check stops publication.\n- The parent session keeps the error details.'
    : 'Check complete.' }],
  error: index === 2 ? 'This operation was aborted' : undefined,
}))
const subagentOutcomeEntries = [
  messageEntry({
    id: 'subagent-outcomes-user',
    role: 'user',
    label: 'You',
    text: 'Review the release flow. Split verification, packaging, rollback handling, release notes, and publication checks across five tasks.',
    timestamp: '2026-08-06T15:43:00.000Z',
  }),
  {
    ...toolEntry({
      id: 'subagent-outcomes-tool',
      label: 'Subagent · subagent',
      code: '5 tasks',
      toolName: 'subagent',
      text: 'Four tasks completed. One task stopped.',
      timestamp: '2026-08-06T15:44:00.000Z',
    }),
    isError: true,
    subagentDetails: { mode: 'parallel', results: subagentOutcomeResults, background: false },
  },
  messageEntry({
    id: 'subagent-outcomes-assistant',
    role: 'assistant',
    label: 'Agent',
    text: 'Four checks completed. The rollback review stopped before it returned a result. The completed results are still available above.',
    timestamp: '2026-08-06T15:45:00.000Z',
  }),
]

const subagentMobileEntries = subagentOutcomeEntries.map((entry) => {
  if (entry.type === 'tool') return {
    ...entry,
    code: '3 tasks',
    text: 'Two tasks completed. One task stopped.',
    copyText: 'Two tasks completed. One task stopped.',
    subagentDetails: { ...entry.subagentDetails, results: subagentOutcomeResults.slice(0, 3) },
  }
  return messageEntry({
    id: entry.id, role: entry.role, label: entry.label, timestamp: entry.timestamp,
    text: entry.role === 'user'
      ? 'Review release verification, packaging, and rollback handling in three parallel tasks.'
      : 'Two checks completed. The rollback review stopped before it returned a result.',
  })
})

const subagentSidebarResults = [subagentOutcomeResults[0], subagentOutcomeResults[1], subagentOutcomeResults[4]]
  .map((result, index) => ({
    ...result,
    status: index ? 'running' : 'done',
    stopReason: index ? undefined : 'stop',
    exitCode: index ? -1 : 0,
    messages: index ? [] : result.messages,
  }))
const subagentSidebarEntries = [
  messageEntry({
    id: 'subagent-sidebar-user',
    role: 'user',
    label: 'You',
    text: 'Review release verification, packaging, and publication conditions in parallel.',
    timestamp: '2026-08-06T15:43:00.000Z',
  }),
  messageEntry({
    id: 'subagent-sidebar-assistant',
    role: 'assistant',
    label: 'Agent',
    text: 'Verification is complete. The packaging and publication checks are still running in separate child sessions.',
    timestamp: '2026-08-06T15:44:00.000Z',
  }),
]

const subagentLiveResult = {
  agent: 'explore',
  modelSource: 'inherited',
  title: 'Verify release safeguards',
  task: 'Review the release workflow and script. Confirm that verification runs before tagging and publication, and that a failed check stops the release.',
  status: 'running',
  exitCode: -1,
  childSession: { id: 'release-live-check', path: '/workspace/harbor/sessions/release-live-check.jsonl', cwd: '/workspace/harbor' },
  messages: [],
}
const subagentLiveEntries = [
  messageEntry({
    id: 'subagent-live-user',
    role: 'user',
    label: 'You',
    text: 'Review the release workflow and report whether a failed verification stops publication.',
    timestamp: '2026-08-06T15:58:00.000Z',
  }),
  messageEntry({
    id: 'subagent-live-assistant',
    role: 'assistant',
    label: 'Agent',
    text: 'I will check the workflow and release script in a separate child session.',
    timestamp: '2026-08-06T15:58:10.000Z',
  }),
]
const subagentLiveChildEntries = projectTranscriptEntries([
  {
    id: 'live-child-prompt', type: 'message', timestamp: '2026-08-06T15:58:15.000Z',
    message: { role: 'user', content: [{ type: 'text', text: subagentLiveResult.task }] },
  },
  {
    id: 'live-child-first', type: 'message', timestamp: '2026-08-06T15:58:25.000Z',
    message: { role: 'assistant', content: [
      { type: 'thinking', thinking: 'Trace verification, tagging, and publication in order.' },
      { type: 'text', text: '**Verification** runs before release. I am checking the failure path.' },
    ] },
  },
  {
    id: 'live-child-file-calls', type: 'message', timestamp: '2026-08-06T15:58:30.000Z',
    message: { role: 'assistant', content: [
      { type: 'toolCall', id: 'live-read-workflow', name: 'read', arguments: { path: '.github/workflows/release.yml' } },
      { type: 'toolCall', id: 'live-read-script', name: 'read', arguments: { path: 'scripts/release.js' } },
      { type: 'toolCall', id: 'live-search-order', name: 'grep', arguments: { path: 'scripts/release.js', pattern: 'verify|tag|publish' } },
    ] },
  },
  {
    id: 'live-child-workflow', type: 'message', timestamp: '2026-08-06T15:58:31.000Z',
    message: { role: 'toolResult', toolCallId: 'live-read-workflow', toolName: 'read', content: [{ type: 'text', text: 'steps:\n  - run: npm run verify\n  - run: node scripts/release.js' }] },
  },
  {
    id: 'live-child-script', type: 'message', timestamp: '2026-08-06T15:58:32.000Z',
    message: { role: 'toolResult', toolCallId: 'live-read-script', toolName: 'read', content: [{ type: 'text', text: 'await verify()\nawait tag()\nawait publish()' }] },
  },
  {
    id: 'live-child-search', type: 'message', timestamp: '2026-08-06T15:58:33.000Z',
    message: { role: 'toolResult', toolCallId: 'live-search-order', toolName: 'grep', content: [{ type: 'text', text: 'scripts/release.js:4: await verify()\nscripts/release.js:5: await tag()\nscripts/release.js:6: await publish()' }] },
  },
  {
    id: 'live-child-progress', type: 'message', timestamp: '2026-08-06T15:59:50.000Z',
    message: { role: 'assistant', content: [
      { type: 'text', text: 'A failed check stops tagging. I am running `npm run verify`.' },
      { type: 'toolCall', id: 'live-release-verify', name: 'bash', arguments: { command: 'npm run verify' } },
    ] },
  },
], { toolArguments: true })
const subagentLiveChildDetail = {
  session: {
    ...session(subagentLiveResult.childSession.id, subagentLiveResult.title, '2026-08-06T15:58:15.000Z', 7),
    sessionFile: subagentLiveResult.childSession.path,
    parentSessionPath: '/workspace/harbor/sessions/demo-session.jsonl',
    isSubagentSession: true,
    contextTokens: 3840,
    created: '2026-08-06T15:58:15.000Z',
  },
  entries: subagentLiveChildEntries,
}
const subagentSavedChildDetails = subagentOutcomeResults.map((result, index) => {
  const target = ['scripts/release.js', 'package.json', 'scripts/rollback.js', 'CHANGELOG.md', '.github/workflows/release.yml'][index]
  const content = ['await verify()\nawait tag()\nawait publish()', '{ "scripts": { "package": "node scripts/package.js" } }', 'await restorePreviousRelease()', '## Next release\n\n- Verify before publication.', 'steps:\n  - run: npm run verify\n  - run: node scripts/release.js'][index]
  const stopped = result.status === 'stopped'
  return {
    session: {
      ...session(result.childSession.id, result.title, '2026-08-06T15:44:00.000Z', 7),
      sessionFile: result.childSession.path,
      parentSessionPath: '/workspace/harbor/sessions/demo-session.jsonl',
      isSubagentSession: true,
    },
    entries: projectTranscriptEntries([
      { id: 'child-prompt', type: 'message', timestamp: '2026-08-06T15:44:00.000Z', message: { role: 'user', content: [{ type: 'text', text: result.task }] } },
      { id: 'child-plan', type: 'message', timestamp: '2026-08-06T15:44:01.000Z', message: { role: 'assistant', content: [{ type: 'thinking', thinking: 'Check the release inputs before publication.' }, { type: 'toolCall', id: 'read-release-input', name: 'read', arguments: { path: target } }] } },
      { id: 'child-read', type: 'message', timestamp: '2026-08-06T15:44:02.000Z', message: { role: 'toolResult', toolCallId: 'read-release-input', toolName: 'read', content: [{ type: 'text', text: content }] } },
      { id: 'child-check-call', type: 'message', timestamp: '2026-08-06T15:44:03.000Z', message: { role: 'assistant', content: [{ type: 'toolCall', id: 'run-release-check', name: 'bash', arguments: { command: 'npm run verify' } }] } },
      { id: 'child-check', type: 'message', timestamp: '2026-08-06T15:44:04.000Z', message: { role: 'toolResult', toolCallId: 'run-release-check', toolName: 'bash', cancelled: stopped, isError: stopped, content: [{ type: 'text', text: stopped ? result.error : 'Release checks passed.\nNo artifacts were published.' }] } },
      ...result.messages.map((message, messageIndex) => ({ id: `child-result-${messageIndex}`, type: 'message', timestamp: '2026-08-06T15:44:05.000Z', message: { ...message, content: [{ type: 'text', text: message.content }] } })),
    ], { toolArguments: true }),
  }
})

const researchEntries = [
  messageEntry({
    id: 'research-user',
    role: 'user',
    label: 'You',
    text: researchState.objective,
    timestamp: '2026-08-06T15:53:00.000Z',
  }),
  messageEntry({
    id: 'research-plan',
    role: 'assistant',
    label: 'Agent',
    text: `I will compare three independent parts of the release process:

1. Distribution controls and staged updates
2. Artifact signing and build provenance
3. Release approval, monitoring, and rollback`,
    timestamp: '2026-08-06T15:54:00.000Z',
  }),
  {
    id: 'research-threads',
    type: 'tool',
    label: 'Research threads',
    code: '3 threads',
    toolName: 'subagent',
    text: 'Three research threads completed.',
    subagentDetails: {
      mode: 'parallel',
      results: researchThreads.map((thread) => ({
        agent: 'researcher',
        agentSource: 'bundled',
        title: thread.title,
        task: `[${thread.id}] ${thread.task}`,
        status: 'done',
        research: {
          threadId: thread.id,
          title: thread.title,
          summary: thread.summary,
          sources: thread.sourceIds.map((id) => ({ id })),
        },
        childSession: thread.childSession,
        exitCode: 0,
        messages: [{ role: 'assistant', content: thread.summary }],
        usage: {
          inputTokens: 2100,
          outputTokens: 680,
          totalTokens: 2780,
          cost: 0,
          turns: 4,
        },
      })),
    },
    researchThreads: true,
    isError: false,
    copyText: 'Research threads\n3 threads completed',
    timestamp: '2026-08-06T15:57:00.000Z',
    rolloutFeedback: '',
    rolloutFeedbackText: '',
  },
  {
    ...messageEntry({
      id: 'research-report',
      role: 'assistant',
      label: 'Assistant · research artifact',
      text: `# Safer desktop release strategy

**Recommendation:** Use signed artifacts, protected promotion stages, and a rehearsed rollback action.

Validate update checks, downloads, and installation in a preview channel before broad rollout [1](https://www.electronjs.org/docs/latest/api/auto-updater).

Sign each platform artifact [2](https://www.electronjs.org/docs/latest/tutorial/code-signing) and publish build provenance from CI [3](https://docs.npmjs.com/generating-provenance-statements).

## Rollout plan

1. Verify packaging, signatures, update metadata, and smoke tests.
2. Promote through a protected release environment [4](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments).
3. Hold each rollout stage until crash and update metrics remain within limits.
4. Stop promotion and restore the prior update manifest when a limit fails.`,
      timestamp: '2026-08-06T15:59:00.000Z',
    }),
    researchReport: {
      title: researchState.reportTitle,
      sourceIds: researchState.citedSourceIds,
      sourceCount: researchState.sourceCount,
      citedSourceCount: researchState.citedSourceCount,
      sources: researchSources.filter((source) => {
        return researchState.citedSourceIds.includes(source.id)
      }).map((source) => ({
        id: source.id,
        key: source.key,
        url: source.url || '',
        path: source.path || '',
      })),
    },
  },
]

const visionEntries = [
  messageEntry({
    id: 'vision-user',
    role: 'user',
    label: 'You',
    text: 'What does this warning mean, and what should I do before publication?',
    images: [visionAlertImage],
    timestamp: '2026-08-06T15:43:00.000Z',
  }),
  toolEntry({
    id: 'tool-vision-agent',
    label: 'Tool · vision_agent',
    code: '',
    toolName: 'vision_agent',
    text: 'The image shows a release validation warning. Verification is required before publication. Run the checks, fix failures, then publish.',
    timestamp: '2026-08-06T15:44:00.000Z',
  }),
]

const shellEntries = [
  ...baseEntries,
  toolEntry({
    id: 'tool-bash-context',
    label: 'Bash',
    code: 'npm run docs:build',
    toolName: 'bash',
    text: 'documentation build complete',
    contextLabel: 'in context',
    timestamp: '2026-08-06T15:48:00.000Z',
  }),
  toolEntry({
    id: 'tool-bash-hidden',
    label: 'Bash',
    code: 'git status --short',
    toolName: 'bash',
    text: 'working tree clean',
    contextLabel: 'not in context',
    excludeFromContext: true,
    timestamp: '2026-08-06T15:49:00.000Z',
  }),
]

const memoryPayload = {
  context: {
    cwd: '/workspace/harbor',
    projectId: 'project_harbor',
    projectName: 'harbor',
    projectRoot: '/workspace/harbor',
    sessionAvailable: true,
    sessionFile: '/workspace/harbor/sessions/demo-session.jsonl',
    sessionId: 'session_demo',
  },
  memories: [
    memory('mem_project', 'project', 'Run release verification before publication.', ['release', 'safety']),
    memory('mem_session', 'session', 'Keep the current change limited to the release script.', ['scope']),
    memory('mem_global', 'global', 'Use concise technical English in project documentation.', ['docs']),
    memory('mem_archived', 'project', 'The old release job used a manual approval step.', ['archive'], 'archived'),
  ],
  counts: {
    active: 3,
    archived: 1,
    scopes: {
      project: { active: 1, archived: 1 },
      session: { active: 1, archived: 0 },
      global: { active: 1, archived: 0 },
    },
  },
}

const subagentPayload = {
  context: memoryPayload.context,
  batching: { global: 4, session: null, effective: 4, source: 'global' },
  agents: [
    {
      key: 'project:/workspace/harbor/.pi/agents/reviewer.md:reviewer',
      name: 'reviewer',
      description: 'Reviews implementation changes for release risks.',
      source: 'project',
      path: '/workspace/harbor/.pi/agents/reviewer.md',
      model: 'inherit',
      thinking: 'high',
      tools: ['read', 'grep'],
      overrides: { global: 'local/glm-5.3-flash', session: 'local/glm-5.3-flash' },
      effectiveModel: 'local/glm-5.3-flash',
      modelSource: 'session',
    },
    {
      key: 'user:/workspace/agents/researcher.md:researcher',
      name: 'researcher',
      description: 'Finds source evidence before implementation begins.',
      source: 'user',
      path: '/workspace/agents/researcher.md',
      model: 'local/glm-5.3-flash',
      thinking: 'medium',
      tools: ['read', 'grep', 'bash'],
      overrides: { global: 'local/glm-5.3-flash', project: 'local/glm-5.3-flash' },
      effectiveModel: 'local/glm-5.3-flash',
      modelSource: 'project',
    },
  ],
}

function subagentConfigPayload({ cwd, sessionPath }, batching) {
  const sessionAvailable = Boolean(sessionPath)
  const session = sessionAvailable ? batching.session : null
  return {
    ...subagentPayload,
    context: {
      ...memoryPayload.context,
      cwd,
      sessionAvailable,
      sessionFile: sessionPath || null,
      sessionId: sessionAvailable ? memoryPayload.context.sessionId : null,
    },
    batching: { global: batching.global, session, effective: session ?? batching.global, source: session === null ? 'global' : 'session' },
    agents: subagentPayload.agents.map(agent => {
      const overrides = Object.fromEntries(Object.entries(agent.overrides).filter(([scope]) => sessionAvailable || scope !== 'session'))
      const modelSource = ['session', 'project', 'global'].find(scope => overrides[scope]) || 'definition'
      return { ...agent, overrides, effectiveModel: overrides[modelSource] || agent.model, modelSource }
    }),
  }
}

const visionConfigPayload = (sessionAvailable) => ({
  context: {
    ...memoryPayload.context,
    sessionAvailable,
    sessionFile: sessionAvailable ? memoryPayload.context.sessionFile : null,
    sessionId: sessionAvailable ? memoryPayload.context.sessionId : null,
  },
  overrides: {
    global: { model: 'local/qwen3.6-27b', thinking: '' },
    project: { model: 'local/qwen3.6-27b', thinking: 'medium' },
    ...(sessionAvailable
      ? { session: { model: 'local/qwen3.6-27b', thinking: 'high' } }
      : {}),
  },
  model: 'local/qwen3.6-27b',
  modelSource: sessionAvailable ? 'session' : 'project',
  thinking: sessionAvailable ? 'high' : 'medium',
  thinkingSource: sessionAvailable ? 'session' : 'project',
})

const traceFixtures = await docsTraces(baseEntries, sessions)
const primaryTrace = traceFixtures[0]
const traceEditObservation = primaryTrace.observations.find(item => item.type === 'TOOL' && item.metadata.toolResultEntryId === 'tool-edit')
const traceFinalGeneration = primaryTrace.observations.find(item => item.type === 'GENERATION' && item.metadata.messageEntryId === 'assistant-2')
const traceAssetNames = ['trace-inspector.png', 'trace-workspace.png', 'trace-explorer.png', 'trace-capture.png', 'trace-mobile.png', 'tracing.png']
const pinnedAssetNames = ['pinned-sessions.png', 'pinned-only.png']
const networkAssetNames = ['network-access.png', 'network-access-mobile.png']
const subagentAssetNames = ['subagent-sidebar.png', 'subagent-outcomes.png', 'subagent-inspector-mobile.png', 'subagent-inspector-export.png', 'subagent-live-tail.png', 'subagent-live-tail-mobile.png']
const embeddedAssetNames = ['embedded-inspector.png', 'embedded-workspace.png', 'embedded-explorer.png']
const allowedNames = new Set([
  ...await fs.readdir(docsOutputDir),
  ...await fs.readdir(readmeOutputDir),
  ...traceAssetNames,
  ...pinnedAssetNames,
  ...networkAssetNames,
  ...subagentAssetNames,
  'subagent-batch-size.png',
  'subagent-batch-size-mobile.png',
  'tool-activity.png',
  'composer-issue.png',
  'composer-issue-mobile.png',
  'composer-send-unavailable.png',
  'dictation.png',
  'dictation-settings.png',
  'dictation-mobile.png',
  'session-title-settings.png',
  'session-title-settings-mobile.png',
  'session-title-generating.png',
  'service-tiers.png',
  'mobile-speed.png',
  ...(eluneOutputDir ? embeddedAssetNames : []),
])
for (const name of screenshotFilter) {
  if (path.basename(name) !== name || !name.endsWith('.png') || !allowedNames.has(name)) {
    throw new Error(`Unknown screenshot basename: ${name}`)
  }
}
await ensureServer()
await fs.mkdir(docsOutputDir, { recursive: true })
await fs.mkdir(readmeOutputDir, { recursive: true })
if (eluneOutputDir) await fs.mkdir(eluneOutputDir, { recursive: true })

const browser = await chromium.launch()
try {
  await capture({
    browser,
    file: path.join(docsOutputDir, 'trace-inspector.png'),
    embeddedFile: eluneOutputDir && path.join(eluneOutputDir, 'embedded-inspector.png'),
    route: '/sessions/demo-session',
    ready: '.assistant-message',
    scenario: 'trace',
    interact: openTraceInspector,
  })
  await capture({
    browser,
    file: path.join(docsOutputDir, 'trace-workspace.png'),
    embeddedFile: eluneOutputDir && path.join(eluneOutputDir, 'embedded-workspace.png'),
    route: '/sessions/demo-session',
    ready: '.assistant-message',
    scenario: 'trace',
    interact: openTraceWorkspace,
  })
  await capture({
    browser,
    file: path.join(docsOutputDir, 'trace-explorer.png'),
    embeddedFile: eluneOutputDir && path.join(eluneOutputDir, 'embedded-explorer.png'),
    route: '/sessions/demo-session',
    ready: '.assistant-message',
    scenario: 'trace',
    interact: async (page) => {
      await page.getByRole('button', { name: 'Trace explorer', exact: true }).click()
      await waitForTrace(page)
      await page.locator('.elune-table tbody tr').nth(4).waitFor()
      await page.locator(`[data-observation-id="${traceEditObservation.id}"]`).click()
      await page.locator('.elune-detail-heading h3').filter({ hasText: traceEditObservation.name }).waitFor()
      await page.locator('.elune-tabs button').filter({ hasText: /^input$/ }).click()
      await page.locator('.elune-table').getByText('field-notes', { exact: true }).first().waitFor()
      if (await page.getByRole('combobox', { name: 'Trace project', exact: true }).inputValue()) throw new Error('Explorer project filter is not clear')
    },
  })
  await capture({
    browser,
    file: path.join(docsOutputDir, 'trace-capture.png'),
    route: '/sessions/demo-session',
    ready: '.assistant-message',
    scenario: 'trace',
    interact: async (page) => {
      await openTraceInspector(page)
      await page.locator(`[data-observation-id="${traceFinalGeneration.id}"]`).click()
      await page.locator('.elune-detail-heading h3').filter({ hasText: traceFinalGeneration.name }).waitFor()
      await page.locator('.elune-tabs button').filter({ hasText: /^output$/ }).click()
      await page.locator('.trace-host-footer summary').click()
      await assertTraceContentReachable(page)
      await page.locator(`[data-observation-id="${traceFinalGeneration.id}"]`).scrollIntoViewIfNeeded()
    },
  })
  await capture({
    browser,
    file: path.join(docsOutputDir, 'trace-mobile.png'),
    route: '/sessions/demo-session',
    ready: '.composer .mobile-model-control',
    viewport: { width: 390, height: 844 },
    scenario: 'trace',
    interact: async (page) => {
      await openTraceInspector(page)
      await page.locator('.elune-pane-switch button[data-panel="detail"]').filter({ hasText: 'Selected detail' }).waitFor()
      await assertTraceContentReachable(page)
    },
  })
  await capture({
    browser,
    file: path.join(readmeOutputDir, 'tracing.png'),
    route: '/sessions/demo-session',
    ready: '.assistant-message',
    viewport: { width: 1503, height: 818 },
    scenario: 'trace',
    interact: openTraceWorkspace,
    macWindow: true,
  })
  await capture({
    browser,
    file: path.join(docsOutputDir, 'dictation.png'),
    route: '/sessions/demo-session',
    ready: '.assistant-message',
    scenario: 'dictation',
    interact: startDictationCapture,
  })
  await capture({
    browser,
    file: path.join(docsOutputDir, 'dictation-settings.png'),
    route: '/sessions/demo-session',
    ready: '.assistant-message',
    scenario: 'dictation-settings',
    interact: openDictationSettings,
  })
  await capture({
    browser,
    file: path.join(docsOutputDir, 'dictation-mobile.png'),
    route: '/sessions/demo-session',
    ready: '.assistant-message',
    viewport: { width: 390, height: 844 },
    scenario: 'dictation',
    interact: startDictationCapture,
  })
  await capture({
    browser,
    file: path.join(readmeOutputDir, 'dictation.png'),
    route: '/sessions/demo-session',
    ready: '.assistant-message',
    viewport: { width: 1503, height: 818 },
    scenario: 'dictation',
    interact: startDictationCapture,
    macWindow: true,
  })
  await capture({
    browser,
    file: path.join(docsOutputDir, 'session-title-settings.png'),
    route: '/sessions/demo-session',
    ready: '.assistant-message',
    scenario: 'title-settings',
    interact: openSessionTitleSettings,
  })
  await capture({
    browser,
    file: path.join(docsOutputDir, 'session-title-settings-mobile.png'),
    route: '/sessions/demo-session',
    ready: '.assistant-message',
    viewport: { width: 390, height: 844 },
    scenario: 'title-settings',
    interact: openSessionTitleSettings,
  })
  await capture({
    browser,
    file: path.join(docsOutputDir, 'session-title-generating.png'),
    route: '/sessions/demo-session',
    ready: '.user-message',
    scenario: 'title-generating',
    interact: async (page) => {
      await page.locator('.workbench-title-button .session-title-pending').filter({ hasText: 'Generating title…' }).waitFor()
      await page.locator('.sidebar .session-title-pending').filter({ hasText: 'Generating title…' }).waitFor()
      if (await page.locator('.user-message').count() !== 1 || await page.locator('.assistant-message').count()) {
        throw new Error('Pending title capture must show only the first accepted message')
      }
    },
  })
  await capture({
    browser,
    file: path.join(docsOutputDir, 'home.png'),
    route: '/',
    ready: '.research-mode-chip',
    scenario: 'home',
  })
  await capture({
    browser,
    file: path.join(docsOutputDir, 'workbench.png'),
    route: '/sessions/demo-session',
    ready: '.assistant-message .thinking-trigger',
    scenario: 'ultrafast',
    sidebarChildren: true,
    interact: (page) => openSidebarChildren(page, 2),
  })
  await capture({
    browser,
    file: path.join(docsOutputDir, 'system-message.png'),
    route: '/sessions/demo-session',
    ready: '.system-prompt-row',
    scenario: 'system',
    interact: async (page) => {
      const before = await page.locator('.workbench').boundingBox()
      await page.locator('.system-prompt-trigger').last().click()
      const inspector = page.locator('.system-prompt-inspector')
      await inspector.locator('[data-line-type="change-deletion"]').filter({ hasText: 'Run release verification before publication.' }).waitFor()
      await inspector.locator('[data-line-type="change-addition"]').filter({ hasText: 'Keep this change limited' }).waitFor()
      const after = await page.locator('.workbench').boundingBox()
      if (before.width !== after.width) throw new Error('Prompt inspector moved the transcript')
    },
    clipSelectors: ['.system-prompt-row', '.system-prompt-inspector'],
    padding: 18,
  })
  await capture({
    browser,
    file: path.join(docsOutputDir, 'deep-research.png'),
    route: '/sessions/research-session',
    ready: '.research-report-message',
    scenario: 'research',
    sidebarChildren: true,
    interact: async (page) => {
      await waitForResearchSources(page)
      await openSidebarChildren(page, 3)
    },
  })
  await capture({
    browser,
    file: path.join(docsOutputDir, 'git-review.png'),
    route: '/sessions/demo-session',
    ready: '.assistant-message',
    scenario: 'review',
    interact: async (page) => {
      await page.getByRole('button', { name: 'Review changes' }).click()
      const pane = page.locator('aside[aria-label="Review project changes"]')
      await pane.waitFor({ state: 'visible' })
      await pane.locator('.review-diff-section').nth(1).waitFor()
    },
  })
  await capture({
    browser,
    file: path.join(docsOutputDir, 'git-review-expanded.png'),
    route: '/sessions/demo-session',
    ready: '.assistant-message',
    scenario: 'review',
    interact: async (page) => {
      await page.getByRole('button', { name: 'Review changes' }).click()
      const pane = page.locator('aside[aria-label="Review project changes"]')
      await pane.waitFor({ state: 'visible' })
      await pane.getByRole('button', { name: 'Expand review' }).click()
      await page.locator('.leyline-app.review-expanded').waitFor()
      await pane.locator('.review-diff-section').nth(1).waitFor()
    },
  })
  await capture({
    browser,
    file: path.join(docsOutputDir, 'pinned-sessions.png'),
    route: '/sessions/demo-session',
    ready: '.assistant-message',
    scenario: 'pinned',
    interact: async (page) => {
      await page.locator('.session-time-heading', { hasText: 'Pinned' }).waitFor()
      await page.locator('.session-meta > .session-pinned-icon').nth(1).waitFor()
    },
  })
  await capture({
    browser,
    file: path.join(docsOutputDir, 'pinned-only.png'),
    route: '/sessions/demo-session',
    ready: '.assistant-message',
    scenario: 'pinned',
    interact: async (page) => {
      await page.locator('.session-meta > .session-pinned-icon').nth(1).waitFor()
      await page.getByRole('button', { name: 'Show pinned sessions only', exact: true }).click()
      await page.locator('.sidebar-pin-filter[aria-pressed="true"]').waitFor()
      await page.getByRole('textbox', { name: 'Search pinned sessions in this project', exact: true }).waitFor()
      await page.waitForFunction(() => {
        const rows = document.querySelectorAll('.project-session-row')
        const count = document.querySelector('.project-session-heading span:last-child')
        return rows.length === 2 && [...rows].every(row => row.querySelector('.session-meta > .session-pinned-icon'))
          && count?.textContent.trim() === '2 of 7'
      })
    },
  })
  await capture({
    browser,
    file: path.join(docsOutputDir, 'project-navigation.png'),
    route: '/sessions/demo-session',
    ready: '.assistant-message',
    interact: async (page) => {
      await page.locator('.sidebar-project-shortcut', { hasText: 'Go to' }).click()
      await page.getByRole('dialog', { name: 'Go to' }).waitFor()
    },
  })
  await capture({
    browser,
    file: path.join(docsOutputDir, 'add-project.png'),
    route: '/sessions/demo-session',
    ready: '.assistant-message',
    interact: async (page) => {
      await page.locator('.sidebar-project-shortcut', { hasText: 'Go to' }).click()
      await page.locator('.sidebar-navigator-add-project').click()
      const dialog = page.getByRole('dialog', { name: 'Add project' })
      await dialog.getByRole('button', { name: 'harbor-docs' }).waitFor()
    },
  })
  await capture({
    browser,
    file: path.join(docsOutputDir, 'activity.png'),
    route: '/sessions/demo-session',
    ready: '.assistant-message',
    scenario: 'activity',
    interact: openActivity,
  })
  await capture({
    browser,
    file: path.join(docsOutputDir, 'project-details.png'),
    route: '/sessions/demo-session',
    ready: '.assistant-message',
    interact: async (page) => {
      const sidebar = page.locator('.project-sidebar')
      await sidebar.getByRole('button', { name: 'Project actions' }).click()
      await sidebar.getByRole('button', { name: 'Project settings' }).click()
      const drawer = page.locator('aside[aria-label="Project settings"]')
      await drawer.locator('section[aria-label="Vision agent"][aria-busy="false"]').waitFor()
      await drawer.locator('section[aria-label="Subagents"][aria-busy="false"]').waitFor()
      await drawer.getByRole('combobox', { name: /^Vision model/ }).locator('option[value="local/qwen3.6-27b"]:checked').waitFor({ state: 'attached' })
      await drawer.locator('.settings-metadata-list > div').last().scrollIntoViewIfNeeded()
    },
  })
  await capture({
    browser,
    file: path.join(docsOutputDir, 'backend-connections.png'),
    route: '/sessions/demo-session',
    ready: '.assistant-message',
    interact: openBackendConnections,
  })
  await capture({
    browser,
    file: path.join(docsOutputDir, 'network-access.png'),
    route: '/sessions/demo-session',
    ready: '.assistant-message',
    scenario: 'network',
    interact: (page) => openBackendConnections(page, true),
  })
  await capture({
    browser,
    file: path.join(docsOutputDir, 'network-access-mobile.png'),
    route: '/sessions/demo-session',
    ready: '.composer .mobile-model-control',
    scenario: 'network',
    viewport: { width: 390, height: 844 },
    interact: (page) => openBackendConnections(page, true),
  })
  await capture({
    browser,
    file: path.join(docsOutputDir, 'models-providers.png'),
    route: '/sessions/demo-session',
    ready: '.assistant-message',
    interact: async (page) => {
      await page.getByRole('button', { name: 'Open settings', exact: true }).click()
      const dialog = page.getByRole('dialog', { name: 'Leyline settings' })
      await dialog.getByRole('button', { name: 'Models & providers', exact: true }).click()
      await dialog.locator('.pi-settings-workspace[aria-busy="false"]').waitFor()
      await dialog.getByRole('button', { name: 'Connection', exact: true }).click()
      await dialog.getByText('http://localhost:8000/v1', { exact: true }).waitFor()
      await dialog.getByRole('button', { name: 'Edit configuration', exact: true }).waitFor()
    },
  })
  await capture({
    browser,
    file: path.join(docsOutputDir, 'provider-models.png'),
    route: '/sessions/demo-session',
    ready: '.assistant-message',
    interact: async (page) => {
      await page.getByRole('button', { name: 'Open settings', exact: true }).click()
      const dialog = page.getByRole('dialog', { name: 'Leyline settings' })
      await dialog.getByRole('button', { name: 'Models & providers', exact: true }).click()
      await dialog.locator('.pi-settings-workspace[aria-busy="false"]').waitFor()
      await dialog.getByRole('button', { name: 'Models 3', exact: true }).click()
      await dialog.locator('.pi-settings-model-row').nth(2).waitFor()
    },
  })
  await capture({
    browser,
    file: path.join(docsOutputDir, 'model-catalog.png'),
    route: '/sessions/demo-session',
    ready: '.assistant-message',
    scenario: 'model-catalog',
    interact: openModelCatalog,
  })
  await capture({
    browser,
    file: path.join(docsOutputDir, 'model-editor.png'),
    route: '/sessions/demo-session',
    ready: '.assistant-message',
    scenario: 'model-catalog',
    interact: async (page) => {
      const dialog = await openModelCatalog(page)
      await dialog.getByRole('button', { name: 'Copy into draft', exact: true }).click()
      await dialog.locator('[data-model-section="model"]').waitFor()
      if (await dialog.locator('input[name="id"]').inputValue() !== qwenCatalogModel.id) throw new Error('Catalog ID was not copied')
      if (await dialog.locator('input[name="contextWindow"]').inputValue() !== String(qwenCatalogModel.contextWindow)) throw new Error('Catalog limits were not copied')
    },
  })
  await capture({
    browser,
    file: path.join(docsOutputDir, 'model-thinking.png'),
    route: '/sessions/demo-session',
    ready: '.assistant-message',
    scenario: 'model-catalog',
    interact: async (page) => {
      const dialog = await openModelCatalog(page)
      await dialog.getByRole('button', { name: 'Copy into draft', exact: true }).click()
      await dialog.locator('input[name="id"]').fill('qwen3.8-27b')
      await dialog.locator('input[name="contextWindow"]').fill('262144')
      await dialog.locator('input[name="maxTokens"]').fill('32768')
      await dialog.getByRole('button', { name: 'Thinking & compatibility', exact: true }).click()
      await dialog.locator('[data-model-section="thinking"]').waitFor()
      if (await dialog.getByRole('combobox', { name: 'high thinking behavior', exact: true }).inputValue() !== 'unsupported') throw new Error('Catalog thinking map was not copied')
      if (await dialog.locator('.pi-settings-role-control select').inputValue() !== 'false') throw new Error('Catalog developer role was not copied')
    },
  })
  await capture({
    browser,
    file: path.join(docsOutputDir, 'provider-connection-test.png'),
    route: '/sessions/demo-session',
    ready: '.assistant-message',
    interact: async (page) => {
      await page.getByRole('button', { name: 'Open settings', exact: true }).click()
      const dialog = page.getByRole('dialog', { name: 'Leyline settings' })
      await dialog.getByRole('button', { name: 'Models & providers', exact: true }).click()
      await dialog.locator('.pi-settings-workspace[aria-busy="false"]').waitFor()
      await dialog.getByRole('button', { name: 'Connection', exact: true }).click()
      await dialog.getByRole('button', { name: 'Edit configuration', exact: true }).click()
      await dialog.getByRole('textbox', { name: /^Base URL/ }).fill('http://localhost:9000/v1')
      const actions = dialog.locator('.pi-settings-draft-actions')
      await actions.getByRole('button', { name: 'Test connection', exact: true }).click()
      await actions.getByText('Connection test passed in 0.2 seconds (HTTP 200).', { exact: true }).waitFor()
      await actions.scrollIntoViewIfNeeded()
    },
  })
  await capture({
    browser,
    file: path.join(docsOutputDir, 'model-connection-test.png'),
    route: '/sessions/demo-session',
    ready: '.assistant-message',
    interact: async (page) => {
      await page.getByRole('button', { name: 'Open settings', exact: true }).click()
      const dialog = page.getByRole('dialog', { name: 'Leyline settings' })
      await dialog.getByRole('button', { name: 'Models & providers', exact: true }).click()
      await dialog.locator('.pi-settings-workspace[aria-busy="false"]').waitFor()
      await dialog.getByRole('button', { name: 'Edit GLM 5.3 Flash (glm-5.3-flash)', exact: true }).click()
      await dialog.getByRole('textbox', { name: /^Display name/ }).fill('GLM 5.3 Flash (draft)')
      const actions = dialog.locator('.pi-settings-draft-actions')
      await actions.getByRole('button', { name: 'Test connection', exact: true }).click()
      await actions.getByText('Connection test passed in 0.2 seconds (HTTP 200).', { exact: true }).waitFor()
      await actions.scrollIntoViewIfNeeded()
    },
  })
  await capture({
    browser,
    file: path.join(docsOutputDir, 'mcp-servers.png'),
    route: '/sessions/demo-session',
    ready: '.assistant-message',
    interact: async (page) => {
      await page.getByRole('button', { name: 'Open settings', exact: true }).click()
      const dialog = page.getByRole('dialog', { name: 'Leyline settings' })
      await dialog.getByRole('button', { name: 'MCP servers', exact: true }).click()
      await dialog.locator('.pi-settings-workspace[aria-busy="false"]').waitFor()
      await dialog.getByRole('region', { name: 'Server settings' }).getByRole('heading', { name: 'documentation', exact: true }).waitFor()
      await dialog.getByText('https://docs.example.com/mcp', { exact: true }).waitFor()
      await dialog.getByRole('button', { name: 'Check connection', exact: true }).waitFor()
    },
  })
  await capture({
    browser,
    file: path.join(docsOutputDir, 'session-details.png'),
    route: '/sessions/demo-session',
    ready: '.assistant-message',
    interact: async (page) => {
      await page.getByRole('button', { name: 'Session details', exact: true }).click()
      const drawer = page.locator('aside[aria-label="Session details"]')
      await drawer.locator('section[aria-label="Vision agent"][aria-busy="false"]').waitFor()
      await drawer.locator('section[aria-label="Subagents"][aria-busy="false"]').waitFor()
      await drawer.getByRole('heading', { name: 'Runtime Read-only', exact: true }).waitFor()
      await waitForBatchSize(page, 'session', 4, true)
    },
  })
  await capture({
    browser,
    file: path.join(docsOutputDir, 'subagent-batch-size.png'),
    route: '/sessions/demo-session',
    ready: '.assistant-message',
    scenario: 'subagent-batching',
    interact: openSessionBatchSize,
  })
  await capture({
    browser,
    file: path.join(docsOutputDir, 'subagent-batch-size-mobile.png'),
    route: '/sessions/demo-session',
    ready: '.composer .mobile-model-control',
    viewport: { width: 390, height: 844 },
    scenario: 'subagent-batching',
    interact: openSessionBatchSize,
  })
  await capture({
    browser,
    file: path.join(docsOutputDir, 'settings-mobile.png'),
    route: '/sessions/demo-session',
    ready: '.composer .mobile-model-control',
    viewport: { width: 390, height: 844 },
    interact: async (page) => {
      await page.getByRole('button', { name: 'Open sessions' }).click()
      await page.getByRole('button', { name: 'Open settings', exact: true }).click()
      const dialog = page.getByRole('dialog', { name: 'Leyline settings' })
      await dialog.getByRole('combobox', { name: 'Settings category' }).selectOption('providers')
      await dialog.locator('.pi-settings-workspace[aria-busy="false"]').waitFor()
      await dialog.getByRole('combobox', { name: 'Provider', exact: true }).selectOption('local')
      await dialog.locator('.pi-settings-model-row').nth(2).waitFor()
    },
  })
  await capture({
    browser,
    file: path.join(docsOutputDir, 'model-catalog-mobile.png'),
    route: '/sessions/demo-session',
    ready: '.composer .mobile-model-control',
    scenario: 'model-catalog',
    viewport: { width: 390, height: 844 },
    interact: openModelCatalog,
  })
  await capture({
    browser,
    file: path.join(docsOutputDir, 'composer-controls.png'),
    route: '/sessions/demo-session',
    ready: '.composer .composer-context-usage',
    scenario: 'ultrafast',
    clipSelectors: ['.composer'],
    padding: 18,
  })
  await capture({
    browser,
    file: path.join(docsOutputDir, 'service-tiers.png'),
    route: '/sessions/demo-session',
    ready: '.composer .service-tier-chip',
    scenario: 'fast',
    interact: openServiceTierChoices,
    clipSelectors: ['.composer', '.service-tier-menu'],
    padding: 18,
    preserveHover: true,
  })
  await capture({
    browser,
    file: path.join(docsOutputDir, 'composer-issue.png'),
    route: '/sessions/demo-session',
    ready: '.assistant-message',
    interact: openComposerIssue,
    clipSelectors: ['.composer', '.composer-issue-popover'],
    padding: 18,
  })
  await capture({
    browser,
    file: path.join(docsOutputDir, 'composer-issue-mobile.png'),
    route: '/sessions/demo-session',
    ready: '.composer .mobile-model-control',
    viewport: { width: 390, height: 844 },
    interact: openComposerIssue,
  })
  await capture({
    browser,
    file: path.join(docsOutputDir, 'composer-send-unavailable.png'),
    route: '/sessions/demo-session',
    ready: '.assistant-message',
    scenario: 'composer-blocked',
    interact: dismissComposerImageIssue,
    clipSelectors: ['.composer'],
    padding: 18,
  })
  await capture({
    browser,
    file: path.join(docsOutputDir, 'composer-queue.png'),
    route: '/sessions/demo-session',
    ready: '.queue-toggle',
    scenario: 'queue',
    interact: async (page) => {
      await page.locator('.queue-toggle').click()
      await page.locator('.queue-popover').waitFor()
    },
    clipSelectors: ['.composer', '.prompt-queue'],
    padding: 18,
  })
  await capture({
    browser,
    file: path.join(docsOutputDir, 'composer-queue-held.png'),
    route: '/sessions/demo-session',
    ready: '.queue-resume',
    scenario: 'queue-held',
    clipSelectors: ['.composer', '.prompt-queue'],
    padding: 18,
  })
  await capture({
    browser,
    file: path.join(docsOutputDir, 'composer-shell.png'),
    route: '/sessions/demo-session',
    ready: '.tool-context-pill',
    scenario: 'shell',
    interact: async (page) => {
      await page.locator('.composer textarea').fill('!! git status --short')
      await page.locator('.hidden-shell-mode-composer .hidden-shell-mode-chip').waitFor()
      await page.locator('.workbench').evaluate((element) => {
        element.scrollTop = element.scrollHeight
      })
    },
  })
  await capture({
    browser,
    file: path.join(docsOutputDir, 'transcript-actions.png'),
    route: '/sessions/demo-session',
    ready: '.transcript-message.user-message',
    interact: async (page) => {
      const message = page.locator('.transcript-message.user-message').first()
      await message.hover()
      await message.getByTitle('Edit message').waitFor()
    },
    clipSelectors: ['.transcript-message.user-message'],
    padding: 22,
    preserveHover: true,
  })
  await capture({
    browser,
    file: path.join(docsOutputDir, 'tool-activity.png'),
    route: '/sessions/demo-session',
    ready: '.transcript-tool',
    scenario: 'tools',
    interact: async (page) => {
      await page.locator('.skill-message-header').waitFor()
      const activity = page.locator('.mobile-activity-card')
      await activity.locator('.mobile-activity-summary').click()
      const tool = activity.locator('.skill-tool-card').filter({ hasText: 'release-review' })
      await tool.locator('.tool-expand-button').click()
      await tool.locator('.pierre-diffs-container [data-line]').filter({ hasText: 'Confirm that a failed check stops the release.' }).waitFor()
      await disableMotion(page)
      await page.locator('.workbench').hover({ position: { x: 10, y: 10 } })
      await page.mouse.wheel(0, -1000)
      await page.waitForFunction(() => document.querySelector('.workbench')?.scrollTop === 0)
      const label = await tool.locator('.tool-label').boundingBox()
      const preview = await tool.locator('.tool-preview-clip').boundingBox()
      const action = await tool.locator('.tool-preview-cta').boundingBox()
      const composer = await page.locator('.composer').boundingBox()
      if (label.x !== preview.x || preview.x !== action.x || action.y + action.height > composer.y) {
        throw new Error('Expanded tool preview or action is misaligned or obscured')
      }
      if (await tool.locator('.mobile-tool-target').isVisible()) throw new Error('Duplicate desktop tool path is visible')
    },
  })
  await capture({
    browser,
    file: path.join(docsOutputDir, 'preview-fullscreen.png'),
    route: '/sessions/demo-session',
    ready: '.transcript-tool',
    scenario: 'markdown',
    interact: async (page) => {
      const activity = page.locator('.mobile-activity-card')
      const tool = activity.locator('.transcript-tool').filter({ hasText: 'docs/release-checklist.md' })
      await activity.locator('.mobile-activity-summary').click()
      await tool.locator('.tool-expand-button').click()
      await tool.getByTitle('Open full screen').click()
      await page.locator('.tool-fullscreen-markdown blockquote').waitFor()
      await page.locator('.tool-fullscreen-backdrop').evaluate((element) => {
        element.style.background = '#08090d'
      })
      await page.locator('.tool-fullscreen').evaluate((element) => {
        element.style.alignSelf = 'flex-start'
      })
    },
    clipSelectors: ['.tool-fullscreen'],
  })
  await capture({
    browser,
    file: path.join(docsOutputDir, 'memory-inspector.png'),
    route: '/sessions/demo-session',
    ready: '.assistant-message',
    interact: async (page) => {
      await page.getByRole('button', { name: 'Memory' }).click()
      await page.locator('aside[aria-label="Memory Inspector"] .memory-card').first().waitFor()
    },
  })
  await capture({
    browser,
    file: path.join(docsOutputDir, 'subagents.png'),
    route: '/sessions/demo-session',
    ready: '.assistant-message',
    scenario: 'subagent-batching-global',
    interact: async (page) => {
      await page.getByRole('button', { name: 'Open settings', exact: true }).click()
      const dialog = page.getByRole('dialog', { name: 'Leyline settings' })
      await dialog.getByRole('button', { name: 'Agent defaults', exact: true }).click()
      await dialog.locator('section[aria-label="Vision agent"][aria-busy="false"]').waitFor()
      const section = dialog.locator('section[aria-label="Subagents"][aria-busy="false"]')
      await section.waitFor()
      await section.locator('select:not(:disabled)').nth(1).waitFor()
      await section.locator('option[value="local/glm-5.3-flash"]').nth(1).waitFor({ state: 'attached' })
      await section.getByRole('combobox', { name: /^reviewer/ }).locator('option[value="local/glm-5.3-flash"]:checked').waitFor({ state: 'attached' })
      await waitForBatchSize(page, 'global', 4)
      await setBatchSize(page, 'global', 3)
      await setBatchSize(page, 'global', 4)
      await section.getByText('Agent definitions and tools', { exact: true }).click()
      await section.getByRole('heading', { name: 'researcher', exact: true }).waitFor()
      await dialog.getByText('Project and session overrides are edited in their own details panels.', { exact: true }).scrollIntoViewIfNeeded()
    },
  })
  await capture({
    browser,
    file: path.join(docsOutputDir, 'subagent-outcomes.png'),
    route: '/sessions/demo-session',
    ready: '.subagent-card .tool-inspect-button',
    scenario: 'subagent-outcomes',
    sidebarChildren: true,
    interact: async (page) => {
      await openSidebarChildren(page, 5)
      await openSubagentInspector(page, 5)
    },
  })
  await capture({
    browser,
    file: path.join(docsOutputDir, 'subagent-sidebar.png'),
    route: '/sessions/demo-session',
    ready: '.session-child-row .status-running',
    scenario: 'subagent-sidebar',
    sidebarChildren: true,
    interact: (page) => openSidebarChildren(page, 3),
  })
  await capture({
    browser,
    file: path.join(docsOutputDir, 'subagent-inspector-mobile.png'),
    route: '/sessions/demo-session',
    ready: '.subagent-card .tool-inspect-button',
    viewport: { width: 390, height: 844 },
    scenario: 'subagent-mobile',
    interact: (page) => openSubagentInspector(page, 3),
  })
  await capture({
    browser,
    file: path.join(docsOutputDir, 'subagent-live-tail.png'),
    route: '/sessions/demo-session',
    ready: '.subagent-card .tool-inspect-button',
    scenario: 'subagent-live',
    sidebarChildren: true,
    interact: openLiveSubagentInspector,
  })
  await capture({
    browser,
    file: path.join(docsOutputDir, 'subagent-live-tail-mobile.png'),
    route: '/sessions/demo-session',
    ready: '.subagent-card .tool-inspect-button',
    viewport: { width: 390, height: 844 },
    scenario: 'subagent-live',
    sidebarChildren: true,
    interact: openLiveSubagentInspector,
  })
  await capture({
    browser,
    file: path.join(docsOutputDir, 'subagent-inspector-export.png'),
    route: '/api/pi/sessions/demo-session/export?disposition=inline',
    ready: '.subagent-card .tool-inspect-button',
    scenario: 'subagent-outcomes',
    exportPage: true,
    interact: (page) => openSubagentInspector(page, 5, true),
  })
  await capture({
    browser,
    file: path.join(docsOutputDir, 'vision-tool-call.png'),
    route: '/sessions/demo-session',
    ready: '.transcript-tool',
    scenario: 'vision',
    interact: async (page) => {
      const activity = page.locator('.mobile-activity-card')
      const tool = activity.locator('.transcript-tool')
        .filter({ hasText: 'Tool · vision_agent' })
      await activity.locator('.mobile-activity-summary').click()
      await tool.locator('.tool-expand-button').click()
      await tool.locator('.tool-output').waitFor()
    },
    clipSelectors: ['.transcript-message.user-message', '.mobile-activity-card'],
    padding: 18,
  })
  await capture({
    browser,
    file: path.join(docsOutputDir, 'vision-agent.png'),
    route: '/sessions/demo-session',
    ready: '.assistant-message',
    interact: async (page) => {
      await page.getByRole('button', { name: 'Open settings', exact: true }).click()
      const dialog = page.getByRole('dialog', { name: 'Leyline settings' })
      await dialog.getByRole('button', { name: 'Agent defaults', exact: true }).click()
      await dialog.locator('section[aria-label="Subagents"][aria-busy="false"]').waitFor()
      const section = dialog.locator('section[aria-label="Vision agent"][aria-busy="false"]')
      await section.waitFor()
      await section.locator('select:not(:disabled)').first().waitFor()
      const modelSelect = section.getByRole('combobox', { name: /^Vision model/ })
      await modelSelect.locator('option[value="local/qwen3.6-27b"]:checked:not(:disabled)').waitFor({ state: 'attached' })
      await section.getByRole('combobox', { name: /^Thinking mode/ }).locator('option[value=""]:checked').waitFor({ state: 'attached' })
      await waitForBatchSize(page, 'global', 4)
      await section.scrollIntoViewIfNeeded()
      const selectedVisionModel = await modelSelect.inputValue()
      if (selectedVisionModel !== 'local/qwen3.6-27b') {
        throw new Error(`Vision model selector uses ${selectedVisionModel || '(empty)'}`)
      }
      const options = await modelSelect.locator('option').allTextContents()
      if (options.some((option) => {
        return option.includes('glm-5.3-flash') || option.includes('text-only-coder')
      })) {
        throw new Error('Vision model selector includes a model without image support')
      }
    },
  })
  await capture({
    browser,
    file: path.join(docsOutputDir, 'terminal.png'),
    route: '/sessions/demo-session',
    ready: '.assistant-message',
    terminal: true,
    interact: async (page) => {
      await page.getByRole('button', { name: 'Open terminal' }).click()
      await page.locator('.terminal-panel .xterm-rows').waitFor()
      await page.waitForFunction(() => {
        return document.querySelector('.xterm-rows')?.textContent?.includes('documentation build complete')
      })
      await page.locator('.terminal-resize-handle').focus()
      await page.keyboard.press('ArrowUp')
      await page.keyboard.press('ArrowUp')
      await page.locator('.workbench').evaluate((element) => {
        element.scrollTop = element.scrollHeight
      })
      await page.waitForFunction(() => {
        const workbench = document.querySelector('.workbench')
        const atBottom = Math.abs(
          workbench.scrollHeight - workbench.clientHeight - workbench.scrollTop,
        ) < 2
        return atBottom && !document.querySelector('.jump-latest-button')
      })
    },
  })
  await capture({
    browser,
    file: path.join(docsOutputDir, 'export.png'),
    route: '/api/pi/sessions/demo-session/export?disposition=inline',
    ready: '.export-shell .transcript',
    scenario: 'export',
    exportPage: true,
    interact: async (page) => {
      await page.locator('.system-prompt-export > summary').last().click()
      const inspector = page.locator('.system-prompt-export[open] .system-prompt-inspector')
      await inspector.locator('[data-line-type="deletion"]').filter({ hasText: 'Run release verification before publication.' }).waitFor()
      await inspector.locator('[data-line-type="addition"]').filter({ hasText: 'Keep this change limited' }).waitFor()
      await inspector.getByRole('button', { name: 'Raw text', exact: true }).click()
      const raw = await inspector.locator('.system-prompt-raw').innerText()
      if (raw !== systemEntries[1].text) throw new Error('Export changed the raw system event')
      await inspector.getByRole('button', { name: 'Close prompt inspector' }).click()
    },
  })
  await capture({
    browser,
    file: path.join(docsOutputDir, 'deep-research-mobile.png'),
    route: '/sessions/research-session',
    ready: '.research-report-message',
    viewport: { width: 390, height: 844 },
    scenario: 'research',
    interact: async (page) => {
      const citation = page.locator(
        '.research-report-message .markdown-body a',
      ).filter({ hasText: /^1$/ }).first()
      await citation.evaluate(async (element) => {
        const workbench = element.closest('.workbench')
        const target = window.innerHeight * 0.56
        workbench.scrollTop += element.getBoundingClientRect().top - target
        await new Promise((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(resolve))
        })
      })
      await page.waitForTimeout(100)
      await citation.click()
      await page.getByRole('dialog', {
        name: 'Citation 1 source preview',
      }).waitFor()
    },
  })
  await capture({
    browser,
    file: path.join(docsOutputDir, 'mobile-session.png'),
    route: '/sessions/demo-session',
    ready: '.composer .mobile-model-control',
    viewport: { width: 390, height: 844 },
    scenario: 'ultrafast',
  })
  await capture({
    browser,
    file: path.join(docsOutputDir, 'mobile-speed.png'),
    route: '/sessions/demo-session',
    ready: '.composer .mobile-speed-control',
    viewport: { width: 390, height: 844 },
    scenario: 'fast',
    interact: openServiceTierChoices,
  })
  await capture({
    browser,
    file: path.join(docsOutputDir, 'mobile-sidebar.png'),
    route: '/sessions/demo-session',
    ready: '.composer .mobile-model-control',
    viewport: { width: 390, height: 844 },
    scenario: 'subagent-sidebar',
    sidebarChildren: true,
    interact: async (page) => {
      await page.getByRole('button', { name: 'Open sessions' }).click()
      await page.locator('.leyline-app.sidebar-open .sidebar').waitFor()
      await openSidebarChildren(page, 3)
    },
  })
  await capture({
    browser,
    file: path.join(docsOutputDir, 'activity-mobile.png'),
    route: '/sessions/demo-session',
    ready: '.composer .mobile-model-control',
    viewport: { width: 390, height: 844 },
    scenario: 'activity',
    interact: async (page) => {
      await page.getByRole('button', { name: 'Open sessions' }).click()
      await openActivity(page)
    },
  })
  await capture({
    browser,
    file: path.join(readmeOutputDir, 'header.png'),
    route: '/sessions/demo-session',
    ready: '.assistant-message .thinking-trigger',
    scenario: 'ultrafast',
    sidebarChildren: true,
    interact: (page) => openSidebarChildren(page, 2),
    readmeHeader: true,
  })
  await capture({
    browser,
    file: path.join(readmeOutputDir, 'home.png'),
    route: '/',
    ready: '.research-mode-chip',
    viewport: { width: 1503, height: 818 },
    scenario: 'home',
    macWindow: true,
  })
  await capture({
    browser,
    file: path.join(readmeOutputDir, 'workbench.png'),
    route: '/sessions/demo-session',
    ready: '.assistant-message .thinking-trigger',
    viewport: { width: 1503, height: 818 },
    scenario: 'ultrafast',
    sidebarChildren: true,
    interact: async (page) => {
      await openSidebarChildren(page, 2)
      await disableMotion(page)
      await page.locator('.workbench').hover({ position: { x: 10, y: 10 } })
      await page.mouse.wheel(0, -1000)
      await page.waitForFunction(() => document.querySelector('.workbench')?.scrollTop === 0)
    },
    macWindow: true,
  })
  await capture({
    browser,
    file: path.join(readmeOutputDir, 'deep-research.png'),
    route: '/sessions/research-session',
    ready: '.research-report-message',
    viewport: { width: 1503, height: 818 },
    scenario: 'research',
    sidebarChildren: true,
    interact: async (page) => {
      await waitForResearchSources(page)
      await openSidebarChildren(page, 3)
    },
    macWindow: true,
  })
} finally {
  await browser.close()
}

console.log('Screenshot capture complete')

async function openServiceTierChoices(page) {
  await disableMotion(page)
  const mobile = await page.locator('.mobile-speed-control:visible').count() > 0
  await page.locator(mobile ? '.mobile-speed-control:visible' : '.service-tier-chip:visible').click()
  const menu = mobile
    ? page.getByRole('dialog', { name: 'Speed', exact: true })
    : page.getByRole('listbox', { name: 'Speed', exact: true })
  await menu.waitFor()
  const choices = menu.locator(mobile ? '.mobile-sheet-choices button' : '[role="option"]')
  const labels = await choices.locator('span:first-child').evaluateAll(elements => elements.map(element => element.firstChild.textContent.trim()))
  const expected = mobile ? ['Standard', 'Fast', 'Ultrafast'] : ['standard', 'fast', 'ultrafast']
  if (JSON.stringify(labels) !== JSON.stringify(expected)
    || await choices.nth(1).getAttribute(mobile ? 'aria-pressed' : 'aria-selected') !== 'true') {
    throw new Error('Service-tier choices must show Fast selected alongside Standard and Ultrafast')
  }
  await page.mouse.move(0, 0)
}

async function waitForBatchSize(page, scope, value, inherited = false) {
  await page.waitForFunction(({ scope, value, inherited }) => {
    const input = document.querySelector(`#subagent-batch-size-${scope}`)
    const row = input?.closest('.settings-batch-size')
    const source = scope === 'session' && !inherited ? 'this transcript' : 'global default'
    const label = `${inherited ? 'Inherited' : 'Effective'}: ${value} · ${source}`
    const reset = row?.querySelector('button')
    return input && !input.disabled && !input.readOnly && input.value === String(value)
      && row.closest('section').getAttribute('aria-busy') === 'false'
      && row.querySelector('.settings-inherited')?.textContent.trim() === label
      && (scope === 'session' && !inherited ? reset && !reset.disabled && reset.textContent.trim() === 'Use global default (4)' : !reset)
  }, { scope, value, inherited })
}

async function setBatchSize(page, scope, value) {
  const input = page.locator(`#subagent-batch-size-${scope}`)
  await input.fill(String(value))
  await input.press('Tab')
  await waitForBatchSize(page, scope, value)
}

async function openSessionBatchSize(page) {
  const more = page.locator('.header-more-button')
  if (await more.isVisible()) await more.click()
  await page.getByRole('button', { name: 'Session details', exact: true }).click()
  await waitForBatchSize(page, 'session', 4, true)
  await setBatchSize(page, 'session', 2)
  await page.getByRole('button', { name: 'Use global default (4)', exact: true }).click()
  await waitForBatchSize(page, 'session', 4, true)
  await setBatchSize(page, 'session', 2)
  const drawer = page.locator('aside[aria-label="Session details"]')
  const section = page.viewportSize().width > 760 ? 'Vision agent' : 'Subagents'
  await drawer.locator(`section[aria-label="${section}"]`).evaluate(element => element.scrollIntoView({ block: 'start', behavior: 'instant' }))
  await disableMotion(page)
  const visible = await drawer.locator('.settings-batch-size').evaluate(row => {
    const bounds = row.getBoundingClientRect()
    const body = row.closest('.context-settings-body').getBoundingClientRect()
    return bounds.top >= body.top && bounds.bottom <= body.bottom && row.scrollWidth <= row.clientWidth
  })
  if (!visible) throw new Error('Session batch size or reset control is clipped')
}

async function openComposerIssue(page) {
  const draft = 'Review the release checklist and keep the current layout.'
  const message = 'Request failed (502): Bad Gateway.\nThe provider is temporarily unavailable.'
  const input = page.locator('.composer textarea')
  await input.fill(draft)
  await page.waitForFunction(() => window.__docsEventSockets.some(socket => {
    return socket.readyState === 1 && new URL(socket.url).searchParams.get('sessionId') === 'demo-session'
  }))
  await page.evaluate(message => {
    const socket = window.__docsEventSockets.find(socket => {
      return socket.readyState === 1 && new URL(socket.url).searchParams.get('sessionId') === 'demo-session'
    })
    socket.emit({ type: 'extension_error', data: { activeSessionId: 'demo-session', error: { name: 'Error', message } } })
  }, message)
  await page.getByRole('button', { name: '1 composer issue. Show details', exact: true }).click()
  const popover = page.getByRole('dialog', { name: 'Composer issue', exact: true })
  await popover.waitFor()
  await popover.getByRole('button', { name: 'Dismiss', exact: true }).waitFor()
  if (await popover.locator('.composer-issue-message').textContent() !== message
    || await input.inputValue() !== draft) throw new Error('Composer issue capture lost its message or draft')
}

async function dismissComposerImageIssue(page) {
  const draft = 'Review the attached release checklist.'
  const input = page.locator('.composer textarea')
  await input.fill(draft)
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Add image', exact: true }).click()
  await (await chooser).setFiles({
    name: 'release-check.webp',
    mimeType: visionAlertImage.mimeType,
    buffer: Buffer.from(visionAlertImage.data, 'base64'),
  })
  await page.waitForFunction(() => document.querySelector('.composer-issue-live')?.textContent.includes('no vision model is configured'))
  await page.getByRole('button', { name: 'Dismiss composer issue', exact: true }).click()
  await page.getByRole('button', { name: 'Send unavailable Details', exact: true }).waitFor()
  if (!await page.locator('.composer .send-button').isDisabled()
    || await input.inputValue() !== draft || await page.locator('.attachment-chip').count() !== 1) {
    throw new Error('Composer dismissal changed the image requirement, draft, or attachment')
  }
}

async function startDictationCapture(page) {
  await page.locator('.dictation-button[aria-label^="Start local dictation"]').click()
  await page.locator('.dictation-status-listening').waitFor()
  const result = await page.evaluate(() => window.__docsFeedDictation())
  const heights = await page.locator('.dictation-wave rect').evaluateAll(bars => bars.map(bar => Number(bar.style.transform.match(/scaleY\(([\d.]+)\)/)?.[1] || 0)))
  if (result.count !== 31 || result.time !== 1000 || result.acknowledged !== 31 || heights.length !== 30 || Math.max(...heights) - Math.min(...heights) < 0.2
    || heights.filter(value => value > 0.2).length < 20
    || new Set(heights.map(value => value.toFixed(2))).size < 8
    || ![0, 10, 20].every(start => heights.slice(start, start + 10).some(value => value > 0.2))) {
    throw new Error(`Deterministic dictation waveform did not fill the capture width: ${JSON.stringify({ result, heights })}`)
  }
  await page.waitForFunction(() => document.querySelector('.dictation-timer')?.textContent.trim() === '0:01')
  const label = await page.locator('.dictation-phase-label').textContent()
  const timer = await page.locator('.dictation-timer').textContent()
  if (label.trim() !== 'Listening' || timer !== '0:01') {
    throw new Error(`Deterministic dictation status changed: ${JSON.stringify({ label, timer })}`)
  }
}

async function openSessionTitleSettings(page) {
  await page.evaluate(() => window.dispatchEvent(new Event('leyline:open-settings')))
  const dialog = page.getByRole('dialog', { name: 'Leyline settings' })
  await dialog.waitFor()
  const category = dialog.getByRole('combobox', { name: 'Settings category', exact: true })
  if (await category.isVisible()) await category.selectOption('agents')
  else await dialog.getByRole('button', { name: 'Agent defaults', exact: true }).click()
  const section = dialog.locator('section[aria-labelledby="session-titles-heading"][aria-busy="false"]')
  await section.waitFor()
  await section.getByRole('button', { name: 'Title model: Choose a model', exact: true }).click()
  await dialog.getByRole('listbox', { name: 'Title model', exact: true }).getByRole('option', { name: /^GLM 5.3 Flash/ }).click()
  await section.getByRole('button', { name: 'Title model: GLM 5.3 Flash', exact: true }).waitFor()
  await section.getByRole('combobox', { name: 'Thinking mode: Lowest available (off)', exact: true }).waitFor()
  const toggle = section.getByRole('switch', { name: 'Automatic titles', exact: true })
  if (await toggle.getAttribute('aria-checked') !== 'false') throw new Error('Automatic titles must start disabled')
  await toggle.click()
  await section.locator('[role="switch"][aria-checked="true"]:not([aria-disabled="true"])').waitFor()
  await section.scrollIntoViewIfNeeded()
}

async function openDictationSettings(page) {
  await page.evaluate(() => window.dispatchEvent(new Event('leyline:open-settings')))
  const dialog = page.getByRole('dialog')
  await dialog.waitFor()
  await dialog.getByRole('button', { name: 'Dictation', exact: true }).click()
  await dialog.locator('.dictation-settings').waitFor()
  await dialog.getByRole('heading', { name: 'Speech model', exact: true }).waitFor()
  await dialog.getByText('Downloaded on Leyline server', { exact: true }).waitFor()
}

async function waitForTrace(page) {
  await page.locator('.elune-ui[aria-busy="false"] .elune-summary h3').filter({ hasText: primaryTrace.name }).waitFor()
  await page.locator(`[data-observation-id="${traceEditObservation.id}"]`).waitFor()
  await page.locator('.trace-host-footer summary').filter({ hasText: 'Capture new runs' }).waitFor()
  const count = primaryTrace.observations.length
  await page.locator('.elune-observations > .elune-pagination').getByText(`1–${count} of ${count} loaded observations`, { exact: false }).waitFor()
}

async function openTraceInspector(page) {
  if (await page.locator('.header-more-button').isVisible().catch(() => false)) {
    await page.locator('.header-more-button').click()
  }
  await page.getByRole('button', { name: 'Session traces', exact: true }).click()
  await waitForTrace(page)
  await page.locator(`[data-observation-id="${traceEditObservation.id}"]`).click()
  await page.locator('.elune-detail-heading h3').filter({ hasText: traceEditObservation.name }).waitFor()
  await page.locator('.elune-tabs button').filter({ hasText: /^input$/ }).click()
  await page.locator('.elune-payload').filter({ hasText: 'await verify()' }).waitFor()
  const geometry = await page.locator('.elune-run-select').evaluate(element => {
    const select = element.querySelector('select').getBoundingClientRect()
    const arrow = element.querySelector('svg').getBoundingClientRect()
    return { inset: select.right - arrow.right, center: arrow.y + arrow.height / 2 - select.y - select.height / 2 }
  })
  if (geometry.inset !== 10 || geometry.center !== 0) throw new Error('Run picker chevron is not centered at its 10px inset')
}

async function openTraceWorkspace(page) {
  await openTraceInspector(page)
  await page.getByRole('button', { name: 'Open workspace', exact: true }).click()
  await page.locator('.trace-panel-workspace .elune-ui[aria-busy="false"]').waitFor()
  await page.locator('.elune-timeline .elune-span.tool').first().waitFor()
  await page.locator(`[data-observation-id="${traceEditObservation.id}"][aria-pressed="true"]`).waitFor()
  await page.locator('.elune-tabs button[aria-pressed="true"]').filter({ hasText: 'input' }).waitFor()
  await page.locator('.elune-detail-heading h3').filter({ hasText: traceEditObservation.name }).waitFor()
  await assertTraceContentReachable(page)
}

async function assertTraceContentReachable(page) {
  await page.locator('.elune-selected').evaluate(element => { element.scrollTop = element.scrollHeight })
  const payload = page.locator('.elune-payload')
  await payload.scrollIntoViewIfNeeded()
  await page.locator('.elune-payload-scroll').evaluate(element => { element.scrollTop = element.scrollHeight })
  const reachable = await payload.evaluate(element => {
    const node = element.firstChild
    const range = document.createRange()
    const end = node.textContent.trimEnd().length
    range.setStart(node, end - 1)
    range.setEnd(node, end)
    const line = range.getBoundingClientRect()
    const footer = document.querySelector('.trace-host-footer').getBoundingClientRect()
    const port = element.closest('.elune-payload-scroll').getBoundingClientRect()
    const hit = document.elementFromPoint(line.x + 2, line.y + line.height / 2)
    return line.top >= port.top && line.bottom <= Math.min(port.bottom, footer.top) && (hit === element || element.contains(hit)) && footer.bottom <= innerHeight
  })
  if (!reachable) throw new Error('Trace payload last line or capture footer is inaccessible')
  await page.locator('.elune-selected').evaluate(element => { element.scrollTop = 0 })
  await page.locator('.elune-payload-scroll').evaluate(element => { element.scrollTop = 0 })
}

async function openSidebarChildren(page, count) {
  const toggle = page.locator('.session-children-toggle').first()
  await toggle.waitFor()
  if (await toggle.getAttribute('aria-expanded') === 'false') await toggle.click()
  await page.locator('.session-child-node').nth(count - 1).waitFor()
  await page.waitForFunction(() => !document.querySelector('.session-child-row.is-folding'))
  const geometry = await toggle.evaluate((button) => {
    const parent = button.closest('.project-session-row')
    const title = parent.querySelector('.session-title-with-kind').getBoundingClientRect()
    const control = button.getBoundingClientRect()
    const child = parent.nextElementSibling
    const node = child.querySelector('.session-child-node').getBoundingClientRect()
    return {
      gap: title.left - control.right,
      gutter: control.width,
      aligned: [...document.querySelectorAll('.project-session-row .session-title')]
        .every(element => Math.abs(element.getBoundingClientRect().left - title.left) < 0.5),
      inset: node.left + node.width / 2 - title.left,
      height: child.getBoundingClientRect().height,
      glyphs: document.querySelectorAll('.session-child-icon').length,
    }
  })
  if (geometry.gap !== 4 || geometry.gutter !== 18 || !geometry.aligned
    || geometry.inset < 10 || geometry.height !== 30 || geometry.glyphs) {
    throw new Error(`Unexpected sidebar child layout: ${JSON.stringify(geometry)}`)
  }
}

async function waitForSubagentReader(page) {
  await page.waitForFunction(() => {
    const inspector = document.querySelector('.subagent-inspector')
    const readers = inspector?.querySelectorAll('.subagent-inspector-content')
    if (readers?.length !== 1 || inspector.querySelectorAll('.subagent-inspector-footer-content').length > 1) return false
    const reader = readers[0]
    const stack = inspector.querySelector('.subagent-inspector-reader-stack')
    return reader.getClientRects().length > 0 && !reader.inert
      && reader.getAttribute('aria-hidden') !== 'true'
      && stack?.getAttribute('aria-busy') !== 'true'
      && getComputedStyle(reader).opacity === '1'
  })
}

async function checkSubagentHeader(page, agent) {
  const inspector = page.locator('.subagent-inspector')
  const header = inspector.locator('.subagent-inspector-header')
  await header.locator('.subagent-inspector-agent').filter({ hasText: agent }).waitFor()
  await header.getByRole('button', { name: 'Full task prompt', exact: true }).waitFor()
  const chips = inspector.locator('.subagent-inspector-meta')
  await chips.locator('.subagent-inspector-model code').filter({ hasText: `${model.provider}/${model.id}` }).waitFor()
  await chips.locator('.subagent-inspector-model-source').filter({ hasText: 'inherited' }).waitFor()
  await chips.locator('.subagent-inspector-thinking code').filter({ hasText: 'high' }).waitFor()
  if (await chips.locator('button').count()) throw new Error('Task prompt must remain in the header')
}

async function openSubagentInspector(page, taskCount, exportPage = false) {
  if (!exportPage) await page.locator('.workbench:not(.session-switching):not(.session-loading-workbench)').waitFor()
  await disableMotion(page)
  const activity = page.locator('.mobile-activity-card').filter({ has: page.locator('.subagent-card') })
  await activity.scrollIntoViewIfNeeded()
  const before = await activity.boundingBox()
  await activity.locator('.mobile-activity-summary').click()
  const inspector = page.locator('.subagent-inspector')
  await inspector.waitFor()
  const tasks = inspector.locator('.subagent-inspector-task')
  if (await tasks.count() !== taskCount) throw new Error('Subagent inspector task count changed')
  const titles = await tasks.locator('.subagent-inspector-task-label').allTextContents()
  if (titles.some((title, index) => title.trim() !== subagentOutcomeResults[index].title)) {
    throw new Error('Subagent inspector must show the supplied session titles')
  }
  await inspector.locator('.subagent-summary').filter({ hasText: `${taskCount - 1} completed` }).waitFor()
  await inspector.locator('.subagent-summary').filter({ hasText: '1 stopped' }).waitFor()
  await tasks.nth(2).click()
  await waitForSubagentReader(page)
  await tasks.nth(2).locator('.status-stopped').waitFor()
  await inspector.locator('.subagent-ledger-row').filter({ hasText: 'This operation was aborted' }).waitFor()
  await tasks.first().click()
  await waitForSubagentReader(page)
  await inspector.locator('.subagent-ledger-latest h3').filter({ hasText: 'Verification precedes publication' }).waitFor()
  await inspector.getByRole('button', { name: 'Full task prompt', exact: true }).click()
  await waitForSubagentReader(page)
  if (await inspector.locator('.subagent-entry-raw').innerText() !== subagentOutcomeResults[0].task) {
    throw new Error('Subagent inspector changed the full task prompt')
  }
  await inspector.getByRole('button', { name: 'Close subagent inspector', exact: true }).click()
  await inspector.waitFor({ state: 'detached' })
  await activity.locator('.tool-inspect-button').click()
  await waitForSubagentReader(page)
  await inspector.locator('.subagent-ledger-latest h3').waitFor()
  if (exportPage || page.viewportSize().width <= 760) {
    await inspector.getByRole('button', { name: /^Read full/ }).click()
    await waitForSubagentReader(page)
    await inspector.locator('.subagent-inspector-output h2').filter({ hasText: 'Verification precedes publication' }).waitFor()
  } else {
    await inspector.locator('.subagent-ledger-row').filter({ hasText: 'scripts/release.js' }).waitFor()
  }
  if (exportPage) await inspector.getByText('Child sessions are available in Leyline', { exact: true }).waitFor()
  else await inspector.getByRole('button', { name: 'Open child session', exact: true }).waitFor()
  await checkSubagentHeader(page, subagentOutcomeResults[0].agent)
  const after = await activity.boundingBox()
  if (before.height !== after.height || before.y !== after.y || await activity.evaluate(element => element.classList.contains('is-expanded'))) {
    throw new Error(`Single-call subagent inspection expanded or moved the Activity card: ${JSON.stringify({ before, after })}`)
  }
}

async function openLiveSubagentInspector(page) {
  await page.locator('.workbench:not(.session-switching):not(.session-loading-workbench)').waitFor()
  await disableMotion(page)
  if (page.viewportSize().width > 760) await openSidebarChildren(page, 1)
  const activity = page.locator('.mobile-activity-card').filter({ has: page.locator('.subagent-card') })
  await activity.scrollIntoViewIfNeeded()
  const before = await activity.boundingBox()
  await activity.locator('.mobile-activity-summary').click()
  const inspector = page.locator('.subagent-inspector')
  const running = inspector.locator('[data-subagent-tail-entry="tool:live-release-verify"]')
  await running.locator('.status-running').waitFor()
  await waitForSubagentReader(page)
  await inspector.locator('.subagent-ledger-row').filter({ hasText: 'A failed check stops tagging.' }).waitFor()
  if (await inspector.locator('h2').innerText() !== subagentLiveResult.title) throw new Error('Live preview lost its supplied title')
  await running.click()
  await waitForSubagentReader(page)
  await inspector.locator('.subagent-entry-raw').filter({ hasText: 'Checking publication safeguards…' }).waitFor()
  await inspector.getByRole('button', { name: 'Arguments', exact: true }).click()
  if (JSON.parse(await inspector.locator('.subagent-entry-raw').innerText()).command !== 'npm run verify') throw new Error('Live preview changed the tool arguments')
  await inspector.getByRole('button', { name: 'Full task prompt', exact: true }).click()
  await waitForSubagentReader(page)
  if (await inspector.locator('.subagent-entry-raw').innerText() !== subagentLiveResult.task) throw new Error('Live preview changed the full task prompt')
  await inspector.getByRole('button', { name: 'Close subagent inspector', exact: true }).click()
  await inspector.waitFor({ state: 'detached' })
  const closed = await page.evaluate(id => window.__docsEventSockets.every(socket => new URL(socket.url).searchParams.get('sessionId') !== id || socket.readyState === WebSocket.CLOSED), subagentLiveResult.childSession.id)
  if (!closed) throw new Error('Closed live inspector retained its child subscription')
  await activity.locator('.tool-inspect-button').click()
  await waitForSubagentReader(page)
  await running.locator('.status-running').waitFor()
  await inspector.locator('.subagent-tail-following').filter({ hasText: 'Following live' }).waitFor()
  await inspector.getByRole('button', { name: 'Open child session', exact: true }).waitFor()
  await checkSubagentHeader(page, subagentLiveResult.agent)
  await inspector.locator('.subagent-ledger-connection').filter({ hasText: 'Live updates' }).waitFor()
  const open = await page.evaluate(id => window.__docsEventSockets.filter(socket => new URL(socket.url).searchParams.get('sessionId') === id && socket.readyState === WebSocket.OPEN).length, subagentLiveResult.childSession.id)
  if (open !== 1 || new URL(page.url()).pathname !== '/sessions/demo-session') throw new Error('Live preview must observe only its child without navigation')
  if (await inspector.evaluate(element => element.scrollWidth > element.clientWidth)) throw new Error('Live preview overflows horizontally')
  const after = await activity.boundingBox()
  if (before.height !== after.height || before.y !== after.y || await activity.evaluate(element => element.classList.contains('is-expanded'))) throw new Error('Live inspection moved or expanded the parent Activity card')
}

async function waitForResearchSources(page) {
  const pane = page.locator('aside[aria-label="Research sources"].open')
  await pane.waitFor()
  await pane.getByRole('button', { name: 'Cited 4', pressed: true }).waitFor()
  await pane.locator('.research-source-card').first().waitFor()
  await page.locator('.workbench:not(.session-switching):not(.session-loading-workbench)').waitFor()
  await disableMotion(page)
  await page.locator('.workbench').dispatchEvent('wheel', { deltaY: -1 })
  await page.locator('.mobile-activity-card').evaluate(element => element.scrollIntoView({ block: 'start', behavior: 'instant' }))
  const report = await page.locator('.research-report-message').boundingBox()
  const composer = await page.locator('.composer').boundingBox()
  if (report.y + report.height > composer.y) throw new Error('Research report is hidden behind the composer')
}

async function openActivity(page) {
  await page.locator('.sidebar-project-shortcut', { hasText: 'Activity' }).click()
  const dialog = page.getByRole('dialog', { name: 'Activity' })
  await dialog.locator('.activity-navigator-result').nth(2).waitFor()
  await dialog.locator('.activity-working-tree-warning').filter({ hasText: 'harbor' }).waitFor()
}

function session(
  id,
  name,
  timestamp,
  messageCount,
  cwd = '/workspace/harbor',
  research = null,
) {
  return {
    id,
    path: `${cwd}/sessions/${id}.jsonl`,
    cwd,
    name,
    parentSessionPath: null,
    isSubagentSession: false,
    research,
    firstMessage: name,
    messageCount,
    modified: timestamp,
    timestamp,
  }
}

function messageEntry({
  id,
  role,
  label,
  text,
  thinking = '',
  images = [],
  timestamp,
  rolloutFeedback = '',
}) {
  const blocks = []
  if (thinking) blocks.push({ type: 'thinking', text: thinking })
  blocks.push({ type: 'text', text })
  blocks.push(...images)
  return {
    id,
    type: 'message',
    role,
    label,
    text,
    blocks,
    copyText: [thinking, text].filter(Boolean).join('\n\n'),
    timestamp,
    rolloutFeedback,
    rolloutFeedbackText: '',
  }
}

function toolEntry({
  id,
  label,
  code,
  toolName,
  text,
  preview,
  contextLabel,
  excludeFromContext = false,
  timestamp,
}) {
  return {
    id,
    type: 'tool',
    label,
    code,
    toolName,
    text,
    preview,
    contextLabel,
    excludeFromContext,
    isError: false,
    copyText: text,
    timestamp,
    rolloutFeedback: '',
    rolloutFeedbackText: '',
  }
}

function memory(id, scope, contentMd, tags, status = 'active') {
  const scoped = scope !== 'global'
  const sessionScoped = scope === 'session'
  return {
    id,
    scope,
    projectId: scoped ? 'project_harbor' : null,
    projectRoot: scoped ? '/workspace/harbor' : null,
    projectName: scoped ? 'harbor' : null,
    sessionId: sessionScoped ? 'session_demo' : null,
    sessionFile: sessionScoped ? '/workspace/harbor/sessions/demo-session.jsonl' : null,
    cwd: scoped ? '/workspace/harbor' : null,
    contentMd,
    reasonMd: '',
    tags,
    status,
    source: 'user',
    createdAt: fixedNow - 86400000,
    updatedAt: fixedNow - 3600000,
    archivedAt: status === 'archived' ? fixedNow - 1800000 : null,
    lastAccessedAt: null,
  }
}

function runtimeFor(scenario) {
  const activity = scenario === 'activity'
  const queued = ['queue', 'queue-held'].includes(scenario)
  const held = scenario === 'queue-held'
  const research = scenario === 'research'
  const sidebar = scenario === 'subagent-sidebar'
  const live = scenario === 'subagent-live'
  const titleGenerating = scenario === 'title-generating'
  const subagents = ['subagent-outcomes', 'subagent-mobile', 'subagent-sidebar', 'subagent-live'].includes(scenario)
  const selectedModel = ['home', 'ultrafast', 'fast'].includes(scenario) ? ultrafastModel : model
  const id = research ? researchSession.id : 'demo-session'
  return {
    id,
    snapshotRevision: fixedNow,
    path: `/workspace/harbor/sessions/${id}.jsonl`,
    cwd: '/workspace/harbor',
    diagnostics: [],
    state: {
      model: selectedModel,
      availableModels,
      thinkingLevel: 'high',
      availableThinkingLevels: selectedModel.availableThinkingLevels,
      isStreaming: (queued && !held) || activity || sidebar || live || titleGenerating,
      isCompacting: false,
      titleGenerating,
      pendingToolCalls: live ? ['subagent-live-tool'] : sidebar ? ['subagent-sidebar-tool']
        : activity ? ['activity-selected-tool'] : [],
      pendingTools: live ? [{
        toolCallId: 'subagent-live-tool',
        toolName: 'subagent',
        args: { agent: subagentLiveResult.agent, title: subagentLiveResult.title, task: subagentLiveResult.task },
        partialResult: {
          content: [{ type: 'text', text: 'The release safeguard check is running.' }],
          details: { mode: 'single', background: true, results: [subagentLiveResult] },
        },
      }] : sidebar ? [{
        toolCallId: 'subagent-sidebar-tool',
        toolName: 'subagent',
        args: {
          mode: 'parallel',
          tasks: subagentSidebarResults.map(({ agent, title, task }) => ({ agent, title, task })),
        },
        partialResult: {
          content: [{ type: 'text', text: 'One check completed. Two checks are running.' }],
          details: { mode: 'parallel', results: subagentSidebarResults, background: true },
        },
      }] : activity
        ? [{
            toolCallId: 'activity-selected-tool',
            toolName: 'read',
            args: { path: 'scripts/release.js' },
          }]
        : [],
      steeringMode: 'one-at-a-time',
      followUpMode: 'one-at-a-time',
      activeToolCount: research ? 6 : subagents ? 5 : 4,
      activeToolNames: research
        ? ['read', 'grep', 'subagent', 'research_update', 'exa_search', 'exa_contents']
        : subagents ? ['read', 'grep', 'bash', 'edit', 'subagent']
          : ['read', 'grep', 'bash', 'edit'],
      contextUsage: {
        tokens: titleGenerating ? 42 : 12480,
        contextWindow: selectedModel.contextWindow,
        percent: (titleGenerating ? 42 : 12480) / selectedModel.contextWindow * 100,
      },
      slashCommands: [
        { name: 'compact', description: 'Compact context', source: 'command' },
        { name: 'skill:review', description: 'Load the review skill', source: 'skill' },
      ],
      promptQueue: {
        revision: held ? 3 : queued ? 2 : 0,
        held,
        error: '',
        items: queued ? [
          { id: 'queue-failure-path', text: 'Check the release failure path.', imageCount: 1, status: 'pending' },
          { id: 'queue-release-risk', text: 'Summarize the remaining release risks.', imageCount: 0, status: 'pending' },
        ] : [],
      },
      queuedMessages: { steering: [], followUp: [] },
      extensionUi: {
        statuses: {
          'leyline-ultrafast': scenario === 'ultrafast' ? 'on' : 'off',
          'leyline-service-tier': scenario === 'ultrafast' ? 'ultrafast' : scenario === 'fast' ? 'fast' : 'standard',
        },
        widgets: {},
        notifications: [],
      },
      research: research ? researchState : null,
    },
  }
}

function runtimeFixturesFor(scenario, runtime) {
  if (scenario === 'subagent-live') {
    const child = runtimeFor('default')
    return {
      runtimeSessions: [runtime, {
        ...child,
        ...subagentLiveResult.childSession,
        session: subagentLiveChildDetail.session,
        state: {
          ...child.state,
          isStreaming: true,
          pendingToolCalls: ['live-release-verify'],
          pendingTools: [{ toolCallId: 'live-release-verify', toolName: 'bash', args: { command: 'npm run verify' } }],
          activeToolCount: 3,
          activeToolNames: ['read', 'grep', 'bash'],
        },
      }],
      runtimeEvents: [{
        activeSessionId: subagentLiveResult.childSession.id,
        event: {
          type: 'tool_execution_update',
          toolCallId: 'live-release-verify',
          toolName: 'bash',
          partialResult: { content: [{ type: 'text', text: '> harbor@1.0.0 verify\n> node scripts/verify-release.js\n\nChecking release inputs…\nChecking publication safeguards…' }] },
        },
      }],
    }
  }
  if (scenario !== 'activity') {
    return { runtimeSessions: [runtime], runtimeEvents: [] }
  }

  const releaseChecks = runtimeForSession('release-checks', {
    isStreaming: true,
    pendingToolCalls: ['activity-build-tool'],
    pendingTools: [{
      toolCallId: 'activity-build-tool',
      toolName: 'bash',
      args: { command: 'npm run verify' },
    }],
  })
  const failed = runtimeForSession('landing-copy', { isStreaming: false })
  const queued = runtimeForSession('search-state', {
    promptQueue: {
      revision: 1,
      held: false,
      error: '',
      items: [{ id: 'queue-navigation', text: 'Run the focused navigation check next.', imageCount: 0, status: 'pending' }],
    },
  })

  return {
    runtimeSessions: [runtime, releaseChecks, failed, queued],
    runtimeEvents: [{
      activeSessionId: failed.id,
      event: {
        type: 'error',
        error: { message: 'Model request timed out after 300 seconds' },
      },
    }],
  }
}

function runtimeForSession(id, state) {
  const summary = sessions.find((item) => item.id === id)
  const runtime = runtimeFor('default')
  return {
    ...runtime,
    id: summary.id,
    path: summary.path,
    cwd: summary.cwd,
    state: {
      ...runtime.state,
      ...state,
    },
  }
}

function detailFor(scenario) {
  const research = scenario === 'research'
  const summary = research ? researchSession : scenario === 'title-generating'
    ? { ...sessions[0], name: '', firstMessage: baseEntries[0].text, messageCount: 1 }
    : sessions[0]
  const entries = {
    'title-generating': [baseEntries[0]],
    system: systemTranscriptEntries,
    ultrafast: systemTranscriptEntries,
    fast: systemTranscriptEntries,
    export: systemTranscriptEntries,
    research: researchEntries,
    'subagent-outcomes': subagentOutcomeEntries,
    'subagent-mobile': subagentMobileEntries,
    'subagent-sidebar': subagentSidebarEntries,
    'subagent-live': subagentLiveEntries,
    markdown: markdownPreviewEntries,
    tools: toolActivityEntries,
    shell: shellEntries,
    vision: visionEntries,
  }[scenario] || baseEntries
  return {
    session: {
      ...summary,
      sessionFile: summary.path,
      research: research ? researchState : null,
      messageCount: entries.length,
      contextTokens: scenario === 'title-generating' ? 42 : 12480,
      modified: scenario === 'export'
        ? '2026-08-06T15:49:00.000Z'
        : summary.modified,
      created: research
        ? '2026-08-06T15:52:00.000Z'
        : '2026-08-06T15:42:00.000Z',
      contextUsage: runtimeFor(scenario).state.contextUsage,
    },
    entries,
  }
}

function sidebarFixtureFor(scenario, parent) {
  const results = scenario === 'research'
    ? researchEntries.find((entry) => entry.toolName === 'subagent').subagentDetails.results
    : scenario === 'subagent-live' ? [subagentLiveResult]
      : scenario === 'subagent-sidebar' ? subagentSidebarResults
        : scenario === 'subagent-outcomes' ? subagentOutcomeResults
          : subagentOutcomeResults.slice(0, 2)
  const children = results.map((result, index) => ({
    ...session(
      result.childSession.id,
      subagentTaskTitle(result, index),
      new Date(Date.parse(parent.timestamp) + (index + 1) * 60000).toISOString(),
      4,
      parent.cwd,
    ),
    path: result.childSession.path,
    parentSessionPath: parent.path,
    isSubagentSession: true,
  }))
  return {
    parent: {
      ...parent,
      subagentChildren: results.map((result, index) => ({
        id: result.childSession.id,
        agent: result.agent,
        task: subagentTaskTitle(result, index),
      })),
    },
    children,
    liveChildren: children.filter((child, index) => results[index].status === 'running'),
  }
}

async function openBackendConnections(page, enabled = false) {
  const sidebar = page.getByRole('button', { name: 'Open sessions', exact: true })
  if (await sidebar.isVisible()) await sidebar.click()
  await page.getByRole('button', { name: 'Open settings', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Leyline settings' })
  await dialog.waitFor()
  const category = dialog.getByRole('combobox', { name: 'Settings category', exact: true })
  if (await category.isVisible()) await category.selectOption('connections')
  else await dialog.getByRole('button', { name: 'Connections', exact: true }).click()
  const network = dialog.locator('.network-settings[aria-busy="false"]')
  await network.waitFor()
  const toggle = network.getByRole('switch', { name: 'Allow network access' })
  if (await toggle.getAttribute('aria-checked') !== 'false' || await toggle.isDisabled()) {
    throw new Error('Network access must start off and available')
  }
  const port = network.getByRole('textbox', { name: 'Proxy port', exact: true })
  if (await port.inputValue() !== '') throw new Error('Proxy port must start in automatic mode')
  await dialog.locator('.backend-connection-card').filter({ hasText: 'Team backend' }).waitFor()
  await dialog.getByRole('button', { name: 'Add connection', exact: true }).waitFor()
  if (!enabled) return
  await port.fill('52342')
  const apply = network.getByRole('button', { name: 'Apply', exact: true })
  await apply.click()
  await network.waitFor()
  if (await toggle.getAttribute('aria-checked') !== 'false' || await port.inputValue() !== '52342' || !await apply.isDisabled()) {
    throw new Error('Proxy port must save without enabling network access')
  }
  await toggle.click()
  await network.getByRole('status').filter({ hasText: 'Listening on port 52342.' }).waitFor()
  if (await toggle.getAttribute('aria-checked') !== 'true'
    || await network.locator('.network-settings-address').count() !== 2) {
    throw new Error('Network access capture did not reach the enabled state')
  }
  await network.getByRole('button', { name: 'Copy http://192.0.2.10:52342', exact: true }).waitFor()
  await network.getByRole('button', { name: 'Copy http://198.51.100.10:52342', exact: true }).waitFor()
}

async function openModelCatalog(page) {
  const sidebarButton = page.getByRole('button', { name: 'Open sessions', exact: true })
  if (await sidebarButton.isVisible()) await sidebarButton.click()
  await page.getByRole('button', { name: 'Open settings', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Leyline settings' })
  await dialog.waitFor()
  const category = dialog.getByRole('combobox', { name: 'Settings category', exact: true })
  if (await category.isVisible()) await category.selectOption('providers')
  else await dialog.getByRole('button', { name: 'Models & providers', exact: true }).click()
  await dialog.locator('.pi-settings-workspace[aria-busy="false"]').waitFor()
  await dialog.getByRole('button', { name: 'Add custom model', exact: true }).click()
  await dialog.getByRole('button', { name: 'Find in catalog', exact: true }).click()
  const search = dialog.getByRole('searchbox', { name: 'Search catalog', exact: true })
  await search.fill('qwen3.8')
  await search.press('Enter')
  await dialog.locator('.pi-settings-catalog-result').first().waitFor({ state: 'attached' })
  await dialog.locator('.pi-settings-catalog[aria-busy="false"]').waitFor()
  const match = dialog.locator('.pi-settings-catalog-picker select')
  if (await match.isVisible()) await match.selectOption(`${qwenCatalogModel.providerId}/${qwenCatalogModel.id}`)
  else await dialog.locator('.pi-settings-catalog-result').filter({ hasText: 'OpenRouter' }).click()
  await dialog.locator('.pi-settings-catalog-review').getByRole('heading', { name: 'OpenRouter · Qwen3.8 27B', exact: true }).waitFor()
  return dialog
}

async function capture({
  browser,
  file,
  route,
  ready,
  viewport = { width: 1440, height: 900 },
  scenario = 'default',
  sidebarChildren = false,
  terminal = false,
  exportPage = false,
  interact,
  clipSelectors,
  padding = 0,
  preserveHover = false,
  macWindow = false,
  readmeHeader = false,
  embeddedFile,
}) {
  const selected = !screenshotFilter.length || screenshotFilter.includes(path.basename(file))
  const embeddedSelected = embeddedFile && (!screenshotFilter.length || screenshotFilter.includes(path.basename(embeddedFile)) || selected)
  if (!selected && !embeddedSelected) return
  const runtime = runtimeFor(scenario)
  const detail = detailFor(scenario)
  if (scenario === 'title-generating') runtime.session = detail.session
  const sidebar = sidebarChildren ? sidebarFixtureFor(scenario, detail.session) : null
  if (sidebar) {
    detail.session = sidebar.parent
    runtime.session = sidebar.parent
  }
  const captureSessions = (scenario === 'research' ? [researchSession, ...sessions] : sessions)
    .map((summary) => (sidebar || scenario === 'title-generating') && summary.id === runtime.id ? detail.session : summary)
    .concat(sidebar?.children || [])
  const runtimeFixtures = runtimeFixturesFor(scenario, runtime)
  for (const child of sidebar?.liveChildren || []) {
    if (runtimeFixtures.runtimeSessions.some(runtime => runtime.id === child.id)) continue
    const childRuntime = runtimeFor('default')
    runtimeFixtures.runtimeSessions.push({
      ...childRuntime,
      id: child.id,
      path: child.path,
      cwd: child.cwd,
      session: child,
      state: { ...childRuntime.state, isStreaming: true },
    })
  }
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: 2,
    colorScheme: 'dark',
    locale: 'en-US',
    timezoneId: 'UTC',
    reducedMotion: 'reduce',
  })
  await context.addInitScript(initBrowser, {
    fixedNow,
    runtime,
    runtimeSessions: runtimeFixtures.runtimeSessions,
    runtimeEvents: runtimeFixtures.runtimeEvents,
    terminal,
    dictation: ['dictation', 'dictation-settings'].includes(scenario) ? docsDictation : null,
    dictationClient: ['dictation', 'dictation-settings'].includes(scenario) ? docsDictationClient : null,
    dictationMeters: scenario === 'dictation' ? docsDictationMeters : null,
  })
  const page = await context.newPage()
  const unexpected = []
  let captureConfig = { enabled: true, error: '' }
  let networkAccess = { available: true, enabled: false, port: null, configuredPort: 0, urls: [], directAccess: false, error: '' }
  const capturedTraces = structuredClone(traceFixtures)
  const batching = { ...subagentPayload.batching }
  const batchWrites = []
  let titleSettings = { enabled: scenario === 'title-generating', model: scenario === 'title-generating' ? 'local/glm-5.3-flash' : '', thinking: '' }
  const titleWrites = []
  await page.route('**/*', (request) => {
    const origin = new URL(request.request().url()).origin
    if (origin === new URL(baseUrl).origin || origin === 'https://esm.sh') return request.continue()
    unexpected.push(`external request: ${origin}`)
    return request.abort()
  })
  page.on('console', (message) => {
    const blockedPreview = exportPage && message.location().url.startsWith('https://esm.sh/')
    if (message.type() === 'error' && !blockedPreview && !message.text().includes('esm.sh')) {
      unexpected.push(`console: ${message.text()}`)
    }
  })
  page.on('pageerror', (error) => unexpected.push(`page: ${error.message}`))
  await page.route('https://esm.sh/**', (request) => exportPage ? request.abort() : request.fulfill({
    status: 200,
    contentType: 'application/javascript',
    body: `
      export const DIFFS_TAG_NAME = 'div'
      export class File { render() {} cleanUp() {} }
      export class FileDiff { render() {} cleanUp() {} }
      export function parsePatchFiles() { return [] }
    `,
  }))
  await page.route('**/api/**', async (request) => {
    const req = request.request()
    const url = new URL(req.url())
    const method = req.method()
    const key = `${method} ${url.pathname}`
    const json = (body) => request.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(body),
    })

    if (key === 'GET /api/leyline/connections') return json(backendRegistry)
    if (key === 'GET /api/leyline/network-access') return json(networkAccess)
    if (key === 'PUT /api/leyline/network-access' && scenario === 'network') {
      const enabled = req.postDataJSON().enabled ?? networkAccess.enabled
      const configuredPort = req.postDataJSON().port ?? networkAccess.configuredPort
      const port = configuredPort || 52342
      networkAccess = {
        ...networkAccess,
        enabled,
        configuredPort,
        port: enabled ? port : null,
        urls: enabled ? [`http://192.0.2.10:${port}`, `http://198.51.100.10:${port}`] : [],
      }
      return json(networkAccess)
    }
    if (key === `GET /api/leyline/settings/${THINKING_DEFAULT_SETTING_KEY}`) {
      return json({ key: THINKING_DEFAULT_SETTING_KEY, value: 'collapsed' })
    }
    if (key === 'GET /api/leyline/pinned-sessions') {
      return json({
        connectionId: url.searchParams.get('connectionId') || 'builtin',
        pinnedIds: scenario === 'pinned'
          ? ['terminal-resize', 'export-layout']
          : [],
      })
    }
    if (key === 'GET /api/pi/settings/session-titles') return json(titleSettings)
    if (key === 'PUT /api/pi/settings/session-titles' && scenario === 'title-settings') {
      const body = req.postDataJSON()
      if (typeof body?.enabled === 'boolean' && body.model === 'local/glm-5.3-flash' && body.thinking === '') {
        titleSettings = body
        titleWrites.push(body)
        return json(titleSettings)
      }
    }
    if (key === 'GET /api/pi/settings/providers') return json(scenario === 'model-catalog' ? catalogProviderSettings : providerSettings)
    if (key === 'GET /api/pi/settings/catalog/models') {
      const words = (url.searchParams.get('q') || '').trim().toLowerCase().split(/\s+/).filter(Boolean)
      return json({ models: words.length ? modelCatalog
        .filter((entry) => words.every((word) => `${entry.id} ${entry.name} ${entry.providerId}`.toLowerCase().includes(word)))
        .sort((a, b) => a.id.localeCompare(b.id) || a.providerId.localeCompare(b.providerId)) : [] })
    }
    if (key === 'POST /api/pi/settings/providers/action') {
      const body = req.postDataJSON()
      if (body.action === 'test' && body.providerId === 'local' && body.modelId === model.id && body.draft?.revision === providerSettings.revision) {
        return json({
          id: 'docs-connection-test', state: 'completed', prompt: null, events: [], error: '',
          result: { providerId: body.providerId, modelId: body.modelId, action: 'test', durationMs: 200, httpStatus: 200 },
        })
      }
    }
    if (key === 'GET /api/pi/settings/mcp') return json(mcpSettings)
    if (key === 'GET /api/pi/info') return json(backendInfo)
    if (key === 'GET /api/pi/traces/config') return json(captureConfig)
    if (key === 'PUT /api/pi/traces/config' && typeof req.postDataJSON()?.enabled === 'boolean') {
      captureConfig = { enabled: req.postDataJSON().enabled, error: '' }
      return json(captureConfig)
    }
    if (key === 'GET /api/pi/traces') {
      const page = Number(url.searchParams.get('page') || 1)
      const limit = Number(url.searchParams.get('limit') || 20)
      const matches = capturedTraces.filter(trace => {
        return (!url.searchParams.has('sessionId') || trace.sessionId === url.searchParams.get('sessionId'))
          && (!url.searchParams.get('cwd') || trace.metadata.cwd === url.searchParams.get('cwd'))
          && (!url.searchParams.get('status') || trace.status === url.searchParams.get('status'))
          && (!url.searchParams.get('q') || `${trace.name} ${trace.metadata.sessionName}`.toLowerCase().includes(url.searchParams.get('q').toLowerCase()))
      })
      return json({ traces: matches.slice((page - 1) * limit, page * limit).map(({ observations, scores, input, output, ...summary }) => summary), total: matches.length, page, limit })
    }
    const trace = capturedTraces.find(item => url.pathname === `/api/pi/traces/${item.id}`)
    if (trace && method === 'GET') return json({ trace: tracePage(trace, url.searchParams) })
    if (trace && method === 'PATCH' && typeof req.postDataJSON()?.bookmarked === 'boolean') {
      trace.bookmarked = req.postDataJSON().bookmarked
      trace.revision += 1
      return json({ trace: tracePage(trace, url.searchParams) })
    }
    if (key === 'GET /api/pi/files/settings') return json(fileSettings)
    if (key === 'GET /api/pi/projects') return json({ projects })
    if (key === 'GET /api/pi/fs') return json(projectDirectory)
    if (key === 'GET /api/pi/sessions') return json({ sessions: captureSessions })
    if (key === 'GET /api/pi/state') return json({ active: runtime })
    if (key === 'POST /api/pi/active-session' && (scenario !== 'subagent-live' || req.postDataJSON()?.id === runtime.id)) return json({ active: runtime })
    if (key === `GET /api/pi/sessions/${runtime.id}`) return json(detail)
    if (scenario === 'subagent-live' && key === `GET /api/pi/sessions/${subagentLiveResult.childSession.id}`) return json(subagentLiveChildDetail)
    const savedChild = subagentSavedChildDetails.find(child => key === `GET /api/pi/sessions/${child.session.id}`)
    if (savedChild) return json(savedChild)
    if (key === 'GET /api/pi/review') {
      return json(scenario === 'review' ? reviewPayload : cleanReviewPayload)
    }
    if (key === 'GET /api/pi/review/diff') return json(reviewDiffPayload)
    if (key === 'GET /api/pi/memories') return json(memoryPayload)
    if (key === 'GET /api/pi/subagents') {
      const target = Object.fromEntries(url.searchParams)
      if (target.cwd === memoryPayload.context.cwd && (!target.sessionPath || target.sessionPath === memoryPayload.context.sessionFile)) {
        return json(subagentConfigPayload(target, batching))
      }
    }
    if (key === 'PUT /api/pi/subagents/batching') {
      const body = req.postDataJSON()
      const scope = scenario === 'subagent-batching' ? 'session' : scenario === 'subagent-batching-global' ? 'global' : null
      if (scope && body.scope === scope && body.cwd === memoryPayload.context.cwd
        && (scope === 'session' ? body.sessionPath === memoryPayload.context.sessionFile : !body.sessionPath)
        && (Number.isSafeInteger(body.batchSize) && body.batchSize > 0 || scope === 'session' && body.batchSize === null)) {
        batching[scope] = body.batchSize
        batchWrites.push(body.batchSize)
        return json(subagentConfigPayload(body, batching))
      }
    }
    if (key === 'GET /api/pi/vision/config') {
      const config = visionConfigPayload(url.searchParams.has('sessionPath'))
      return json(scenario === 'composer-blocked' ? {
        ...config,
        overrides: {},
        model: null,
        modelSource: 'default',
        thinking: '',
        thinkingSource: 'default',
      } : config)
    }
    if (key === `GET /api/pi/sessions/${runtime.id}/export`) {
      const html = await renderSessionExportHtml(detail)
      return request.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html })
    }

    unexpected.push(`request: ${key}${url.search}`)
    return request.abort()
  })

  try {
    const url = new URL(route, baseUrl).toString()
    await page.goto(url, { waitUntil: 'domcontentloaded' })
    await page.locator(ready).first().waitFor({ state: 'visible', timeout: 15000 })
    if (!exportPage) {
      await page.locator('.project-sidebar .sidebar-project-shortcuts').waitFor({
        state: 'attached',
        timeout: 15000,
      })
      await page.waitForFunction(() => {
        const count = document.querySelector(
          '.project-session-heading span:last-child',
        )?.textContent?.trim()
        return count && count !== '…'
      }, undefined, { timeout: 15000 })
    }
    if (viewport.width > 1120 && route.startsWith('/sessions/')) {
      await page.locator('.review-toggle-button:not(.preparing)').waitFor({
        state: 'visible',
        timeout: 15000,
      })
    }
    if (interact) await interact(page)
    const expectedBatchWrites = scenario === 'subagent-batching' ? [2, null, 2] : scenario === 'subagent-batching-global' ? [3, 4] : []
    if (JSON.stringify(batchWrites) !== JSON.stringify(expectedBatchWrites)) throw new Error('Batch size fixture did not save, reset, and restore the expected values')
    const expectedTitleWrites = scenario === 'title-settings' ? [
      { enabled: false, model: 'local/glm-5.3-flash', thinking: '' },
      { enabled: true, model: 'local/glm-5.3-flash', thinking: '' },
    ] : []
    if (JSON.stringify(titleWrites) !== JSON.stringify(expectedTitleWrites)) throw new Error('Title settings fixture did not select the model and enable titles')
    if (await page.locator('.subagent-inspector').count()) await waitForSubagentReader(page)
    await sanitizeNativeBackendAddress(page)
    await page.evaluate(async () => {
      await document.fonts.ready
      await Promise.all([...document.images].map((image) => image.decode().catch(() => {})))
    })
    await disableMotion(page)
    if (!preserveHover) {
      await page.mouse.move(viewport.width - 2, viewport.height - 2)
      await page.evaluate(() => document.activeElement?.blur?.())
    }
    await page.evaluate(() => window.scrollTo(0, 0))
    await assertPrivateDataAbsent(page)
    if (!exportPage) {
      await assertModelLabel(
        page,
        `${runtime.state.model.provider}/${runtime.state.model.id}`,
        runtime.state.model.name,
      )
      if (['home', 'ultrafast', 'fast'].includes(scenario)) {
        const enabled = scenario !== 'home'
        const tierLabel = scenario === 'ultrafast' ? 'Ultrafast' : scenario === 'fast' ? 'Fast' : 'Standard'
        if (await page.locator('.mobile-model-control:visible').count()) {
          const control = page.locator('.mobile-speed-control:visible')
          if (await control.count() !== 1
            || await control.evaluate(element => element.classList.contains('active')) !== enabled) {
            throw new Error('Unexpected mobile speed control state')
          }
        } else {
          const chip = page.locator('.service-tier-chip:visible').first()
          if (await chip.getAttribute('aria-label') !== `Speed: ${tierLabel}`
            || await chip.evaluate(element => element.classList.contains('active')) !== enabled) {
            throw new Error('Unexpected service tier control state')
          }
        }
      }
    }
    if (unexpected.length) throw new Error(unexpected.join('\n'))
    const clip = clipSelectors
      ? await unionClip(page, clipSelectors, padding, viewport)
      : undefined
    if (embeddedSelected) {
      await assertPrivateDataAbsent(page)
      await page.locator('.trace-panel > .elune-ui').screenshot({ path: embeddedFile, animations: 'disabled' })
      console.log(`Saved ${path.relative(process.cwd(), embeddedFile)}`)
    }
    if (!selected) return
    if (macWindow) {
      await assertPrivateDataAbsent(page)
      const image = await page.screenshot({ clip, animations: 'disabled' })
      await saveMacWindowScreenshot({
        browser,
        file,
        image,
        contentSize: clip || viewport,
      })
    } else if (readmeHeader) {
      const image = await page.screenshot({ animations: 'disabled' })
      await saveReadmeHeader({ browser, file, image })
    } else {
      await assertPrivateDataAbsent(page)
      await page.screenshot({ path: file, clip, animations: 'disabled' })
    }
    console.log(`Saved ${path.relative(process.cwd(), file)}`)
  } finally {
    await context.close()
  }
}

async function saveMacWindowScreenshot({ browser, file, image, contentSize }) {
  const frame = {
    side: 104,
    top: 56,
    bottom: 104,
    titlebar: 52,
  }
  const viewport = {
    width: Math.ceil(contentSize.width + frame.side * 2),
    height: Math.ceil(contentSize.height + frame.top + frame.titlebar + frame.bottom),
  }
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: 2,
    colorScheme: 'dark',
  })
  const page = await context.newPage()

  try {
    await page.setContent(`
      <style>
        html, body {
          width: 100%;
          height: 100%;
          margin: 0;
          overflow: hidden;
          background: transparent;
        }

        .window-frame {
          position: absolute;
          top: ${frame.top}px;
          left: ${frame.side}px;
          width: ${contentSize.width}px;
          overflow: hidden;
          border-radius: 20px;
          background: #0d0d0d;
          box-shadow:
            0 0 0 1px rgba(255, 255, 255, 0.18),
            0 44px 96px rgba(0, 0, 0, 0.58),
            0 16px 36px rgba(0, 0, 0, 0.38),
            0 3px 10px rgba(0, 0, 0, 0.28);
        }

        .window-titlebar {
          position: relative;
          display: flex;
          height: ${frame.titlebar}px;
          align-items: center;
          justify-content: center;
          border-bottom: 1px solid rgba(0, 0, 0, 0.72);
          background: linear-gradient(180deg, #2a2a2d 0%, #202023 100%);
          box-shadow: inset 0 1px rgba(255, 255, 255, 0.08);
        }

        .window-controls {
          position: absolute;
          left: 20px;
          display: flex;
          gap: 9px;
        }

        .window-control {
          width: 14px;
          height: 14px;
          border-radius: 50%;
          box-shadow:
            inset 0 0 0 0.5px rgba(0, 0, 0, 0.4),
            0 1px 1px rgba(0, 0, 0, 0.22);
        }

        .window-control:nth-child(1) { background: #ff5f57; }
        .window-control:nth-child(2) { background: #febc2e; }
        .window-control:nth-child(3) { background: #28c840; }

        .window-title {
          color: rgba(255, 255, 255, 0.68);
          font: 500 15px/1 -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif;
          letter-spacing: -0.01em;
          -webkit-font-smoothing: antialiased;
        }

        .window-content {
          display: block;
          width: ${contentSize.width}px;
          height: ${contentSize.height}px;
        }
      </style>
      <div class="window-frame">
        <div class="window-titlebar">
          <div class="window-controls">
            <span class="window-control"></span>
            <span class="window-control"></span>
            <span class="window-control"></span>
          </div>
          <div class="window-title">Leyline</div>
        </div>
        <img class="window-content" alt="">
      </div>
    `)
    const windowContent = page.locator('.window-content')
    await windowContent.evaluate(async (element, source) => {
      element.src = source
      await element.decode()
    }, `data:image/png;base64,${image.toString('base64')}`)
    await assertPrivateDataAbsent(page)
    await page.screenshot({ path: file, animations: 'disabled', omitBackground: true })
  } finally {
    await context.close()
  }
}

async function saveReadmeHeader({ browser, file, image }) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 480 }, deviceScaleFactor: 1 })
  const page = await context.newPage()
  try {
    const mark = await fs.readFile(path.resolve('docs/public/leyline-mark.svg'), 'utf8')
    await page.setContent(`
      <style>
        html, body { margin: 0; overflow: hidden; background: #0d0d0d; color: #e6e6e6; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
        .brand { position: absolute; top: 32px; left: 52px; height: 76px; display: flex; align-items: center; gap: 8px; }
        .brand svg { width: 72px; height: 72px; }
        h1 { margin: 0; font-size: 64px; font-weight: 650; letter-spacing: -2px; line-height: 1; }
        .site { position: absolute; top: 62px; right: 64px; color: #8d8d8d; font-size: 24px; }
        p { position: absolute; top: 127px; left: 64px; margin: 0; color: #b3b3b3; font: 34px/44px Arial, sans-serif; letter-spacing: -1px; }
        .workspace { position: absolute; top: 212px; left: 64px; width: 1312px; overflow: hidden; border: 1px solid #363636; border-radius: 16px; box-shadow: 0 12px 32px #0004; }
        .workspace img { display: block; width: 100%; }
      </style>
      <div class="brand">${mark}<h1>Leyline</h1></div>
      <span class="site">leyline.sh</span>
      <p>Run concurrent pi sessions in your browser, desktop, or mobile.</p>
      <div class="workspace"><img alt="Leyline workspace"></div>
    `)
    await page.locator('img').evaluate(async (element, source) => {
      element.src = source
      await element.decode()
    }, `data:image/png;base64,${image.toString('base64')}`)
    await page.evaluate(() => document.fonts.ready)
    await assertPrivateDataAbsent(page)
    await page.screenshot({ path: file, animations: 'disabled' })
  } finally {
    await context.close()
  }
}

async function ensureServer() {
  try {
    const response = await fetch(baseUrl, { signal: AbortSignal.timeout(3000) })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
  } catch (error) {
    throw new Error(`Leyline is not available at ${baseUrl}: ${error.message}`)
  }
}

async function disableMotion(page) {
  await page.addStyleTag({
    content: `
      *, *::before, *::after {
        animation: none !important;
        scroll-behavior: auto !important;
        transition: none !important;
      }
      input, textarea, [contenteditable="true"] { caret-color: transparent !important; }
      .xterm-cursor, .xterm-cursor-layer { visibility: hidden !important; }
    `,
  })
  await page.evaluate(() => new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(resolve))
  }))
}

async function sanitizeNativeBackendAddress(page) {
  const source = new URL(baseUrl).host
  const replacement = 'localhost:5173'
  if (!source || source === replacement) return

  await page.locator('body').evaluate((element, values) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
    let node = walker.nextNode()
    while (node) {
      if (node.nodeValue.includes(values.source)) {
        node.nodeValue = node.nodeValue.replaceAll(values.source, values.replacement)
      }
      node = walker.nextNode()
    }
  }, { source, replacement })
}

async function assertPrivateDataAbsent(page) {
  const shadowText = await page.locator('.pierre-diffs-container').evaluateAll((elements) => {
    return elements.map((element) => element.shadowRoot?.textContent || '').join('\n')
  })
  const text = shadowText + '\n' + await page.locator('body').innerText() + '\n' + await page.locator('input, textarea, select').evaluateAll((elements) => {
    return elements.map((element) => element.value).join('\n')
  })
  const captureHost = new URL(baseUrl).host
  const forbidden = [
    '/Users/',
    '/home/',
    os.homedir(),
    os.userInfo().username,
    process.cwd(),
    captureHost === 'localhost:5173' ? '' : captureHost,
  ].filter((value) => value && value.length > 2)
  const found = forbidden.find((value) => text.includes(value))
  if (found) throw new Error(`Private text found before capture: ${found}`)
  if (/minimax[- ]m2\.7/i.test(text)) throw new Error('Previous general model fixture found before capture')
  if (/\b[\w.-]+\.(?:local|internal)\b/.test(text)) {
    throw new Error('Private hostname found before capture')
  }
  if (/\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b/.test(text)) {
    throw new Error('Email address found before capture')
  }
  if (/\b(?:sk-|ghp_|xox[baprs]-|AKIA)[A-Za-z0-9_-]{8,}\b/.test(text)) {
    throw new Error('Credential-like text found before capture')
  }
  const fixturePaths = text.match(/\/workspace\/[A-Za-z0-9_./-]+/g) || []
  if (fixturePaths.some((value) => !value.startsWith('/workspace/'))) {
    throw new Error('Unexpected fixture path found before capture')
  }
}

async function assertModelLabel(page, expected, mobileExpected = expected) {
  const mobileControl = page.locator('.mobile-model-control:visible').first()
  if (await mobileControl.count()) {
    await page.waitForFunction(({ expected }) => {
      const controls = [...document.querySelectorAll('.mobile-model-control')]
        .filter((control) => control.getClientRects().length)
      return controls.length > 0 && controls.every((control) => {
        const title = control.querySelector('.mobile-model-title > span')
        return title && title.textContent.trim() === expected
      })
    }, { expected: mobileExpected }, { timeout: 15000 })
    return
  }
  const selector = '.model-picker:not(.small-picker):not(.tool-picker):not(.service-tier-picker) > .model-picker-button'
  await page.waitForFunction(({ expected, selector }) => {
    const buttons = [...document.querySelectorAll(selector)]
      .filter((button) => button.getClientRects().length)
    return buttons.length > 0 && buttons.every((button) => {
      const labels = [...button.querySelectorAll('.model-label')]
        .filter((label) => label.getClientRects().length)
      return labels.some((label) => label.textContent.trim() === expected)
    })
  }, { expected, selector }, { timeout: 15000 })
  const buttons = page.locator(`${selector}:visible`)
  const count = await buttons.count()
  for (let index = 0; index < count; index += 1) {
    const label = buttons.nth(index).locator('.model-label:visible').first()
    const value = (await label.innerText()).trim()
    if (value !== expected) throw new Error(`Unexpected model selector label: ${value}`)
  }
}

async function unionClip(page, selectors, padding, viewport) {
  const boxes = []
  for (const selector of selectors) {
    const box = await page.locator(selector).first().boundingBox()
    if (!box) throw new Error(`Cannot calculate capture bounds for ${selector}`)
    boxes.push(box)
  }
  const left = Math.max(0, Math.min(...boxes.map((box) => box.x)) - padding)
  const top = Math.max(0, Math.min(...boxes.map((box) => box.y)) - padding)
  const right = Math.min(viewport.width, Math.max(...boxes.map((box) => box.x + box.width)) + padding)
  const bottom = Math.min(viewport.height, Math.max(...boxes.map((box) => box.y + box.height)) + padding)
  return { x: left, y: top, width: right - left, height: bottom - top }
}

function initBrowser({
  fixedNow: now,
  runtime,
  runtimeSessions,
  runtimeEvents,
  terminal,
  dictation,
  dictationClient,
  dictationMeters,
}) {
  const NativeDate = Date
  let tick = 0
  class FixedDate extends NativeDate {
    constructor(...args) {
      super(...(args.length ? args : [now + tick++]))
    }
    static now() {
      return now + tick++
    }
  }
  FixedDate.parse = NativeDate.parse
  FixedDate.UTC = NativeDate.UTC
  window.Date = FixedDate

  class MockSpeechRecognition {
    start() {}
    stop() {
      this.onend?.()
    }
  }
  window.SpeechRecognition = MockSpeechRecognition
  window.webkitSpeechRecognition = MockSpeechRecognition
  if (dictationClient) {
    window.localStorage.setItem('leyline.dictation.client.v1', JSON.stringify(dictationClient))
    let fixtureNow = 0
    Object.defineProperty(Performance.prototype, 'now', { configurable: true, value: () => fixtureNow })
    const nativeRequestAnimationFrame = window.requestAnimationFrame.bind(window)
    window.requestAnimationFrame = callback => nativeRequestAnimationFrame(() => callback(fixtureNow))
    const tracks = [{ onended: null, stop() {} }]
    const stream = { getTracks: () => tracks, getAudioTracks: () => tracks }
    const emptyNode = () => ({ connect() {}, disconnect() {} })
    let workletNode
    class DocsAudioContext {
      state = 'suspended'
      destination = {}
      audioWorklet = { addModule: async () => {} }
      async resume() { this.state = 'running' }
      async close() { this.state = 'closed' }
      createMediaStreamSource() { return emptyNode() }
      createGain() { return { ...emptyNode(), gain: { value: 1 } } }
    }
    class DocsAudioWorkletNode {
      constructor() {
        workletNode = this
        this.port = {
          onmessage: null,
          postMessage: value => {
            if (value === 'flush') this.port.onmessage?.({ data: { type: 'flushed' } })
          },
        }
        this.onprocessorerror = null
      }
      connect() {}
      disconnect() {}
    }
    window.AudioContext = DocsAudioContext
    window.webkitAudioContext = DocsAudioContext
    window.AudioWorkletNode = DocsAudioWorkletNode
    Object.defineProperty(navigator.mediaDevices, 'enumerateDevices', {
      configurable: true,
      value: async () => [{ deviceId: 'demo-microphone', groupId: 'demo-group', kind: 'audioinput', label: 'Demo microphone', toJSON() {} }],
    })
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
      configurable: true,
      value: async () => stream,
    })
    window.__docsDictationAcknowledged = 0
    window.__docsFeedDictation = async () => {
      if (!workletNode?.port.onmessage || !dictationMeters?.length) throw new Error('Mock dictation audio worklet is not ready')
      let previousDrawing = ''
      for (let index = 0; index < dictationMeters.length; index++) {
        fixtureNow = index * 1000 / (dictationMeters.length - 1)
        const meter = dictationMeters[index]
        workletNode.port.onmessage({ data: { type: 'meter', ...meter } })
        const pcm = new Float32Array(1600)
        for (let sample = 0; sample < pcm.length; sample++) {
          pcm[sample] = Math.sin((index * pcm.length + sample) * 0.071) * meter.rms * 1.4
        }
        workletNode.port.onmessage({ data: { type: 'audio', pcm } })
        await new Promise(resolve => setTimeout(resolve, 0))
        const drawing = [...document.querySelectorAll('.dictation-wave rect')].map(bar => bar.style.transform).join('|')
        if (!drawing || drawing === previousDrawing) throw new Error(`Dictation meter ${index + 1} did not update the production waveform`)
        if (window.__docsDictationAcknowledged !== index + 1) throw new Error(`Dictation PCM packet ${index + 1} was not acknowledged`)
        previousDrawing = drawing
      }
      return { count: dictationMeters.length, time: fixtureNow, acknowledged: window.__docsDictationAcknowledged }
    }
    window.addEventListener('pagehide', () => {
      if (workletNode) workletNode.port.onmessage = null
    }, { once: true })
  }

  const NativeWebSocket = window.WebSocket
  let docsCaptureSequence = 0
  window.__docsEventSockets = []
  class MockWebSocket extends EventTarget {
    static CONNECTING = 0
    static OPEN = 1
    static CLOSING = 2
    static CLOSED = 3
    constructor(url, protocols) {
      super()
      if ([protocols].flat().includes('vite-hmr')) return new NativeWebSocket(url, protocols)
      this.url = String(url)
      this.readyState = MockWebSocket.CONNECTING
      const target = new URL(url, window.location.href)
      const pathname = target.pathname
      if (pathname === '/api/pi/events') window.__docsEventSockets.push(this)
      setTimeout(() => {
        if (this.readyState !== MockWebSocket.CONNECTING) return
        if (!['/api/pi/events', '/api/pi/review/events', '/api/pi/terminal', ...(dictation ? ['/api/leyline/dictation'] : [])].includes(pathname)
          || (pathname === '/api/pi/terminal' && !terminal)) {
          this.close()
          return
        }
        this.readyState = MockWebSocket.OPEN
        const event = new Event('open')
        this.onopen?.(event)
        this.dispatchEvent(event)
        if (pathname === '/api/leyline/dictation') {
          this.dictationState = structuredClone(dictation)
          this.dictationCapture = null
          this.dictationOwner = true
          return
        }
        if (pathname === '/api/pi/terminal') {
          this.emit({ type: 'ready', cwd: '/workspace/harbor', shell: '/bin/zsh', pty: true })
          this.emit({ type: 'data', data: '$ npm run docs:build\r\n✓ documentation build complete\r\n' })
          return
        }
        if (pathname === '/api/pi/review/events') {
          this.emit({ type: 'review_ready', data: {} })
          return
        }
        for (const activeRuntime of runtimeSessions) {
          this.emit({ type: 'active_session', data: activeRuntime })
        }
        this.emit({ type: 'runtime_roster', data: { sessionIds: runtimeSessions.map((session) => session.id) } })
        for (const data of runtimeEvents) {
          if (['message_update', 'tool_execution_update'].includes(data.event?.type)
            && data.activeSessionId !== target.searchParams.get('sessionId')) continue
          this.emit({ type: 'runtime_event', data })
        }
        this.emit({ type: 'active_session', data: { ...runtime, snapshotRevision: now + 1 } })
      }, pathname === '/api/pi/terminal' ? 20 : 0)
    }
    emit(frame) {
      if (this.readyState !== MockWebSocket.OPEN) return
      const event = new MessageEvent('message', { data: JSON.stringify(frame) })
      this.onmessage?.(event)
      this.dispatchEvent(event)
    }
    send(data) {
      if (!dictation || new URL(this.url).pathname !== '/api/leyline/dictation') return
      if (typeof data === 'string') {
        const request = JSON.parse(data)
        try {
          const value = this.dictationCommand(request.method, request.input)
          this.emit({ id: request.id, ok: true, value })
        } catch (error) {
          this.emit({ id: request.id, ok: false, error: error.message })
        }
        return
      }
      if (!(data instanceof ArrayBuffer) || data.byteLength < 48 || (data.byteLength - 44) % 4) return
      const frame = new DataView(data)
      const id = frame.getUint32(0, true)
      const sequence = frame.getUint32(4, true)
      const captureId = new TextDecoder().decode(new Uint8Array(data, 8, 36))
      if (!this.dictationOwner || !this.dictationCapture || this.dictationCapture.captureId !== captureId || this.dictationCapture.sequence !== sequence) {
        this.emit({ id, ok: false, error: 'Invalid dictation audio sequence' })
        return
      }
      for (let offset = 44; offset < data.byteLength; offset += 4) {
        const sample = frame.getFloat32(offset, true)
        if (!Number.isFinite(sample) || Math.abs(sample) > 1) {
          this.emit({ id, ok: false, error: 'Invalid dictation audio sample' })
          return
        }
      }
      this.dictationCapture.sequence++
      window.__docsDictationAcknowledged++
      this.emit({ id, ok: true, value: { accepted: true } })
    }
    dictationCommand(method, input) {
      if (method === 'getState') return structuredClone(this.dictationState)
      if (method === 'updateSettings') {
        this.dictationState.settings = { ...this.dictationState.settings, ...input }
        return structuredClone(this.dictationState)
      }
      if (method === 'start') {
        if (!this.dictationOwner || this.dictationCapture) throw new Error('Dictation capture is busy')
        const sequence = ++docsCaptureSequence
        const captureId = `${String(Date.now()).slice(-8).padStart(8, '0')}-0000-4000-8000-${sequence.toString(16).padStart(12, '0')}`
        this.dictationCapture = { captureId, sequence: 0, requestId: input.requestId }
        this.dictationState.busy = true
        this.dictationState.owned = true
        return { captureId, sampleRate: 16000 }
      }
      if (method === 'finish') {
        if (!this.dictationOwner || !this.dictationCapture || this.dictationCapture.captureId !== input) throw new Error('Dictation capture is not owned')
        this.dictationCapture = null
        this.dictationState.busy = false
        this.dictationState.owned = false
        return { text: 'The release notes are ready for review.' }
      }
      if (method === 'cancel') {
        if (input?.requestId && this.dictationCapture?.requestId !== input.requestId) throw new Error('Dictation capture is not owned')
        this.dictationCapture = null
        this.dictationState.busy = false
        this.dictationState.owned = false
        return structuredClone(this.dictationState)
      }
      throw new Error(`Unknown dictation method: ${method}`)
    }
    close() {
      if (this.readyState === MockWebSocket.CLOSED) return
      this.readyState = MockWebSocket.CLOSED
      const event = new CloseEvent('close', { code: 1000, wasClean: true })
      this.onclose?.(event)
      this.dispatchEvent(event)
    }
  }
  window.WebSocket = MockWebSocket
}
