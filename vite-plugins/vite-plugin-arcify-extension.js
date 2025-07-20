import { resolve } from 'path';
import fs from 'fs-extra';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { build } from 'vite';

/**
 * Get shared input configuration for Arcify Chrome Extension
 */
function getExtensionInputs() {
  return {
    sidebar: resolve(process.cwd(), 'sidebar.html'),
    options: resolve(process.cwd(), 'options.html'),
    onboarding: resolve(process.cwd(), 'onboarding.html'),
    'spotlight-popup': resolve(process.cwd(), 'spotlight/popup.html'),
    background: resolve(process.cwd(), 'background.js'),
    'sidebar-script': resolve(process.cwd(), 'sidebar.js'),
    'options-script': resolve(process.cwd(), 'options.js'),
    'onboarding-script': resolve(process.cwd(), 'onboarding.js'),
    'spotlight-popup-script': resolve(process.cwd(), 'spotlight/popup.js'),
  };
}

/**
 * Get shared output configuration for Arcify Chrome Extension
 */
function getExtensionOutput(isDev = false) {
  return {
    entryFileNames: (chunkInfo) => {
      const mainScripts = ['background', 'sidebar-script', 'options-script', 'onboarding-script', 'spotlight-popup-script'];
      if (mainScripts.includes(chunkInfo.name)) {
        if (chunkInfo.name === 'sidebar-script') return 'sidebar.js';
        if (chunkInfo.name === 'options-script') return 'options.js';
        if (chunkInfo.name === 'spotlight-popup-script') return 'spotlight/popup.js';
        return `${chunkInfo.name}.js`;
      }
      return isDev ? '[name].js' : 'assets/[name]-[hash].js';
    },
    chunkFileNames: isDev ? '[name].js' : 'assets/[name]-[hash].js',
    assetFileNames: (assetInfo) => {
      if (assetInfo.name?.endsWith('.css')) {
        if (assetInfo.name?.includes('popup')) {
          return 'spotlight/popup.css';
        }
        return '[name][extname]';
      }
      return isDev ? '[name][extname]' : 'assets/[name]-[hash][extname]';
    }
  };
}

/**
 * Get Arcify extension build plugins
 */
function getExtensionPlugins(isDev = false) {
  const outDir = isDev ? 'dist-dev' : 'dist';
  
  return [
    // Main extension build plugin
    {
      name: 'arcify-extension-main',
      writeBundle: async () => {
        // Copy static files
        await fs.copy('manifest.json', `${outDir}/manifest.json`);
        
        if (await fs.pathExists('assets')) {
          await fs.copy('assets', `${outDir}/assets`);
        }
        
        if (await fs.pathExists('styles.css')) {
          await fs.copy('styles.css', `${outDir}/styles.css`);
        }
        
        // Copy spotlight files except overlay.js (overlay is built separately)
        if (await fs.pathExists('spotlight')) {
          await fs.copy('spotlight', `${outDir}/spotlight`, {
            filter: (src) => {
              // Exclude overlay.js (built separately as IIFE)
              if (src.endsWith('overlay.js')) return false;
              
              // Include everything else (CSS files and JS modules needed by popup)
              return true;
            }
          });
        }
        
        if (await fs.pathExists('LICENSE')) {
          await fs.copy('LICENSE', `${outDir}/LICENSE`);
        }
        if (await fs.pathExists('README.md')) {
          await fs.copy('README.md', `${outDir}/README.md`);
        }
        
        console.log(`✅ Main extension files built to ${outDir}/`);
      }
    },
    
    // Overlay build plugin - runs after main build
    {
      name: 'arcify-extension-overlay',
      writeBundle: async () => {
        console.log('🔄 Building spotlight overlay...');
        
        // Build overlay.js as IIFE for content script injection
        await build({
          configFile: false,
          build: {
            outDir,
            emptyOutDir: false, // Don't clear main build
            rollupOptions: {
              input: {
                'spotlight-overlay': resolve(process.cwd(), 'spotlight/overlay.js'),
              },
              output: {
                entryFileNames: 'spotlight/overlay.js',
                format: 'iife',
                inlineDynamicImports: true,
              }
            },
            target: 'es2020',
            minify: !isDev,
            sourcemap: isDev
          },
          plugins: [
            viteSingleFile({
              removeViteModuleLoader: true
            })
          ],
          resolve: {
            alias: {
              '@': resolve(process.cwd(), './'),
            }
          }
        });
        
        console.log(`✅ Spotlight overlay built to ${outDir}/spotlight/overlay.js`);
        console.log(`🎉 Arcify extension build complete!`);
      }
    }
  ];
}

/**
 * Create complete Vite configuration for Arcify Chrome Extension
 * Handles both main extension build and spotlight overlay build
 */
export function createArcifyConfig(options = {}) {
  const { isDev = false } = options;
  const outDir = isDev ? 'dist-dev' : 'dist';
  
  const config = {
    build: {
      outDir,
      emptyOutDir: true,
      rollupOptions: {
        input: getExtensionInputs(),
        output: getExtensionOutput(isDev)
      },
      target: 'es2020',
      minify: !isDev,
      sourcemap: isDev
    },
    plugins: getExtensionPlugins(isDev),
    server: {
      port: 3000,
      open: false,
      ...(isDev && { hmr: false }) // Disable HMR for Chrome extension in dev mode
    },
    resolve: {
      alias: {
        '@': resolve(process.cwd(), './'),
      }
    }
  };

  // Add dev-specific options
  if (isDev) {
    config.mode = 'development';
    config.build.watch = {
      include: ['**/*.js', '**/*.html', '**/*.css', 'manifest.json']
    };
  }

  return config;
}

/**
 * Legacy function for backward compatibility
 * @deprecated Use createArcifyConfig instead
 */
export function arcifyExtensionPlugin(options = {}) {
  return getExtensionPlugins(options.isDev);
}