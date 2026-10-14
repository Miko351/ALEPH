import { copyFileSync, mkdirSync } from 'node:fs';

mkdirSync('dist/vendor', { recursive: true });
copyFileSync(
  'node_modules/@simplewebauthn/browser/dist/bundle/index.umd.min.js',
  'dist/vendor/simplewebauthn.min.js',
);
