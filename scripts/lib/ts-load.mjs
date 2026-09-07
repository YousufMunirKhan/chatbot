// Loads TypeScript source directly into a Node test script.
//
// The repo's test scripts are plain .mjs and there is no ts-node/tsx dependency,
// but a lot of the new logic (the flow engine, channel adapters, matching rules)
// is pure TypeScript worth testing without a database or a browser. This
// transpiles the requested files with the TypeScript compiler that already ships
// as a devDependency, writes them to a temp folder, and imports them.
//
// Relative imports are rewritten to the emitted .mjs names; `@/...` imports are
// redirected to a stub you provide, so a module that would normally reach for
// Supabase can be exercised in isolation.
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const ROOT = resolve(dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', '..');

/**
 * @param {string[]} files  Repo-relative .ts paths, e.g. 'src/lib/flows/engine.ts'
 * @param {Record<string,string>} [stubs]  Module specifier -> JS source to stand in for it
 * @returns {Promise<Record<string, any>>}  Imported namespace per input file
 */
export async function loadTs(files, stubs = {}) {
  // Emit inside the project's node_modules rather than the OS temp directory:
  // a stub may need to import a real package (supabase-js, for instance), and
  // Node resolves bare specifiers by walking up from the importing file.
  const stagingRoot = join(ROOT, 'node_modules', '.ts-load');
  mkdirSync(stagingRoot, { recursive: true });
  const outDir = mkdtempSync(join(stagingRoot, 'run-'));
  const stubNames = new Map();

  let stubIndex = 0;
  for (const [specifier, source] of Object.entries(stubs)) {
    const name = `__stub_${stubIndex++}.mjs`;
    writeFileSync(join(outDir, name), source, 'utf8');
    stubNames.set(specifier, name);
  }

  const emitted = [];
  // Relative imports are followed transitively, so asking for one entry point
  // pulls in the local modules it depends on.
  const queue = files.map((f) => resolve(ROOT, f));
  const seen = new Set();

  for (let i = 0; i < queue.length; i += 1) {
    const abs = queue[i];
    if (seen.has(abs)) continue;
    seen.add(abs);
    const file = relative(ROOT, abs).replace(/\\/g, '/');
    // CRLF checkouts are normal on Windows; keep the compiler input uniform.
    const source = (await readFile(abs, 'utf8')).replace(/\r\n/g, '\n');
    const { outputText } = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
        isolatedModules: true,
      },
      fileName: abs,
    });

    // Flatten to a single directory so relative specifiers stay simple.
    const flatName = relative(ROOT, abs).replace(/[\\/]/g, '__').replace(/\.ts$/, '.mjs');
    const rewritten = outputText.replace(
      /(from\s+|import\s*\(\s*)(['"])([^'"]+)\2/g,
      (match, prefix, quote, specifier) => {
        if (stubNames.has(specifier)) return `${prefix}${quote}./${stubNames.get(specifier)}${quote}`;
        if (specifier.startsWith('.')) {
          const target = resolve(dirname(abs), specifier);
          queue.push(target.endsWith('.ts') ? target : `${target}.ts`);
          const targetFlat = relative(ROOT, target).replace(/[\\/]/g, '__') + '.mjs';
          return `${prefix}${quote}./${targetFlat}${quote}`;
        }
        // Anything else (a bare package) is left alone; if it is not installed
        // the import will fail loudly rather than silently returning undefined.
        return match;
      },
    );

    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, flatName), rewritten, 'utf8');
    emitted.push({ file, flatName });
  }

  const namespaces = {};
  for (const { file, flatName } of emitted) {
    namespaces[file] = await import(pathToFileURL(join(outDir, flatName)).href);
  }
  return namespaces;
}

/** Tiny assertion helper shared by the pure-logic test scripts. */
export function makeChecker() {
  const state = { passed: 0, failed: 0 };
  const check = (label, condition, detail) => {
    if (condition) {
      state.passed += 1;
      console.log(`✅ ${label}`);
    } else {
      state.failed += 1;
      console.log(`❌ ${label}${detail === undefined ? '' : ` — ${JSON.stringify(detail)}`}`);
    }
  };
  return { check, state };
}
