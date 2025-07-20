// css-injector.js - Shared CSS injection utility for spotlight components
// Handles dynamic CSS injection with accent colors for both overlay and popup

import { SpotlightUtils } from './ui-utilities.js';

export class SpotlightCSSInjector {
    // Inject shared styles with accent color customization
    static async injectSharedStyles(accentColor = 'purple', isOverlay = false) {
        try {
            // Get the shared CSS content
            const sharedCSS = await SpotlightCSSInjector.getSharedCSS();
            
            // Generate accent color CSS
            const accentColorCSS = SpotlightUtils.getAccentColorCSS(accentColor);
            
            // Combine with overlay-specific overrides if needed
            let finalCSS = accentColorCSS + '\n' + sharedCSS;
            
            if (isOverlay) {
                finalCSS += SpotlightCSSInjector.getOverlaySpecificCSS();
            } else {
                finalCSS += SpotlightCSSInjector.getPopupSpecificCSS();
            }
            
            // Create and inject stylesheet
            const styleSheet = document.createElement('style');
            styleSheet.textContent = finalCSS;
            styleSheet.className = 'arcify-spotlight-styles';
            document.head.appendChild(styleSheet);
            
            return styleSheet;
        } catch (error) {
            console.error('[SpotlightCSSInjector] Error injecting styles:', error);
            return null;
        }
    }

    // Get shared CSS content (for overlay injection where we can't import CSS files)
    static getSharedCSS() {
        return `
            /* Shared spotlight styles */
            :root {
                --spotlight-accent-color: rgb(214, 166, 255);
                --spotlight-accent-color-15: rgba(214, 166, 255, 0.15);
                --spotlight-accent-color-20: rgba(214, 166, 255, 0.2);
                --spotlight-accent-color-80: rgba(214, 166, 255, 0.8);
            }

            .arcify-spotlight-container {
                background: #2D2D2D;
                border-radius: 12px;
                border: 1px solid rgba(255, 255, 255, 0.1);
                padding: 0;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                color: #ffffff;
                position: relative;
                overflow: hidden;
            }

            .arcify-spotlight-input-wrapper {
                display: flex;
                align-items: center;
                padding: 12px 24px 12px 20px;
                border-bottom: 1px solid rgba(255, 255, 255, 0.1);
            }

            .arcify-spotlight-search-icon {
                width: 20px;
                height: 20px;
                margin-right: 12px;
                opacity: 0.6;
                flex-shrink: 0;
            }

            .arcify-spotlight-input {
                flex: 1;
                background: transparent;
                border: none;
                color: #ffffff;
                font-size: 18px;
                line-height: 24px;
                padding: 8px 0;
                outline: none;
                font-weight: 400;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            }

            .arcify-spotlight-input::placeholder {
                color: rgba(255, 255, 255, 0.5);
            }

            .arcify-spotlight-input:focus {
                outline: none;
            }

            .arcify-spotlight-results {
                max-height: 270px;
                overflow-y: auto;
                padding: 8px 0;
                scroll-behavior: smooth;
                scrollbar-width: none;
                -ms-overflow-style: none;
            }

            .arcify-spotlight-results::-webkit-scrollbar {
                display: none;
            }

            .arcify-spotlight-result-item {
                display: flex;
                align-items: center;
                padding: 12px 24px 12px 20px;
                cursor: pointer;
                transition: background-color 0.15s ease;
                border: none;
                background: none;
                width: 100%;
                text-align: left;
                color: inherit;
                font-family: inherit;
            }

            .arcify-spotlight-result-item:hover,
            .arcify-spotlight-result-item:focus {
                background: var(--spotlight-accent-color-15);
                outline: none;
            }

            .arcify-spotlight-result-item.selected {
                background: var(--spotlight-accent-color-20);
            }

            .arcify-spotlight-result-favicon {
                width: 20px;
                height: 20px;
                margin-right: 12px;
                border-radius: 4px;
                flex-shrink: 0;
            }

            .arcify-spotlight-result-content {
                flex: 1;
                min-width: 0;
            }

            .arcify-spotlight-result-title {
                font-size: 14px;
                font-weight: 500;
                color: #ffffff;
                margin: 0 0 2px 0;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
            }

            .arcify-spotlight-result-url {
                font-size: 12px;
                color: rgba(255, 255, 255, 0.6);
                margin: 0;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
            }

            .arcify-spotlight-result-action {
                font-size: 12px;
                color: var(--spotlight-accent-color-80);
                margin-left: 12px;
                flex-shrink: 0;
            }

            .arcify-spotlight-loading {
                display: flex;
                align-items: center;
                justify-content: center;
                padding: 24px;
                color: rgba(255, 255, 255, 0.6);
            }

            .arcify-spotlight-empty {
                display: flex;
                align-items: center;
                justify-content: center;
                padding: 24px;
                color: rgba(255, 255, 255, 0.6);
                font-size: 14px;
            }

            .arcify-spotlight-result-item:focus-visible {
                outline: 2px solid var(--spotlight-accent-color);
                outline-offset: -2px;
            }

            @media (max-width: 640px) {
                .arcify-spotlight-input {
                    font-size: 16px !important;
                }
            }
        `;
    }

