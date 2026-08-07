import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Relative base so the built app works from a file path or any subdirectory.
  base: './',
  server: { port: 5173 },
});
