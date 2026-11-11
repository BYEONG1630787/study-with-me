// 빌드: src/ 를 한 장짜리 페이지(dist/index.html)로 묶는다.
//
//   node build.mjs                 → dist/index.html, dist/vendor/*
//   APP_URL=https://… node build.mjs   초대 링크에 넣을 게시 주소를 함께 넣는다
//   node build.mjs --test          → 테스트용 dist/test.html, dist/mock-claude.js 도 만든다

import { build, transform } from 'esbuild';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const dist = join(root, 'dist');
const withTest = process.argv.includes('--test');
const appUrl = process.env.APP_URL ?? '';
// Firebase 설정: 환경 변수 FIREBASE_CONFIG(JSON)가 없으면 firebase-config.json 을 읽는다
const firebaseConfig = process.env.FIREBASE_CONFIG ?? (existsSync(join(root, 'firebase-config.json')) ? JSON.stringify(JSON.parse(readFileSync(join(root, 'firebase-config.json'), 'utf8'))) : '');

mkdirSync(join(dist, 'vendor'), { recursive: true });

// ---- 스크립트 ----

async function bundle(entry) {
  const res = await build({
    entryPoints: [join(root, entry)],
    bundle: true,
    format: 'iife',
    minify: true,
    target: ['es2019', 'safari14'],
    charset: 'utf8',
    legalComments: 'none',
    write: false,
    define: {
      'process.env.NODE_ENV': '"production"',
      __APP_URL__: JSON.stringify(appUrl),
      __FIREBASE_CONFIG__: JSON.stringify(firebaseConfig),
    },
    logLevel: 'warning',
  });
  return res.outputFiles[0].text;
}

/** <script> 안에 그대로 넣어도 안전하게 */
function inlineSafe(js) {
  return js.replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\!--');
}

// ---- 스타일 ----

async function styles() {
  let css = readFileSync(join(root, 'src/styles.css'), 'utf8');
  const m = css.match(/\/\*@dark\n([\s\S]*?)@\*\//);
  if (!m) throw new Error('styles.css: /*@dark … @*/ 블록이 없어요');
  const dark = m[1];
  css = css.replace(m[0], '');
  const uses = css.split('/*@use-dark*/').length - 1;
  if (uses < 2) throw new Error('styles.css: /*@use-dark*/ 자리가 부족해요');
  css = css.split('/*@use-dark*/').join(dark);
  const out = await transform(css, { loader: 'css', minify: true, charset: 'utf8', legalComments: 'none', target: ['safari14'] });
  for (const w of out.warnings) console.warn('css:', w.text, w.location?.line);
  return out.code.replace(/<\/style/gi, '<\\/style');
}

// ---- pdf.js ----

function pack(dir, filter) {
  const out = {};
  for (const name of readdirSync(dir).sort()) {
    if (!filter(name)) continue;
    out[name] = readFileSync(join(dir, name)).toString('base64');
  }
  return out;
}

function vendor() {
  const pdf = join(root, 'node_modules/pdfjs-dist');
  copyFileSync(join(pdf, 'build/pdf.min.js'), join(dist, 'vendor/pdf.min.js'));
  copyFileSync(join(pdf, 'build/pdf.worker.min.js'), join(dist, 'vendor/pdf.worker.min.js'));
  // 글꼴 표(cmaps)와 기본 글꼴은 파일 수가 많고 확장자가 낯설어서 JSON 두 개로 묶는다
  const cmaps = pack(join(pdf, 'cmaps'), (n) => n.endsWith('.bcmap'));
  writeFileSync(join(dist, 'vendor/pdf.cmaps.json'), JSON.stringify(cmaps));
  const fonts = pack(join(pdf, 'standard_fonts'), (n) => n.endsWith('.pfb') || n.endsWith('.ttf'));
  writeFileSync(join(dist, 'vendor/pdf.fonts.json'), JSON.stringify(fonts));
  return { cmaps: Object.keys(cmaps).length, fonts: Object.keys(fonts).length };
}

// ---- 페이지 ----

const FONTS =
  'https://fonts.googleapis.com/css2?family=Gowun+Batang:wght@400;700&family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans+KR:wght@400;500;600;700&display=swap';

function page(css, js) {
  return [
    '<title>스터디 윗미</title>',
    '<meta name="claude:viewport-fit-sides" content="cover">',
    `<link rel="stylesheet" href="${FONTS}">`,
    `<style>${css}</style>`,
    '<div id="root"><div class="gate"><span class="wordmark big"><span class="wordmark-seal" aria-hidden="true">윗미</span><span>스터디 윗미</span></span><p class="muted">공부 기록을 불러오는 중…</p></div></div>',
    `<script>${inlineSafe(js)}</script>`,
    '',
  ].join('\n');
}

const [css, js] = await Promise.all([styles(), bundle('src/main.tsx')]);
const html = page(css, js);
writeFileSync(join(dist, 'index.html'), html);
const v = vendor();

if (withTest) {
  const mock = await bundle('test/mock-claude.ts');
  writeFileSync(join(dist, 'mock-claude.js'), mock);
  // 테스트 페이지: 플랫폼이 감싸 주는 뼈대를 흉내 내고, 앱보다 먼저 가짜 window.claude 를 올린다
  const body = html.replace('<script>', '<script src="mock-claude.js"></script>\n<script>');
  writeFileSync(
    join(dist, 'test.html'),
    `<!doctype html>\n<html lang="ko">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n</head>\n<body>\n${body}</body>\n</html>\n`,
  );
}

const kb = (n) => (n / 1024).toFixed(0) + 'KB';
console.log(`index.html ${kb(Buffer.byteLength(html))} (css ${kb(Buffer.byteLength(css))}, js ${kb(Buffer.byteLength(js))}) · cmaps ${v.cmaps} · fonts ${v.fonts}${appUrl ? ' · ' + appUrl : ''}`);
