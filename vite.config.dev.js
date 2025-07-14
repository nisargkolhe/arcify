import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  // Development-specific configuration
  mode: 'development',
  build: {
    outDir: 'dist-dev',
    emptyOutDir: true,
    watch: {
      // Watch for changes in source files
      include: ['**/*.js', '**/*.html', '**/*.css', 'manifest.json']
    },
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
        'spotlight-search-engine': resolve(__dirname, 'spotlight/shared/search-engine.js'),
        'spotlight-search-provider': resolve(__dirname, 'spotlight/shared/search-provider.js'),
        'spotlight-search-types': resolve(__dirname, 'spotlight/shared/search-types.js'),
        'spotlight-styling': resolve(__dirname, 'spotlight/shared/styling.js'),
      },
      output: {
        entryFileNames: (chunkInfo) => {
          const mainScripts = ['background', 'sidebar-script', 'options-script', 'onboarding-script', 'utils', 'localstorage', 'chromeHelper', 'icons', 'spotlight-overlay', 'spotlight-popup-script', 'spotlight-search-engine', 'spotlight-search-provider', 'spotlight-search-types', 'spotlight-styling'];
          if (mainScripts.includes(chunkInfo.name)) {
            if (chunkInfo.name === 'sidebar-script') return 'sidebar.js';
            if (chunkInfo.name === 'options-script') return 'options.js';
            if (chunkInfo.name === 'spotlight-overlay') return 'spotlight/overlay.js';
            if (chunkInfo.name === 'spotlight-popup-script') return 'spotlight/popup.js';
            if (chunkInfo.name === 'spotlight-search-engine') return 'spotlight/shared/search-engine.js';
            if (chunkInfo.name === 'spotlight-search-provider') return 'spotlight/shared/search-provider.js';
            if (chunkInfo.name === 'spotlight-search-types') return 'spotlight/shared/search-types.js';
            if (chunkInfo.name === 'spotlight-styling') return 'spotlight/shared/styling.js';
            return `${chunkInfo.name}.js`;
          }
          return '[name].js';
        },
        chunkFileNames: '[name].js',
        assetFileNames: (assetInfo) => {
          if (assetInfo.name?.endsWith('.css')) {
            if (assetInfo.name?.includes('popup')) {
              return 'spotlight/popup.css';
            }
            return '[name][extname]';
          }
          return '[name][extname]';
        }
      }
    },
    // Development settings
    target: 'es2020',
    minify: false,
    sourcemap: true // Enable source maps for debugging
  },
  plugins: [
    {
      name: 'webExtension',
      writeBundle: async () => {
        const fs = await import('fs-extra');
        
        // Copy manifest.json
        await fs.copy('manifest.json', 'dist-dev/manifest.json');
        
        // Copy assets folder if it exists
        if (await fs.pathExists('assets')) {
          await fs.copy('assets', 'dist-dev/assets');
        }
        
        // Copy styles.css
        if (await fs.pathExists('styles.css')) {
          await fs.copy('styles.css', 'dist-dev/styles.css');
        }
        
        // Copy spotlight directory structure
        if (await fs.pathExists('spotlight')) {
          await fs.copy('spotlight', 'dist-dev/spotlight');
        }
        
        console.log('🔄 Development files updated in dist-dev/');
      }
    }
  ],
  server: {
    port: 3000,
    open: false,
    hmr: false // Disable HMR for Chrome extension
  }
}); 