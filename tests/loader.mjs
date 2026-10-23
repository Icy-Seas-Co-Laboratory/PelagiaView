import { pathToFileURL } from 'node:url';
import { resolve as pathResolve } from 'node:path';
import { existsSync } from 'node:fs';
import fsp from 'node:fs/promises';
import ts from 'typescript';

export async function resolve(specifier, context, nextResolve) {
  if (specifier === '$app/environment') return { url: pathToFileURL(pathResolve('tests/support/environmentMock.mjs')).href, shortCircuit: true };
  if (specifier === '$lib/stores/session') return { url: pathToFileURL(pathResolve('tests/support/queueStatusMock.ts')).href, shortCircuit: true };
  if (specifier === '$lib/stores/queueStatus') return { url: pathToFileURL(pathResolve('src/lib/stores/queueStatus.ts')).href, shortCircuit: true };
  if (specifier === '$lib/utils/analytics') return { url: pathToFileURL(pathResolve('tests/support/analyticsMock.mjs')).href, shortCircuit: true };
  if (specifier === '$lib/api/types') return { url: pathToFileURL(pathResolve('tests/support/typesMock.mjs')).href, shortCircuit: true };
  if (specifier.startsWith('.') && !specifier.endsWith('.js')) {
    const candidate = pathResolve(new URL(specifier, context.parentURL).pathname + '.ts');
    if (existsSync(candidate)) return { url: pathToFileURL(candidate).href, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  if (url.endsWith('.ts')) {
    const source = await fsp.readFile(new URL(url), 'utf8');
    const output = ts.transpileModule(source, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, sourceMap: false }
    });
    return { format: 'module', source: output.outputText, shortCircuit: true };
  }
  return nextLoad(url, context);
}
