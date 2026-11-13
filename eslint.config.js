import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist', 'src-tauri'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true },
      ],
    },
  },
  {
    files: ['scripts/**/*.mjs', 'vite.config.ts'],
    languageOptions: { globals: globals.node },
  },
  {
    // The rules engine must stay free of UI code so it can be tested and saved as plain data.
    files: ['src/engine/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['react', 'react-dom', 'zustand', 'pixi.js'], message: 'engine/ must not import UI libraries.' },
            { group: ['../screens/*', '../render/*', '../state/*'], message: 'engine/ must not import UI code.' },
          ],
        },
      ],
    },
  },
);
