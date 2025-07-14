// styling.js - Shared styling utilities for spotlight components

// Function to get accent color CSS based on active space color
export function getAccentColorCSS(spaceColor) {
    // RGB values for each color name (matching --chrome-*-color variables in styles.css)
    // We need this mapping to create rgba() variants with different opacities
    // Can't directly reuse the constants in styles.css due to two reasons:
    //   1. Color constants are in hexcode, cannot use this value in rgba
    //   2. CSS is not directly available in content scripts
    const colorMap = {
        grey: '204, 204, 204',
        blue: '139, 179, 243',
        red: '255, 158, 151',
        yellow: '255, 226, 159',
        green: '139, 218, 153',
        pink: '251, 170, 215',
        purple: '214, 166, 255',
        cyan: '165, 226, 234'
    };

    const rgb = colorMap[spaceColor] || colorMap.purple; // Fallback to purple

    return `
        :root {
            --spotlight-accent-color: rgb(${rgb});
            --spotlight-accent-color-15: rgba(${rgb}, 0.15);
            --spotlight-accent-color-20: rgba(${rgb}, 0.2);
            --spotlight-accent-color-80: rgba(${rgb}, 0.8);
        }
    `;
}