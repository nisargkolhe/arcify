// inject-shared-utilities.js - Build utility to inject shared utilities into overlay.js
// This solves the content script ES6 import limitation by embedding shared code at build time

import fs from 'fs-extra';
import path from 'path';

/**
 * Injects shared utilities into overlay.js by replacing template placeholders
 * This allows overlay.js to use shared code without ES6 imports
 */
export async function injectSharedUtilities(overlayPath, outputPath) {
    try {
        console.log('[Build] Injecting shared utilities into overlay.js...');
        
        // Read the overlay.js source
        const overlaySource = await fs.readFile(overlayPath, 'utf8');
        
        // Read shared utility files
        const [
            uiUtilities,
            selectionManager,
            messageClient,
            cssInjector
        ] = await Promise.all([
            fs.readFile(path.join(path.dirname(overlayPath), 'shared/ui-utilities.js'), 'utf8'),
            fs.readFile(path.join(path.dirname(overlayPath), 'shared/selection-manager.js'), 'utf8'),
            fs.readFile(path.join(path.dirname(overlayPath), 'shared/message-client.js'), 'utf8'),
            fs.readFile(path.join(path.dirname(overlayPath), 'shared/css-injector.js'), 'utf8')
        ]);
        
        // Extract just the class/function implementations without imports/exports
        const extractedUtilities = extractUtilityFunctions([
            { name: 'ui-utilities', content: uiUtilities },
            { name: 'selection-manager', content: selectionManager },
            { name: 'message-client', content: messageClient },
            { name: 'css-injector', content: cssInjector }
        ]);
        
        // Create the injection code
        const injectionCode = `
    // ======= SHARED UTILITIES (Build-time injected) =======
    // The following code is automatically injected from shared modules during build
    // Source files: spotlight/shared/*.js
    
${extractedUtilities}
    
    // ======= END SHARED UTILITIES =======
    `;
        
        // Find the injection point in overlay.js (after the constants section)
        const injectionPoint = overlaySource.indexOf('// Utility function to detect URLs');
        
        if (injectionPoint === -1) {
            throw new Error('Could not find injection point in overlay.js');
        }
        
        // Replace the injection point with shared utilities
        const modifiedOverlay = overlaySource.slice(0, injectionPoint) + 
                               injectionCode + 
                               overlaySource.slice(injectionPoint);
        
        // Write the modified overlay to the output path
        await fs.ensureDir(path.dirname(outputPath));
        await fs.writeFile(outputPath, modifiedOverlay, 'utf8');
        
        console.log('[Build] ✅ Shared utilities injected into overlay.js');
        return true;
        
    } catch (error) {
        console.error('[Build] ❌ Failed to inject shared utilities:', error);
        return false;
    }
}

/**
 * Extracts utility functions from ES6 modules, removing imports/exports
 */
function extractUtilityFunctions(modules) {
    const extractedCode = [];
    
    modules.forEach(module => {
        console.log(`[Build] Processing module: ${module.name}`);
        
        let content = module.content;
        
        // Remove import statements
        content = content.replace(/^import\s+.*$/gm, '');
        
        // Remove export statements but keep the class/function declarations
        content = content.replace(/^export\s+/gm, '');
        
        // Clean up extra whitespace
        content = content.replace(/^\s*\n/gm, '\n');
        
        extractedCode.push(`    // === ${module.name.toUpperCase()} ===`);
        extractedCode.push(content);
        extractedCode.push('');
    });
    
    return extractedCode.join('\n');
}

/**
 * Creates a template version of overlay.js with injection points
 * This prepares overlay.js to use shared utilities
 */
