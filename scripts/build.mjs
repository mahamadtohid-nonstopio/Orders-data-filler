import { build } from 'esbuild';
import { mkdir, cp } from 'node:fs/promises';
await mkdir('dist', { recursive: true });
await cp('public', 'dist', { recursive: true });
await build({ entryPoints: ['src/popup.ts'], bundle: true, outdir: 'dist', target: 'chrome120', format: 'iife' });
console.log('Load unpacked extension from dist/');
