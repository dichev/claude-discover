import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'
import pkg from './package.json' with { type: 'json' }

// Strict CSP for the renderer (it shows untrusted transcripts), same in dev and packaged builds.
// Scripts stay 'self'; no remote origins, so a stray markdown <img>/link can't beacon out.
// 'unsafe-inline' is for styles only (React style props, tippy, syntax themes), never scripts.
const cspMeta = () => ({
  name: 'csp-meta',
  transformIndexHtml: { order: 'pre', handler: () => [{
    tag: 'meta',
    attrs: {
      'http-equiv': 'Content-Security-Policy',
      content: `
        default-src 'self';
        script-src 'self';
        style-src 'self' 'unsafe-inline';
        img-src 'self' data:;
        font-src 'self' data:;
        connect-src 'self';
        object-src 'none';
        base-uri 'none';
        form-action 'none';
      `.replace(/\s+/g, ' ').trim()
    },
    injectTo: 'head-prepend'
  }] }
})

export default defineConfig({
  main: {
    build: {
      lib: { entry: resolve('src/main/main.js') }
    }
  },
  preload: {
    build: {
      lib: {
        entry: {
          preload:     resolve('src/preload/preload.js'),
          findPreload: resolve('src/preload/findPreload.js')
        }
      }
    }
  },
  renderer: {
    root: resolve('src/renderer'),
    build: {
      modulePreload: { polyfill: false }, // Electron ships modern Chromium skip the inline polyfill so script-src can stay 'self'
      rollupOptions: {
        input: {
          index: resolve('src/renderer/index.html'),
          find:  resolve('src/renderer/find/find.html')
        }
      }
    },
    server: { port: 5555, strictPort: true }, // npm run dev
    plugins: [react(), cspMeta()],
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version)
    }
  }
})
