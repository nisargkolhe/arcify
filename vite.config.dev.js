import { defineConfig } from 'vite';
import { createArcifyConfig } from './vite-plugins/vite-plugin-arcify-extension.js';

export default defineConfig(createArcifyConfig({ isDev: true })); 