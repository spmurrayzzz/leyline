import { createApp } from 'vue'
import './style.css'
import App from './App.vue'

// Electron-only root class (same UA test as useDictation.js) so stylesheets
// can gate Chromium/Electron paint mitigations without affecting browsers.
if (/\bElectron\//.test(navigator.userAgent)) {
  document.documentElement.classList.add('electron')
}

createApp(App).mount('#app')