    // Overlay-specific CSS overrides (for content script injection)
    static getOverlaySpecificCSS() {
        return `
            /* Overlay-specific styles */
            #arcify-spotlight-dialog {
                margin: 0;
                position: fixed;
                top: calc(35vh);
                left: 50%;
                transform: translateX(-50%);
                border: none;
                padding: 0;
                background: transparent;
                border-radius: 12px;
                width: 650px;
                max-width: 90vw;
                box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
                backdrop-filter: blur(20px);
                -webkit-backdrop-filter: blur(20px);
                animation: arcify-spotlight-show 0.2s ease-out;
            }

            #arcify-spotlight-dialog::backdrop {
                background: rgba(0, 0, 0, 0.4);
                backdrop-filter: blur(8px);
                -webkit-backdrop-filter: blur(8px);
            }

            /* Specific CSS directives to override styling on specific pages */
            #arcify-spotlight-dialog .arcify-spotlight-input {
                flex: 1 !important;
                background: transparent !important;
                background-color: transparent !important;
                background-image: none !important;
                border: none !important;
                border-style: none !important;
                border-width: 0 !important;
                border-color: transparent !important;
                color: #ffffff !important;
                font-size: 18px !important;
                line-height: 24px !important;
                padding: 8px 0 !important;
                margin: 0 !important;
                outline: none !important;
                outline-style: none !important;
                outline-width: 0 !important;
                font-weight: 400 !important;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
                box-shadow: none !important;
                border-radius: 0 !important;
                appearance: none !important;
                -webkit-appearance: none !important;
                -moz-appearance: none !important;
                text-indent: 0 !important;
                text-shadow: none !important;
                vertical-align: baseline !important;
                text-decoration: none !important;
                box-sizing: border-box !important;
            }

            #arcify-spotlight-dialog .arcify-spotlight-input::placeholder {
                color: rgba(255, 255, 255, 0.5) !important;
                opacity: 1 !important;
            }

            #arcify-spotlight-dialog .arcify-spotlight-input:focus {
                outline: none !important;
                outline-style: none !important;
                outline-width: 0 !important;
                border: none !important;
                box-shadow: none !important;
                background: transparent !important;
                background-color: transparent !important;
            }

            @keyframes arcify-spotlight-show {
                from {
                    opacity: 0;
                    transform: translateX(-50%) scale(0.95);
                }
                to {
                    opacity: 1;
                    transform: translateX(-50%) scale(1);
                }
            }

            @media (max-width: 640px) {
                #arcify-spotlight-dialog {
                    width: 95vw;
                    margin: 20px auto;
                }
            }
        `;
    }

    // Popup-specific CSS overrides
    static getPopupSpecificCSS() {
        return `
            /* Popup-specific styles */
            body {
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                background: #2D2D2D;
                margin: 0;
                padding: 0;
                width: 600px;
                min-height: 300px;
                overflow: hidden;
            }

            * {
                margin: 0;
                padding: 0;
                box-sizing: border-box;
            }

            .arcify-spotlight-container {
                width: 100%;
                min-height: 300px;
                display: flex;
                flex-direction: column;
                animation: spotlightPopupShow 0.15s ease-out;
            }

            .arcify-spotlight-input-wrapper {
                flex-shrink: 0;
            }

            .arcify-spotlight-results {
                flex: 1;
                max-height: 300px;
                min-height: 0;
            }

            @keyframes spotlightPopupShow {
                from {
                    opacity: 0;
                    transform: scale(0.98);
                }
                to {
                    opacity: 1;
                    transform: scale(1);
                }
            }
        `;
    }

    // Remove injected styles (cleanup)
    static removeInjectedStyles() {
        const styleSheets = document.querySelectorAll('style.arcify-spotlight-styles');
        styleSheets.forEach(sheet => {
            if (sheet.parentNode) {
                sheet.parentNode.removeChild(sheet);
            }
        });
    }
}