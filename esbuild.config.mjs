import esbuild from 'esbuild';
const prod = process.argv.includes('production');
const config = {
  entryPoints: ['src/main.ts'],
  bundle: true,
  outfile: 'main.js',
  platform: 'browser',
  format: 'cjs',
  target: 'es2020',
  external: ['obsidian', 'electron', '@codemirror/state', '@codemirror/view'],
  sourcemap: prod ? false : 'inline',
  logLevel: 'info',
};
if (prod) await esbuild.build(config);
else { const ctx = await esbuild.context(config); await ctx.watch(); }
