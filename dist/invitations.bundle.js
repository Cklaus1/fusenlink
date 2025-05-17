/**
 * LinkedIn Bulk Actions - Invitations Content Script
 * Bundled version without ES modules
 */

// Global state and settings
let stopRequested = false;
let startTime = 0;
let processedCount = 0;
let totalCount = 0;
let skippedCount = 0;
let overlayElement = null;
let statusElement = null;
let progressElement = null;
let stopButton = null;
let stopCallback = null;
let isVisible = false;

// Settings function
async function getSettings() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ action: 'getSettings' }, (response) => {
      resolve(response);
    });
  });
}

/**
 * Create and show the overlay UI
 * @param {string} label - The action label to display
 */
function showOverlay(label) {
  if (overlayElement) {
    removeOverlay();
  }
  
  // Create overlay container
  overlayElement = document.createElement('div');
  overlayElement.id = 'li-bulk-overlay';
  overlayElement.setAttribute('role', 'status');
  overlayElement.setAttribute('aria-live', 'polite');
  
  // Apply styles
  Object.assign(overlayElement.style, {
    position: 'fixed',
    bottom: '20px',
    right: '20px',
    backgroundColor: 'white',
    borderRadius: '8px',
    boxShadow: '0 2px 10px rgba(0, 0, 0, 0.1)',
    padding: '16px',
    zIndex: '9999',
    fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    display: 'flex',
    flexDirection: 'column',
    minWidth: '250px',
    border: '1px solid #e0e0e0'
  });

  // Create header with label
  const headerElement = document.createElement('div');
  Object.assign(headerElement.style, {
    fontWeight: 'bold',
    marginBottom: '8px',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center'
  });
  
  // Add LinkedIn branded label
  const labelSpan = document.createElement('span');
  labelSpan.textContent = label;
  Object.assign(labelSpan.style, {
    color: '#0a66c2'
  });
  headerElement.appendChild(labelSpan);
  
  // Add progress text
  progressElement = document.createElement('div');
  progressElement.textContent = 'Initializing...';
  Object.assign(progressElement.style, {
    margin: '8px 0',
    fontSize: '14px'
  });
  
  // Add status message area
  statusElement = document.createElement('div');
  statusElement.textContent = 'Starting...';
  Object.assign(statusElement.style, {
    fontSize: '12px',
    color: '#666',
    marginBottom: '12px'
  });
  
  // Add stop button
  stopButton = document.createElement('button');
  stopButton.textContent = 'Stop';
  stopButton.setAttribute('aria-label', 'Stop current action');
  Object.assign(stopButton.style, {
    backgroundColor: '#d11124',
    color: 'white',
    border: 'none',
    borderRadius: '4px',
    padding: '6px 12px',
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: 'bold',
    alignSelf: 'flex-end'
  });
  
  // Add event listener
  stopButton.addEventListener('click', () => {
    if (typeof stopCallback === 'function') {
      stopCallback();
      updateStatus('Stopping...');
      stopButton.disabled = true;
      stopButton.textContent = 'Stopping...';
      Object.assign(stopButton.style, {
        backgroundColor: '#999',
        cursor: 'default'
      });
    }
  });
  
  // Assemble overlay
  overlayElement.appendChild(headerElement);
  overlayElement.appendChild(progressElement);
  overlayElement.appendChild(statusElement);
  overlayElement.appendChild(stopButton);
  
  // Add to page
  document.body.appendChild(overlayElement);
  isVisible = true;
}

/**
 * Update the progress display
 * @param {number} processed - Number of items processed
 * @param {number} total - Total number of items
 * @param {number} [elapsedSeconds] - Optional elapsed seconds
 */
function updateProgress(processed, total, elapsedSeconds) {
  if (!progressElement) return;
  
  let text = `Processed: ${processed}`;
  if (total > 0) {
    text += ` / ${total}`;
  }
  
  if (elapsedSeconds !== undefined) {
    text += ` • ${elapsedSeconds.toFixed(1)}s elapsed`;
  }
  
  progressElement.textContent = text;
}

/**
 * Update the status message
 * @param {string} message - Status message to display
 */
function updateStatus(message) {
  if (!statusElement) return;
  statusElement.textContent = message;
}

/**
 * Show a summary message and disable stop button
 * @param {string} text - Summary text to display
 */
