// @ts-check
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

/**
 * ESLint flat config.
 *
 * Type-aware linting (`recommendedTypeChecked`) is on because the rules that
 * actually catch bugs here need type information: a floating promise around an
 * ad call, an impossible condition left behind by a refactor, a Decimal
 * compared with `==`. It makes the lint run slower, which is the right trade
 * for a codebase where the alternative is finding those at runtime.
 *
 * Formatting is left entirely to Prettier; `eslint-config-prettier` comes last
 * and switches off every rule that would argue with it.
 */
export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'coverage/**'] },

  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,

  {
    languageOptions: {
      parserOptions: {
        projectService: {
          // A glob rather than a list: `tools/` holds plain-JS scripts that are
          // deliberately outside the app's type-check graph, and naming them one
          // by one means every new one fails lint until someone remembers this
          // file.
          allowDefaultProject: ['eslint.config.js', 'tools/*.mjs'],
        },
        tsconfigRootDir: import.meta.dirname,
      },
      globals: { ...globals.browser },
    },
    rules: {
      '@typescript-eslint/no-unnecessary-condition': [
        'error',
        { allowConstantLoopConditions: true },
      ],

      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],

      // An ad promise dropped on the floor is a reward the player earned and
      // never received, reported to nobody.
      '@typescript-eslint/no-floating-promises': 'error',

      '@typescript-eslint/no-non-null-assertion': 'error',

      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      'prefer-const': 'error',
      'no-var': 'error',
    },
  },

  {
    // Tests reach into internals on purpose and assert on values the type
    // system cannot prove are present.
    files: ['tests/**/*.ts'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-unnecessary-condition': 'off',
      '@typescript-eslint/unbound-method': 'off',
      '@typescript-eslint/no-empty-function': 'off',
      // Test doubles stand in for async interfaces without doing async work.
      '@typescript-eslint/require-await': 'off',
      'no-console': 'off',
    },
  },

  {
    // Developer tooling, not shipped code: the balance probe exists to print
    // numbers, and the browser check runs in Node against a real page.
    files: ['tools/**/*.ts', 'tools/**/*.mjs'],
    languageOptions: { globals: { ...globals.node } },
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-unnecessary-condition': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      'no-console': 'off',
    },
  },

  {
    files: ['*.config.js', '*.config.ts'],
    languageOptions: { globals: { ...globals.node } },
    rules: { '@typescript-eslint/no-unsafe-assignment': 'off' },
  },

  prettier,
);
