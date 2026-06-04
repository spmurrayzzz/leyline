import { defineConfig } from 'vitepress'

export default defineConfig({
  base: process.env.VITEPRESS_BASE || '/docs/',
  outDir: '../dist/docs',
  cacheDir: '../node_modules/.vitepress-cache',
  title: 'Leyline',
  description: 'UI for your pi coding agent sessions',
  themeConfig: {
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
          { text: 'Composer', link: '/user-guide/composer' },
          { text: 'Runtime controls', link: '/user-guide/runtime-controls' },
          {
            text: 'Tools and thinking',
            link: '/user-guide/tools-and-thinking',
          },
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
          { text: 'Goal extension', link: '/integrations/goal-extension' },
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
