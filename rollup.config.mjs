import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import typescript from '@rollup/plugin-typescript';
import terser from '@rollup/plugin-terser';
import fs from 'fs/promises';
import path from 'path';

/** The GLB is CC-BY-SA, so its licence has to travel with it into every
 *  distribution — dist/ is what the HACS zip is built from. */
const copyModel = {
  name: 'copy-model',
  async writeBundle() {
    const src = path.join(process.cwd(), 'models');
    const dest = path.join(process.cwd(), 'dist', 'models');
    await fs.mkdir(dest, { recursive: true });
    for (const file of ['GLaDOS.glb', 'LICENSE.txt']) {
      await fs.copyFile(path.join(src, file), path.join(dest, file));
    }
  },
};

export default {
  input: 'src/glados-card.ts',
  output: {
    file: 'dist/glados-3d-card.js',
    format: 'es',
    sourcemap: true,
  },
  plugins: [
    resolve({ browser: true }),
    commonjs(),
    typescript({ tsconfig: './tsconfig.json' }),
    terser(),
    copyModel,
  ],
  external: ['home-assistant-js-websocket'],
};
