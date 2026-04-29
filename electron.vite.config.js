import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  main: {
    build: {
      lib: { entry: resolve('electron/main.js') }
    }
  },
  preload: {
    build: {
      lib: { entry: resolve('electron/preload.js') }
    }
  },
  renderer: {
    root: resolve('src'),
    build: {
      rollupOptions: {
        input: resolve('src/index.html')
      }
    },
    server: { port: 5555, strictPort: true },
    plugins: [react()]
  }
});
