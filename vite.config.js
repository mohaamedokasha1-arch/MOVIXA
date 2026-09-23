const { defineConfig } = require('vite');

// No hardcoded port — Railway injects PORT and `serve` reads it automatically.
module.exports = defineConfig({
  publicDir: 'public',
  build: {
    outDir: 'dist',
    emptyOutDir: true
  }
});
