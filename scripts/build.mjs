// Bundle the app into one self-contained HTML file: dist/index.html.
//
//   node scripts/build.mjs           build once
//   node scripts/build.mjs --watch   rebuild on changes
//
// The script and the stylesheet are inlined into src/index.html. The page's
// Content-Security-Policy allows exactly this script (by its SHA-256 hash) and no
// network access, so the page cannot send the evaluated runs anywhere.
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outFile = join(root, 'dist', 'index.html');

async function build() {
  const bundle = await esbuild.build({
    entryPoints: [join(root, 'src', 'main.ts')],
    bundle: true,
    format: 'iife',
    target: 'es2022',
    minify: true,
    // Keeps the /*! ... */ license notice of trec_eval in the page.
    legalComments: 'eof',
    write: false,
  });
  // A literal "</script" inside the bundle would end the inline script early.
  const script = bundle.outputFiles[0].text.trim().replace(/<\/(script)/gi, '<\\/$1');
  const styles = (await readFile(join(root, 'src', 'styles.css'), 'utf8')).replace(/<\/(style)/gi, '<\\/$1');
  const hash = `sha256-${createHash('sha256').update(script).digest('base64')}`;
  const template = await readFile(join(root, 'src', 'index.html'), 'utf8');
  // Replacement functions keep "$" sequences in the bundle from being interpreted.
  const html = template
    .replace('__SCRIPT_HASH__', () => hash)
    .replace('/*__STYLES__*/', () => styles)
    .replace('/*__SCRIPT__*/', () => script);
  await mkdir(dirname(outFile), { recursive: true });
  await writeFile(outFile, html);
  console.log(`dist/index.html  ${(html.length / 1024).toFixed(0)} KB`);
}

if (process.argv.includes('--watch')) {
  const { watch } = await import('node:fs');
  let pending;
  watch(join(root, 'src'), { recursive: true }, () => {
    clearTimeout(pending);
    pending = setTimeout(() => build().catch((e) => console.error(e.message)), 100);
  });
  await build();
  console.log('watching src/ …');
} else {
  await build();
}
