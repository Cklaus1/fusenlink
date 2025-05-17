const path = require('path');

module.exports = {
  mode: 'production',
  entry: {
    background: './background.js',
    invitations: './invitations.js',
    search: './search.js',
    options: './options.js'
  },
  output: {
    filename: '[name].bundle.js',
    path: path.resolve(__dirname, 'dist'),
    clean: true
  }
};