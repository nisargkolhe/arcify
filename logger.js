/**
 * Logger - Centralized logging utility with debug flag support
 * 
 * Purpose: Provides controlled logging that respects the debugLoggingEnabled setting
 * Key Functions: log(), error(), warn(), info(), debug() - all check cached debug setting
 * Architecture: Singleton pattern with cached setting value and storage change listener
 * 
 * Critical Notes:
 * - Caches debugLoggingEnabled setting to avoid storage reads on every log call
 * - Listens for storage changes to update cache automatically
 * - All logging methods are synchronous (check cached value, no async operations)
 * - Works in both service worker and content script contexts
 */

// Cached debug setting value (defaults to false if not yet loaded)
let debugLoggingEnabled = false;
let isInitialized = false;

/**
 * Initialize the logger by loading the debug setting and setting up storage listener
 * This should be called early in the extension lifecycle, but logging will work
 * even if called later (defaults to disabled until loaded)
 */
async function initializeLogger() {
    if (isInitialized) return;
    
    try {
        // Load the setting from storage
        const result = await chrome.storage.sync.get({ debugLoggingEnabled: false });
        debugLoggingEnabled = result.debugLoggingEnabled || false;
        
        // Listen for storage changes to update cache
        chrome.storage.onChanged.addListener((changes, areaName) => {
            if (areaName === 'sync' && changes.debugLoggingEnabled) {
                debugLoggingEnabled = changes.debugLoggingEnabled.newValue || false;
            }
        });
        
        isInitialized = true;
    } catch (error) {
        // If we can't access storage, default to disabled
        console.error('[Logger] Failed to initialize:', error);
        debugLoggingEnabled = false;
        isInitialized = true;
    }
}

/**
 * Logger object with methods matching console API
 * All methods check the cached debugLoggingEnabled value synchronously
 */
const Logger = {
    /**
     * Log a message (only if debug logging is enabled)
     */
    log: function(...args) {
        if (debugLoggingEnabled) {
            console.log(...args);
        }
    },
    
    /**
     * Log an error (only if debug logging is enabled)
     * Note: Consider if errors should always log regardless of debug flag
     */
    error: function(...args) {
        if (debugLoggingEnabled) {
            console.error(...args);
        }
    },
    
    /**
     * Log a warning (only if debug logging is enabled)
     */
    warn: function(...args) {
        if (debugLoggingEnabled) {
            console.warn(...args);
        }
    },
    
    /**
     * Log an info message (only if debug logging is enabled)
     */
    info: function(...args) {
        if (debugLoggingEnabled) {
            console.info(...args);
        }
    },
    
    /**
     * Log a debug message (only if debug logging is enabled)
     */
    debug: function(...args) {
        if (debugLoggingEnabled) {
            console.debug(...args);
        }
    },
    
    /**
     * Initialize the logger (call this early in extension lifecycle)
     */
    initialize: initializeLogger
};

// Auto-initialize if chrome.storage is available
if (typeof chrome !== 'undefined' && chrome.storage) {
    initializeLogger();
}

export { Logger };

