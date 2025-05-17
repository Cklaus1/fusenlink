// This is a debug utility to test content script injection on LinkedIn
// Add this to your manifest.json temporarily for debugging:
// "content_scripts": [
//   {
//     "matches": ["*://*.linkedin.com/*"],
//     "js": ["debug-injector.js"]
//   },
//   ...other content scripts...
// ]

console.log("Debug Injector: Script loaded on", window.location.href);

// Create a visual indicator that the extension is running
const debugBadge = document.createElement('div');
debugBadge.textContent = 'LinkedIn Extension Debug Active';
Object.assign(debugBadge.style, {
  position: 'fixed',
  top: '10px',
  right: '10px',
  backgroundColor: 'red',
  color: 'white',
  padding: '5px 10px',
  borderRadius: '5px',
  zIndex: '9999999',
  fontWeight: 'bold',
  fontSize: '12px'
});

// Add the badge to the page
document.body.appendChild(debugBadge);

// Track URL changes (LinkedIn is a SPA)
let lastUrl = window.location.href;
const observer = new MutationObserver(() => {
  if (lastUrl !== window.location.href) {
    lastUrl = window.location.href;
    console.log("Debug Injector: URL changed to", lastUrl);

    if (lastUrl.includes('/mynetwork/invitation-manager/')) {
      console.log("Debug Injector: On invitation manager page!");
      debugBadge.textContent = 'On Invitation Manager!';
      debugBadge.style.backgroundColor = 'green';

      // Try to manually inject the buttons
      setTimeout(() => {
        console.log("Debug Injector: Trying to inject buttons directly...");
        try {
          injectInvitationButtons();
        } catch (err) {
          console.error("Debug Injector: Error injecting buttons:", err);
        }
      }, 1500);
    }
  }
});

// Function to inject invitation buttons directly
function injectInvitationButtons() {
  // Create container for buttons
  const buttonContainer = document.createElement('div');
  buttonContainer.className = 'li-bulk-action-buttons';
  Object.assign(buttonContainer.style, {
    display: 'flex',
    gap: '12px',
    margin: '16px 0',
    padding: '0 16px'
  });

  // Create Accept All button
  const acceptAllButton = document.createElement('button');
  acceptAllButton.textContent = 'Debug: Accept All';
  acceptAllButton.className = 'li-bulk-action-button';

  // Apply LinkedIn-like styling
  Object.assign(acceptAllButton.style, {
    backgroundColor: '#0a66c2',
    color: 'white',
    border: 'none',
    borderRadius: '24px',
    padding: '8px 16px',
    fontWeight: 'bold',
    fontSize: '14px',
    cursor: 'pointer',
    transition: 'background-color 0.2s'
  });

  // Create Deny All button
  const denyAllButton = document.createElement('button');
  denyAllButton.textContent = 'Debug: Deny All';
  denyAllButton.className = 'li-bulk-action-button';

  // Apply LinkedIn-like styling
  Object.assign(denyAllButton.style, {
    backgroundColor: '#0a66c2',
    color: 'white',
    border: 'none',
    borderRadius: '24px',
    padding: '8px 16px',
    fontWeight: 'bold',
    fontSize: '14px',
    cursor: 'pointer',
    transition: 'background-color 0.2s'
  });

  // Add buttons to container
  buttonContainer.appendChild(acceptAllButton);
  buttonContainer.appendChild(denyAllButton);

  // Add button container before main content
  const headerSection = document.querySelector('header') ||
                      document.querySelector('.scaffold-layout__header') ||
                      document.querySelector('main');

  console.log("Debug Injector: Header elements found:", headerSection ? 'Yes' : 'No');

  if (headerSection && headerSection.parentNode) {
    console.log("Debug Injector: Inserting buttons before header");
    headerSection.parentNode.insertBefore(buttonContainer, headerSection);
  } else {
    // Fallback to start of body if header not found
    console.log("Debug Injector: Header not found, inserting at beginning of body");
    document.body.insertBefore(buttonContainer, document.body.firstChild);
  }

  console.log("Debug Injector: Debug buttons injected successfully");
}

// Start observing URL changes
observer.observe(document, {subtree: true, childList: true});

// Check if we're on the invitation manager now
if (window.location.href.includes('/mynetwork/invitation-manager/')) {
  console.log("Debug Injector: Already on invitation manager page!");
  debugBadge.textContent = 'On Invitation Manager!';
  debugBadge.style.backgroundColor = 'green';

  // Wait for page to be fully loaded, then inject buttons
  setTimeout(() => {
    console.log("Debug Injector: Trying to inject buttons directly...");
    try {
      injectInvitationButtons();
    } catch (err) {
      console.error("Debug Injector: Error injecting buttons:", err);
    }
  }, 1500);
}