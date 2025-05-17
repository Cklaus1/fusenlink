# LinkedIn Bulk Actions

A Chrome extension that adds bulk action capabilities to LinkedIn for:
- Accept All invitations
- Deny All invitations
- Send up to N connection requests (configurable)

## Features

- **Bulk Accept/Deny**: One-click to process all pending invitations with auto-scrolling
- **Bulk Connect**: Send up to a configurable number of connection requests on any search results page
- **Progress Overlay**: Live feedback showing processed items and elapsed time
- **Stop Control**: Cancel any ongoing bulk action
- **Security Handling**: Automatic pause when LinkedIn security checks appear
- **Configurable Settings**: Adjust maximum invites and delay between actions

## Installation

### From Source

1. Clone this repository:
   ```
   git clone https://github.com/yourusername/linkedin-bulk-actions.git
   ```

2. Open Chrome and navigate to `chrome://extensions/`

3. Enable "Developer mode" by toggling the switch in the top-right corner

4. Click "Load unpacked" and select the extension directory

### From Chrome Web Store

*(Coming soon)*

## Usage

### Bulk Accept/Deny Invitations

1. Navigate to [LinkedIn Invitation Manager](https://www.linkedin.com/mynetwork/invitation-manager/)
2. Use the "Accept All" or "Deny All" buttons added to the top of the page
3. An overlay will show progress and allow cancellation

### Bulk Send Connection Requests

1. Navigate to any LinkedIn search results page
2. Use the "Invite ≤ N" button added to the filters bar
3. The extension will auto-send connection requests up to your configured limit

### Configure Settings

1. Right-click the extension icon and select "Options"
2. Adjust the maximum number of invites to send
3. Adjust the delay between actions (in milliseconds)
4. Click "Save Settings"

## Development

### Prerequisites

- Node.js and npm

### Setup

1. Clone the repository
2. Install dependencies:
   ```
   npm install
   ```

### Testing

Run tests:
```
npm test
```

### Building

Build the extension using webpack:
```
npm run build
```

If npm installation fails, you can use the included build script:
```
./build.sh
```

Or create a package for distribution:
```
zip -r linkedin-bulk-actions.zip * -x "node_modules/*" "*.git*" "tests/*" "dist/*"
```

## Security Notes

This extension:
- Only runs on LinkedIn domains
- Does not transmit any data externally
- Respects LinkedIn's security checks by automatically pausing
- Uses reasonable delays to avoid rate limiting

## License

MIT

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request