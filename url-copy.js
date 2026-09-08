/**
 * Copy the last-focused tab URL from the MV3 service worker.
 *
 * Clipboard APIs are unavailable in a service worker, so the primary path
 * uses an offscreen document. Page injection remains a fallback for Chrome
 * versions or contexts where the offscreen API is unavailable.
 */
export async function copyCurrentTabUrlWithFallback({ chromeApi = globalThis.chrome, logger = console } = {}) {
    try {
        const [tab] = await chromeApi.tabs.query({ active: true, lastFocusedWindow: true });
        if (!tab?.id || !tab.url) {
            logger.error?.('[URLCopy] No active tab found');
            return false;
        }

        try {
            if (chromeApi.offscreen?.createDocument) {
                const offscreenUrl = chromeApi.runtime.getURL('offscreen.html');
                const contexts = await chromeApi.runtime.getContexts?.({
                    contextTypes: ['OFFSCREEN_DOCUMENT'],
                    documentUrls: [offscreenUrl]
                });
                if (!contexts?.length) {
                    await chromeApi.offscreen.createDocument({
                        url: 'offscreen.html',
                        reasons: ['CLIPBOARD'],
                        justification: 'Copy the current tab URL from a keyboard shortcut.'
                    });
                }
                const response = await chromeApi.runtime.sendMessage({
                    target: 'offscreen',
                    type: 'copyToClipboard',
                    text: tab.url
                });
                if (response?.success !== true) throw new Error(response?.error || 'Offscreen clipboard copy failed');
                await chromeApi.offscreen.closeDocument?.();
                try { chromeApi.runtime.sendMessage({ action: 'urlCopySuccess' }); } catch (notifyError) {
                    logger.log?.('[URLCopy] Could not notify sidebar:', notifyError);
                }
                return true;
            }
        } catch (offscreenError) {
            logger.log?.('[URLCopy] Offscreen clipboard failed, trying page injection:', offscreenError);
        }

        try {
            const [injection] = await chromeApi.scripting.executeScript({
                target: { tabId: tab.id },
                func: async (url) => {
                    try {
                        await navigator.clipboard.writeText(url);
                        return { copied: true };
                    } catch (clipboardError) {
                        const textarea = document.createElement('textarea');
                        textarea.value = url;
                        textarea.setAttribute('readonly', '');
                        textarea.style.position = 'fixed';
                        textarea.style.opacity = '0';
                        document.body.appendChild(textarea);
                        textarea.select();
                        const copied = document.execCommand('copy');
                        textarea.remove();
                        if (!copied) throw clipboardError;
                        return { copied: true, fallback: true };
                    }
                },
                args: [tab.url]
            });

            if (injection?.result?.copied !== true) {
                throw new Error('Injected clipboard function did not confirm a copy');
            }

            // The sidebar may be closed, so notification failures must not
            // turn a successful clipboard write into a failed command.
            try {
                chromeApi.runtime.sendMessage({ action: 'urlCopySuccess' });
            } catch (notifyError) {
                logger.log?.('[URLCopy] Could not notify sidebar:', notifyError);
            }
            return true;
        } catch (injectionError) {
            logger.log?.('[URLCopy] Script injection failed, trying sidebar fallback:', injectionError);
        }

        try {
            const response = await new Promise((resolve, reject) => {
                const timeout = setTimeout(() => reject(new Error('Sidebar timeout')), 1000);
                chromeApi.runtime.sendMessage({ command: 'copyCurrentUrl', url: tab.url }, result => {
                    clearTimeout(timeout);
                    if (chromeApi.runtime.lastError) reject(chromeApi.runtime.lastError);
                    else resolve(result);
                });
            });
            return response?.success === true;
        } catch (sidebarError) {
            logger.error?.('[URLCopy] Both script injection and sidebar failed:', sidebarError);
            return false;
        }
    } catch (error) {
        logger.error?.('[URLCopy] Failed to copy URL:', error);
        return false;
    }
}
