const path = require('path');

module.exports = {
  mode: 'production',
  entry: {
    background: './src/background/index.js',
    content: './src/content/index.js',
    options: './src/ui/options.js',
    popup: './src/ui/popup.js'
  },
  output: {
    filename: '[name].bundle.js',
    path: path.resolve(__dirname, 'dist'),
    clean: true,
    // Bug 26: publicPath '' disables webpack's auto-publicPath detection (which
    // reads document.currentScript.src at runtime). With '' the chunk URL becomes
    // a bare filename, which works in the extension context (chunks are listed in
    // web_accessible_resources). Dynamic imports (only used by engine.runInteractive)
    // require all chunks to be pre-injected by the host environment — the CDP shell
    // does this; the extension currently does not exercise interactive mode.
    // Do NOT change this value without coordinating with the CDP shell agent.
    publicPath: ''
  }
};