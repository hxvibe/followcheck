// src/followcheck.js → docs/ 에 북마클릿/콘솔용 코드 생성
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { minify } from 'terser';

const src = await readFile(new URL('../src/followcheck.js', import.meta.url), 'utf8');
const { code } = await minify(src, {
  ecma: 2018,
  compress: { passes: 2 },
  mangle: true,
  format: { comments: false },
});

// 북마클릿: javascript: URL 에서 문제가 되는 문자만 퍼센트 인코딩 (한글은 그대로 두어 길이 절약)
const encoded = code.replace(/[%#&?"'<>`\s\\^{}|[\]]/g, (c) => {
  if (c === ' ') return '%20';
  return '%' + c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0');
});
const bookmarklet = 'javascript:' + encoded + 'void%200';

const out = new URL('../docs/', import.meta.url);
await mkdir(out, { recursive: true });
await writeFile(new URL('followcheck.min.js', out), code + '\n');
await writeFile(new URL('bookmarklet.txt', out), bookmarklet + '\n');
await writeFile(
  new URL('bookmarklet.js', out),
  '// 자동 생성 파일 — npm run build\n' +
    'window.FC_BOOKMARKLET=' + JSON.stringify(bookmarklet).replace(/</g, '\\u003c') + ';\n' +
    'window.FC_CONSOLE=' + JSON.stringify(code).replace(/</g, '\\u003c') + ';\n',
);
console.log(`minified ${code.length} chars, bookmarklet ${bookmarklet.length} chars`);
