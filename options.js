import { getSettings } from './utils.js'; 

// Function to save options to chrome.storage
async function saveOptions() {
  const defaultSpaceName = document.getElementById('defaultSpaceName').value;
  const autoArchiveEnabledCheckbox = document.getElementById('autoArchiveEnabled'); // Assume IDs exist
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
        // ...
    } catch (error) {
        console.error('Error saving settings:', error);
    }

//   chrome.storage.local.set({
//     defaultSpaceName: defaultSpaceName || 'Home', // Default to 'Home' if empty
//     autoArchiveEnabled: autoArchiveEnabledCheckbox.checked,
//     autoArchiveIdleMinutes: parseInt(autoArchiveIdleMinutesInput.value, 10) || 30
//   }, () => {
//     // Update status to let user know options were saved.
//     const status = document.getElementById('status');
//     status.textContent = 'Options saved.';
//     setTimeout(() => {
//       status.textContent = '';
//     }, 1500);
//   });
}

// Function to restore options from chrome.storage
async function restoreOptions() {

    const settings = await getSettings(); // Assuming getSettings is available or imported

    const defaultSpaceName = document.getElementById('defaultSpaceName');
    const autoArchiveEnabledCheckbox = document.getElementById('autoArchiveEnabled'); // Assume IDs exist
    const autoArchiveIdleMinutesInput = document.getElementById('autoArchiveIdleMinutes');
    defaultSpaceName.value = settings.defaultSpaceName;
    autoArchiveEnabledCheckbox.checked = settings.autoArchiveEnabled;
    autoArchiveIdleMinutesInput.value = settings.autoArchiveIdleMinutes;
}

document.addEventListener('DOMContentLoaded', restoreOptions);
document.getElementById('save').addEventListener('click', saveOptions);