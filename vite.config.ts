import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [sveltekit()],
  server: {
    host: true, // Listens on all local addresses (0.0.0.0)
    allowedHosts: true
  }
});
