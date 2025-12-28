import { defineConfig } from 'vite'

export default defineConfig({
  base: '/TRADE-BOOST/',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: './index.html',
        admin: './admin.html'
      }
    }
  }
})
