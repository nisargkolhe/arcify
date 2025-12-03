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
let initializationPromise = null;

/**
 * Initialize the logger by loading the debug setting and setting up storage listener
 * This should be called early in the extension lifecycle, but logging will work
 * even if called later (defaults to disabled until loaded)
 */
async function initializeLogger() {
    if (isInitialized) return;
    if (initializationPromise) return initializationPromise;
    
    initializationPromise = (async () => {
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
    })();
    
    return initializationPromise;
}

/**
 * Check if debug logging is enabled, with fallback for race conditions
 * If not initialized yet, performs an immediate async check
 */
function shouldLog() {
    // If initialized, use cached value
    if (isInitialized) {
        return debugLoggingEnabled;
    }
    
    // If not initialized and chrome.storage is available, trigger immediate check
    // This handles the race condition where Logger methods are called before init completes
    if (typeof chrome !== 'undefined' && chrome.storage && !initializationPromise) {
        // Start initialization if not already started
        initializeLogger();
    }
    
    // During race condition window, default to false (respects user's setting preference)
    // The async check will update the cache for future calls
    return false;
}

/**
 * Logger object with methods matching console API
 * All methods check the cached debugLoggingEnabled value, handling race conditions
 */
const Logger = {
    /**
     * Log a message (only if debug logging is enabled)
     */
    log: function(...args) {
        if (shouldLog()) {
            console.log(...args);
        }
    },
    
    /**
     * Log an error (only if debug logging is enabled)
     * Note: Errors are critical but we respect the debug flag to avoid console spam
     */
    error: function(...args) {
        if (shouldLog()) {
            console.error(...args);
        }
    },
    
    /**
     * Log a warning (only if debug logging is enabled)
     */
    warn: function(...args) {
        if (shouldLog()) {
            console.warn(...args);
        }
    },
    
    /**
     * Log an info message (only if debug logging is enabled)
     */
    info: function(...args) {
        if (shouldLog()) {
            console.info(...args);
        }
    },
    
    /**
     * Log a debug message (only if debug logging is enabled)
     */
    debug: function(...args) {
        if (shouldLog()) {
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

