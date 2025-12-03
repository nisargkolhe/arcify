/**
 * Options - Extension settings and preferences UI
 * 
 * Purpose: Provides user interface for configuring extension behavior and preferences
 * Key Functions: Auto-archive settings, default space configuration, extension preferences management
 * Architecture: Options page that syncs with chrome.storage for persistent settings
 * 
 * Critical Notes:
 * - Settings are synced across devices via chrome.storage.sync
 * - Auto-archive timing affects background script alarm configuration
 * - Changes trigger background script updates via message passing
 * - Provides real-time feedback for setting changes
 */

import { Utils } from './utils.js';
import { LocalStorage } from './localstorage.js';
import { Logger } from './logger.js';

// Default color values (must be 6-digit hex for color picker compatibility)
const DEFAULT_COLORS = {
  grey: '#cccccc',
  blue: '#8bb3f3',
  red: '#ff9e97',
  yellow: '#ffe29f',
  green: '#8bda99',
  pink: '#fbaad7',
  purple: '#d6a6ff',
  cyan: '#a5e2ea'
};

// Function to apply color overrides to CSS variables
function applyColorOverrides(colorOverrides) {
  if (!colorOverrides) return;

  const root = document.documentElement;
  Object.keys(colorOverrides).forEach(colorName => {
    const colorValue = colorOverrides[colorName];
    if (colorValue) {
      root.style.setProperty(`--user-chrome-${colorName}-color`, colorValue);
    } else {
      root.style.removeProperty(`--user-chrome-${colorName}-color`);
    }
  });
}

// Function to save options to chrome.storage
async function saveOptions() {
  const defaultSpaceNameSelect = document.getElementById('defaultSpaceName');
  const defaultSpaceName = defaultSpaceNameSelect.value;
  const autoArchiveEnabledCheckbox = document.getElementById('autoArchiveEnabled');
  const autoArchiveIdleMinutesInput = document.getElementById('autoArchiveIdleMinutes');
  const invertTabOrderCheckbox = document.getElementById('invertTabOrder');
  const enableSpotlightCheckbox = document.getElementById('enableSpotlight');
  const debugLoggingEnabledCheckbox = document.getElementById('debugLoggingEnabled');

  // Get color overrides
  const colorOverrides = {};
  const colorNames = ['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan'];
  colorNames.forEach(colorName => {
    const colorPicker = document.getElementById(`color${colorName.charAt(0).toUpperCase() + colorName.slice(1)}`);
    if (colorPicker && colorPicker.value !== DEFAULT_COLORS[colorName]) {
      colorOverrides[colorName] = colorPicker.value;
    }
  });

  const settings = {
    defaultSpaceName: defaultSpaceName || 'Home', // Default to 'Home' if empty
    autoArchiveEnabled: autoArchiveEnabledCheckbox.checked,
    autoArchiveIdleMinutes: parseInt(autoArchiveIdleMinutesInput.value, 10) || 360,
    invertTabOrder: invertTabOrderCheckbox.checked,
    enableSpotlight: enableSpotlightCheckbox.checked,
    colorOverrides: Object.keys(colorOverrides).length > 0 ? colorOverrides : null,
    debugLoggingEnabled: debugLoggingEnabledCheckbox ? debugLoggingEnabledCheckbox.checked : false
  };

  try {
    await chrome.storage.sync.set(settings);
    Logger.log('Settings saved:', settings);

    // Apply color overrides immediately
    applyColorOverrides(settings.colorOverrides);

    // Notify background script to update the alarm immediately
    await chrome.runtime.sendMessage({ action: 'updateAutoArchiveSettings' });

    // Show toast notification
    showToast();
  } catch (error) {
    Logger.error('Error saving settings:', error);
  }
}

// Function to show toast notification
function showToast() {
  const toast = document.getElementById('saveToast');
  if (!toast) return;

  // Add show class to trigger animation
  toast.classList.add('show');

  // Remove show class after 2 seconds
  setTimeout(() => {
    toast.classList.remove('show');
  }, 2000);
}

// Function to restore options from chrome.storage
async function restoreOptions() {
  const settings = await Utils.getSettings();
  const autoArchiveEnabledCheckbox = document.getElementById('autoArchiveEnabled');
  const autoArchiveIdleMinutesInput = document.getElementById('autoArchiveIdleMinutes');
  const invertTabOrderCheckbox = document.getElementById('invertTabOrder');
  const enableSpotlightCheckbox = document.getElementById('enableSpotlight');
  const debugLoggingEnabledCheckbox = document.getElementById('debugLoggingEnabled');

  // Populate spaces dropdown
  await populateSpacesDropdown(settings.defaultSpaceName);

  autoArchiveEnabledCheckbox.checked = settings.autoArchiveEnabled;
  autoArchiveIdleMinutesInput.value = settings.autoArchiveIdleMinutes;
  invertTabOrderCheckbox.checked = settings.invertTabOrder !== undefined ? settings.invertTabOrder : true; // Default true
  enableSpotlightCheckbox.checked = settings.enableSpotlight !== undefined ? settings.enableSpotlight : true; // Default true
  if (debugLoggingEnabledCheckbox) {
    debugLoggingEnabledCheckbox.checked = settings.debugLoggingEnabled !== undefined ? settings.debugLoggingEnabled : false; // Default false
  }

  // Restore color overrides
  const colorOverrides = settings.colorOverrides || {};
  const colorNames = ['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan'];
  colorNames.forEach(colorName => {
    const colorPicker = document.getElementById(`color${colorName.charAt(0).toUpperCase() + colorName.slice(1)}`);
    if (colorPicker) {
      colorPicker.value = colorOverrides[colorName] || DEFAULT_COLORS[colorName];
    }
  });

  // Apply color overrides on load
  applyColorOverrides(colorOverrides);
}

