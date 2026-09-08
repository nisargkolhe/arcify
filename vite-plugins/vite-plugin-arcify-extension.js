import { resolve } from 'path';
import fs from 'fs-extra';

/**
 * Get shared input configuration for Arcify Chrome Extension
 */
function getExtensionInputs() {
  return {
    sidebar: resolve(process.cwd(), 'sidebar.html'),
    'tutorial-practice': resolve(process.cwd(), 'tutorial-practice.html'),
    options: resolve(process.cwd(), 'options.html'),
    onboarding: resolve(process.cwd(), 'onboarding.html'),
    'installation-onboarding': resolve(process.cwd(), 'installation-onboarding.html'),
    background: resolve(process.cwd(), 'background.js'),
    'sidebar-script': resolve(process.cwd(), 'sidebar.js'),
    'options-script': resolve(process.cwd(), 'options.js'),
    'onboarding-script': resolve(process.cwd(), 'onboarding.js'),
    'installation-onboarding-script': resolve(process.cwd(), 'installation-onboarding.js'),
    offscreen: resolve(process.cwd(), 'offscreen.html'),
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
      return isDev ? '[name].js' : 'assets/[name]-[hash].js';
    },
    chunkFileNames: isDev ? '[name].js' : 'assets/[name]-[hash].js',
    assetFileNames: (assetInfo) => {
      if (assetInfo.name?.endsWith('.css')) {
        return '[name][extname]';
      }
      if (assetInfo.name?.endsWith('.html')) {
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

        if (await fs.pathExists('LICENSE')) {
          await fs.copy('LICENSE', `${outDir}/LICENSE`);
        }
        if (await fs.pathExists('README.md')) {
          await fs.copy('README.md', `${outDir}/README.md`);
        }

        console.log(`✅ Main extension files built to ${outDir}/`);
        console.log(`🎉 Arcify extension build complete!`);
      }
    }
  ];
}

/**
 * Create complete Vite configuration for Arcify Chrome Extension
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
