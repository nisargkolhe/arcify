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
        // JavaScript entry points
        background: resolve(__dirname, 'background.js'),
        'sidebar-script': resolve(__dirname, 'sidebar.js'),
        'options-script': resolve(__dirname, 'options.js'),
        utils: resolve(__dirname, 'utils.js'),
        localstorage: resolve(__dirname, 'localstorage.js'),
        chromeHelper: resolve(__dirname, 'chromeHelper.js'),
        icons: resolve(__dirname, 'icons.js')
      },
      output: {
        entryFileNames: (chunkInfo) => {
          const mainScripts = ['background', 'sidebar-script', 'options-script', 'utils', 'localstorage', 'chromeHelper', 'icons'];
          if (mainScripts.includes(chunkInfo.name)) {
            return chunkInfo.name === 'sidebar-script' ? 'sidebar.js' : 
                   chunkInfo.name === 'options-script' ? 'options.js' : 
                   `${chunkInfo.name}.js`;
          }
          return '[name].js';
        },
        chunkFileNames: '[name].js',
        assetFileNames: '[name][extname]'
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