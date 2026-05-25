import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { createServer as createVitePressServer } from 'vitepress'
import { piApi } from './server/pi-api.js'

function docsSite() {
  return {
    name: 'leyline-docs-site',
    async configureServer(server) {
      const docs = await createVitePressServer('docs', {
        middlewareMode: true,
      })

      server.middlewares.use((req, res, next) => {
        if (req.url?.startsWith('/docs')) {
          return docs.middlewares(req, res, next)
        }
        next()
      })

      server.httpServer?.once('close', () => docs.close())
    },
  }
}

export default defineConfig({
  plugins: [vue(), docsSite(), piApi()],
})
