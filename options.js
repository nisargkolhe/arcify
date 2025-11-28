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

// Function to save options to chrome.storage
async function saveOptions() {
  const defaultSpaceNameSelect = document.getElementById('defaultSpaceName');
  const defaultSpaceName = defaultSpaceNameSelect.value;
  const autoArchiveEnabledCheckbox = document.getElementById('autoArchiveEnabled');
  const autoArchiveIdleMinutesInput = document.getElementById('autoArchiveIdleMinutes');

  const settings = {
    defaultSpaceName: defaultSpaceName || 'Home', // Default to 'Home' if empty
    autoArchiveEnabled: autoArchiveEnabledCheckbox.checked,
    autoArchiveIdleMinutes: parseInt(autoArchiveIdleMinutesInput.value, 10) || 360,
  };

  try {
    await chrome.storage.sync.set(settings);
    console.log('Settings saved:', settings);

    // Notify background script to update the alarm immediately
    await chrome.runtime.sendMessage({ action: 'updateAutoArchiveSettings' });

    // Show status message to user
    const status = document.getElementById('status');
    console.log('Status:', status);
    status.textContent = 'Options saved.';
    setTimeout(() => {
      status.textContent = '';
    }, 2000);
  } catch (error) {
    console.error('Error saving settings:', error);
  }
}

// Function to restore options from chrome.storage
async function restoreOptions() {
  const settings = await Utils.getSettings();
  const autoArchiveEnabledCheckbox = document.getElementById('autoArchiveEnabled');
  const autoArchiveIdleMinutesInput = document.getElementById('autoArchiveIdleMinutes');

  // Populate spaces dropdown
  await populateSpacesDropdown(settings.defaultSpaceName);

  autoArchiveEnabledCheckbox.checked = settings.autoArchiveEnabled;
  autoArchiveIdleMinutesInput.value = settings.autoArchiveIdleMinutes;
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
    console.error('Error loading spaces:', error);
    // Fallback to default option if there's an error
    defaultSpaceNameSelect.innerHTML = '<option value="Home">Home</option>';
    defaultSpaceNameSelect.value = selectedSpaceName || 'Home';
  }
}

document.addEventListener('DOMContentLoaded', restoreOptions);
document.getElementById('save').addEventListener('click', saveOptions);