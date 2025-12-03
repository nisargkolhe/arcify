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
    'installation-onboarding': resolve(process.cwd(), 'installation-onboarding.html'),
    // Note: newtab.html is handled separately in the build plugin
    background: resolve(process.cwd(), 'background.js'),
    'sidebar-script': resolve(process.cwd(), 'sidebar.js'),
    'options-script': resolve(process.cwd(), 'options.js'),
    'onboarding-script': resolve(process.cwd(), 'onboarding.js'),
    'installation-onboarding-script': resolve(process.cwd(), 'installation-onboarding.js'),
  };
}

/**
 * Get shared output configuration for Arcify Chrome Extension
 */
function getExtensionOutput(isDev = false) {
  return {
    entryFileNames: (chunkInfo) => {
      const mainScripts = ['background', 'sidebar-script', 'options-script', 'onboarding-script', 'installation-onboarding-script'];
      if (mainScripts.includes(chunkInfo.name)) {
        if (chunkInfo.name === 'sidebar-script') return 'sidebar.js';
        if (chunkInfo.name === 'options-script') return 'options.js';
        if (chunkInfo.name === 'onboarding-script') return 'onboarding.js';
        if (chunkInfo.name === 'installation-onboarding-script') return 'installation-onboarding.js';
        return `${chunkInfo.name}.js`;
      }
      // Note: newtab.js is built separately, so we don't need to handle it here
      return isDev ? '[name].js' : 'assets/[name]-[hash].js';
    },
    chunkFileNames: isDev ? '[name].js' : 'assets/[name]-[hash].js',
    assetFileNames: (assetInfo) => {
      if (assetInfo.name?.endsWith('.css')) {
        return '[name][extname]';
      }
      // Keep HTML files in their original directory structure
      if (assetInfo.name?.endsWith('.html')) {
        // For newtab.html, maintain the spotlight/ directory structure
        if (assetInfo.name === 'newtab.html') {
          return 'spotlight/[name][extname]';
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
        
        // Copy spotlight files except overlay.js (overlay is built separately), newtab.js (built separately), and popup files
        if (await fs.pathExists('spotlight')) {
          await fs.copy('spotlight', `${outDir}/spotlight`, {
            filter: (src) => {
              // Exclude overlay.js (built separately as IIFE)
              if (src.endsWith('overlay.js')) return false;
              
              // Exclude newtab.js (built separately with inlined dependencies)
              if (src.endsWith('newtab.js')) return false;
              
              // Exclude newtab.html (will be copied after newtab.js is built)
              if (src.endsWith('newtab.html')) return false;
              
              // Exclude popup files (popup mode removed)
              if (src.endsWith('popup.html')) return false;
              if (src.endsWith('popup.css')) return false;
              if (src.endsWith('popup.js')) return false;
              
              // Include everything else (shared modules needed by overlay and newtab)
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
      }
    },
    
    // Newtab build plugin - runs after main build
    {
      name: 'arcify-extension-newtab',
      writeBundle: async () => {
        console.log('🔄 Building newtab page...');
        
        // Build newtab.js as ES module with inlined dependencies
        await build({
          configFile: false,
          build: {
            outDir,
            emptyOutDir: false, // Don't clear main build
            rollupOptions: {
              input: {
                'spotlight-newtab': resolve(process.cwd(), 'spotlight/newtab.js'),
              },
              output: {
                entryFileNames: 'spotlight/newtab.js',
                format: 'es',
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
        
        // Copy newtab.html after building newtab.js
        if (await fs.pathExists('spotlight/newtab.html')) {
          await fs.copy('spotlight/newtab.html', `${outDir}/spotlight/newtab.html`);
        }
        if (await fs.pathExists('spotlight/newtab.css')) {
          await fs.copy('spotlight/newtab.css', `${outDir}/spotlight/newtab.css`);
        }
        
        console.log(`✅ Newtab page built to ${outDir}/spotlight/newtab.js`);
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