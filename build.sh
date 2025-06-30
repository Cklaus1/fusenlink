#!/bin/bash

# Make dist directory if it doesn't exist
mkdir -p dist

# Function to create a simpler version of invitations.js without ES modules
create_non_module_invitations() {
  echo "Creating non-module version of invitations.js..."
  local output_file="dist/invitations.bundle.js"

  # Start with header
  cat > "$output_file" << 'EOF'
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

// Initialize when DOM is ready
// Removed duplicate event listener

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
EOF

  # Now append the core invitation functionality from invitations.js, skipping the imports and global state
  grep -v "^import" /mnt/c/users/cklau/onedrive/Documents/GitHub/linkedinbrowser/invitations.js | \
  grep -v "from './lib" | \
  grep -v "let stopRequested = false" | \
  grep -v "let startTime = 0" | \
  grep -v "let processedCount = 0" | \
  grep -v "let totalCount = 0" | \
  grep -v "let skippedCount = 0" >> "$output_file"

  echo "Successfully created non-module version at $output_file"
}

# Function to create a simple background script
create_background_bundle() {
  echo "Creating bundled background script..."
  local output_file="dist/background.bundle.js"

  cat /mnt/c/users/cklau/onedrive/Documents/GitHub/linkedinbrowser/background.js > "$output_file"

  echo "Successfully created background bundle at $output_file"
}

# Function to create search.js bundle
create_search_bundle() {
  echo "Creating search.js bundle..."
  local input_file="/mnt/c/users/cklau/onedrive/Documents/GitHub/linkedinbrowser/search.js"
  local output_file="dist/search.bundle.js"

  if [ -f "$input_file" ]; then
    # Create a modified version with ES module imports replaced
    sed 's/^import.*from.*//g' "$input_file" > "$output_file"
    echo "Successfully created search bundle at $output_file"
  else
    echo "// Placeholder for search.js bundle" > "$output_file"
    echo "Warning: search.js not found, created placeholder"
  fi
}

# Function to create options.js bundle
create_options_bundle() {
  echo "Creating options.js bundle..."
  local input_file="/mnt/c/users/cklau/onedrive/Documents/GitHub/linkedinbrowser/options.js"
  local output_file="dist/options.bundle.js"

  if [ -f "$input_file" ]; then
    # Create a modified version with ES module imports replaced
    sed 's/^import.*from.*//g' "$input_file" > "$output_file"
    echo "Successfully created options bundle at $output_file"
  else
    echo "// Placeholder for options.js bundle" > "$output_file"
    echo "Warning: options.js not found, created placeholder"
  fi
}

# Create all the bundle files
create_background_bundle
create_non_module_invitations
create_search_bundle
create_options_bundle

echo "Build completed! Files are in the dist directory."