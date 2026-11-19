import { defineConfig } from 'vite'

export default defineConfig({
  server: {
    port: 5174,
    strictPort: true,
    watch: {
      ignored: ['**/src-tauri/**'],
    },
  },
  build: {
    rollupOptions: {
      // index.html is the nodes interface; classic.html is the earlier layout, kept as it was.
      input: { main: 'index.html', classic: 'classic.html' },
    },
  },
})
