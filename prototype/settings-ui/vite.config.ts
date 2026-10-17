import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [react()],
  // codemirror 包会带自己的 @codemirror/state 副本；不 dedupe 时
  // StateField/EditorState 的 instanceof 检查会跨副本失败。
  resolve: {
    dedupe: ['@codemirror/state', '@codemirror/view'],
  },
  build: {
    outDir: 'dist',
  },
})