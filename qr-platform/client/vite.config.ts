import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: '/original-tools/qr-platform/',
  plugins: [react()],
  server: {
    port: 5173,
  },
});
