import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyCurrentTabUrlWithFallback } from '../../url-copy.js';

test('copies from the last-focused tab and waits for the injected result', async () => {
    let queryOptions;
    let injected;
    const messages = [];
    const chromeApi = {
        tabs: {
            query: async options => {
                queryOptions = options;
                return [{ id: 42, url: 'https://example.com/article' }];
            }
        },
        scripting: {
            executeScript: async details => {
                injected = details;
                return [{ result: { copied: true } }];
            }
        },
        runtime: {
            sendMessage: message => messages.push(message),
            lastError: null
        }
    };

    assert.equal(await copyCurrentTabUrlWithFallback({ chromeApi }), true);
    assert.deepEqual(queryOptions, { active: true, lastFocusedWindow: true });
    assert.equal(injected.target.tabId, 42);
    assert.equal(injected.args[0], 'https://example.com/article');
    assert.equal(messages[0].action, 'urlCopySuccess');
});

test('uses an offscreen document when Chrome provides the clipboard context', async () => {
    const calls = [];
    const chromeApi = {
        tabs: { query: async () => [{ id: 7, url: 'https://example.org' }] },
        runtime: {
            getURL: path => `chrome-extension://arcify/${path}`,
            getContexts: async () => [],
            sendMessage: async message => {
                calls.push(['message', message]);
                return { success: true };
            }
        },
        offscreen: {
            createDocument: async details => calls.push(['create', details]),
            closeDocument: async () => calls.push(['close'])
        }
    };

    assert.equal(await copyCurrentTabUrlWithFallback({ chromeApi }), true);
    assert.equal(calls[0][0], 'create');
    assert.equal(calls[1][1].target, 'offscreen');
    assert.equal(calls[1][1].text, 'https://example.org');
    assert.deepEqual(calls.find(call => call[0] === 'close'), ['close']);
});

test('does not report success when the injected function cannot confirm a copy', async () => {
    const chromeApi = {
        tabs: { query: async () => [{ id: 42, url: 'https://example.com' }] },
        scripting: { executeScript: async () => [{ result: { copied: false } }] },
        runtime: {
            lastError: { message: 'No sidebar' },
            sendMessage: (_message, callback) => callback()
        }
    };

    assert.equal(await copyCurrentTabUrlWithFallback({ chromeApi }), false);
});