export async function createOverlayTemplate(originalPath, templatePath) {
    try {
        console.log('[Build] Creating overlay template...');
        
        const originalContent = await fs.readFile(originalPath, 'utf8');
        
        // Replace duplicate functions with calls to shared utilities
        let templateContent = originalContent;
        
        // Replace utility function calls
        const replacements = [
            // URL detection
            { 
                from: /function isURL\(text\)\s*{[\s\S]*?return false;\s*}/,
                to: '// isURL function will be replaced with SpotlightUtils.isURL'
            },
            // Instant suggestion generation
            {
                from: /function generateInstantSuggestion\(query\)\s*{[\s\S]*?}\s*}/,
                to: '// generateInstantSuggestion function will be replaced with SpotlightUtils.generateInstantSuggestion'
            },
            // Escape HTML
            {
                from: /function escapeHtml\(text\)\s*{[\s\S]*?return div\.innerHTML;\s*}/,
                to: '// escapeHtml function will be replaced with SpotlightUtils.escapeHtml'
            },
            // Format result
            {
                from: /function formatResult\(result, mode\)\s*{[\s\S]*?};\s*}/,
                to: '// formatResult function will be replaced with SpotlightUtils.formatResult'
            },
            // Get favicon URL
            {
                from: /function getFaviconUrl\(result\)\s*{[\s\S]*?return `data:image\/svg\+xml[^`]*`;\s*}/,
                to: '// getFaviconUrl function will be replaced with SpotlightUtils.getFaviconUrl'
            },
            // Get accent color CSS
            {
                from: /function getAccentColorCSS\(spaceColor\)\s*{[\s\S]*?};\s*}/,
                to: '// getAccentColorCSS function will be replaced with SpotlightUtils.getAccentColorCSS'
            },
            // Selection Manager class
            {
                from: /class SelectionManager\s*{[\s\S]*?}\s*}/,
                to: '// SelectionManager class will be replaced with shared implementation'
            }
        ];
        
        // Apply replacements
        replacements.forEach(replacement => {
            templateContent = templateContent.replace(replacement.from, replacement.to);
        });
        
        // Add template markers for function calls
        templateContent = templateContent.replace(/isURL\(/g, 'SpotlightUtils.isURL(');
        templateContent = templateContent.replace(/generateInstantSuggestion\(/g, 'SpotlightUtils.generateInstantSuggestion(');
        templateContent = templateContent.replace(/escapeHtml\(/g, 'SpotlightUtils.escapeHtml(');
        templateContent = templateContent.replace(/formatResult\(/g, 'SpotlightUtils.formatResult(');
        templateContent = templateContent.replace(/getFaviconUrl\(/g, 'SpotlightUtils.getFaviconUrl(');
        templateContent = templateContent.replace(/getAccentColorCSS\(/g, 'SpotlightUtils.getAccentColorCSS(');
        templateContent = templateContent.replace(/new SelectionManager\(/g, 'new SelectionManager(');
        
        // Replace message passing with shared client
        templateContent = templateContent.replace(/chrome\.runtime\.sendMessage\(\{\s*action:\s*'getSpotlightSuggestions'/g, 'SpotlightMessageClient.getSuggestions(');
        templateContent = templateContent.replace(/chrome\.runtime\.sendMessage\(\{\s*action:\s*'spotlightHandleResult'/g, 'SpotlightMessageClient.handleResult(');
        templateContent = templateContent.replace(/chrome\.runtime\.sendMessage\(\{\s*action:\s*'getActiveSpaceColor'/g, 'SpotlightMessageClient.getActiveSpaceColor(');
        templateContent = templateContent.replace(/chrome\.runtime\.sendMessage\(\{\s*action:\s*'spotlightOpened'/g, 'SpotlightMessageClient.notifyOpened(');
        templateContent = templateContent.replace(/chrome\.runtime\.sendMessage\(\{\s*action:\s*'spotlightClosed'/g, 'SpotlightMessageClient.notifyClosed(');
        
        await fs.writeFile(templatePath, templateContent, 'utf8');
        
        console.log('[Build] ✅ Overlay template created');
        return true;
        
    } catch (error) {
        console.error('[Build] ❌ Failed to create overlay template:', error);
        return false;
    }
}