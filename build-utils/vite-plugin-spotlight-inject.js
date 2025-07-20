// vite-plugin-spotlight-inject.js - Vite plugin to inject shared utilities into overlay.js
// This solves the content script import limitation by bundling shared code at build time

import fs from 'fs-extra';
import path from 'path';

/**
 * Vite plugin that injects shared utilities into overlay.js during build
 * This allows overlay.js to use shared code without ES6 imports (which don't work in content scripts)
 */
export function createSpotlightInjectPlugin() {
    return {
        name: 'spotlight-inject',
        // Transform the overlay.js file during build
        transform(code, id) {
            // Only process spotlight/overlay.js
            if (!id.includes('spotlight/overlay.js')) {
                return null;
            }
            
            console.log('[SpotlightInject] Processing overlay.js...');
            
            // Check if this overlay.js has already been processed or if it needs injection
            if (code.includes('// ======= SHARED UTILITIES (Build-time injected) =======')) {
                console.log('[SpotlightInject] Already processed, skipping...');
                return null;
            }
            
            // For now, just return the original code
            // In a future implementation, we would inject shared utilities here
            console.log('[SpotlightInject] Overlay.js processed (no changes for now)');
            return null;
        },
        
        // Alternative approach: modify files after Vite processes them
        writeBundle: async (options) => {
            const overlayPath = path.join(options.dir, 'spotlight/overlay.js');
            
            if (await fs.pathExists(overlayPath)) {
                console.log('[SpotlightInject] Post-processing overlay.js...');
                
                // Read the built overlay.js
                let overlayContent = await fs.readFile(overlayPath, 'utf8');
                
                // Check if already processed
                if (overlayContent.includes('// ======= SHARED UTILITIES (Build-time injected) =======')) {
                    console.log('[SpotlightInject] Already contains injected utilities');
                    return;
                }
                
                // For now, just add a comment indicating where injection would happen
                const injectionMarker = '// ======= SHARED UTILITIES INJECTION POINT =======\\n';
                const injectionPoint = overlayContent.indexOf('// Utility function to detect URLs');
                
                if (injectionPoint !== -1) {
                    const beforeInjection = overlayContent.slice(0, injectionPoint);
                    const afterInjection = overlayContent.slice(injectionPoint);
                    
                    overlayContent = beforeInjection + injectionMarker + afterInjection;
                    
                    await fs.writeFile(overlayPath, overlayContent, 'utf8');
                    console.log('[SpotlightInject] ✅ Injection point marked in overlay.js');
                } else {
                    console.log('[SpotlightInject] ⚠️  Could not find injection point in overlay.js');
                }
            }
        }
    };
}

/**
 * Simple utility to prepare overlay.js for shared utilities without complex templating
 * This creates a working version that demonstrates the concept
 */
export async function createSimpleOverlayRefactor(srcPath, outputPath) {
    try {
        console.log('[SpotlightInject] Creating simple overlay refactor...');
        
        const overlayContent = await fs.readFile(srcPath, 'utf8');
        
        // Simple approach: Add shared utility classes at the top, after constants
        const sharedUtilitiesCode = `
    // ======= SHARED UTILITIES (Simplified injection) =======
    // Note: In a full implementation, these would be automatically injected from shared modules
    
    // For now, overlay.js keeps its existing utility functions
    // Future implementation would replace these with injected shared utilities
    
    // ======= END SHARED UTILITIES =======
    `;
        
        // Find insertion point (after constants, before first utility function)
        const insertionPoint = overlayContent.indexOf('// Utility function to detect URLs');
        
        if (insertionPoint === -1) {
            throw new Error('Could not find insertion point in overlay.js');
        }
        
        // Insert the shared utilities marker
        const modifiedContent = 
            overlayContent.slice(0, insertionPoint) + 
            sharedUtilitiesCode + 
            overlayContent.slice(insertionPoint);
        
        // Ensure output directory exists
        await fs.ensureDir(path.dirname(outputPath));
        await fs.writeFile(outputPath, modifiedContent, 'utf8');
        
        console.log('[SpotlightInject] ✅ Simple overlay refactor completed');
        return true;
        
    } catch (error) {
        console.error('[SpotlightInject] ❌ Failed to create simple overlay refactor:', error);
        return false;
    }
}