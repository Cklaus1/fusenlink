// LinkedIn Bulk Actions - Combined Content Script
// Handles accepting/denying invitations, search connect requests, and button injection

// LinkedIn Bulk Actions content script loaded

// Global state
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
    try {
      chrome.runtime.sendMessage({ action: 'getSettings' }, (response) => {
        if (chrome.runtime.lastError) {
          resolve({ maxInvites: 50, delayMs: 1500 });
          return;
        }
        
        if (response) {
          resolve(response);
        } else {
          // Default settings if background doesn't respond
          resolve({ maxInvites: 50, delayMs: 1500 });
        }
      });
    } catch (error) {
      resolve({ maxInvites: 50, delayMs: 1500 });
    }
  });
}

// Function to inject buttons
function addButtons() {
  // Only run on invitation manager page - check for various URL patterns
  const url = window.location.href;
  const pathname = window.location.pathname;
  
  // Check if we're on any invitation manager page
  const isInvitationManager = url.includes('/mynetwork/invitation-manager/') || 
                              pathname.includes('/mynetwork/invitation-manager/');
  
  if (!isInvitationManager) {
    return;
  }

  // Exit if buttons already exist
  if (document.querySelector('.li-bulk-action-buttons')) {
    return;
  }

  // Create container for buttons - positioned at bottom left
  const buttonContainer = document.createElement('div');
  buttonContainer.className = 'li-bulk-action-buttons';
  buttonContainer.style.position = 'fixed';
  buttonContainer.style.bottom = '20px';
  buttonContainer.style.left = '20px';
  buttonContainer.style.display = 'flex';
  buttonContainer.style.gap = '12px';
  buttonContainer.style.zIndex = '9999';
  buttonContainer.style.padding = '12px';
  buttonContainer.style.backgroundColor = 'white';
  buttonContainer.style.borderRadius = '8px';
  buttonContainer.style.boxShadow = '0 2px 10px rgba(0, 0, 0, 0.15)';
  buttonContainer.style.border = '1px solid #e0e0e0';

  // Create Accept All button
  const acceptAllButton = document.createElement('button');
  acceptAllButton.textContent = 'Accept All';
  acceptAllButton.className = 'li-bulk-action-button';
  
  // Apply LinkedIn-like styling
  acceptAllButton.style.backgroundColor = '#0a66c2';
  acceptAllButton.style.color = 'white';
  acceptAllButton.style.border = 'none';
  acceptAllButton.style.borderRadius = '24px';
  acceptAllButton.style.padding = '8px 16px';
  acceptAllButton.style.fontWeight = 'bold';
  acceptAllButton.style.fontSize = '14px';
  acceptAllButton.style.cursor = 'pointer';
  acceptAllButton.style.transition = 'background-color 0.2s';
  
  // Hover effect
  acceptAllButton.addEventListener('mouseover', () => {
    acceptAllButton.style.backgroundColor = '#084d93';
  });
  
  acceptAllButton.addEventListener('mouseout', () => {
    acceptAllButton.style.backgroundColor = '#0a66c2';
  });
  
  // Create Deny All button
  const denyAllButton = document.createElement('button');
  denyAllButton.textContent = 'Deny All';
  denyAllButton.className = 'li-bulk-action-button';
  
  // Apply LinkedIn-like styling
  denyAllButton.style.backgroundColor = '#0a66c2';
  denyAllButton.style.color = 'white';
  denyAllButton.style.border = 'none';
  denyAllButton.style.borderRadius = '24px';
  denyAllButton.style.padding = '8px 16px';
  denyAllButton.style.fontWeight = 'bold';
  denyAllButton.style.fontSize = '14px';
  denyAllButton.style.cursor = 'pointer';
  denyAllButton.style.transition = 'background-color 0.2s';
  
  // Hover effect
  denyAllButton.addEventListener('mouseover', () => {
    denyAllButton.style.backgroundColor = '#084d93';
  });
  
  denyAllButton.addEventListener('mouseout', () => {
    denyAllButton.style.backgroundColor = '#0a66c2';
  });
  
  // Add buttons to container
  buttonContainer.appendChild(acceptAllButton);
  buttonContainer.appendChild(denyAllButton);
  
  // Add floating button container to page
  document.body.appendChild(buttonContainer);

  // Add click handlers
  acceptAllButton.addEventListener('click', () => {
    acceptAll();
  });
  
  denyAllButton.addEventListener('click', () => {
    denyAll();
  });
}

