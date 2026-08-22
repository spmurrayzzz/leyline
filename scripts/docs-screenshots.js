import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { chromium } from 'playwright'
import { THINKING_DEFAULT_SETTING_KEY } from '../lib/leyline-settings.js'
import {
  canonicalResearchSourceKey,
  compactResearchState,
} from '../lib/research-state.js'
import { renderSessionExportHtml } from '../server/pi-api/export-renderer.js'

const baseUrl = process.env.DOCS_SCREENSHOT_URL || 'http://localhost:5173/'
const docsOutputDir = path.resolve('docs/assets/screenshots')
const readmeOutputDir = path.resolve('assets/readme')
const fixedNow = Date.parse('2026-08-06T16:00:00.000Z')
const visionAlertImage = {
  type: 'image',
  data: (await fs.readFile(path.resolve('scripts/fixtures/vision-alert.webp'))).toString('base64'),
  mimeType: 'image/webp',
}
const model = {
  provider: 'local',
  id: 'deepseek-v4-flash',
  name: 'DeepSeek V4 Flash',
  supportsImages: false,
  contextWindow: 384000,
  availableThinkingLevels: ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'],
}
const availableModels = [
  model,
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
  apiVersion: 1,
  capabilities: {
    events: true,
    exports: true,
    research: true,
    review: true,
    terminal: true,
  },
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

const baseEntries = [
  messageEntry({
    id: 'user-1',
    role: 'user',
    label: 'You',
    text: 'Review `scripts/release.js` and make validation run before publication.',
    timestamp: '2026-08-06T15:43:00.000Z',
  }),
  messageEntry({
    id: 'assistant-1',
    role: 'assistant',
    label: 'Agent',
    text: 'The script publishes before it checks the build. I will reverse those operations and keep failures visible.',
    thinking: 'I need to inspect the release order, preserve the existing error path, and make the smallest safe change.',
    timestamp: '2026-08-06T15:44:00.000Z',
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
    timestamp: '2026-08-06T15:45:00.000Z',
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
    timestamp: '2026-08-06T15:46:00.000Z',
  }),
  messageEntry({
    id: 'assistant-2',
    role: 'assistant',
    label: 'Agent',
    text: 'Updated `scripts/release.js`. Verification now finishes before publication begins.',
    timestamp: '2026-08-06T15:47:00.000Z',
    rolloutFeedback: 'helpful',
  }),
]

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

## Release controls

Use a preview channel before broad rollout. Electron exposes the update lifecycle needed to check, download, and install releases [1](https://www.electronjs.org/docs/latest/api/auto-updater).

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
      overrides: { session: 'local/deepseek-v4-flash' },
      effectiveModel: 'local/deepseek-v4-flash',
      modelSource: 'session',
    },
    {
      key: 'user:/workspace/agents/researcher.md:researcher',
      name: 'researcher',
      description: 'Finds source evidence before implementation begins.',
      source: 'user',
      path: '/workspace/agents/researcher.md',
      model: 'local/deepseek-v4-flash',
      thinking: 'medium',
      tools: ['read', 'grep', 'bash'],
      overrides: { project: 'local/deepseek-v4-flash' },
      effectiveModel: 'local/deepseek-v4-flash',
      modelSource: 'project',
    },
  ],
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

const goal = {
  objective: 'Prepare a safe release candidate',
  status: 'active',
  tokenBudget: 50000,
  continuationLimit: 8,
  continuationsUsed: 2,
  tokensUsed: 12480,
  timeUsedSeconds: 420,
  createdAt: fixedNow - 480000,
  updatedAt: fixedNow,
}

await ensureServer()
await fs.mkdir(docsOutputDir, { recursive: true })
await fs.mkdir(readmeOutputDir, { recursive: true })

