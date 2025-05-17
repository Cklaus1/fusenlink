/**
 * LinkedIn Bulk Actions - Invitations Content Script
 * Handles bulk accepting/denying invitations on invitation manager page
 */

// Import utilities
import { getSettings } from './lib/settings.js';
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
let totalCount = 0;
let skippedCount = 0;

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', initializeButtons);

/**
 * Initialize the UI by injecting action buttons
 */
function initializeButtons() {
  // Only run on invitation manager page
  if (!window.location.href.includes('/mynetwork/invitation-manager/')) {
    return;
  }

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
                       
  if (headerSection && headerSection.parentNode) {
    headerSection.parentNode.insertBefore(buttonContainer, headerSection);
  } else {
    // Fallback to start of body if header not found
    document.body.insertBefore(buttonContainer, document.body.firstChild);
  }
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