import esbuild from 'esbuild'
import external from 'esbuild-plugin-external-package'

esbuild
  .build({
    entryPoints: ['src/main.ts'],
    platform: 'node',
    bundle: true,
    format: 'cjs',
    outfile: 'dist/index.cjs',
    logLevel: 'info',
    sourcemap: true,
    plugins: [external],
    lineLimit: 120,
    define: {
      "process.env.DATABASE_SSL": JSON.stringify("true"),
    },
  })
  .catch(() => process.exit(1))