function showSummary(text) {
  if (!overlayElement) return;
  
  if (progressElement) {
    progressElement.textContent = text;
  }
  
  if (statusElement) {
    statusElement.textContent = 'Completed';
  }
  
  if (stopButton) {
    stopButton.disabled = true;
    stopButton.textContent = 'Done';
    Object.assign(stopButton.style, {
      backgroundColor: '#0a66c2',
      cursor: 'default'
    });
    
    // Auto-hide after 5 seconds
    setTimeout(() => {
      hideOverlay();
    }, 5000);
  }
}

/**
 * Hide and remove the overlay
 */
function hideOverlay() {
  if (overlayElement && overlayElement.parentNode) {
    overlayElement.parentNode.removeChild(overlayElement);
    overlayElement = null;
    statusElement = null;
    progressElement = null;
    stopButton = null;
    isVisible = false;
  }
}

/**
 * Function to remove the overlay (for compatibility with old API)
 */
function removeOverlay() {
  hideOverlay();
}

/**
 * Register a callback for when the stop button is clicked
 * @param {Function} callback - Function to call when stop is clicked
 */
function onStop(callback) {
  stopCallback = callback;
}

/**
 * Check if the overlay is currently visible
 * @returns {boolean} True if visible
 */
function isOverlayVisible() {
  return isVisible;
}

/**
 * LinkedIn Bulk Actions - Invitations Content Script
 * Handles bulk accepting/denying invitations on invitation manager page
 */

// Run the initialization function
console.log('LinkedIn Bulk Actions: Content script loaded');

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  console.log('LinkedIn Bulk Actions: DOMContentLoaded event fired');
  setTimeout(initializeButtons, 500);
});

// Also try initializing when window loads
window.addEventListener('load', () => {
  console.log('LinkedIn Bulk Actions: Window load event fired');
  setTimeout(initializeButtons, 1000);
});

// Run the initialization now in case the page is already loaded
if (document.readyState === 'complete' || document.readyState === 'interactive') {
  console.log('LinkedIn Bulk Actions: Document already ready, initializing immediately');
  setTimeout(initializeButtons, 500);
}

/**
 * Initialize the UI by injecting action buttons
 */
function initializeButtons() {
  console.log('LinkedIn Bulk Actions: Checking if on invitation manager page...');
  console.log('Current URL:', window.location.href);
  
  // Only run on invitation manager page
  if (!window.location.href.includes('/mynetwork/invitation-manager/')) {
    console.log('LinkedIn Bulk Actions: Not on invitation manager page, exiting.');
    return;
  }
  
  console.log('LinkedIn Bulk Actions: On invitation manager page, initializing buttons.');

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
  const acceptAllButton = createActionButton('Accept All', acceptAll);
  
  // Create Deny All button
  const denyAllButton = createActionButton('Deny All', denyAll);
  
  // Add buttons to container
  buttonContainer.appendChild(acceptAllButton);
  buttonContainer.appendChild(denyAllButton);
  
  // Add button container before main content
  const headerSection = document.querySelector('header') || 
                       document.querySelector('.scaffold-layout__header') ||
                       document.querySelector('main');
  
  console.log('LinkedIn Bulk Actions: Header elements found:', headerSection ? 'Yes' : 'No');
                       
  if (headerSection && headerSection.parentNode) {
    console.log('LinkedIn Bulk Actions: Inserting buttons before header');
    headerSection.parentNode.insertBefore(buttonContainer, headerSection);
  } else {
    // Fallback to start of body if header not found
    console.log('LinkedIn Bulk Actions: Header not found, inserting at beginning of body');
    document.body.insertBefore(buttonContainer, document.body.firstChild);
  }
  
  console.log('LinkedIn Bulk Actions: Buttons initialized successfully');
}

/**
 * Create a button with styling and event listener
 * @param {string} text - Button text
 * @param {Function} clickHandler - Click event handler
 * @returns {HTMLButtonElement} The created button
 */
