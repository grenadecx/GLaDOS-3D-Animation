import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import typescript from '@rollup/plugin-typescript';
import terser from '@rollup/plugin-terser';
import fs from 'fs/promises';
import path from 'path';

/** dist/ is flat because these files ship as GitHub release assets, which HACS
 *  downloads side by side into www/community/<repo>/ — so the layout here is the
 *  layout on an install. The GLB is CC-BY-SA, so its licence ships beside it. */
const copyModel = {
  name: 'copy-model',
  async writeBundle() {
    const src = path.join(process.cwd(), 'models');
    const dest = path.join(process.cwd(), 'dist');
    await fs.mkdir(dest, { recursive: true });
    await fs.copyFile(path.join(src, 'GLaDOS.glb'), path.join(dest, 'GLaDOS.glb'));
    await fs.copyFile(path.join(src, 'LICENSE.txt'), path.join(dest, 'MODEL-LICENSE.txt'));
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
