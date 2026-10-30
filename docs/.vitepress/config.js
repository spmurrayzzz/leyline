import { defineConfig } from 'vitepress'

const base = process.env.VITEPRESS_BASE || '/docs/'
const siteUrl = 'https://leyline.sh/'
const description = 'Run concurrent pi sessions in your browser, desktop, or mobile. Read transcripts, inspect tool calls, and steer agents as they work.'
const shareImage = new URL('social/leyline-workspace-v4.png', siteUrl).href
const shareImageAlt = 'Leyline logo above a workspace showing pi sessions, a conversation transcript, and tool activity.'

export default defineConfig({
  base,
  lang: 'en-US',
  outDir: '../dist/docs',
  appearance: 'force-dark',
  head: [
    ['link', { rel: 'icon', type: 'image/png', sizes: '48x48', href: `${base}favicon.png` }],
    ['link', { rel: 'icon', type: 'image/svg+xml', sizes: 'any', href: `${base}favicon.svg` }],
    ['link', { rel: 'apple-touch-icon', sizes: '180x180', href: `${base}apple-touch-icon.png` }],
    ['meta', { name: 'theme-color', content: '#0d0d0d' }],
    ['meta', { name: 'robots', content: 'index, follow, max-image-preview:large' }],
  ],
  cacheDir: '../node_modules/.vitepress-cache',
  title: 'Leyline',
  description,
  sitemap: { hostname: siteUrl },
  markdown: {
    config(md) {
      md.core.ruler.push('page-description', ({ tokens, env }) => {
        if (!env.frontmatter || env.frontmatter.description !== undefined) return
        const index = tokens.findIndex((token) => token.type === 'paragraph_open' && token.level === 0)
        if (index < 0) return
        const text = tokens[index + 1]?.children?.map((token) => {
          if (token.type === 'text' || token.type === 'code_inline') return token.content
          return token.type === 'softbreak' || token.type === 'hardbreak' ? ' ' : ''
        }).join('').replace(/\s+/g, ' ').trim()
        if (!text) return
        env.frontmatter.description = text.length > 160
          ? `${text.slice(0, 157).replace(/\s+\S*$/, '')}…`
          : text
      })
    },
  },
  transformPageData(pageData) {
    if (pageData.relativePath === '404.md') return
    const path = pageData.relativePath.replace(/(^|\/)index\.md$/, '$1').replace(/\.md$/, '.html')
    const url = new URL(path, siteUrl).href
    const title = pageData.title === 'Leyline' || pageData.titleTemplate === false
      ? pageData.title
      : `${pageData.title} | Leyline`
    const pageDescription = pageData.description || description
    pageData.frontmatter.head ??= []
    pageData.frontmatter.head.push(
      ['link', { rel: 'canonical', href: url }],
      ['meta', { property: 'og:type', content: 'website' }],
      ['meta', { property: 'og:site_name', content: 'Leyline' }],
      ['meta', { property: 'og:locale', content: 'en_US' }],
      ['meta', { property: 'og:title', content: title }],
      ['meta', { property: 'og:description', content: pageDescription }],
      ['meta', { property: 'og:url', content: url }],
      ['meta', { property: 'og:image', content: shareImage }],
      ['meta', { property: 'og:image:type', content: 'image/png' }],
      ['meta', { property: 'og:image:width', content: '1200' }],
      ['meta', { property: 'og:image:height', content: '630' }],
      ['meta', { property: 'og:image:alt', content: shareImageAlt }],
      ['meta', { name: 'twitter:card', content: 'summary_large_image' }],
      ['meta', { name: 'twitter:title', content: title }],
      ['meta', { name: 'twitter:description', content: pageDescription }],
      ['meta', { name: 'twitter:image', content: shareImage }],
      ['meta', { name: 'twitter:image:alt', content: shareImageAlt }],
    )
  },
  transformHead({ page, description }) {
    return [
      ['meta', { name: 'description', content: description }],
      ...(page === '404.md' ? [['meta', { name: 'robots', content: 'noindex' }]] : []),
    ]
  },
  themeConfig: {
    logo: '/leyline-mark.svg',
    socialLinks: [
      { icon: 'github', link: 'https://github.com/spmurrayzzz/leyline' },
    ],
    nav: [
      { text: 'Guide', link: '/getting-started/' },
      { text: 'Motivations', link: '/motivations' },
      { text: 'User Guide', link: '/user-guide/' },
      { text: 'Developer Guide', link: '/developer-guide/' },
      { text: 'Reference', link: '/reference/commands' },
    ],
    sidebar: [
      {
        text: 'Guide',
        items: [
          { text: 'Overview', link: '/getting-started/' },
          { text: 'Motivations', link: '/motivations' },
          { text: 'Requirements', link: '/getting-started/requirements' },
          { text: 'Installation', link: '/getting-started/installation' },
          { text: 'Linux installation', link: '/getting-started/linux-installation' },
          { text: 'First run', link: '/getting-started/first-run' },
          {
            text: 'Browser vs Electron',
            link: '/getting-started/browser-vs-electron',
          },
        ],
      },
      {
        text: 'User Guide',
        items: [
          { text: 'Overview', link: '/user-guide/' },
          { text: 'Start screen', link: '/user-guide/start-screen' },
          { text: 'Sessions', link: '/user-guide/sessions' },
          { text: 'Workbench', link: '/user-guide/workbench' },
          { text: 'Tracing', link: '/user-guide/tracing' },
          { text: 'Git review', link: '/user-guide/git-review' },
          { text: 'Composer', link: '/user-guide/composer' },
          { text: 'Dictation', link: '/user-guide/dictation' },
          { text: 'Deep research', link: '/user-guide/deep-research' },
          { text: 'Runtime controls', link: '/user-guide/runtime-controls' },
          {
            text: 'Tools and thinking',
            link: '/user-guide/tools-and-thinking',
          },
          { text: 'Memory', link: '/user-guide/memory' },
          { text: 'Subagents', link: '/user-guide/subagents' },
          { text: 'Terminal', link: '/user-guide/terminal' },
          {
            text: 'Projects and search',
            link: '/user-guide/projects-and-search',
          },
          {
            text: 'Images and previews',
            link: '/user-guide/images-and-previews',
          },
          {
            text: 'Editing, forking, resetting, and compaction',
            link: '/user-guide/editing-forking-compaction',
          },
          { text: 'Export', link: '/user-guide/export' },
          { text: 'Settings', link: '/user-guide/settings' },
          { text: 'Mobile layout', link: '/user-guide/mobile' },
          {
            text: 'Keyboard shortcuts',
            link: '/user-guide/keyboard-shortcuts',
          },
        ],
      },
      {
        text: 'Electron',
        items: [
          { text: 'Overview', link: '/electron/' },
          { text: 'Electron development', link: '/electron/development' },
          { text: 'Packaging', link: '/electron/packaging' },
          { text: 'Environment handling', link: '/electron/environment' },
          { text: 'Windows and state management', link: '/electron/window-state' },
        ],
      },
      {
        text: 'Developer Guide',
        items: [
          { text: 'Overview', link: '/developer-guide/' },
          {
            text: 'Local development',
            link: '/developer-guide/local-development',
          },
          { text: 'Project layout', link: '/developer-guide/project-layout' },
          { text: 'Architecture', link: '/developer-guide/architecture' },
          { text: 'Frontend state', link: '/developer-guide/frontend-state' },
          { text: 'Backend API', link: '/developer-guide/backend-api' },
          {
            text: 'Realtime events',
            link: '/developer-guide/realtime-events',
          },
          {
            text: 'Transcript projection',
            link: '/developer-guide/transcript-projection',
          },
          {
            text: 'Styling and motion',
            link: '/developer-guide/styling-and-motion',
          },
          {
            text: 'Screenshots and video',
            link: '/developer-guide/screenshots-and-video',
          },
        ],
      },
      {
        text: 'Integrations',
        items: [
          { text: 'Overview', link: '/integrations/' },
          { text: 'pi SDK integration', link: '/integrations/pi-sdk' },
          { text: 'Elune tracing', link: '/integrations/elune' },
          { text: 'Memory', link: '/integrations/memory-integration' },
          { text: 'Subagents', link: '/integrations/subagents' },
          { text: 'Deep research', link: '/integrations/deep-research' },
          { text: 'Vision agent', link: '/integrations/vision-agent' },
          {
            text: 'Terminal backend',
            link: '/integrations/terminal-backend',
          },
        ],
      },
      {
        text: 'Reference',
        items: [
          { text: 'Commands', link: '/reference/commands' },
          { text: 'Environment variables', link: '/reference/environment' },
          { text: 'API reference', link: '/reference/api' },
          { text: 'Glossary', link: '/reference/glossary' },
          { text: 'Troubleshooting', link: '/reference/troubleshooting' },
        ],
      },
    ],
    search: {
      provider: 'local',
    },
  },
})
