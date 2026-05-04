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
    // Disable webpack's auto-publicPath detection (which reads
    // document.currentScript.src at runtime). With '' the chunk URL becomes a
    // bare filename, which is fine in the extension context (chunks are
    // web_accessible_resources). Removes the need for the document.currentScript
    // shim in the CDP shell. (Shim is kept in shell.js as defense-in-depth for
    // older bundles.)
    publicPath: ''
  }
};