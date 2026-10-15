export default {
  '*.{ts,tsx,js,mjs,cjs}': ['eslint --fix', 'prettier --write'],
  '*.{json,css,yml,yaml,md}': 'prettier --write',
};
