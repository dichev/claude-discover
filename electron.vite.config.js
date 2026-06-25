import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import pkg from './package.json' with { type: 'json' };

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
      rollupOptions: {
        input: {
          index: resolve('src/renderer/index.html'),
          find:  resolve('src/renderer/find/find.html')
        }
      }
    },
    server:  { port: 5555, strictPort: true  }, // npm run dev
    preview: { port: 5555, strictPort: false }, // npm start (serves built output)
    plugins: [react()],
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version)
    }
  }
});
