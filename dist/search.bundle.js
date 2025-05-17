/**
 * LinkedIn Bulk Actions - Search Content Script
 * Handles bulk connection requests on search results pages
 */

// Import utilities

import { 
  showOverlay, 
  updateProgress, 
  updateStatus, 
  showSummary, 
  hideOverlay, 
  onStop 
} from './lib/overlay.js';

// Global state
let stopRequested = false;
let startTime = 0;
let processedCount = 0;
let skippedCount = 0;
let totalCount = 0;
let maxInvites = 50; // Default, will be updated from settings

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', initializeButton);

/**
 * Initialize the UI by injecting the Invite button
 */
async function initializeButton() {
  // Only run on search results pages
  if (!window.location.href.includes('/search/results/')) {
    return;
  }

  try {
    // Get settings
    const settings = await getSettings();
    maxInvites = settings.maxInvites;
    
    // Create the button
    const inviteButton = createInviteButton(maxInvites);
    
    // Find the filter bar to inject next to
    // Wait for the filter bar to be ready
    await waitForElement('.search-reusables__filters-bar');
    
    // Find the filter bar or a suitable container
    const filterBar = document.querySelector('.search-reusables__filters-bar') || 
                      document.querySelector('.search-results-container');
    
    // If filter bar exists, add the button
    if (filterBar) {
      // Create a container to hold our button with proper styling
      const buttonContainer = document.createElement('div');
      buttonContainer.className = 'li-bulk-invite-container';
      Object.assign(buttonContainer.style, {
        display: 'inline-flex',
        alignItems: 'center',
        marginLeft: '12px'
      });
      
      // Add button to container
      buttonContainer.appendChild(inviteButton);
      
      // Add container to filter bar
      filterBar.appendChild(buttonContainer);
    }
  } catch (err) {
    console.error('Error initializing Invite button:', err);
  }
}

/**
 * Create the Invite button with current max invites
 * @param {number} max - Maximum number of invites to send
 * @returns {HTMLButtonElement} The created button
 */
function createInviteButton(max) {
  const button = document.createElement('button');
  button.textContent = `Invite ≤ ${max}`;
  button.className = 'li-bulk-invite-button';
  
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
  button.addEventListener('click', () => {
    inviteProfiles(max);
  });
  
  return button;
}

/**
 * Start the bulk invite process
 * @param {number} max - Maximum number of invites to send
 */
async function inviteProfiles(max) {
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
        
        // If no new results loaded, we're done
        if (!foundMoreResults) {
          updateStatus('No more profiles with Connect button found');
          break;
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
          // Check if this is a "More" dropdown button
          if (button._hasDropdownInfo) {
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
                updateProgress(processedCount, totalCount, getElapsedSeconds());
                updateStatus(`Sent invitation ${processedCount} of ${max}`);
              } else {
                skippedCount++;
                updateStatus(`Skipped invitation (${skippedCount} total skipped)`);
              }
            } else {
              // No Connect option found, close the dropdown and skip
              closeOpenDropdown();
              skippedCount++;
              updateStatus(`No Connect option in dropdown (${skippedCount} total skipped)`);
            }
          } else {
            // Regular Connect button
            button.click();
            await delay(300); // Wait for modal to appear

            // Handle the confirmation modal if it appears
            const sent = await handleSendInviteModal();

            if (sent) {
              processedCount++;
              updateProgress(processedCount, totalCount, getElapsedSeconds());
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
 * Find all Connect buttons in the current view
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

  // 2. Find and expand "More" dropdown buttons to reveal hidden Connect options
  const moreButtons = findMoreDropdownButtons();
  for (const moreButton of moreButtons) {
    // Store information about this dropdown for later cleanup
    const dropdownInfo = {
      button: moreButton,
      wasProcessed: false
    };

    // Add a special property to the button so we can identify it
    moreButton._hasDropdownInfo = true;

    // Add to our list of buttons with the dropdown info attached
    buttons.push(moreButton);
  }

  return buttons;
}

/**
 * Find "More" dropdown buttons that might contain Connect options
 * @returns {HTMLElement[]} Array of More buttons
 */
function findMoreDropdownButtons() {
  // Find buttons with "More" text
  return Array.from(document.querySelectorAll('button'))
    .filter(button => {
      const text = button.textContent.trim().toLowerCase();
      return (text === 'more' || text.includes('more')) &&
             !button.closest('[aria-hidden="true"]') &&
             !button._hasDropdownInfo; // Skip if already processed
    });
}

/**
 * Handle the Send Invitation modal that appears after clicking Connect
 * @returns {Promise<boolean>} True if invitation was sent successfully
 */
async function handleSendInviteModal() {
  // Wait briefly for modal to appear
  await delay(500);
  
  // Look for the Send/Send Now button in the modal
  const sendButtons = Array.from(document.querySelectorAll('button'))
    .filter(button => {
      const text = button.textContent.trim().toLowerCase();
      return (text === 'send' || text === 'send now') && 
             button.offsetParent !== null; // Visible button
    });
  
  if (sendButtons.length > 0) {
    // Click the send button
    sendButtons[0].click();
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
 * Wait for an element to be present in the DOM
 * @param {string} selector - CSS selector to wait for
 * @param {number} [maxWaitMs=5000] - Maximum wait time in milliseconds
 * @returns {Promise<HTMLElement|null>} The found element or null if not found
 */
async function waitForElement(selector, maxWaitMs = 5000) {
  return new Promise(resolve => {
    // Check if element already exists
    const element = document.querySelector(selector);
    if (element) {
      resolve(element);
      return;
    }
    
    // Set up observer to watch for the element
    const observer = new MutationObserver((mutations, obs) => {
      const element = document.querySelector(selector);
      if (element) {
        obs.disconnect();
        resolve(element);
      }
    });
    
    // Start observing
    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
    
    // Set timeout to stop observing if element never appears
    setTimeout(() => {
      observer.disconnect();
      resolve(null);
    }, maxWaitMs);
  });
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
 * Close any open dropdown menu
 */
function closeOpenDropdown() {
  // Try to find the close button for the dropdown
  const closeButton = document.querySelector('.artdeco-dropdown__content [aria-label="Close"]');
  if (closeButton) {
    closeButton.click();
    return;
  }

  // If no close button, try clicking outside the dropdown
  document.body.click();

  // As a last resort, try hitting Escape key
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
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