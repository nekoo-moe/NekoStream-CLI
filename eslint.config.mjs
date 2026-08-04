import eslint from '@eslint/js'
import tseslint from 'typescript-eslint'

const nodeGlobals = {
  Buffer: 'readonly',
  console: 'readonly',
  __dirname: 'readonly',
  module: 'readonly',
  process: 'readonly',
  require: 'readonly',
  setInterval: 'readonly',
  setTimeout: 'readonly',
  clearInterval: 'readonly',
  clearTimeout: 'readonly',
}

/** Globals available inside the player window and the webview preload. */
const browserGlobals = {
  document: 'readonly',
  window: 'readonly',
  location: 'readonly',
  localStorage: 'readonly',
  navigator: 'readonly',
  fetch: 'readonly',
  URL: 'readonly',
  Node: 'readonly',
  Element: 'readonly',
  HTMLElement: 'readonly',
  MutationObserver: 'readonly',
  XMLHttpRequest: 'readonly',
  Image: 'readonly',
  Event: 'readonly',
  CustomEvent: 'readonly',
  getComputedStyle: 'readonly',
  requestAnimationFrame: 'readonly',
  alert: 'readonly',
  globalThis: 'readonly',
  Response: 'readonly',
  // Declared by player.html, which prepends it to the preload copy it writes.
  __streamInfo: 'readonly',
}

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      '.data/**',
      '.claude/**',
      'DESIGN.md',
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{js,mjs,ts,mts}'],
    languageOptions: {
      globals: nodeGlobals,
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      'no-control-regex': 'off',
      'no-empty': 'off',
      'no-useless-assignment': 'off',
      'preserve-caught-error': 'off',
      'prefer-const': 'off',
    },
  },
  {
    // The Electron layer. These three files were excluded from linting entirely
    // until the security pass; they are in scope now, and unused-variable
    // reporting is switched back on for them specifically because that is what
    // catches the dead injection code this pass had to hunt down by hand.
    files: ['player-main.js', 'webview-preload.js', 'isolate.js'],
    languageOptions: {
      globals: { ...nodeGlobals, ...browserGlobals },
    },
    rules: {
      'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none', varsIgnorePattern: '^_' }],
      // `var self = this` inside the XHR/fetch shims is the only way to keep the
      // original callsite's receiver when forwarding to the native method.
      '@typescript-eslint/no-this-alias': 'off',
    },
  }
)
