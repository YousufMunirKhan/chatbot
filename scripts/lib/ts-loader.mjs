/**
 * Import the app's TypeScript modules straight from a plain `.mjs` script.
 *
 * The other test scripts talk to a running dev server over HTTP, so they never
 * had to load app code in-process. The channel adapters are pure functions —
 * testing them through HTTP would prove nothing about `parse()` — so this
 * registers two sync module hooks:
 *
 *  - resolve: understands the `@/*` path alias from tsconfig.json and the
 *    extensionless relative imports the app uses (`'../http'` → `http.ts`);
 *  - load: strips the types with Node's own built-in TypeScript stripper.
 *
 * No new dependency, and the test therefore exercises the real adapter source
 * rather than a copy of it. Requires Node >= 22.15 (`module.registerHooks`).
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { registerHooks, stripTypeScriptTypes } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SRC = path.join(ROOT, 'src');

function firstFile(base) {
  const candidates = [base, `${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts')];
  for (const candidate of candidates) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    let base = null;
    if (specifier.startsWith('@/')) base = path.join(SRC, specifier.slice(2));
    else if (specifier.startsWith('./') || specifier.startsWith('../')) {
      const parent = context.parentURL?.startsWith('file:')
        ? fileURLToPath(context.parentURL)
        : path.join(ROOT, 'index.mjs');
      base = path.resolve(path.dirname(parent), specifier);
    }
    const resolved = base ? firstFile(base) : null;
    if (resolved && /\.tsx?$/.test(resolved)) {
      return { url: pathToFileURL(resolved).href, format: 'module', shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },

  load(url, context, nextLoad) {
    if (/\.tsx?$/.test(url)) {
      const source = readFileSync(fileURLToPath(url), 'utf8');
      return {
        format: 'module',
        source: stripTypeScriptTypes(source, { mode: 'strip' }),
        shortCircuit: true,
      };
    }
    return nextLoad(url, context);
  },
});
