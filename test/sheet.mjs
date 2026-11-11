// 화면 캡처 여러 장을 한 장으로 모은다: node test/sheet.mjs <prefix> [cols] [cellWidth]
import { createRequire } from 'node:module';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const { chromium } = createRequire(import.meta.url)('playwright');
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dir = join(root, 'test/shots');
const prefix = process.argv[2] ?? 'sc-';
const cols = Number(process.argv[3] ?? 2);
const cw = Number(process.argv[4] ?? 960);
const per = cols * 2;
const files = readdirSync(dir).filter((f) => f.startsWith(prefix) && f.endsWith('.png') && !f.startsWith('sheet-')).sort();
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: cols * cw, height: 100 } });
let n = 0;
for (let i = 0; i < files.length; i += per) {
  const part = files.slice(i, i + per);
  const html = `<body style="margin:0;background:#888;display:grid;grid-template-columns:repeat(${cols},${cw}px);gap:0">${part
    .map((f) => `<figure style="margin:0;position:relative"><img src="data:image/png;base64,${readFileSync(join(dir, f)).toString('base64')}" style="width:${cw}px;display:block;border:1px solid #f0f"><figcaption style="position:absolute;left:0;top:0;background:#000;color:#fff;font:12px monospace;padding:1px 4px">${f}</figcaption></figure>`)
    .join('')}</body>`;
  await page.setContent(html);
  await page.screenshot({ path: join(dir, `sheet-${prefix}${String(++n).padStart(2, '0')}.png`), fullPage: true });
}
console.log(n + ' sheets from ' + files.length + ' shots');
await browser.close();
