# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Chrome extension called "LinkedIn Bulk Actions" that automates LinkedIn networking tasks. The extension provides:
- **Bulk Accept/Deny**: Process all pending invitations on the invitation manager page
- **Bulk Connect**: Send connection requests to profiles in search results with configurable limits
- **Progress Overlay**: Real-time UI showing processed items and elapsed time
- **Security Handling**: Automatic pause when LinkedIn security checks appear

## Common Development Commands

### Building
```bash
# Primary build method (requires npm dependencies)
npm run build

# Alternative build script (fallback when npm fails)
./build.sh
```

### Testing
```bash
# Run all tests
npm test

# Test files are located in tests/ directory
# Uses Jest with jsdom environment
```

### Development Setup
```bash
# Install dependencies
npm install

# Load extension in Chrome:
# 1. Open chrome://extensions/
# 2. Enable "Developer mode"
# 3. Click "Load unpacked" and select this directory
```

## Architecture Overview

### Core Components
- **`background.js`**: Service worker handling settings storage and message passing
- **`content.js`**: Main content script with combined functionality for both invitation and search pages
- **`invitations.js`**: Modular invitation processing logic (ES6 modules)
- **`search.js`**: Modular search page connection logic (ES6 modules)
- **`lib/overlay.js`**: Shared UI overlay component for progress display
- **`lib/settings.js`**: Settings management utilities

### Build System
The project uses dual build approaches:
1. **Webpack** (`webpack.config.js`): Modern ES6 module bundling
2. **Shell Script** (`build.sh`): Fallback bundler that creates non-module versions

Files are bundled into `dist/` directory with `.bundle.js` extensions.

### Content Script Architecture
- **Page Detection**: Uses URL pattern matching to determine LinkedIn page type
- **Button Injection**: Dynamically adds action buttons to appropriate page sections
- **Overlay System**: Floating progress UI with stop functionality
- **Security Handling**: Detects and pauses for LinkedIn security challenges
- **State Management**: Global state tracking for ongoing operations

### Settings System
- **Storage**: Uses Chrome sync storage for cross-device settings
- **Defaults**: `maxInvites: 50`, `delayMs: 1500`
- **Options Page**: `options.html` with form-based configuration

### Key Technical Details
- **Manifest V3**: Uses service worker architecture
- **ES6 Modules**: Modular code with import/export (bundled for compatibility)
- **Mutation Observers**: Watches for DOM changes and URL navigation
- **Rate Limiting**: Configurable delays between actions
- **Error Handling**: Graceful fallbacks and user feedback
- **Auto-scrolling**: Automatically scrolls and loads more invitations/results during bulk operations

## Testing Setup

The project uses Jest with:
- **jsdom** environment for DOM testing
- **jest-chrome** for mocking Chrome APIs
- **Puppeteer** for integration testing
- Test files in `tests/` directory with `.test.js` extension

## Development Notes

### LinkedIn DOM Targeting
The extension uses multiple selector strategies due to LinkedIn's dynamic nature:
- Primary: `data-view-name` attributes
- Fallback: `aria-label` patterns
- Final: Text content matching

### Security Considerations
- Only runs on LinkedIn domains
- Respects LinkedIn's security challenges
- Uses reasonable delays to avoid rate limiting
- No external data transmission

### Module System
The codebase uses ES6 modules for development but includes build scripts to create non-module versions for browser compatibility.