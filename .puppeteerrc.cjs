// Split view needs Chrome 155+; Puppeteer 24 bundles an older Chrome for Testing.
/** @type {import('puppeteer').Configuration} */
module.exports = {
    chrome: { version: '156.0.8078.47' }
};
