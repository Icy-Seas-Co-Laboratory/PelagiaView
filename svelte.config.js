import adapter from '@sveltejs/adapter-auto';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

const base = process.env.PELAGIAVIEW_BASE_PATH || '';

const config = {
  preprocess: vitePreprocess(),
  kit: {
    adapter: adapter(),
    paths: { base }
  }
};

export default config;