/**
 * Create and show the overlay UI
 * @param {string} label - The action label to display
 */
function showOverlay(label) {
  if (overlayElement) {
    hideOverlay();
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
 * Register a callback for when the stop button is clicked
 * @param {Function} callback - Function to call when stop is clicked
 */
function onStop(callback) {
  stopCallback = callback;
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
      // TEMPORARILY DISABLED: Check for security challenges or rate limits before proceeding
      // const securityPaused = await checkForSecurityChallenge();
      // if (securityPaused && stopRequested) {
      //   break; // User requested stop during security pause
      // }

      // Brief wait to ensure page is fully loaded
      await delay(100);

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

          // TEMPORARILY DISABLED: Periodically check for security challenges (every 5 actions)
          // if (processedCount % 5 === 0) {
          //   const securityPaused = await checkForSecurityChallenge();
          //   if (securityPaused && stopRequested) {
          //     break; // User requested stop during security pause
          //   }
          // }
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
  // Primary method: Use the data-view-name attribute which is most reliable
  let buttons = Array.from(document.querySelectorAll('button[data-view-name="invitation-action"]'));
  
  if (buttons.length > 0) {
    // Filter buttons by their text content (nested in spans)
    buttons = buttons.filter(button => {
      const text = button.textContent.trim();
      return text === buttonText;
    });
    
    if (buttons.length > 0) {
      return buttons;
    }
  }
  
  // Fallback method: Use aria-label patterns
  const labelPatterns = {
    'Accept': ['aria-label*="Accept"', 'aria-label*="invitation"'],
    'Ignore': ['aria-label*="Ignore"', 'aria-label*="invitation"']
  };
  
  if (labelPatterns[buttonText]) {
    // Try aria-label patterns
    const ariaButtons = Array.from(document.querySelectorAll('button'))
      .filter(button => {
        const ariaLabel = button.getAttribute('aria-label') || '';
        const lowerLabel = ariaLabel.toLowerCase();
        return lowerLabel.includes(buttonText.toLowerCase()) && 
               lowerLabel.includes('invitation');
      });
    
    if (ariaButtons.length > 0) {
      return ariaButtons;
    }
  }
  
  // Final fallback: Text content search
  const allButtons = Array.from(document.querySelectorAll('button'));
  buttons = allButtons.filter(button => {
    const text = button.textContent.trim();
    return text === buttonText;
  });
  
  return buttons;
}

/**
 * Count the number of invitation cards in the current view
 * @returns {number} The number of invitation cards found
 */
function countInvitationCards() {
  // Use the correct LinkedIn selector for invitation containers
  let cards = document.querySelectorAll('[data-view-name="pending-invitation"]');
  
  // Fallback to role-based selector
  if (cards.length === 0) {
    cards = document.querySelectorAll('[role="listitem"][componentkey*="invitation"]');
  }
  
  // Another fallback to common invitation container patterns
  if (cards.length === 0) {
    cards = document.querySelectorAll('.invitation-card, .invitation-card__container, [class*="invitation"]');
  }
  
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
  const maxAttempts = 8; // Try for up to 8 * 300ms = 2.4s (longer wait for network)
  
  while (attempts < maxAttempts) {
    await delay(300);
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

  // Check for rate limit or security messages - but only in modals, alerts, or specific containers
  const securityMessages = [
    'security check',
    'please verify you are not a robot',
    'confirm you are not a robot',
    'unusual amount of activity',
    'too many requests',
    'rate limit exceeded',
    'try again later'
  ];

  // Only check specific containers that would contain security messages, not all page text
  const securityContainers = document.querySelectorAll([
    '[role="dialog"]',           // Modals
    '[role="alert"]',            // Alert messages
    '.artdeco-modal',            // LinkedIn modal class
    '.challenge-page',           // Challenge page container
    '.security-challenge',       // Security challenge container
    '.error-message',            // Error message containers
    '.captcha-container'         // CAPTCHA containers
  ].join(', '));
  
  let securityMessageElement = null;
  let foundMessage = '';

  for (const container of securityContainers) {
    const text = container.textContent.toLowerCase();
    const matchedMessage = securityMessages.find(msg => text.includes(msg));
    if (matchedMessage) {
      securityMessageElement = container;
      foundMessage = matchedMessage;
      break;
    }
  }
  
  // If challenge detected, pause and wait for user to resolve
  if (captchaFrame || securityMessageElement) {
    updateStatus(`Paused – resolve security challenge to continue (${foundMessage || 'CAPTCHA'})`);
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

/**
 * Function to initialize the Connect with All button on search pages
 */
function addSearchButton() {
  // Only run on search results pages
  if (!window.location.href.includes('/search/results/')) {
    return;
  }


  // Exit if button already exists
  if (document.querySelector('.li-bulk-connect-button')) {
    return;
  }

  // Get settings for max invites
  getSettings().then(settings => {
    const maxInvites = settings.maxInvites;

    // Create a wrapper that will persist
    const wrapperElement = document.createElement('div');
    wrapperElement.id = 'li-bulk-connect-wrapper';
    wrapperElement.style.position = 'fixed';
    wrapperElement.style.top = '80px';
    wrapperElement.style.right = '20px';
    wrapperElement.style.zIndex = '1000';
    wrapperElement.style.padding = '8px';
    wrapperElement.style.backgroundColor = 'white';
    wrapperElement.style.boxShadow = '0 2px 5px rgba(0,0,0,0.2)';
    wrapperElement.style.borderRadius = '8px';
    wrapperElement.style.border = '1px solid #e0e0e0';

    // Create the button
    const connectButton = document.createElement('button');
    connectButton.textContent = `Connect All Pages (≤ ${maxInvites})`;
    connectButton.className = 'li-bulk-connect-button';

    // Apply LinkedIn-like styling
    Object.assign(connectButton.style, {
      backgroundColor: '#0a66c2',
      color: 'white',
      border: 'none',
      borderRadius: '24px',
      padding: '8px 16px',
      fontWeight: 'bold',
      fontSize: '14px',
      cursor: 'pointer',
      transition: 'background-color 0.2s',
      whiteSpace: 'nowrap'
    });

    // Hover effect
    connectButton.addEventListener('mouseover', () => {
      connectButton.style.backgroundColor = '#084d93';
    });

    connectButton.addEventListener('mouseout', () => {
      connectButton.style.backgroundColor = '#0a66c2';
    });

    // Add click handler
    connectButton.addEventListener('click', () => {
      sendConnectRequests(maxInvites);
    });

    // Add button to wrapper
    wrapperElement.appendChild(connectButton);

    // Add wrapper to body
    document.body.appendChild(wrapperElement);


    // Add a persistent check that will re-add the button if it gets removed
    const buttonObserver = new MutationObserver(() => {
      if (!document.querySelector('.li-bulk-connect-button')) {

        // If our wrapper was removed, add it again
        if (!document.getElementById('li-bulk-connect-wrapper')) {
          document.body.appendChild(wrapperElement);
        }
      }
    });

    // Start observing for button removal
    buttonObserver.observe(document.body, {
      childList: true,
      subtree: true
    });
  });
}

/**
 * Send connection requests to profiles in search results
 * @param {number} max - Maximum number of requests to send
 */
async function sendConnectRequests(max) {
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
  showOverlay('Sending Connection Requests');
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
    
    // Continue processing until we reach max invites or run out of profiles
    while (!stopRequested && processedCount < max) {
      // Check for security challenges or rate limits before proceeding
      const securityPaused = await checkForSecurityChallenge();
      if (securityPaused && stopRequested) {
        break; // User requested stop during security pause
      }
      
      // Find connect buttons on the page
      const connectButtons = findConnectButtons();
      
      // Update total count (best estimate)
      if (totalCount === 0) {
        totalCount = Math.min(countSearchResults(), max);
        updateProgress(processedCount, totalCount, getElapsedSeconds());
      }
      
      // If no connect buttons found, try scrolling to load more
      if (connectButtons.length === 0) {
        // Scroll to load more results
        window.scrollTo(0, document.body.scrollHeight);
        updateStatus('Loading more results...');
        
        // Wait for new content to load
        const foundMoreResults = await waitForNewResults();
        
        // If no new results loaded, try going to next page
        if (!foundMoreResults) {
          updateStatus('Trying to go to next page...');
          const nextPageClicked = await goToNextPage();
          
          if (nextPageClicked) {
            updateStatus('Moved to next page, continuing...');
            await delay(2000); // Wait for page to load
            continue;
          } else {
            updateStatus('No more pages available');
            break;
          }
        }
        
        // Continue to next iteration to find buttons in newly loaded content
        continue;
      }
      
      // Process each button until we reach max
      for (let i = 0; i < connectButtons.length; i++) {
        if (stopRequested || processedCount >= max) {
          break;
        }
        
        const button = connectButtons[i];

        try {
          // Check if this is a "More" dropdown button that needs to be expanded
          if (button.textContent.trim().toLowerCase().includes('more')) {
            // Click the "More" button to open the dropdown
            button.click();
            await delay(300); // Wait for dropdown to appear

            // Look for "Connect" in the expanded dropdown menu
            const connectOption = findConnectOptionInDropdown();

            if (connectOption) {
              // Click the Connect option in the dropdown
              connectOption.click();
              await delay(300); // Wait for modal to appear

              // Handle the confirmation modal
              const sent = await handleSendInviteModal();

              if (sent) {
                processedCount++;
                updateProgress(processedCount, max, getElapsedSeconds());
                updateStatus(`Sent invitation ${processedCount} of ${max}`);
              } else {
                skippedCount++;
                updateStatus(`Skipped invitation (${skippedCount} total skipped)`);
              }
              
              // Close dropdown if still open
              document.body.click();
            } else {
              // No Connect option found, skip
              skippedCount++;
              updateStatus(`No Connect option in dropdown (${skippedCount} total skipped)`);
              
              // Close dropdown if still open
              document.body.click();
            }
          } else {
            // Regular Connect button
            button.click();
            await delay(300); // Wait for modal to appear

            // Handle the confirmation modal if it appears
            const sent = await handleSendInviteModal();

            if (sent) {
              processedCount++;
              updateProgress(processedCount, max, getElapsedSeconds());
              updateStatus(`Sent invitation ${processedCount} of ${max}`);
            } else {
              skippedCount++;
              updateStatus(`Skipped invitation (${skippedCount} total skipped)`);
            }
          }

          // Check for security challenges periodically
          if (processedCount % 5 === 0) {
            const securityPaused = await checkForSecurityChallenge();
            if (securityPaused && stopRequested) {
              break; // User requested stop during security pause
            }
          }
          
          // Wait between actions to avoid rate limiting
          await delay(delayMs);
        } catch (err) {
          console.error('Error sending invitation:', err);
          skippedCount++;
          updateStatus(`Error: ${err.message}`);
        }
      }
    }
    
    // Show summary
    let summaryText = '';
    
    if (stopRequested) {
      summaryText = `Cancelled – ${processedCount} invitations sent`;
    } else if (processedCount >= max) {
      summaryText = `Completed – ${processedCount} invitations sent`;
    } else {
      summaryText = `No more profiles – ${processedCount} invitations sent`;
    }
    
    if (skippedCount > 0) {
      summaryText += ` (${skippedCount} skipped)`;
    }
    
    showSummary(summaryText);
  } catch (err) {
    console.error('Bulk invite error:', err);
    updateStatus(`Error: ${err.message}`);
  }
}

/**
 * Find all Connect buttons in search results
 * @returns {HTMLElement[]} Array of connect buttons
 */
function findConnectButtons() {
  const buttons = [];

  // Try different selectors for Connect buttons
  
  // 1. Direct connect buttons (most common)
  const directButtons = Array.from(document.querySelectorAll('button'))
    .filter(button => {
      const text = button.textContent.trim().toLowerCase();
      return text === 'connect' && !button.closest('[aria-hidden="true"]');
    });

  buttons.push(...directButtons);
  
  // 2. Find "More" dropdown buttons that might contain Connect options
  const moreButtons = Array.from(document.querySelectorAll('button'))
    .filter(button => {
      const text = button.textContent.trim().toLowerCase();
      return (text === 'more' || text.includes('more')) &&
             !button.closest('[aria-hidden="true"]');
    });
  
  buttons.push(...moreButtons);

  return buttons;
}

/**
 * Find the Connect option in an open dropdown menu
 * @returns {HTMLElement|null} The Connect option element or null if not found
 */
function findConnectOptionInDropdown() {
  // First try to find it through menu items
  const menuItems = document.querySelectorAll('[role="menuitem"]');

  for (const item of menuItems) {
    const text = item.textContent.trim().toLowerCase();
    if (text === 'connect') {
      return item;
    }
  }

  // Fall back to more generic search
  const dropdownButtons = Array.from(document.querySelectorAll('.artdeco-dropdown__content button, .artdeco-dropdown-item'))
    .filter(button => {
      const text = button.textContent.trim().toLowerCase();
      return text === 'connect' && button.offsetParent !== null; // Visible button
    });

  return dropdownButtons.length > 0 ? dropdownButtons[0] : null;
}

/**
 * Handle the Send Invitation modal that appears after clicking Connect
 * @returns {Promise<boolean>} True if invitation was sent successfully
 */
async function handleSendInviteModal() {
  // Wait briefly for modal to appear
  await delay(500);

  // First, check if there's an "Add a note" or similar modal with an option to skip
  // Look for "Send without a note" button specifically
  const exactButton = Array.from(document.querySelectorAll('button'))
    .find(button => {
      const text = button.textContent.trim().toLowerCase();
      return text === 'send without a note' && button.offsetParent !== null;
    });

  // If we found the exact button, use it, otherwise try more general patterns
  const skipNoteButtons = exactButton ? [exactButton] : Array.from(document.querySelectorAll('button'))
    .filter(button => {
      const text = button.textContent.trim().toLowerCase();
      return ((text.includes('without') && text.includes('note')) ||
              text.includes('skip') ||
              (text.includes('connect') && !text.includes('add'))) &&
             button.offsetParent !== null; // Visible button
    });

  if (skipNoteButtons.length > 0) {
    // Click the button to skip adding a note
    skipNoteButtons[0].click();
    await delay(300); // Wait for any subsequent modal
  }

  // Now look for the final Send/Send Now button in the modal
  const sendButtons = Array.from(document.querySelectorAll('button'))
    .filter(button => {
      const text = button.textContent.trim().toLowerCase();
      return (text === 'send' || text === 'send now' || text === 'connect') &&
             button.offsetParent !== null; // Visible button
    });

  if (sendButtons.length > 0) {
    // Click the send button
    sendButtons[0].click();
    return true;
  }

  // If we're here, we might need to look for an option to proceed without a note
  // Look for any "Connect" or similar primary action
  const connectButtons = Array.from(document.querySelectorAll('button'))
    .filter(button => {
      const text = button.textContent.trim().toLowerCase();
      const isPrimary = button.classList.contains('artdeco-button--primary') ||
                       button.style.backgroundColor === '#0a66c2' ||
                       text.includes('connect');
      return isPrimary && button.offsetParent !== null; // Visible primary button
    });

  if (connectButtons.length > 0) {
    connectButtons[0].click();
    return true;
  }

  // If no modal appeared or no send button found, try dismissing any visible modal
  const dismissButtons = document.querySelectorAll('button[aria-label="Dismiss"]');
  const closeButtons = document.querySelectorAll('button[aria-label="Close"]');

  if (dismissButtons.length > 0) {
    dismissButtons[0].click();
  } else if (closeButtons.length > 0) {
    closeButtons[0].click();
  }

  return false;
}

/**
 * Count the number of search results on the page
 * @returns {number} The number of results found
 */
function countSearchResults() {
  // Look for profile cards in search results
  const resultCards = document.querySelectorAll('.reusable-search__result-container');
  return resultCards.length;
}

/**
 * Wait to see if new search results load after scrolling
 * @returns {Promise<boolean>} True if new results appeared
 */
async function waitForNewResults() {
  const countBefore = countSearchResults();
  
  // Wait for content to potentially load
  let attempts = 0;
  const maxAttempts = 10; // Try for up to 10 * 200ms = 2s
  
  while (attempts < maxAttempts) {
    await delay(200);
    const currentCount = countSearchResults();
    
    if (currentCount > countBefore) {
      return true; // New results loaded
    }
    
    attempts++;
  }
  
  return false; // No new results found after waiting
}

/**
 * Try to go to the next page of search results
 * @returns {Promise<boolean>} True if next page button was found and clicked
 */
async function goToNextPage() {
  
  // Try different selectors for the next page button
  const nextButtonSelectors = [
    'button[aria-label="Next"]',
    'button[aria-label="Next page"]', 
    'button[aria-label="Go to next page"]',
    '.artdeco-pagination__button--next',
    '.artdeco-pagination__button[aria-label*="Next"]',
    'button:has(li-icon[type="chevron-right"])',
    'button:has(svg[data-test-icon="chevron-right"])',
    'a[aria-label="Next"]',
    'a[aria-label="Next page"]'
  ];
  
  let nextButton = null;
  
  for (const selector of nextButtonSelectors) {
    try {
      const buttons = document.querySelectorAll(selector);
      for (const button of buttons) {
        // Check if button is visible and not disabled
        if (button.offsetParent !== null && !button.disabled && !button.classList.contains('disabled')) {
          nextButton = button;
          break;
        }
      }
      if (nextButton) break;
    } catch (err) {
      // Skip invalid selectors
      continue;
    }
  }
  
  // If no specific next button found, try finding by text content
  if (!nextButton) {
    const allButtons = Array.from(document.querySelectorAll('button, a'));
    for (const button of allButtons) {
      const text = button.textContent.trim().toLowerCase();
      const ariaLabel = (button.getAttribute('aria-label') || '').toLowerCase();
      
      if ((text === 'next' || text.includes('next page') || 
           ariaLabel.includes('next') || ariaLabel.includes('page')) &&
          button.offsetParent !== null && !button.disabled) {
        nextButton = button;
        break;
      }
    }
  }
  
  if (nextButton) {
    nextButton.click();
    return true;
  }
  
  return false;
}

// Initialize buttons based on the current page
function initializeButtons() {
  
  // For invitation manager
  if (window.location.href.includes('/mynetwork/invitation-manager/')) {
    setTimeout(addButtons, 1000);
  }
  
  // For search results
  if (window.location.href.includes('/search/results/')) {
    setTimeout(addSearchButton, 1000);
  }
  
}

// Run on document load
document.addEventListener('DOMContentLoaded', () => {
  initializeButtons();
});

// Run on window load
window.addEventListener('load', () => {
  initializeButtons();
});

// Run immediately if document is already loaded
if (document.readyState === 'complete' || document.readyState === 'interactive') {
  initializeButtons();
}

// Watch for URL changes (LinkedIn is a SPA)
let lastUrl = window.location.href;
const observer = new MutationObserver(() => {
  if (lastUrl !== window.location.href) {
    lastUrl = window.location.href;
    
    // Initialize buttons for the new page
    initializeButtons();
  }
});

// Start observing
observer.observe(document, {subtree: true, childList: true});

// Manual trigger functions (for debugging if needed)
// window.forceAddButtons = function() { addButtons(); };
// window.forceAddSearchButton = function() { addSearchButton(); };

