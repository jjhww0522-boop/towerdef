import { build } from 'esbuild';
import ts from 'typescript';
import { mkdir, writeFile } from 'node:fs/promises';

const result = await build({
  entryPoints: ['server/nakama.ts'], bundle: true, write: false,
  format: 'iife', globalName: 'TowerdefRuntime', platform: 'neutral', target: 'es2015'
});
const bundled = result.outputFiles[0].text + '\nvar InitModule = TowerdefRuntime.InitModule;\n';
const output = ts.transpileModule(bundled, {
  compilerOptions: { target: ts.ScriptTarget.ES5, module: ts.ModuleKind.None }
}).outputText;
await mkdir('dist/nakama', { recursive: true });
await writeFile('dist/nakama/index.js', output);
console.log('Nakama ES5 bundle: dist/nakama/index.js');
