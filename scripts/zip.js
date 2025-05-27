import archiver from 'archiver';
import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function createZip() {
  const distPath = path.resolve(__dirname, '../dist');
  const zipPath = path.resolve(__dirname, '../arcify-extension.zip');
  
  // Check if dist folder exists
  if (!await fs.pathExists(distPath)) {
    console.error('❌ dist folder not found. Please run "npm run build" first.');
    process.exit(1);
  }
  
  // Remove existing zip file if it exists
  if (await fs.pathExists(zipPath)) {
    await fs.remove(zipPath);
    console.log('🗑️  Removed existing zip file');
  }
  
  // Create a file to stream archive data to
  const output = fs.createWriteStream(zipPath);
  const archive = archiver('zip', {
    zlib: { level: 9 } // Maximum compression
  });
  
  // Listen for all archive data to be written
  output.on('close', () => {
    const sizeInMB = (archive.pointer() / 1024 / 1024).toFixed(2);
    console.log(`✅ Extension packaged successfully!`);
    console.log(`📦 File: arcify-extension.zip`);
    console.log(`📏 Size: ${sizeInMB} MB (${archive.pointer()} bytes)`);
    console.log(`📁 Location: ${zipPath}`);
  });
  
  // Handle warnings (e.g., stat failures and other non-blocking errors)
  archive.on('warning', (err) => {
    if (err.code === 'ENOENT') {
      console.warn('⚠️  Warning:', err.message);
    } else {
      throw err;
    }
  });
  
  // Handle errors
  archive.on('error', (err) => {
    console.error('❌ Error creating zip:', err);
    throw err;
  });
  
  // Pipe archive data to the file
  archive.pipe(output);
  
  console.log('📦 Creating extension package...');
  
  // Add the entire dist directory to the zip
  archive.directory(distPath, false);
  
  // Finalize the archive (this is the end of the stream)
  await archive.finalize();
}

// Run the script
createZip().catch((error) => {
  console.error('❌ Failed to create zip:', error);
  process.exit(1);
}); 