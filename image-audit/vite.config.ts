import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: '/original-tools/image-audit/',
  plugins: [react()],
  server: {
    port: 5174,
  },
});
