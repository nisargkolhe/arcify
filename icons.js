/**
 * Icons - SVG icon definitions and constants
 * 
 * Purpose: Centralized repository for SVG icons used throughout the extension
 * Key Functions: Provides consistent icon definitions, folder states, action icons
 * Architecture: ES6 module exports for icon string constants
 * 
 * Critical Notes:
 * - Icons are embedded as SVG strings for performance and styling flexibility
 * - Font Awesome icons used with proper licensing attribution
 * - Exported constants allow for easy icon swapping and maintenance
 * - SVGs can be styled via CSS for theme consistency
 */

// SVG icons for folder states
export const FOLDER_CLOSED_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><!--!Font Awesome Free 6.7.2 by @fontawesome - https://fontawesome.com License - https://fontawesome.com/license/free Copyright 2025 Fonticons, Inc.--><path d="M0 96C0 60.7 28.7 32 64 32l132.1 0c19.1 0 37.4 7.6 50.9 21.1L289.9 96 448 96c35.3 0 64 28.7 64 64l0 256c0 35.3-28.7 64-64 64L64 480c-35.3 0-64-28.7-64-64L0 96zM64 80c-8.8 0-16 7.2-16 16l0 320c0 8.8 7.2 16 16 16l384 0c8.8 0 16-7.2 16-16l0-256c0-8.8-7.2-16-16-16l-161.4 0c-10.6 0-20.8-4.2-28.3-11.7L213.1 87c-4.5-4.5-10.6-7-17-7L64 80z"/></svg>`;

export const FOLDER_OPEN_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 576 512"><!--!Font Awesome Free 6.7.2 by @fontawesome - https://fontawesome.com License - https://fontawesome.com/license/free Copyright 2025 Fonticons, Inc.--><path d="M384 480l48 0c11.4 0 21.9-6 27.6-15.9l112-192c5.8-9.9 5.8-22.1 .1-32.1S555.5 224 544 224l-400 0c-11.4 0-21.9 6-27.6 15.9L48 357.1 48 96c0-8.8 7.2-16 16-16l117.5 0c4.2 0 8.3 1.7 11.3 4.7l26.5 26.5c21 21 49.5 32.8 79.2 32.8L416 144c8.8 0 16 7.2 16 16l0 32 48 0 0-32c0-35.3-28.7-64-64-64L298.5 96c-17 0-33.3-6.7-45.3-18.7L226.7 50.7c-12-12-28.3-18.7-45.3-18.7L64 32C28.7 32 0 60.7 0 96L0 416c0 35.3 28.7 64 64 64l23.7 0L384 480z"/></svg>`;


export const ARCHIVE_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 576 512"><!--!Font Awesome Free 6.7.2 by @fontawesome - https://fontawesome.com License - https://fontawesome.com/license/free Copyright 2025 Fonticons, Inc.--><path d="M192 416l0-64 248 0c4 0 8-4 8-8l0-240c0-4-4-8-8-8l-304 0c-4 0-8 4-8 8l0 48c0 4 4 8 8 8l248 0 0 128-192 0 0-64-128 96z"/></svg>`;
export const RESTORE_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 576 512" class="svg-icon"><!--!Font Awesome Free 6.7.2 by @fontawesome - https://fontawesome.com License - https://fontawesome.com/license/free Copyright 2025 Fonticons, Inc.--><path d="M475 256c0-30-5-58-17-85-12-27-27-51-47-70-19-20-43-35-70-47-27-12-55-17-85-17-33 0-64 6-93 20-30 14-55 34-76 59-1 2-2 4-2 6 0 3 1 4 3 6l39 39c2 2 4 3 7 3 3 0 5-2 7-3 13-19 31-33 51-42 20-10 41-15 64-15 20 0 39 4 57 11 18 8 33 18 46 32 14 13 24 28 32 46 7 18 11 37 11 57 0 20-4 39-11 57-8 18-18 33-32 46-13 14-28 24-46 32-18 7-37 11-57 11-19 0-37-3-54-10-17-7-32-16-45-29l39-39c6-6 7-13 4-20-4-8-9-11-17-11l-128 0c-5 0-9 1-13 5-4 4-5 8-5 13l0 128c0 8 3 13 11 17 7 3 14 2 20-4l37-37c20 19 44 34 70 45 26 10 53 15 81 15 30 0 58-5 85-17 27-12 51-27 70-47 20-19 35-43 47-70 12-27 17-55 17-85z"/></svg>`;
export const MENU_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 576 512" class="svg-icon"><!--!Font Awesome Free 6.7.2 by @fontawesome - https://fontawesome.com License - https://fontawesome.com/license/free Copyright 2025 Fonticons, Inc.--><path d="M296 376c0 22-18 40-40 40-22 0-40-18-40-40 0-22 18-40 40-40 22 0 40 18 40 40z m0-240c0 22-18 40-40 40-22 0-40-18-40-40 0-22 18-40 40-40 22 0 40 18 40 40z m0 120c0 22-18 40-40 40-22 0-40-18-40-40 0-22 18-40 40-40 22 0 40 18 40 40z"/></svg>`;
