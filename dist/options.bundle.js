// LinkedIn Bulk Actions - Options Page Script

// Default settings
const DEFAULT_SETTINGS = {
  maxInvites: 50,
  delayMs: 1500
};

// DOM Elements
const form = document.getElementById('settingsForm');
const maxInvitesInput = document.getElementById('maxInvites');
const delayMsInput = document.getElementById('delayMs');
const toast = document.getElementById('toast');

// Load current settings
document.addEventListener('DOMContentLoaded', async () => {
  // Get settings from storage
  chrome.runtime.sendMessage({ action: 'getSettings' }, (settings) => {
    // Set form values
    maxInvitesInput.value = settings.maxInvites;
    delayMsInput.value = settings.delayMs;
  });
});

// Save settings
form.addEventListener('submit', (e) => {
  e.preventDefault();

  // Get values from form
  const maxInvites = parseInt(maxInvitesInput.value, 10);
  const delayMs = parseInt(delayMsInput.value, 10);

  // Validate inputs
  if (isNaN(maxInvites) || maxInvites < 1) {
    maxInvitesInput.value = DEFAULT_SETTINGS.maxInvites;
    return;
  }

  if (isNaN(delayMs) || delayMs < 500) {
    delayMsInput.value = DEFAULT_SETTINGS.delayMs;
    return;
  }

  // Save settings
  const newSettings = { maxInvites, delayMs };
  chrome.runtime.sendMessage({ 
    action: 'setSettings', 
    settings: newSettings 
  }, () => {
    // Show toast notification
    showToast();
  });
});

// Show toast notification for 3 seconds
function showToast() {
  toast.classList.add('show');
  setTimeout(() => {
    toast.classList.remove('show');
  }, 3000);
}