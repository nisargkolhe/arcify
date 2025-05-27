import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function displayBuildInfo() {
  console.log('🚀 Arcify Extension Build Information\n');
  
  // Check package.json
  const packagePath = path.resolve(__dirname, '../package.json');
  if (await fs.pathExists(packagePath)) {
    const pkg = await fs.readJson(packagePath);
    console.log(`📦 Package: ${pkg.name} v${pkg.version}`);
    console.log(`📝 Description: ${pkg.description}\n`);
  }
  
  // Check manifest.json
  const manifestPath = path.resolve(__dirname, '../manifest.json');
  if (await fs.pathExists(manifestPath)) {
    const manifest = await fs.readJson(manifestPath);
    console.log(`🔧 Extension: ${manifest.name} v${manifest.version}`);
    console.log(`📋 Manifest Version: ${manifest.manifest_version}\n`);
  }
  
  // Check build directories
  const distPath = path.resolve(__dirname, '../dist');
  const distDevPath = path.resolve(__dirname, '../dist-dev');
  
  console.log('📁 Build Directories:');
  console.log(`   Production (dist/): ${await fs.pathExists(distPath) ? '✅ Exists' : '❌ Not found'}`);
  console.log(`   Development (dist-dev/): ${await fs.pathExists(distDevPath) ? '✅ Exists' : '❌ Not found'}\n`);
  
  // Check for zip files
  const zipPath = path.resolve(__dirname, '../arcify-extension.zip');
  if (await fs.pathExists(zipPath)) {
    const stats = await fs.stat(zipPath);
    const sizeInMB = (stats.size / 1024 / 1024).toFixed(2);
    console.log(`📦 Package: arcify-extension.zip (${sizeInMB} MB)\n`);
  }
  
  // Available scripts
  console.log('🛠️  Available Commands:');
  console.log('   npm run dev        - Development build with file watching');
  console.log('   npm run build      - Production build');
  console.log('   npm run build:zip  - Build and create zip package');
  console.log('   npm run zip        - Create zip from existing build');
  console.log('   npm run clean      - Remove all build artifacts');
  console.log('   npm run preview    - Preview the built extension\n');
  
  console.log('🎯 Next Steps:');
  console.log('   1. Run "npm install" to install dependencies');
  console.log('   2. Run "npm run dev" for development');
  console.log('   3. Run "npm run build:zip" for distribution');
  console.log('   4. Load the extension from dist/ or dist-dev/ in Chrome');
}

displayBuildInfo().catch(console.error); 