/**
 * Extension Helper
 * Utilities for loading and interacting with Chrome extensions in Puppeteer
 */
import puppeteer from 'puppeteer';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Launch Chrome with the extension loaded
 * @param {Object} options - Launch options
 * @returns {Promise<{browser: Browser, extensionId: string}>}
 */
export async function launchBrowserWithExtension(options = {}) {
  const extensionPath = options.extensionPath || process.env.ARCIFY_TEST_EXTENSION_PATH || path.resolve(__dirname, '../../../dist');
  // Default: headless (uses Chrome's new headless mode which supports extensions)
  // Set DEBUG=true or HEADED=true to see the browser window
  const isDebug = process.env.DEBUG === 'true' || process.env.HEADED === 'true';
  const headless = options.headless !== undefined ? options.headless : !isDebug;

  const browser = await puppeteer.launch({
    headless: headless ? 'new' : false,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-blink-features=AutomationControlled',
      '--disable-web-security', // For testing purposes
      '--window-size=1920,1080',
    ],
    devtools: false,
  });

  // Wait a bit for the extension to initialize
  await new Promise(resolve => setTimeout(resolve, 2000));

  // Get extension ID - try multiple methods
  let extensionId = null;

  // Method 1: Look for service worker
  let targets = await browser.targets();
  let extensionTarget = targets.find(
    target => target.type() === 'service_worker' && target.url().startsWith('chrome-extension://')
  );

  if (extensionTarget) {
    const extensionUrl = extensionTarget.url();
    extensionId = extensionUrl.split('/')[2];
  }

  // Method 2: If no service worker found, try background_page or any extension target
  if (!extensionId) {
    extensionTarget = targets.find(
      target => target.url().startsWith('chrome-extension://')
    );

    if (extensionTarget) {
      const extensionUrl = extensionTarget.url();
      extensionId = extensionUrl.split('/')[2];
    }
  }

  // Method 3: Try to get ID from chrome://extensions page
  if (!extensionId) {
    const page = await browser.newPage();
    await page.goto('chrome://extensions/');
    await page.waitForTimeout(1000);

    extensionId = await page.evaluate(() => {
      const cards = document.querySelectorAll('extensions-item');
      for (const card of cards) {
        const nameEl = card.shadowRoot.querySelector('#name');
        if (nameEl && nameEl.textContent.includes('Arcify')) {
          return card.id;
        }
      }
      return null;
    });

    await page.close();
  }

  if (!extensionId) {
    throw new Error('Extension not loaded properly. Make sure the extension is built in dist/ directory.');
  }

  return { browser, extensionId };
}

/**
 * Open the extension sidebar
 * @param {Browser} browser - Puppeteer browser instance
 * @param {string} extensionId - Extension ID
 * @returns {Promise<Page>}
 */
export async function openSidebar(browser, extensionId) {
  const sidebarUrl = `chrome-extension://${extensionId}/sidebar.html`;
  const page = await browser.newPage();
  await page.goto(sidebarUrl, { waitUntil: 'domcontentloaded' });
  // Wait for sidebar JS to initialize (loads spaces from storage, creates DOM)
  await new Promise(r => setTimeout(r, 2000));
  return page;
}

/**
 * Open the extension options page
 * @param {Browser} browser - Puppeteer browser instance
 * @param {string} extensionId - Extension ID
 * @returns {Promise<Page>}
 */
export async function openOptionsPage(browser, extensionId) {
  const optionsUrl = `chrome-extension://${extensionId}/options.html`;
  const page = await browser.newPage();
  await page.goto(optionsUrl, { waitUntil: 'networkidle0' });
  return page;
}

/**
 * Get the background service worker page
 * @param {Browser} browser - Puppeteer browser instance
 * @returns {Promise<Target>}
 */
export async function getBackgroundServiceWorker(browser) {
  const targets = await browser.targets();
  const serviceWorkerTarget = targets.find(
    target => target.type() === 'service_worker'
  );

  if (!serviceWorkerTarget) {
    throw new Error('Service worker not found');
  }

  return serviceWorkerTarget.worker();
}

