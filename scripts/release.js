import fs from 'fs-extra';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function createRelease() {
  const args = process.argv.slice(2);
  const versionType = args[0]; // major, minor, patch, or specific version
  
  if (!versionType) {
    console.log('🚀 Arcify Release Script\n');
    console.log('Usage: npm run release <version-type>');
    console.log('');
    console.log('Version types:');
    console.log('  patch   - Bug fixes (1.0.0 → 1.0.1)');
    console.log('  minor   - New features (1.0.0 → 1.1.0)');
    console.log('  major   - Breaking changes (1.0.0 → 2.0.0)');
    console.log('  x.y.z   - Specific version (e.g., 2.1.3)');
    console.log('');
    console.log('Examples:');
    console.log('  npm run release patch');
    console.log('  npm run release minor');
    console.log('  npm run release 2.3.0');
    process.exit(0);
  }
  
  try {
    // Check if working directory is clean
    try {
      execSync('git diff-index --quiet HEAD --', { stdio: 'pipe' });
    } catch (error) {
      console.error('❌ Working directory is not clean. Please commit or stash your changes first.');
      process.exit(1);
    }
    
    // Read current versions
    const packagePath = path.resolve(__dirname, '../package.json');
    const manifestPath = path.resolve(__dirname, '../manifest.json');
    
    const packageJson = await fs.readJson(packagePath);
    const manifestJson = await fs.readJson(manifestPath);
    
    const currentVersion = packageJson.version;
    console.log(`📦 Current version: ${currentVersion}`);
    
    // Calculate new version
    let newVersion;
    if (['patch', 'minor', 'major'].includes(versionType)) {
      const versionParts = currentVersion.split('.').map(Number);
      switch (versionType) {
        case 'patch':
          versionParts[2]++;
          break;
        case 'minor':
          versionParts[1]++;
          versionParts[2] = 0;
          break;
        case 'major':
          versionParts[0]++;
          versionParts[1] = 0;
          versionParts[2] = 0;
          break;
      }
      newVersion = versionParts.join('.');
    } else {
      // Specific version provided
      if (!/^\d+\.\d+\.\d+$/.test(versionType)) {
        console.error('❌ Invalid version format. Use x.y.z format (e.g., 2.1.3)');
        process.exit(1);
      }
      newVersion = versionType;
    }
    
    console.log(`🎯 New version: ${newVersion}`);
    
    // Update package.json
    packageJson.version = newVersion;
    await fs.writeJson(packagePath, packageJson, { spaces: 2 });
    console.log('✅ Updated package.json');
    
    // Update manifest.json
    manifestJson.version = newVersion;
    await fs.writeJson(manifestPath, manifestJson, { spaces: 2 });
    console.log('✅ Updated manifest.json');
    
    // Build the extension to ensure everything works
    console.log('🔨 Building extension...');
    execSync('npm run build', { stdio: 'inherit' });
    
    // Create zip to test packaging
    console.log('📦 Creating test package...');
    execSync('npm run zip', { stdio: 'inherit' });
    
    // Commit changes
    console.log('📝 Committing version changes...');
    execSync(`git add package.json manifest.json`, { stdio: 'inherit' });
    execSync(`git commit -m "chore: bump version to ${newVersion}"`, { stdio: 'inherit' });
    
    // Create and push tag
    console.log('🏷️  Creating and pushing tag...');
    const tagName = `v${newVersion}`;
    execSync(`git tag -a ${tagName} -m "Release ${tagName}"`, { stdio: 'inherit' });
    execSync(`git push origin main`, { stdio: 'inherit' });
    execSync(`git push origin ${tagName}`, { stdio: 'inherit' });
    
    console.log('');
    console.log('🎉 Release process completed!');
    console.log('');
    console.log(`✅ Version bumped to ${newVersion}`);
    console.log(`✅ Tag ${tagName} created and pushed`);
    console.log(`✅ GitHub Actions will now build and create the release`);
    console.log('');
    console.log(`🔗 Check the release at: https://github.com/nisargkolhe/arcify/releases/tag/${tagName}`);
    console.log('');
    console.log('📋 Next steps:');
    console.log('1. Monitor the GitHub Actions workflow');
    console.log('2. Review the generated release notes');
    console.log('3. Update the Chrome Web Store listing (if applicable)');
    
  } catch (error) {
    console.error('❌ Release failed:', error.message);
    process.exit(1);
  }
}

createRelease(); 