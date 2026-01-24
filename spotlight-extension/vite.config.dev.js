import { defineConfig } from 'vite';
import { createSpotlightConfig } from './vite-plugins/vite-plugin-spotlight-extension.js';

export default defineConfig(createSpotlightConfig({ isDev: true }));