/**
 * Wait for element with timeout
 * @param {Page} page - Puppeteer page
 * @param {string} selector - CSS selector
 * @param {number} timeout - Timeout in ms
 */
export async function waitForElement(page, selector, timeout = 5000) {
  await page.waitForSelector(selector, { timeout });
}

/**
 * Wait for condition to be true
 * @param {Function} condition - Function that returns boolean
 * @param {number} timeout - Timeout in ms
 * @param {string} errorMsg - Error message if timeout
 */
export async function waitForCondition(condition, timeout = 5000, errorMsg = 'Condition not met') {
  const startTime = Date.now();
  while (Date.now() - startTime < timeout) {
    if (await condition()) {
      return true;
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(errorMsg);
}

/**
 * Get all tabs from sidebar
 * @param {Page} sidebarPage - Sidebar page instance
 * @returns {Promise<Array>}
 */
export async function getSidebarTabs(sidebarPage) {
  return await sidebarPage.evaluate(() => {
    const tabElements = document.querySelectorAll('.tab');
    return Array.from(tabElements).map(tab => ({
      title: tab.querySelector('.tab-title-display')?.textContent?.trim(),
      url: tab.dataset.url || '',
      id: tab.dataset.tabId || '',
    }));
  });
}

/**
 * Get all spaces from sidebar
 * @param {Page} sidebarPage - Sidebar page instance
 * @returns {Promise<Array>}
 */
export async function getSidebarSpaces(sidebarPage) {
  return await sidebarPage.evaluate(() => {
    const spaceElements = document.querySelectorAll('.space');
    return Array.from(spaceElements).map(space => ({
      name: space.querySelector('.space-name')?.value?.trim() || space.querySelector('.space-name')?.textContent?.trim(),
      color: space.dataset.color || '',
      id: space.dataset.spaceId || '',
      uuid: space.dataset.spaceUuid || '',
    }));
  });
}

/**
 * Click element by selector
 * @param {Page} page - Puppeteer page
 * @param {string} selector - CSS selector
 */
export async function clickElement(page, selector) {
  await page.waitForSelector(selector);
  await page.click(selector);
}

/**
 * Type into input field - clicks the element first to focus it, clears existing text
 * @param {Page} page - Puppeteer page
 * @param {string} selector - CSS selector
 * @param {string} text - Text to type
 */
export async function typeIntoField(page, selector, text) {
  await page.waitForSelector(selector, { visible: true, timeout: 5000 });
  await page.click(selector);
  // Select all existing text and delete it
  await page.keyboard.down('Meta');
  await page.keyboard.press('KeyA');
  await page.keyboard.up('Meta');
  await page.keyboard.press('Backspace');
  await page.type(selector, text);
}

/**
 * Create a new extension-owned space through the sidebar UI.
 * Opens a sidebar and uses its Create Space form. DOM clicks avoid depending on
 * compositor frames when Chrome focuses a different tab during the test.
 * @param {object} browser - Puppeteer browser instance
 * @param {string} extensionId - Extension ID
 * @param {string} name - Space name
 * @param {string} color - Space color (default: 'grey')
 * @returns {Promise<Page>} New sidebar page
 */
export async function createSpace(browser, extensionId, name, color = 'grey') {
  const page = await openSidebar(browser, extensionId);
  await page.$eval('#addSpaceBtn', button => button.click());
  await page.type('#newSpaceName', name);
  await page.select('#spaceColor', color);
  await page.$eval('#createSpaceBtn', button => button.click());
  await page.waitForFunction(spaceName => [...document.querySelectorAll('.space-name')].some(el => el.value === spaceName), { polling: 100 }, name);
  await page.waitForFunction(async spaceName => {
    const { spaces = [] } = await chrome.storage.local.get('spaces');
    return spaces.some(s => s.name === spaceName);
  }, { polling: 100 }, name);
  return page;
}

/**
 * Clear Chrome storage (for clean test state)
 * @param {Page} page - Any page from the browser
 */
export async function clearExtensionStorage(page) {
  await page.evaluate(() => {
    return new Promise((resolve) => {
      chrome.storage.local.clear(() => {
        chrome.storage.sync.clear(() => {
          resolve();
        });
      });
    });
  });
}
