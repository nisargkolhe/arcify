/**
 * Setup file for each test suite
 * Runs before each test file
 */
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Global test constants
global.EXTENSION_PATH = path.resolve(__dirname, '../../dist');
global.TEST_TIMEOUT = 30000;
