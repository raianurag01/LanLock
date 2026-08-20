import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    // 5173 belongs to the lanlock-desktop electron-vite renderer in dev.
    // Pin the admin dashboard to its own port so they never collide.
    port: 5180,
    strictPort: true,
  },
  preview: {
    port: 5180,
  },
});
