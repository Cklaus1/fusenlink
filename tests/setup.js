// Setup file for Jest tests
const chrome = require('jest-chrome');

// Mock Chrome API
global.chrome = chrome;

// Mock storage with default settings
chrome.storage.sync.get.mockImplementation((keys, callback) => {
  callback({
    maxInvites: 50,
    delayMs: 1500
  });
});

chrome.storage.sync.set.mockImplementation((items, callback) => {
  if (callback) callback();
});

chrome.runtime.sendMessage.mockImplementation((message, callback) => {
  if (message.action === 'getSettings') {
    callback({
      maxInvites: 50,
      delayMs: 1500
    });
  } else if (message.action === 'setSettings') {
    callback({ success: true });
  }
});

// Mock DOM functions when not available
if (typeof window !== 'undefined') {
  window.scrollTo = jest.fn();
  
  // Create dummy DOM elements for testing
  Object.defineProperty(HTMLElement.prototype, 'offsetParent', {
    get: function() {
      return this.parentNode;
    }
  });
}