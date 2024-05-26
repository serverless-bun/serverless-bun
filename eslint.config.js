import eslint from '@eslint/js'
import importPlugin from 'eslint-plugin-import'
import prettier from 'eslint-plugin-prettier/recommended'
import turbo from 'eslint-plugin-turbo'
import tseslint from 'typescript-eslint'

/** @type {import('eslint').Linter.FlatConfig[]} */
export default tseslint.config(
  {
    ignores: [
      'node_modules/',
      'examples/**/node_modules/',
      'examples/**/.serverless',
      'packages/**/node_modules/',
      'packages/**/dist/',
    ],
  },
  eslint.configs.recommended,
  {
    plugins: {
      ['import']: importPlugin,
    },
    rules: {
      'import/order': [
        'error',
        {
          groups: ['builtin', 'external', 'internal', ['sibling', 'parent'], 'index', 'unknown'],
          'newlines-between': 'always',
          alphabetize: {
            order: 'asc',
            caseInsensitive: true,
          },
        },
      ],
    },
  },
  ...tseslint.configs.recommended,
  {
    plugins: {
      ['turbo']: turbo,
    },
  },
  prettier
)
