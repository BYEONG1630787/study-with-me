// 테스트 서버: dist/ 를 그대로 내주고, 파일 저장소(/_blob)와 글꼴(/_fonts)을 흉내 낸다.
//   node test/server.mjs [port]

import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dist = join(root, 'dist');
const port = Number(process.argv[2] ?? 4173);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.pdf': 'application/pdf',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

const blobs = new Map();

/** Google Fonts 대신 내주는 글꼴 CSS (@fontsource 파일을 쓴다) */
function fontCss() {
  const fams = [
    ['IBM Plex Sans KR', 'ibm-plex-sans-kr', [400, 500, 600, 700], ['korean', 'latin']],
    ['Gowun Batang', 'gowun-batang', [400, 700], ['korean', 'latin']],
    ['IBM Plex Mono', 'ibm-plex-mono', [400, 500, 600], ['latin']],
  ];
  let css = '';
  for (const [name, pkg, weights, subsets] of fams) {
    for (const w of weights) {
      for (const sub of subsets) {
        const file = `${pkg}-${sub}-${w}-normal.woff2`;
        if (!existsSync(join(root, 'node_modules/@fontsource', pkg, 'files', file))) continue;
        const range = sub === 'latin' ? 'U+0000-024F,U+2000-206F,U+20AC,U+2122,U+2190-21FF,U+2212' : 'U+1100-11FF,U+3000-303F,U+3130-318F,U+AC00-D7AF,U+FF00-FFEF,U+00B7,U+2026';
        css += `@font-face{font-family:'${name}';font-style:normal;font-weight:${w};font-display:block;src:url(/_fonts/${pkg}/${file}) format('woff2');unicode-range:${range}}\n`;
      }
    }
  }
  return css;
}

const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const path = decodeURIComponent(url.pathname);

  if (path.startsWith('/_blob/')) {
    const id = path.slice(7);
    if (req.method === 'PUT') {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        blobs.set(id, { type: req.headers['content-type'] ?? 'application/octet-stream', body: Buffer.concat(chunks) });
        res.writeHead(200).end('ok');
      });
      return;
    }
    if (req.method === 'DELETE') {
      const had = blobs.delete(id);
      res.writeHead(had ? 200 : 404).end();
      return;
    }
    const b = blobs.get(id);
    if (!b) {
      res.writeHead(404).end('no such asset');
      return;
    }
    res.writeHead(200, { 'content-type': b.type, 'content-length': b.body.length }).end(b.body);
    return;
  }

  if (path === '/_fonts.css') {
    res.writeHead(200, { 'content-type': 'text/css; charset=utf-8', 'access-control-allow-origin': '*' }).end(fontCss());
    return;
  }
  if (path.startsWith('/_fonts/')) {
    const [, , pkg, file] = path.split('/');
    const f = join(root, 'node_modules/@fontsource', normalize(pkg ?? ''), 'files', normalize(file ?? ''));
    if (existsSync(f)) {
      res.writeHead(200, { 'content-type': 'font/woff2', 'access-control-allow-origin': '*', 'cache-control': 'max-age=3600' }).end(readFileSync(f));
      return;
    }
    res.writeHead(404).end();
    return;
  }

  let rel = normalize(path).replace(/^([/\\])+/, '');
  if (rel === '' || rel === '.') rel = 'test.html';
  const file = join(dist, rel);
  if (!file.startsWith(dist) || !existsSync(file) || !statSync(file).isFile()) {
    res.writeHead(404).end('not found');
    return;
  }
  res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' }).end(readFileSync(file));
});

server.listen(port, '127.0.0.1', () => console.log('test server on http://127.0.0.1:' + port));
