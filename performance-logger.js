/**
 * Performance Logger - Timing utilities for performance debugging
 * 
 * Purpose: Provides timing utilities to measure and log performance metrics
 * Key Functions: Timer management, async operation measurement, phase logging, storage persistence
 * Architecture: Singleton pattern with storage persistence for cross-session analysis
 * 
 * Critical Notes:
 * - All timings are logged to chrome.storage.local for analysis
 * - Timers can be nested for detailed breakdowns
 * - Supports both manual timing and async function wrappers
 */

import { Logger } from './logger.js';

const STORAGE_KEY = 'performanceLogs';
const MAX_LOG_ENTRIES = 1000; // Keep last 1000 entries
const LOG_RETENTION_DAYS = 7; // Keep logs for 7 days

class PerformanceLogger {
    constructor() {
        this.timers = new Map();
        this.logs = [];
        this.initialized = false;
    }

    /**
     * Initialize the performance logger
     */
    async initialize() {
        if (this.initialized) return;
        
        try {
            // Load existing logs
            const result = await chrome.storage.local.get(STORAGE_KEY);
            this.logs = result[STORAGE_KEY] || [];
            
            // Clean old logs
            this.cleanOldLogs();
            
            this.initialized = true;
        } catch (error) {
            Logger.error('[PerformanceLogger] Failed to initialize:', error);
            this.logs = [];
            this.initialized = true;
        }
    }

    /**
     * Clean logs older than retention period
     */
    cleanOldLogs() {
        const cutoffTime = Date.now() - (LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000);
        this.logs = this.logs.filter(log => log.timestamp > cutoffTime);
        
        // Also limit total entries
        if (this.logs.length > MAX_LOG_ENTRIES) {
            this.logs = this.logs.slice(-MAX_LOG_ENTRIES);
        }
    }

    /**
     * Start a timer
     * @param {string} label - Label for the timer
     * @returns {Object} Timer object with label and start time
     */
    startTimer(label) {
        const timer = {
            label,
            startTime: performance.now(),
            timestamp: Date.now()
        };
        this.timers.set(label, timer);
        return timer;
    }

    /**
     * End a timer and log the duration
     * @param {Object} timer - Timer object returned by startTimer
     * @param {Object} metadata - Optional metadata to include
     * @returns {number} Duration in milliseconds
     */
    endTimer(timer, metadata = {}) {
        if (!timer) {
            Logger.error('[PerformanceLogger] endTimer called with null timer');
            return 0;
        }

        const duration = performance.now() - timer.startTime;
        const logEntry = {
            label: timer.label,
            duration: duration,
            timestamp: timer.timestamp,
            endTimestamp: Date.now(),
            ...metadata
        };

        this.logs.push(logEntry);
        this.timers.delete(timer.label);

        // Persist to storage (async, don't await)
        this.persistLogs();

        Logger.log(`[Performance] ${timer.label}: ${duration.toFixed(2)}ms`, metadata);
        return duration;
    }

    /**
     * Measure an async function
     * @param {string} label - Label for the measurement
     * @param {Function} asyncFn - Async function to measure
     * @param {Object} metadata - Optional metadata
     * @returns {Promise} Result of the async function
     */
    async measureAsync(label, asyncFn, metadata = {}) {
        const timer = this.startTimer(label);
        try {
            const result = await asyncFn();
            this.endTimer(timer, { ...metadata, success: true });
            return result;
        } catch (error) {
            this.endTimer(timer, { ...metadata, success: false, error: error.message });
            throw error;
        }
    }

    /**
     * Log a phase with duration
     * @param {string} phase - Phase name
     * @param {number} duration - Duration in milliseconds
     * @param {Object} metadata - Optional metadata
     */
    logPhase(phase, duration, metadata = {}) {
        const logEntry = {
            label: phase,
            duration: duration,
            timestamp: Date.now(),
            ...metadata
        };

        this.logs.push(logEntry);
        this.persistLogs();

        Logger.log(`[Performance] ${phase}: ${duration.toFixed(2)}ms`, metadata);
    }

    /**
     * Persist logs to storage
     */
    async persistLogs() {
        try {
            // Clean old logs before persisting
            this.cleanOldLogs();
            
            await chrome.storage.local.set({ [STORAGE_KEY]: this.logs });
        } catch (error) {
            Logger.error('[PerformanceLogger] Failed to persist logs:', error);
        }
    }

    /**
     * Get performance logs
     * @param {string} label - Optional filter by label
     * @returns {Array} Array of log entries
     */
    getLogs(label = null) {
        if (label) {
            return this.logs.filter(log => log.label === label);
        }
        return this.logs;
    }

    /**
     * Get statistics for a label
     * @param {string} label - Label to get stats for
     * @returns {Object} Statistics object
     */
    getStats(label) {
        const labelLogs = this.getLogs(label);
        if (labelLogs.length === 0) {
            return { count: 0, avg: 0, min: 0, max: 0 };
        }

        const durations = labelLogs.map(log => log.duration);
        const sum = durations.reduce((a, b) => a + b, 0);
        const avg = sum / durations.length;
        const min = Math.min(...durations);
        const max = Math.max(...durations);

        return {
            count: labelLogs.length,
            avg: avg,
            min: min,
            max: max,
            total: sum
        };
    }

    /**
     * Clear all logs
     */
    async clearLogs() {
        this.logs = [];
        await chrome.storage.local.remove(STORAGE_KEY);
        Logger.log('[PerformanceLogger] Logs cleared');
    }

    /**
     * Add timeout wrapper to async function
     * @param {Function} asyncFn - Async function to wrap
     * @param {number} timeoutMs - Timeout in milliseconds
     * @param {string} label - Label for logging
     * @returns {Promise} Result of async function or timeout error
     */
    async withTimeout(asyncFn, timeoutMs, label = 'operation') {
        return Promise.race([
            asyncFn(),
            new Promise((_, reject) => {
                setTimeout(() => {
                    reject(new Error(`${label} timed out after ${timeoutMs}ms`));
                }, timeoutMs);
            })
        ]);
    }
}

// Create singleton instance
const performanceLogger = new PerformanceLogger();

// Auto-initialize if chrome.storage is available
if (typeof chrome !== 'undefined' && chrome.storage) {
    performanceLogger.initialize();
}

export { performanceLogger as PerformanceLogger };

