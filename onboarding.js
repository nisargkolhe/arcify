/**
 * Onboarding - First-run experience and user education
 * 
 * Purpose: Provides interactive tutorial and introduction to extension features
 * Key Functions: Smooth scrolling navigation, interactive demos, feature highlights
 * Architecture: Standalone script for onboarding.html page with DOM event handling
 * 
 * Critical Notes:
 * - Runs only on first extension installation or user-initiated help
 * - Self-contained with no dependencies on other extension modules
 * - Handles smooth scrolling and interactive elements for user guidance
 * - Designed to be lightweight and accessible
 */

document.addEventListener('DOMContentLoaded', function () {
    // Handle smooth scrolling for elements with data-scroll-to attribute
    document.addEventListener('click', function (e) {
        if (e.target.hasAttribute('data-scroll-to')) {
            e.preventDefault();
            const targetClass = e.target.getAttribute('data-scroll-to');
            const targetElement = document.querySelector('.' + targetClass);
            if (targetElement) {
                targetElement.scrollIntoView({ behavior: 'smooth' });
            }
        }

        // Handle opening extension options
        if (e.target.id === 'open-options') {
            e.preventDefault();
            chrome.runtime.openOptionsPage();
        }
    });
}); 