function createActionButton(text, clickHandler) {
  const button = document.createElement('button');
  button.textContent = text;
  button.className = 'li-bulk-action-button';
  
  // Apply LinkedIn-like styling
  Object.assign(button.style, {
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
  
  // Hover effect
  button.addEventListener('mouseover', () => {
    button.style.backgroundColor = '#084d93';
  });
  
  button.addEventListener('mouseout', () => {
    button.style.backgroundColor = '#0a66c2';
  });
  
  // Add click handler
  button.addEventListener('click', clickHandler);
  
  return button;
}

/**
 * Accept all pending invitations
 */
async function acceptAll() {
  processInvites('Accepting Invitations', 'Accept');
}

/**
 * Deny/ignore all pending invitations
 */
async function denyAll() {
  processInvites('Denying Invitations', 'Ignore');
}

/**
 * Process invitations with the specified action
 * @param {string} actionLabel - Label for the overlay
 * @param {string} buttonText - Text content to look for in the action buttons
 */
async function processInvites(actionLabel, buttonText) {
  // Don't start multiple processes
  if (document.getElementById('li-bulk-overlay')) {
    return;
  }

  // Initialize state
  stopRequested = false;
  processedCount = 0;
  skippedCount = 0;
  totalCount = 0;
  startTime = Date.now();

  // Show overlay UI
  showOverlay(actionLabel);
  updateStatus('Starting...');

  // Register stop handler
  onStop(() => {
    stopRequested = true;
    updateStatus('Stopping at next opportunity...');
  });

  try {
    // Get settings for delays
    const settings = await getSettings();
    const delayMs = settings.delayMs;

    // Continue processing until stopped or no more invitations
    while (!stopRequested) {
      // Check for security challenges or rate limits before proceeding
      const securityPaused = await checkForSecurityChallenge();
      if (securityPaused && stopRequested) {
        break; // User requested stop during security pause
      }

      // Find all visible action buttons matching the text
      const actionButtons = findActionButtons(buttonText);

      // Update count of total items (best estimate)
      if (totalCount === 0) {
        totalCount = countInvitationCards();
        updateProgress(processedCount, totalCount, getElapsedSeconds());
      }

      // Process each button
      for (let i = 0; i < actionButtons.length; i++) {
        if (stopRequested) break;

        const button = actionButtons[i];

        try {
          // Click the action button
          button.click();
          processedCount++;

          // Update progress
          updateProgress(processedCount, totalCount, getElapsedSeconds());
          updateStatus(`Processing invitation ${processedCount}`);

          // Check for and handle any confirmation modal
          await dismissConfirmationModal();

          // Wait between actions to avoid rate limiting
          await delay(delayMs / 3); // Use shorter delay for smooth UX

          // Periodically check for security challenges (every 5 actions)
          if (processedCount % 5 === 0) {
            const securityPaused = await checkForSecurityChallenge();
            if (securityPaused && stopRequested) {
              break; // User requested stop during security pause
            }
          }
        } catch (err) {
          console.error('Error processing invitation:', err);
          skippedCount++;
          updateStatus(`Skipped invitation (${skippedCount} total skipped)`);
        }
      }

      // If no buttons found, check if we need to scroll to load more
      if (actionButtons.length === 0) {
        // Scroll to bottom to load more invitations
        window.scrollTo(0, document.body.scrollHeight);

        // Wait for new content to load
        updateStatus('Loading more invitations...');
        const foundMoreInvitations = await waitForNewInvitations();

        // If no new invitations loaded after scrolling, we're done
        if (!foundMoreInvitations) {
          break;
        }
      }
    }
    
    // Show summary
    const action = buttonText === 'Accept' ? 'Accepted' : 'Denied';
    let summaryText = '';
    
    if (stopRequested) {
      summaryText = `Cancelled – ${processedCount} invitations ${action.toLowerCase()}`;
    } else {
      summaryText = `${action} ${processedCount} invitations`;
      if (skippedCount > 0) {
        summaryText += ` (${skippedCount} skipped)`;
      }
    }
    
    showSummary(summaryText);
  } catch (err) {
    console.error('Bulk action error:', err);
    updateStatus(`Error: ${err.message}`);
  }
}

/**
 * Find all action buttons with the specified text
 * @param {string} buttonText - The text content to search for
 * @returns {HTMLElement[]} Array of matching button elements
 */
function findActionButtons(buttonText) {
  // Try different selectors to find buttons
  // First try using data attributes that LinkedIn might have
  let buttons = Array.from(document.querySelectorAll(`button[data-test-id*="${buttonText.toLowerCase()}"]`));
  
  // Fall back to text content if no buttons found
  if (buttons.length === 0) {
    // Get all buttons
    const allButtons = Array.from(document.querySelectorAll('button'));
    
    // Filter to those containing the text
    buttons = allButtons.filter(button => {
      const text = button.textContent.trim();
      return text === buttonText || text === buttonText + ' invitation';
    });
  }
  
  return buttons;
}

/**
 * Count the number of invitation cards in the current view
 * @returns {number} The number of invitation cards found
 */
function countInvitationCards() {
  // Try different selectors for invitation cards
  const cards = document.querySelectorAll('.invitation-card') || 
                document.querySelectorAll('.artdeco-list__item') ||
                document.querySelectorAll('li.artdeco-list');
  
  return cards.length;
}

/**
 * Checks for and dismisses any confirmation modal that appears
 */
async function dismissConfirmationModal() {
  // Wait briefly for modal to appear
  await delay(200);
  
  // Look for dismiss buttons in modals
  const dismissButtons = document.querySelectorAll('button[aria-label="Dismiss"]');
  const closeButtons = document.querySelectorAll('button[aria-label="Close"]');
  
  // Try to click dismiss if found
  if (dismissButtons.length > 0) {
    dismissButtons[0].click();
    await delay(100);
  } else if (closeButtons.length > 0) {
    closeButtons[0].click();
    await delay(100);
  }
}

/**
 * Waits to see if new invitation cards load after scrolling
 * @returns {Promise<boolean>} True if new cards appeared, false otherwise
 */
async function waitForNewInvitations() {
  const countBefore = countInvitationCards();
  
  // Wait for content to potentially load
  let attempts = 0;
  const maxAttempts = 4; // Try for up to 4 * 200ms = 800ms
  
  while (attempts < maxAttempts) {
    await delay(200);
    const currentCount = countInvitationCards();
    
    if (currentCount > countBefore) {
      return true; // New invitations loaded
    }
    
    attempts++;
  }
  
  return false; // No new invitations found after waiting
}

/**
 * Create a promise that resolves after a delay
 * @param {number} ms - Milliseconds to delay
 * @returns {Promise<void>} Promise that resolves after the delay
 */
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Get the elapsed seconds since the operation started
 * @returns {number} Elapsed seconds
 */
function getElapsedSeconds() {
  return (Date.now() - startTime) / 1000;
}

/**
 * Check for security challenges or rate limiting
 * @returns {Promise<boolean>} True if a security challenge was detected and handled
 */
async function checkForSecurityChallenge() {
  // Check for CAPTCHA challenge iframe
  const captchaFrame = document.querySelector('iframe[src*="challenge"]');

  // Check for rate limit or security messages
  const securityMessages = [
    'security check',
    'please verify',
    'confirm you're not a robot',
    'check your network',
    'unusual amount of activity',
    'too many requests',
    'rate limit',
    'try again later'
  ];

  // Find text nodes containing security messages
  const textElements = document.querySelectorAll('p, h1, h2, h3, div, span');
  let securityMessageElement = null;

  for (const element of textElements) {
    const text = element.textContent.toLowerCase();
    if (securityMessages.some(msg => text.includes(msg))) {
      securityMessageElement = element;
      break;
    }
  }

  // If challenge detected, pause and wait for user to resolve
  if (captchaFrame || securityMessageElement) {
    updateStatus('Paused – resolve security challenge to continue');
    updateProgress(processedCount, totalCount, getElapsedSeconds());

    // Wait until the challenge is gone
    let challengeResolved = false;
    let checkAttempts = 0;
    const maxWaitTime = 5 * 60 * 1000; // 5 minutes max wait
    const checkInterval = 1000; // Check every second
    const maxAttempts = maxWaitTime / checkInterval;

    while (!challengeResolved && !stopRequested && checkAttempts < maxAttempts) {
      await delay(checkInterval);
      checkAttempts++;

      // Re-check for the challenge elements
      const stillHasCaptcha = document.querySelector('iframe[src*="challenge"]');

      let stillHasMessage = false;
      if (securityMessageElement && document.body.contains(securityMessageElement)) {
        stillHasMessage = securityMessages.some(msg =>
          securityMessageElement.textContent.toLowerCase().includes(msg)
        );
      }

      // Check if challenge is resolved
      if (!stillHasCaptcha && !stillHasMessage) {
        challengeResolved = true;
      }

      // Update status with waiting time
      if (!challengeResolved && checkAttempts % 5 === 0) {
        const waitTime = Math.floor(checkAttempts / 60);
        updateStatus(`Waiting for security challenge to be resolved (${waitTime}m)`);
      }
    }

    // Resume if resolved, otherwise end if timed out or stopped
    if (challengeResolved) {
      updateStatus('Security challenge resolved, resuming...');
      await delay(1000); // Brief pause before resuming
      return true;
    } else if (stopRequested) {
      return true;
    } else {
      updateStatus('Timed out waiting for security challenge resolution');
      stopRequested = true;
      return true;
    }
  }

  return false;
}