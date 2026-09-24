// Run from the repo root: node tests/csp-check.js
// Static check: pages on the strict CSP tier must not rely on inline script/handlers.
const fs = require('fs');
const hdr = fs.readFileSync('_headers', 'utf8');
const strict = [...hdr.matchAll(/^\/([^\s*]*)\r?\n\s+Content-Security-Policy: ([^\r\n]+)/gm)]
  .filter(m => !/script-src[^;]*'unsafe-inline'/.test(m[2]))
  .map(m => ({ page: m[1] || 'index.html', csp: m[2] }));
const onAttr = /\son[a-z]+\s*=\s*["']/i;
let bad = 0;
const seen = new Set();
function checkJs(file) {
  if (seen.has(file) || !fs.existsSync(file)) return; seen.add(file);
  const s = fs.readFileSync(file, 'utf8');
  if (onAttr.test(s)) { console.log('INLINE HANDLER in', file, s.match(onAttr)[0]); bad++; }
  for (const m of s.matchAll(/from\s+['"]\.\/([^'"]+)['"]|import\(\s*['"]\.\/([^'"]+)['"]\s*\)/g)) checkJs(m[1] || m[2]);
}
for (const { page, csp } of strict) {
  if (!fs.existsSync(page)) { console.log('MISSING', page); bad++; continue; }
  const html = fs.readFileSync(page, 'utf8');
  const allowed = (csp.match(/script-src ([^;]+)/) || [,''])[1].split(/\s+/);
  for (const m of html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)) {
    const src = (m[1].match(/src=["']([^"']+)/) || [])[1];
    if (!src && m[2].trim()) { console.log('INLINE SCRIPT in', page); bad++; }
    if (src) {
      if (/^https?:/.test(src)) { const o = new URL(src).origin; if (!allowed.includes(o)) { console.log('BLOCKED ORIGIN', o, 'in', page); bad++; } }
      else checkJs(src.replace(/^\//, ''));
    }
  }
  if (onAttr.test(html.replace(/<script[\s\S]*?<\/script>/g, ''))) { console.log('INLINE HANDLER in', page); bad++; }
}
console.log(strict.length, 'strict pages checked,', bad, 'problems');
process.exit(bad ? 1 : 0);
