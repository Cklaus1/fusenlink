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
    clean: true
  }
};