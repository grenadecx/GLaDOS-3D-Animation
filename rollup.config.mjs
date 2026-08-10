import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import typescript from '@rollup/plugin-typescript';
import terser from '@rollup/plugin-terser';
import fs from 'fs/promises';
import path from 'path';

const copyModel = {
  name: 'copy-model',
  async writeBundle() {
    await fs.mkdir(path.join(process.cwd(), 'dist', 'models'), { recursive: true });
    await fs.copyFile(
      path.join(process.cwd(), 'models', 'GLaDOS.glb'),
      path.join(process.cwd(), 'dist', 'models', 'GLaDOS.glb'),
    );
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
