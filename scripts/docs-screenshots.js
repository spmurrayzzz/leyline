import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { chromium } from 'playwright'
import { THINKING_DEFAULT_SETTING_KEY } from '../lib/leyline-settings.js'
import { renderSessionExportHtml } from '../server/pi-api/export-renderer.js'

const baseUrl = process.env.DOCS_SCREENSHOT_URL || 'http://localhost:5173/'
const docsOutputDir = path.resolve('docs/assets/screenshots')
const readmeOutputDir = path.resolve('assets/readme')
const fixedNow = Date.parse('2026-08-06T16:00:00.000Z')
const model = {
  provider: 'local',
  id: 'minimax-m2.7',
  name: 'MiniMax M2.7',
  supportsImages: true,
  availableThinkingLevels: ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'],
}
const availableModels = [
  model,
  {
    provider: 'anthropic',
    id: 'claude-sonnet-4-6',
    name: 'Claude Sonnet 4.6',
    supportsImages: true,
    availableThinkingLevels: ['off', 'low', 'medium', 'high'],
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
      overrides: { session: 'local/minimax-m2.7' },
      effectiveModel: 'local/minimax-m2.7',
      modelSource: 'session',
    },
    {
      key: 'user:/workspace/agents/researcher.md:researcher',
      name: 'researcher',
      description: 'Finds source evidence before implementation begins.',
      source: 'user',
      path: '/workspace/agents/researcher.md',
      model: 'local/minimax-m2.7',
      thinking: 'medium',
      tools: ['read', 'grep', 'bash'],
      overrides: { project: 'local/minimax-m2.7' },
      effectiveModel: 'local/minimax-m2.7',
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
    global: 'anthropic/claude-sonnet-4-6',
    project: 'local/minimax-m2.7',
    ...(sessionAvailable ? { session: 'local/minimax-m2.7' } : {}),
  },
  model: 'local/minimax-m2.7',
  modelSource: sessionAvailable ? 'session' : 'project',
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
    ready: '.start-panel .start-composer',
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
    file: path.join(docsOutputDir, 'project-details.png'),
    route: '/sessions/demo-session',
    ready: '.assistant-message',
    interact: async (page) => {
      const project = page.locator('.project').filter({ hasText: 'harbor' }).first()
      await project.hover()
      await project.getByRole('button', { name: 'Project details' }).click()
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
    file: path.join(docsOutputDir, 'vision-agent.png'),
    route: '/sessions/demo-session',
    ready: '.assistant-message',
    interact: async (page) => {
      await page.getByRole('button', { name: 'Open settings' }).click()
      await page.locator('.settings-action-row').filter({ hasText: 'Vision agent' }).click()
      const drawer = page.locator('aside[aria-label="Vision agent"]')
      await drawer.locator('.subagent-config-card').waitFor()
      const options = await drawer.locator('select option').allTextContents()
      if (options.some((option) => option.includes('text-only-coder'))) {
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
    },
  })
  await capture({
    browser,
    file: path.join(docsOutputDir, 'export.png'),
    route: '/api/pi/sessions/demo-session/export?disposition=inline',
    ready: '.export-shell .transcript',
    exportPage: true,
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
    ready: '.start-panel .start-composer',
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
} finally {
  await browser.close()
}

console.log('Saved documentation and README screenshots')

function session(
  id,
  name,
  timestamp,
  messageCount,
  cwd = '/workspace/harbor',
) {
  return {
    id,
    path: `${cwd}/sessions/${id}.jsonl`,
    cwd,
    name,
    parentSessionPath: null,
    isSubagentSession: false,
    firstMessage: name,
    messageCount,
    modified: timestamp,
    timestamp,
  }
}

function messageEntry({ id, role, label, text, thinking = '', timestamp, rolloutFeedback = '' }) {
  const blocks = []
  if (thinking) blocks.push({ type: 'thinking', text: thinking })
  blocks.push({ type: 'text', text })
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
  return {
    id: 'demo-session',
    path: '/workspace/harbor/sessions/demo-session.jsonl',
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
      activeToolCount: 4,
      activeToolNames: ['read', 'grep', 'bash', 'edit'],
      contextUsage: { tokens: 12480, contextWindow: 200000, percent: 6.24 },
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
    },
  }
}

function detailFor(scenario) {
  const summary = sessions[0]
  return {
    session: {
      ...summary,
      sessionFile: summary.path,
      messageCount: scenario === 'shell' ? shellEntries.length : baseEntries.length,
      contextTokens: 12480,
      modified: '2026-08-06T15:49:00.000Z',
      created: '2026-08-06T15:42:00.000Z',
      contextUsage: { tokens: 12480, contextWindow: 200000, percent: 6.24 },
    },
    entries: scenario === 'shell' ? shellEntries : baseEntries,
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

    if (key === 'GET /api/pi/projects') return json({ projects })
    if (key === 'GET /api/pi/sessions') return json({ sessions })
    if (key === 'GET /api/pi/state') return json({ active: runtime })
    if (key === 'POST /api/pi/active-session') return json({ active: runtime })
    if (key === 'GET /api/pi/sessions/demo-session') return json(detailFor(scenario))
    if (key === 'GET /api/pi/memories') return json(memoryPayload)
    if (key === 'GET /api/pi/subagents') return json(subagentPayload)
    if (key === 'GET /api/pi/vision/config') {
      return json(visionConfigPayload(url.searchParams.has('sessionPath')))
    }
    if (key === 'GET /api/pi/sessions/demo-session/export') {
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
    if (interact) await interact(page)
    await sanitizeNativeBackendAddress(page)
    await page.evaluate(async () => {
      await document.fonts.ready
    })
    await disableMotion(page)
    if (!preserveHover) {
      await page.mouse.move(viewport.width - 2, viewport.height - 2)
      await page.evaluate(() => document.activeElement?.blur?.())
    }
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
  const expected = 'local/minimax-m2.7'
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
          { activeSessionId: 'demo-session', event: { type: 'session_start' } },
          { activeSessionId: 'demo-session', event: { type: 'tool_execution_start', toolName: 'read' } },
          { activeSessionId: 'demo-session', event: { type: 'tool_execution_end', toolName: 'read' } },
          ...(!runtime.state.isStreaming
            ? [{ activeSessionId: 'demo-session', event: { type: 'agent_end' } }]
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
              activeSessionId: 'demo-session',
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
