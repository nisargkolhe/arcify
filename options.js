// Function to save options to chrome.storage
function saveOptions() {
  const defaultSpaceName = document.getElementById('defaultSpaceName').value;
  chrome.storage.local.set({
    defaultSpaceName: defaultSpaceName || 'Home' // Default to 'Home' if empty
  }, () => {
    // Update status to let user know options were saved.
    const status = document.getElementById('status');
    status.textContent = 'Options saved.';
    setTimeout(() => {
      status.textContent = '';
    }, 1500);
  });
}

// Function to restore options from chrome.storage
function restoreOptions() {
  // Use default value defaultSpaceName = 'Home'
  chrome.storage.local.get({
    defaultSpaceName: 'Home'
  }, (items) => {
    document.getElementById('defaultSpaceName').value = items.defaultSpaceName;
  });
}

document.addEventListener('DOMContentLoaded', restoreOptions);
document.getElementById('save').addEventListener('click', saveOptions);