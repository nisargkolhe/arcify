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

// Function to save options to chrome.storage
async function saveOptions() {
  const defaultSpaceName = document.getElementById('defaultSpaceName').value;
  const autoArchiveEnabledCheckbox = document.getElementById('autoArchiveEnabled');
  const autoArchiveIdleMinutesInput = document.getElementById('autoArchiveIdleMinutes');
//   const saveButton = document.getElementById('saveSettingsBtn'); // Or however settings are saved

  const settings = {
    defaultSpaceName: defaultSpaceName || 'Home', // Default to 'Home' if empty
    autoArchiveEnabled: autoArchiveEnabledCheckbox.checked,
    autoArchiveIdleMinutes: parseInt(autoArchiveIdleMinutesInput.value, 10) || 30,
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

    const defaultSpaceName = document.getElementById('defaultSpaceName');
    const autoArchiveEnabledCheckbox = document.getElementById('autoArchiveEnabled'); 
    const autoArchiveIdleMinutesInput = document.getElementById('autoArchiveIdleMinutes');
    defaultSpaceName.value = settings.defaultSpaceName;
    autoArchiveEnabledCheckbox.checked = settings.autoArchiveEnabled;
    autoArchiveIdleMinutesInput.value = settings.autoArchiveIdleMinutes;
}

document.addEventListener('DOMContentLoaded', restoreOptions);
document.getElementById('save').addEventListener('click', saveOptions);