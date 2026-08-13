import * as esbuild from 'esbuild'
import { rm } from 'node:fs/promises'

const production = process.argv.includes('--production')
const watch = process.argv.includes('--watch')

if (production) await rm('dist/extension.cjs.map', { force: true })

const context = await esbuild.context({
  entryPoints: ['src/extension.ts'],
  bundle: true,
  format: 'cjs',
  platform: 'node',
  target: 'node24',
  outfile: 'dist/extension.cjs',
  external: ['vscode'],
  minify: production,
  sourcemap: !production,
  sourcesContent: false,
  logLevel: 'info',
})

if (watch) {
  await context.watch()
} else {
  await context.rebuild()
  await context.dispose()
}
