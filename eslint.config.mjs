import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import next from 'eslint-config-next/core-web-vitals';
import importX from 'eslint-plugin-import-x';
import globals from 'globals';
export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/.next/**',
      '**/dist/**',
      '**/generated/**',
      '**/schema.d.ts',
      '**/next-env.d.ts',
      '**/coverage/**',
      '**/.turbo/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node, ...globals.browser, ...globals.jest } },
    rules: { '@typescript-eslint/no-explicit-any': 'error' },
  },
  { files: ['**/*.cjs'], rules: { '@typescript-eslint/no-require-imports': 'off' } },
  ...next.map((c) => ({
    ...c,
    files: ['apps/web/**/*.{ts,tsx}'],
    settings: { ...c.settings, next: { rootDir: 'apps/web/' } },
  })),
  {
    files: ['**/*.{ts,tsx}'],
    plugins: { 'import-x': importX },
    settings: {
      'import-x/resolver': {
        typescript: {
          project: ['apps/*/tsconfig.json', 'packages/*/tsconfig.json'],
          noWarnOnMultipleProjects: true,
        },
      },
    },
    rules: {
      'import-x/no-unresolved': 'error',
      'import-x/no-extraneous-dependencies': [
        'error',
        { devDependencies: true, optionalDependencies: false },
      ],
    },
  },
);
