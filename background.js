// LinkedIn Bulk Actions - Background Service Worker

// Default settings
const DEFAULT_SETTINGS = {
  maxInvites: 50,
  delayMs: 1500
};

// Initialize default settings on installation
chrome.runtime.onInstalled.addListener(async () => {
  // Set default settings
  await chrome.storage.sync.set(DEFAULT_SETTINGS);
});

// Handle messages from content scripts and options page
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Handle getSettings request
  if (message.action === 'getSettings') {
    chrome.storage.sync.get(['maxInvites', 'delayMs'], (result) => {
      sendResponse({
        maxInvites: result.maxInvites || DEFAULT_SETTINGS.maxInvites,
        delayMs: result.delayMs || DEFAULT_SETTINGS.delayMs
      });
    });
    return true; // Keep the message channel open for async response
  }

  // Handle setSettings request
  if (message.action === 'setSettings' && message.settings) {
    chrome.storage.sync.set(message.settings, () => {
      sendResponse({ success: true });
    });
    return true; // Keep the message channel open for async response
  }
});