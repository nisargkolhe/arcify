/**
 * Global Setup
 * Runs once before all test suites
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default async function globalSetup() {
  console.log('\n🚀 Setting up E2E test environment...\n');

  // Create screenshots directory if it doesn't exist
  const screenshotsDir = path.resolve(__dirname, 'screenshots');
  if (!fs.existsSync(screenshotsDir)) {
    fs.mkdirSync(screenshotsDir, { recursive: true });
    console.log('✓ Created screenshots directory');
  }

  // Verify extension is built
  const extensionPath = path.resolve(__dirname, '../../dist');
  const manifestPath = path.join(extensionPath, 'manifest.json');

  if (!fs.existsSync(manifestPath)) {
    throw new Error(
      `Extension not built! Run "npm run build" first.\nExpected manifest at: ${manifestPath}`
    );
  }

  console.log('✓ Extension build verified');
  console.log(`  Extension path: ${extensionPath}`);

  // Read and display extension version
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  console.log(`  Extension version: ${manifest.version}`);
  console.log(`  Extension name: ${manifest.name}`);

  console.log('\n✅ E2E test environment ready\n');
}
