import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['node_modules/**', 'megalinter-reports/**', '.vercel/**'] },
  js.configs.recommended,
  {
    languageOptions: { ecmaVersion: 2023, sourceType: 'module' },
    rules: {
      eqeqeq: ['error', 'always'],
      complexity: ['error', 12],
      'prefer-const': 'error',
      'no-var': 'error',
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true }],
    },
  },
  { files: ['src/**/*.js', 'test/**/*.js', '*.js', 'api/**/*.js'], languageOptions: { globals: globals.node } },
  { files: ['public/**/*.js'], languageOptions: { globals: globals.browser } },
];
