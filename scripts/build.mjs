// src/followcheck.js → 아이폰/PC용 북마클릿(docs/bookmarklet.js) + 안드로이드 앱 내장 스크립트
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { minify } from 'terser';

const src = await readFile(new URL('../src/followcheck.js', import.meta.url), 'utf8');
const { code } = await minify(src, { ecma: 2018, compress: { passes: 2 }, mangle: true, format: { comments: false } });

// javascript: URL 에서 문제가 되는 문자만 퍼센트 인코딩 (한글은 그대로 두어 길이 절약)
const enc = code.replace(/[%#&?"'<>`\s\\^{}|[\]]/g, (c) =>
  c === ' ' ? '%20' : '%' + c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0'));
const bookmarklet = 'javascript:' + enc + 'void%200';

const out = (p) => new URL('../' + p, import.meta.url);
await mkdir(out('android/app/src/main/assets/'), { recursive: true });
await writeFile(out('android/app/src/main/assets/followcheck.js'), code + '\n');
await writeFile(out('docs/bookmarklet.js'),
  '// 자동 생성 — npm run build\nwindow.FC_BOOKMARKLET=' + JSON.stringify(bookmarklet).replace(/</g, '\\u003c') + ';\n');
console.log(`minified ${code.length} chars, bookmarklet ${bookmarklet.length} chars`);