const browser = await chromium.launch()
try {
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
  })
  await capture({
    browser,
    file: path.join(docsOutputDir, 'deep-research.png'),
    route: '/sessions/research-session',
    ready: '.research-report-message',
    scenario: 'research',
    interact: async (page) => {
      await selectResearchSource(page, 1)
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
    file: path.join(docsOutputDir, 'project-navigation.png'),
    route: '/sessions/demo-session',
    ready: '.assistant-message',
    interact: async (page) => {
      await page.getByRole('button', { name: 'Change project' }).click()
      await page.getByRole('dialog', { name: 'Projects' }).waitFor()
    },
  })
  await capture({
    browser,
    file: path.join(docsOutputDir, 'project-details.png'),
    route: '/sessions/demo-session',
    ready: '.assistant-message',
    interact: async (page) => {
      const sidebar = page.locator('.project-sidebar')
      await sidebar.getByRole('button', { name: 'Project actions' }).click()
      await sidebar.getByRole('button', { name: 'Project details' }).click()
      const drawer = page.locator('aside[aria-label="Project details"]')
      await drawer.waitFor()
      await drawer.locator('input').fill('release')
      await drawer.locator('.project-session-card').first().waitFor()
    },
  })
  await capture({
    browser,
    file: path.join(docsOutputDir, 'backend-connections.png'),
    route: '/sessions/demo-session',
    ready: '.assistant-message',
    interact: async (page) => {
      await page.getByRole('button', { name: 'Open settings' }).click()
      await page.locator('aside[aria-label="Settings"] .backend-connection-card').last().waitFor()
    },
  })
  await capture({
    browser,
    file: path.join(docsOutputDir, 'composer-controls.png'),
    route: '/sessions/demo-session',
    ready: '.composer .composer-context-usage',
    clipSelectors: ['.composer'],
    padding: 18,
  })
  await capture({
    browser,
    file: path.join(docsOutputDir, 'composer-queue.png'),
    route: '/sessions/demo-session',
    ready: '.queued-message-drawer',
    scenario: 'queue',
    clipSelectors: ['.composer', '.queued-message-drawer'],
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
    file: path.join(docsOutputDir, 'preview-fullscreen.png'),
    route: '/sessions/demo-session',
    ready: '.transcript-tool',
    interact: async (page) => {
      const tool = page.locator('.transcript-tool').filter({ hasText: 'scripts/release.js' }).last()
      await tool.getByTitle('Open full screen').click()
      await page.locator('.tool-fullscreen .pierre-preview-inner > *').waitFor()
      await page.locator('.app-header').evaluate((element) => {
        element.style.visibility = 'hidden'
      })
    },
    clipSelectors: ['.tool-fullscreen-header', '.tool-fullscreen .pierre-preview-inner'],
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
    interact: async (page) => {
      await page.getByRole('button', { name: 'Open settings' }).click()
      await page.locator('.settings-action-row').filter({ hasText: 'Subagents' }).click()
      await page.locator('aside[aria-label="Subagents"] .subagent-config-card').first().waitFor()
    },
  })
  await capture({
    browser,
    file: path.join(docsOutputDir, 'vision-tool-call.png'),
    route: '/sessions/demo-session',
    ready: '.transcript-tool',
    scenario: 'vision',
    interact: async (page) => {
      const tool = page.locator('.transcript-tool').filter({ hasText: 'Tool · vision_agent' })
      await tool.click()
      await tool.locator('.tool-output').waitFor()
    },
    clipSelectors: ['.transcript-message.user-message', '.transcript-tool'],
    padding: 18,
  })
  await capture({
    browser,
    file: path.join(docsOutputDir, 'vision-agent.png'),
    route: '/sessions/demo-session',
    ready: '.assistant-message',
    interact: async (page) => {
      await page.getByRole('button', { name: 'Open settings' }).click()
      await page.locator('.settings-action-row').filter({ hasText: 'Vision agent' }).click()
      const drawer = page.locator('aside[aria-label="Vision agent"]')
      await drawer.locator('.subagent-config-card').first().waitFor()
      const modelSelect = drawer.locator('select').first()
      await page.waitForFunction((expected) => {
        const drawer = document.querySelector('aside[aria-label="Vision agent"]')
        return drawer?.querySelector('select')?.value === expected
      }, 'local/qwen3.6-27b')
      const selectedVisionModel = await modelSelect.inputValue()
      if (selectedVisionModel !== 'local/qwen3.6-27b') {
        throw new Error(`Vision model selector uses ${selectedVisionModel || '(empty)'}`)
      }
      const options = await modelSelect.locator('option').allTextContents()
      if (options.some((option) => {
        return option.includes('deepseek-v4-flash') || option.includes('text-only-coder')
      })) {
        throw new Error('Vision model selector includes a model without image support')
      }
    },
  })
  await capture({
    browser,
    file: path.join(docsOutputDir, 'goal-events.png'),
    route: '/sessions/demo-session',
    ready: '.goal-control-plane',
    scenario: 'goal',
    interact: async (page) => {
      await page.getByRole('button', { name: 'Events' }).click()
      await page.locator('aside[aria-label="Runtime events"] .event-log-row').first().waitFor()
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
  })
  await capture({
    browser,
    file: path.join(docsOutputDir, 'deep-research-mobile.png'),
    route: '/sessions/research-session',
    ready: '.research-report-message',
    viewport: { width: 390, height: 844 },
    scenario: 'research',
    interact: async (page) => {
      await page.getByRole('button', { name: 'Research sources · 6' }).click()
      await selectResearchSource(page, 1)
    },
  })
  await capture({
    browser,
    file: path.join(docsOutputDir, 'mobile-session.png'),
    route: '/sessions/demo-session',
    ready: '.composer .mobile-label',
    viewport: { width: 390, height: 844 },
  })
  await capture({
    browser,
    file: path.join(docsOutputDir, 'mobile-sidebar.png'),
    route: '/sessions/demo-session',
    ready: '.composer .mobile-label',
    viewport: { width: 390, height: 844 },
    interact: async (page) => {
      await page.getByRole('button', { name: 'Open sessions' }).click()
      await page.locator('.leyline-app.sidebar-open .sidebar').waitFor()
    },
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
    macWindow: true,
  })
  await capture({
    browser,
    file: path.join(readmeOutputDir, 'deep-research.png'),
    route: '/sessions/research-session',
    ready: '.research-report-message',
    viewport: { width: 1503, height: 818 },
    scenario: 'research',
    interact: async (page) => {
      await selectResearchSource(page, 1)
    },
    macWindow: true,
  })
} finally {
  await browser.close()
}

console.log('Saved documentation and README screenshots')

async function selectResearchSource(page, sourceId) {
  const pane = page.locator('aside[aria-label="Research sources"].open')
  await pane.waitFor()
  await pane.locator(`[data-source-id="${sourceId}"] .research-source-select`).click()
  await pane.locator(`[data-source-id="${sourceId}"] .research-source-evidence`).waitFor()
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
  const queued = scenario === 'queue'
  const research = scenario === 'research'
  const id = research ? researchSession.id : 'demo-session'
  return {
    id,
    path: `/workspace/harbor/sessions/${id}.jsonl`,
    cwd: '/workspace/harbor',
    diagnostics: [],
    state: {
      model,
      availableModels,
      thinkingLevel: 'high',
      availableThinkingLevels: model.availableThinkingLevels,
      isStreaming: queued,
      isCompacting: false,
      pendingToolCalls: [],
      steeringMode: 'one-at-a-time',
      followUpMode: 'one-at-a-time',
      activeToolCount: research ? 6 : 4,
      activeToolNames: research
        ? ['read', 'grep', 'subagent', 'research_update', 'exa_search', 'exa_contents']
        : ['read', 'grep', 'bash', 'edit'],
      contextUsage: { tokens: 12480, contextWindow: model.contextWindow, percent: 3.25 },
      slashCommands: [
        { name: 'compact', description: 'Compact context', source: 'command' },
        { name: 'goal', description: 'Start or manage a goal', source: 'extension' },
        { name: 'skill:review', description: 'Load the review skill', source: 'skill' },
      ],
      queuedMessages: queued
        ? {
            steering: ['Check the failure path before you finish.'],
            followUp: ['Summarize the release risk after the change.'],
          }
        : { steering: [], followUp: [] },
      extensionUi: {
        statuses: scenario === 'goal' ? { goal: 'goal: active' } : {},
        widgets: {},
        notifications: [],
      },
      goal: scenario === 'goal' ? goal : null,
      research: research ? researchState : null,
    },
  }
}

function detailFor(scenario) {
  const research = scenario === 'research'
  const summary = research ? researchSession : sessions[0]
  const entries = research
    ? researchEntries
    : scenario === 'shell'
      ? shellEntries
      : scenario === 'vision'
        ? visionEntries
        : baseEntries
  return {
    session: {
      ...summary,
      sessionFile: summary.path,
      research: research ? researchState : null,
      messageCount: entries.length,
      contextTokens: 12480,
      modified: scenario === 'export'
        ? '2026-08-06T15:49:00.000Z'
        : summary.modified,
      created: research
        ? '2026-08-06T15:52:00.000Z'
        : '2026-08-06T15:42:00.000Z',
      contextUsage: { tokens: 12480, contextWindow: model.contextWindow, percent: 3.25 },
    },
    entries,
  }
}

async function capture({
  browser,
  file,
  route,
  ready,
  viewport = { width: 1440, height: 900 },
  scenario = 'default',
  terminal = false,
  exportPage = false,
  interact,
  clipSelectors,
  padding = 0,
  preserveHover = false,
  macWindow = false,
}) {
  const runtime = runtimeFor(scenario)
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
    goal: scenario === 'goal' ? goal : null,
    terminal,
    emitRuntimeEvents: scenario !== 'home',
  })
  const page = await context.newPage()
  const unexpected = []
  page.on('console', (message) => {
    if (message.type() === 'error' && !message.text().includes('esm.sh')) {
      unexpected.push(`console: ${message.text()}`)
    }
  })
  page.on('pageerror', (error) => unexpected.push(`page: ${error.message}`))
  await page.route('https://esm.sh/**', (request) => request.fulfill({
    status: 200,
    contentType: 'application/javascript',
    body: `
      export const DIFFS_TAG_NAME = 'div'
      export class File { render() {} cleanUp() {} }
      export class FileDiff { render() {} cleanUp() {} }
      export function parsePatchFiles() { return [] }
    `,
  }))
  await page.route('**/api/leyline/connections', async (request) => {
    const method = request.request().method()
    if (method === 'GET') {
      return request.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(backendRegistry),
      })
    }
    unexpected.push(`request: ${method} /api/leyline/connections`)
    return request.abort()
  })
  await page.route(
    `**/api/leyline/settings/${THINKING_DEFAULT_SETTING_KEY}`,
    async (request) => {
      const method = request.request().method()
      if (method === 'GET') {
        return request.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            key: THINKING_DEFAULT_SETTING_KEY,
            value: 'collapsed',
          }),
        })
      }
      unexpected.push(
        `request: ${method} /api/leyline/settings/${THINKING_DEFAULT_SETTING_KEY}`,
      )
      return request.abort()
    },
  )
  await page.route('**/api/pi/**', async (request) => {
    const req = request.request()
    const url = new URL(req.url())
    const method = req.method()
    const key = `${method} ${url.pathname}`
    const json = (body) => request.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(body),
    })

    if (key === 'GET /api/pi/info') return json(backendInfo)
    if (key === 'GET /api/pi/projects') return json({ projects })
    if (key === 'GET /api/pi/sessions') {
      return json({
        sessions: scenario === 'research'
          ? [researchSession, ...sessions]
          : sessions,
      })
    }
    if (key === 'GET /api/pi/state') return json({ active: runtime })
    if (key === 'POST /api/pi/active-session') return json({ active: runtime })
    if (key === `GET /api/pi/sessions/${runtime.id}`) return json(detailFor(scenario))
    if (key === 'GET /api/pi/review') {
      return json(scenario === 'review' ? reviewPayload : cleanReviewPayload)
    }
    if (key === 'GET /api/pi/review/diff') return json(reviewDiffPayload)
    if (key === 'GET /api/pi/memories') return json(memoryPayload)
    if (key === 'GET /api/pi/subagents') return json(subagentPayload)
    if (key === 'GET /api/pi/vision/config') {
      return json(visionConfigPayload(url.searchParams.has('sessionPath')))
    }
    if (key === `GET /api/pi/sessions/${runtime.id}/export`) {
      const html = await renderSessionExportHtml(detailFor(scenario))
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
    if (!exportPage) await assertModelLabel(page)
    if (unexpected.length) throw new Error(unexpected.join('\n'))
    const clip = clipSelectors
      ? await unionClip(page, clipSelectors, padding, viewport)
      : undefined
    if (macWindow) {
      const image = await page.screenshot({ clip, animations: 'disabled' })
      await saveMacWindowScreenshot({
        browser,
        file,
        image,
        contentSize: clip || viewport,
      })
    } else {
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
    await page.screenshot({ path: file, animations: 'disabled', omitBackground: true })
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
  const text = await page.locator('body').innerText()
  const captureHost = new URL(baseUrl).host
  const forbidden = [
    '/Users/',
    os.homedir(),
    os.userInfo().username,
    process.cwd(),
    captureHost === 'localhost:5173' ? '' : captureHost,
  ].filter((value) => value && value.length > 2)
  const found = forbidden.find((value) => text.includes(value))
  if (found) throw new Error(`Private text found before capture: ${found}`)
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

async function assertModelLabel(page) {
  const expected = 'local/deepseek-v4-flash'
  const selector = '.model-picker:not(.small-picker):not(.tool-picker) > .model-picker-button'
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

function initBrowser({ fixedNow: now, runtime, goal: activeGoal, terminal, emitRuntimeEvents }) {
  const NativeDate = Date
  let tick = 0
  class FixedDate extends NativeDate {
    constructor(...args) {
      super(...(args.length ? args : [now + tick++]))
    }
    static now() {
      return now
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

  class MockEventSource extends EventTarget {
    constructor(url) {
      super()
      this.url = url
      this.readyState = 0
      setTimeout(() => {
        if (this.readyState === 2) return
        this.readyState = 1
        this.onopen?.(new Event('open'))
        this.dispatchEvent(new MessageEvent('active_session', {
          data: JSON.stringify(runtime),
        }))
        const events = [
          { activeSessionId: runtime.id, event: { type: 'session_start' } },
          { activeSessionId: runtime.id, event: { type: 'tool_execution_start', toolName: 'read' } },
          { activeSessionId: runtime.id, event: { type: 'tool_execution_end', toolName: 'read' } },
          ...(!runtime.state.isStreaming
            ? [{ activeSessionId: runtime.id, event: { type: 'agent_end' } }]
            : []),
        ]
        if (emitRuntimeEvents) {
          for (const data of events) {
            this.dispatchEvent(new MessageEvent('runtime_event', {
              data: JSON.stringify(data),
            }))
          }
        }
        if (activeGoal) {
          this.dispatchEvent(new MessageEvent('extension_ui', {
            data: JSON.stringify({
              activeSessionId: runtime.id,
              state: {
                statuses: { goal: 'goal: active' },
                widgets: {},
                notifications: [],
              },
              goal: activeGoal,
            }),
          }))
        }
      }, 0)
    }
    close() {
      this.readyState = 2
    }
  }
  window.EventSource = MockEventSource

  if (terminal) {
    class MockWebSocket extends EventTarget {
      static CONNECTING = 0
      static OPEN = 1
      static CLOSING = 2
      static CLOSED = 3
      constructor(url) {
        super()
        this.url = url
        this.readyState = MockWebSocket.CONNECTING
        setTimeout(() => {
          this.readyState = MockWebSocket.OPEN
          this.dispatchEvent(new Event('open'))
          this.dispatchEvent(new MessageEvent('message', {
            data: JSON.stringify({
              type: 'ready',
              cwd: '/workspace/harbor',
              shell: '/bin/zsh',
              pty: true,
            }),
          }))
          this.dispatchEvent(new MessageEvent('message', {
            data: JSON.stringify({
              type: 'data',
              data: '$ npm run docs:build\r\n✓ documentation build complete\r\n',
            }),
          }))
        }, 20)
      }
      send() {}
      close() {
        this.readyState = MockWebSocket.CLOSED
        this.dispatchEvent(new Event('close'))
      }
    }
    window.WebSocket = MockWebSocket
  }
}