// Function to populate the spaces dropdown
async function populateSpacesDropdown(selectedSpaceName) {
  const defaultSpaceNameSelect = document.getElementById('defaultSpaceName');

  try {
    // Get space names using the LocalStorage utility function
    const spaceNames = await LocalStorage.getSpaceNames();

    // Clear existing options
    defaultSpaceNameSelect.innerHTML = '';

    // Add space options
    spaceNames.forEach(spaceName => {
      const option = document.createElement('option');
      option.value = spaceName;
      option.textContent = spaceName;
      defaultSpaceNameSelect.appendChild(option);
    });

    // Only add default "Home" option if no spaces were found
    if (spaceNames.length === 0) {
      const defaultOption = document.createElement('option');
      defaultOption.value = 'Home';
      defaultOption.textContent = 'Home';
      defaultSpaceNameSelect.appendChild(defaultOption);
    }

    // Set the selected value
    defaultSpaceNameSelect.value = selectedSpaceName || 'Home';

  } catch (error) {
    Logger.error('Error loading spaces:', error);
    // Fallback to default option if there's an error
    defaultSpaceNameSelect.innerHTML = '<option value="Home">Home</option>';
    defaultSpaceNameSelect.value = selectedSpaceName || 'Home';
  }
}

// Function to setup advanced options toggle
function setupAdvancedOptions() {
  const toggle = document.getElementById('advancedOptionsToggle');
  const content = document.getElementById('advancedOptionsContent');

  if (toggle && content) {
    toggle.addEventListener('click', () => {
      const isExpanded = content.style.display !== 'none';
      content.style.display = isExpanded ? 'none' : 'block';
      toggle.classList.toggle('expanded', !isExpanded);
    });
  }

  // Setup color reset buttons
  const resetButtons = document.querySelectorAll('.color-reset-btn');
  resetButtons.forEach(button => {
    button.addEventListener('click', () => {
      const colorName = button.dataset.color;
      const colorPicker = document.getElementById(`color${colorName.charAt(0).toUpperCase() + colorName.slice(1)}`);
      if (colorPicker && DEFAULT_COLORS[colorName]) {
        colorPicker.value = DEFAULT_COLORS[colorName];
        // Trigger auto-save after reset
        saveOptions();
      }
    });
  });
}

// Debounce function to avoid excessive saves for color pickers
let saveTimeout;
function debouncedSave() {
  clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => {
    saveOptions();
  }, 500); // Wait 500ms after last change before saving
}

// Function to setup auto-save listeners
function setupAutoSave() {
  // Auto-save for dropdown
  const defaultSpaceNameSelect = document.getElementById('defaultSpaceName');
  if (defaultSpaceNameSelect) {
    defaultSpaceNameSelect.addEventListener('change', saveOptions);
  }

  // Auto-save for checkboxes
  const autoArchiveEnabledCheckbox = document.getElementById('autoArchiveEnabled');
  if (autoArchiveEnabledCheckbox) {
    autoArchiveEnabledCheckbox.addEventListener('change', saveOptions);
  }

  const invertTabOrderCheckbox = document.getElementById('invertTabOrder');
  if (invertTabOrderCheckbox) {
    invertTabOrderCheckbox.addEventListener('change', saveOptions);
  }

  const enableSpotlightCheckbox = document.getElementById('enableSpotlight');
  if (enableSpotlightCheckbox) {
    enableSpotlightCheckbox.addEventListener('change', saveOptions);
  }

  const debugLoggingEnabledCheckbox = document.getElementById('debugLoggingEnabled');
  if (debugLoggingEnabledCheckbox) {
    debugLoggingEnabledCheckbox.addEventListener('change', saveOptions);
  }

  // Auto-save for number input (with debounce)
  const autoArchiveIdleMinutesInput = document.getElementById('autoArchiveIdleMinutes');
  if (autoArchiveIdleMinutesInput) {
    autoArchiveIdleMinutesInput.addEventListener('input', debouncedSave);
  }

  // Auto-save for color pickers (with debounce)
  const colorNames = ['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan'];
  colorNames.forEach(colorName => {
    const colorPicker = document.getElementById(`color${colorName.charAt(0).toUpperCase() + colorName.slice(1)}`);
    if (colorPicker) {
      colorPicker.addEventListener('input', debouncedSave);
    }
  });
}

document.addEventListener('DOMContentLoaded', () => {
  restoreOptions();
  setupAdvancedOptions();
  setupAutoSave();
});