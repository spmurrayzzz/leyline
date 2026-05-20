import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { piApi } from './server/pi-api.js'

export default defineConfig({
  plugins: [vue(), piApi()],
})
