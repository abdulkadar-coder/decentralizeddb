import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['dist/', 'node_modules/', 'data/', '*.config.js', '*.config.mjs', 'chaincode/'],
  },
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
);
