/**
 * Global Teardown
 * Runs once after all test suites complete
 */
export default async function globalTeardown() {
  console.log('\n🧹 Cleaning up E2E test environment...\n');
  console.log('✅ E2E tests complete\n');
}
