// styling.js - Shared styling utilities for spotlight components

// Helper function to convert hex color to RGB string
function hexToRgb(hex) {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    if (!result) return null;
    return `${parseInt(result[1], 16)}, ${parseInt(result[2], 16)}, ${parseInt(result[3], 16)}`;
}

// Function to get accent color CSS based on active space color
export async function getAccentColorCSS(spaceColor) {
    // Default RGB values for each color name (matching --chrome-*-color variables in styles.css)
    // We need this mapping to create rgba() variants with different opacities
    // Can't directly reuse the constants in styles.css due to two reasons:
    //   1. Color constants are in hexcode, cannot use this value in rgba
    //   2. CSS is not directly available in content scripts
    const defaultColorMap = {
        grey: '204, 204, 204',
        blue: '139, 179, 243',
        red: '255, 158, 151',
        yellow: '255, 226, 159',
        green: '139, 218, 153',
        pink: '251, 170, 215',
        purple: '214, 166, 255',
        cyan: '165, 226, 234'
    };

    let rgb = defaultColorMap[spaceColor] || defaultColorMap.purple; // Fallback to purple

    // Try to get overridden color from settings
    try {
        const settings = await chrome.storage.sync.get(['colorOverrides']);
        if (settings.colorOverrides && settings.colorOverrides[spaceColor]) {
            const hexColor = settings.colorOverrides[spaceColor];
            const rgbValue = hexToRgb(hexColor);
            if (rgbValue) {
                rgb = rgbValue;
            }
        }
    } catch (error) {
        console.error('Error getting color overrides:', error);
    }

    return `
        :root {
            --spotlight-accent-color: rgb(${rgb});
            --spotlight-accent-color-15: rgba(${rgb}, 0.15);
            --spotlight-accent-color-20: rgba(${rgb}, 0.2);
            --spotlight-accent-color-80: rgba(${rgb}, 0.8);
        }
    `;
}