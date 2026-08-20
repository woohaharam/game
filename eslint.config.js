// @ts-check
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

/**
 * ESLint flat config.
 *
 * Type-aware linting is enabled (`recommendedTypeChecked`) because the rules
 * that actually catch bugs in this codebase — floating promises, unsafe
 * argument types, unnecessary conditions — all need type information. It costs
 * a slower lint run; that is the right trade for a game where a silently
 * ignored promise or a mistyped enum surfaces as a frame-time mystery.
 *
 * Formatting rules are left entirely to Prettier: `eslint-config-prettier`
 * comes last and switches off anything that would fight it.
 */
export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**', 'coverage/**'],
  },

  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,

  {
    languageOptions: {
      parserOptions: {
        // `allowDefaultProject` lets the root config files be linted without
        // dragging them into tsconfig's `include`, which would put build
        // tooling into the app's type-check graph.
        projectService: {
          allowDefaultProject: ['eslint.config.js'],
        },
        tsconfigRootDir: import.meta.dirname,
      },
      globals: {
        ...globals.browser,
      },
    },
    rules: {
      // The engine deliberately mutates pooled objects and out-params for
      // performance; flagging every parameter reassignment would be noise.
      '@typescript-eslint/no-unnecessary-condition': [
        'error',
        { allowConstantLoopConditions: true },
      ],

      // Unused code is a bug, but an underscore prefix is the documented way
      // to say "this argument exists to satisfy the signature".
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrors: 'none',
        },
      ],

      // A dropped promise in a game loop shows up as a missing sound or a
      // silent failure three seconds later; make it explicit.
      '@typescript-eslint/no-floating-promises': 'error',

      // Non-null assertions are allowed in tests (see the override below) but
      // production code should narrow properly.
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
      '@typescript-eslint/prefer-for-of': 'off',
      'no-console': 'off',
    },
  },

  {
    // Developer tooling, not shipped code. It reaches into world internals on
    // purpose and asserts on invariants the type system cannot see — the same
    // latitude tests get, for the same reason.
    files: ['tools/**/*.ts'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-unnecessary-condition': 'off',
      'no-console': 'off',
    },
  },

  {
    files: ['*.config.js', '*.config.ts'],
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
    },
  },

  prettier,
);
