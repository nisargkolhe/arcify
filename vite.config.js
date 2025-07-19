import { defineConfig } from 'vite';
import { resolve } from 'path';
import fs from 'fs-extra';
import webExtension from 'vite-plugin-web-extension';


export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        // HTML entry points
        sidebar: resolve(__dirname, 'sidebar.html'),
        options: resolve(__dirname, 'options.html'),
        onboarding: resolve(__dirname, 'onboarding.html'),
        'spotlight-popup': resolve(__dirname, 'spotlight/popup.html'),
        // JavaScript entry points
        background: resolve(__dirname, 'background.js'),
        'sidebar-script': resolve(__dirname, 'sidebar.js'),
        'options-script': resolve(__dirname, 'options.js'),
        'onboarding-script': resolve(__dirname, 'onboarding.js'),
        utils: resolve(__dirname, 'utils.js'),
        localstorage: resolve(__dirname, 'localstorage.js'),
        chromeHelper: resolve(__dirname, 'chromeHelper.js'),
        icons: resolve(__dirname, 'icons.js'),
        'spotlight-overlay': resolve(__dirname, 'spotlight/overlay.js'),
        'spotlight-popup-script': resolve(__dirname, 'spotlight/popup.js'),
        'spotlight-styling': resolve(__dirname, 'spotlight/shared/styling.js'),
      },
      output: {
        entryFileNames: (chunkInfo) => {
          // Keep original names for main scripts
          const mainScripts = ['background', 'sidebar-script', 'options-script', 'onboarding-script', 'utils', 'localstorage', 'chromeHelper', 'icons', 'spotlight-overlay', 'spotlight-popup-script', 'spotlight-styling'];
          if (mainScripts.includes(chunkInfo.name)) {
            // Handle special naming for scripts
            if (chunkInfo.name === 'sidebar-script') return 'sidebar.js';
            if (chunkInfo.name === 'options-script') return 'options.js';
            if (chunkInfo.name === 'spotlight-overlay') return 'spotlight/overlay.js';
            if (chunkInfo.name === 'spotlight-popup-script') return 'spotlight/popup.js';
            if (chunkInfo.name === 'spotlight-styling') return 'spotlight/shared/styling.js';
            return `${chunkInfo.name}.js`;
          }
          return 'assets/[name]-[hash].js';
        },
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: (assetInfo) => {
          // Keep CSS files in proper locations for extension compatibility
          if (assetInfo.name?.endsWith('.css')) {
            if (assetInfo.name?.includes('popup')) {
              return 'spotlight/popup.css';
            }
            return '[name][extname]';
          }
          return 'assets/[name]-[hash][extname]';
        }
      }
    },
    // Ensure compatibility with Chrome extension environment
    target: 'es2020',
    minify: false, // Keep readable for debugging
    sourcemap: false
  },
  plugins: [
    // Custom plugin to copy static files and update manifest
    {
      name: 'webExtension',
      writeBundle: async () => {
        // Copy manifest.json
        await fs.copy('manifest.json', 'dist/manifest.json');
        
        // Copy assets folder if it exists
        if (await fs.pathExists('assets')) {
          await fs.copy('assets', 'dist/assets');
        }
        
        // Copy styles.css
        if (await fs.pathExists('styles.css')) {
          await fs.copy('styles.css', 'dist/styles.css');
        }
        
        // Copy spotlight directory structure
        if (await fs.pathExists('spotlight')) {
          await fs.copy('spotlight', 'dist/spotlight');
        }
        
        
        // Copy LICENSE and README if they exist
        if (await fs.pathExists('LICENSE')) {
          await fs.copy('LICENSE', 'dist/LICENSE');
        }
        if (await fs.pathExists('README.md')) {
          await fs.copy('README.md', 'dist/README.md');
        }
        
        console.log('✅ Chrome extension files copied to dist/');
      }
    }
  ],
  // Development server configuration
  server: {
    port: 3000,
    open: false
  },
  // Resolve configuration
  resolve: {
    alias: {
      '@': resolve(__dirname, './'),
    }
  }
}); 