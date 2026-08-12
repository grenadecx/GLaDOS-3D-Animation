import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import typescript from '@rollup/plugin-typescript';
import terser from '@rollup/plugin-terser';
import fs from 'fs/promises';
import path from 'path';

/** Everything the browser needs lives inside the integration: HACS installs an
 *  integration by extracting the release zip straight into
 *  custom_components/<domain>/, and the integration serves this directory at
 *  /glados_3d/. So the build output here is the layout on an install. */
const OUT = 'custom_components/glados_3d/frontend';

/** The GLB is CC-BY-SA, so its licence ships beside it. */
const copyModel = {
  name: 'copy-model',
  async writeBundle() {
    const src = path.join(process.cwd(), 'models');
    const dest = path.join(process.cwd(), OUT);
    await fs.mkdir(dest, { recursive: true });
    await fs.copyFile(path.join(src, 'GLaDOS.glb'), path.join(dest, 'GLaDOS.glb'));
    await fs.copyFile(path.join(src, 'LICENSE.txt'), path.join(dest, 'MODEL-LICENSE.txt'));
  },
};

const plugins = () => [
  resolve({ browser: true }),
  commonjs(),
  typescript({ tsconfig: './tsconfig.json' }),
  terser(),
];

/** The overlay resolves the card against its own URL so it needs no hardcoded
 *  path, which by construction is a specifier Rollup cannot follow. That is the
 *  point — the card is a separate bundle — so the warning is noise. */
const onwarn = (warning, warn) => {
  if (warning.code === 'UNRESOLVED_IMPORT' || warning.code === 'DYNAMIC_IMPORT_VARIABLES') return;
  warn(warning);
};

const external = ['home-assistant-js-websocket'];

export default [
  {
    input: 'src/glados-card.ts',
    output: { file: `${OUT}/glados-3d-card.js`, format: 'es', sourcemap: true },
    plugins: [...plugins(), copyModel],
    external,
    onwarn,
  },
  {
    input: 'src/overlay.ts',
    output: { file: `${OUT}/glados-3d-overlay.js`, format: 'es', sourcemap: true },
    plugins: plugins(),
    external,
    onwarn,
  },
];
