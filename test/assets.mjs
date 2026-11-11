// 테스트에 쓰는 파일들: 사진(PNG), 여러 쪽 PDF, HTML, 마크다운, 텍스트.

import { BASE } from './lib.mjs';

const FONT = `<link rel="stylesheet" href="${BASE}/_fonts.css">`;

function notePage(title, lines, hue) {
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8">${FONT}<style>
  body{margin:0;width:900px;height:1200px;background:hsl(${hue} 40% 96%);font-family:'IBM Plex Sans KR',sans-serif;color:#1c2738}
  .p{padding:70px 80px}
  h1{font-size:54px;margin:0 0 30px;border-bottom:4px solid hsl(${hue} 60% 45%);padding-bottom:16px}
  li{font-size:34px;line-height:1.9}
  .hl{background:hsl(${(hue + 40) % 360} 90% 78%)}
  </style></head><body><div class="p"><h1>${title}</h1><ol>${lines.map((l, i) => `<li>${i % 3 === 1 ? `<span class="hl">${l}</span>` : l}</li>`).join('')}</ol></div></body></html>`;
}

export async function makeAssets(browser) {
  const ctx = await browser.newContext({ viewport: { width: 900, height: 1200 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();

  await page.setContent(notePage('LC 파트2 오답 노트', ['Where 의문문은 장소 표현에 주의', 'Why don’t you ~ 는 제안', '부가 의문문은 Yes/No 그대로', '간접 응답 유형 정리', '시제 함정 문제 3개 복습'], 215), { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  const photo1 = await page.screenshot({ type: 'png' });

  await page.setContent(notePage('오늘의 단어 60개', ['abandon · 버리다', 'acquire · 얻다', 'allocate · 배정하다', 'comply · 따르다', 'defer · 미루다', 'expire · 만료되다'], 12), { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  const photo2 = await page.screenshot({ type: 'png' });

  // 4쪽짜리 PDF (한글 글꼴이 들어간 실제 PDF)
  const pdfHtml = `<!doctype html><html lang="ko"><head><meta charset="utf-8">${FONT}<style>
    @page{size:A4;margin:18mm}
    body{font-family:'IBM Plex Sans KR',sans-serif;color:#111}
    h1{font-size:26pt;border-bottom:2pt solid #2a4fd7;padding-bottom:6pt}
    h2{font-size:15pt;margin-top:18pt}
    p,li{font-size:11.5pt;line-height:1.75}
    .pg{page-break-after:always}
    table{border-collapse:collapse;width:100%}td,th{border:1px solid #999;padding:5pt 8pt;font-size:11pt}
    th{background:#e6ecfd}
  </style></head><body>
  ${[1, 2, 3, 4]
    .map(
      (n) => `<div class="${n < 4 ? 'pg' : ''}"><h1>토익 기출 요약 ${n}장</h1>
      <h2>${n}.1 핵심 문법</h2><p>가정법 과거는 현재 사실의 반대를 가정할 때 쓴다. If + 주어 + 과거 동사, 주어 + would + 동사원형. ${'문장 구조를 먼저 파악하고 빈칸 앞뒤의 품사를 확인한다. '.repeat(6)}</p>
      <h2>${n}.2 빈출 어휘</h2><table><tr><th>단어</th><th>뜻</th><th>예문</th></tr>
      ${['allocate|배정하다|allocate funds', 'comply|따르다|comply with the rules', 'defer|미루다|defer the payment', 'expire|만료되다|the contract expires'].map((r) => `<tr>${r.split('|').map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}
      </table><h2>${n}.3 풀이 순서</h2><ol>${['보기부터 훑어보기', '빈칸의 품사 정하기', '시제와 수 일치 확인', '남은 보기 비교'].map((l) => `<li>${l}</li>`).join('')}</ol>
      <p>${'Part 5는 한 문제에 20초를 넘기지 않는다. '.repeat(8)}</p></div>`,
    )
    .join('')}
  </body></html>`;
  await page.setContent(pdfHtml, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  const pdf = await page.pdf({ format: 'A4', printBackground: true });
  await ctx.close();

  const html = Buffer.from(
    `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<title>문법 정리</title>
<style>
  body { font-family: sans-serif; margin: 24px; line-height: 1.7; }
  h1 { color: #2a4fd7; }
  .box { border: 2px solid #d8402f; padding: 12px; border-radius: 8px; }
  td, th { border: 1px solid #aaa; padding: 4px 10px; }
</style>
</head>
<body>
<h1>가정법 과거</h1>
<p class="box">If I <b>were</b> you, I <b>would</b> study harder.</p>
<table><tr><th>형태</th><th>뜻</th></tr><tr><td>If + 과거, would + 원형</td><td>현재 사실의 반대</td></tr></table>
<p id="js-result">스크립트 꺼짐</p>
<p><a href="https://example.com/more">더 읽기</a></p>
<img src="x" onerror="document.title='xss'">
<script>document.getElementById('js-result').textContent = '스크립트 실행됨';</script>
</body>
</html>`,
    'utf8',
  );

  const md = Buffer.from(
    `# 단어장

오늘 외울 **핵심 단어**와 _예문_ 입니다. \`comply with\` 는 꼭 외우기.

## 1주차

| 단어 | 뜻 | 외움 |
| --- | --- | :---: |
| abandon | 버리다 | O |
| acquire | 얻다 | X |

- [x] abandon
- [ ] acquire
  - 예문: acquire a company
- [ ] allocate

> 하루 20개씩, 자기 전에 한 번 더.

1. 소리 내어 읽기
2. 예문 만들기

\`\`\`
If I were you, I would study harder.
\`\`\`

[토익 공식 사이트](https://www.ets.org/toeic)
<script>alert(1)</script>
`,
    'utf8',
  );

  const txt = Buffer.from('시험 전날에는 새 문제를 풀지 않는다.\n오답 노트만 두 번 읽고 일찍 잔다.\n\n준비물: 신분증, 연필, 지우개\n', 'utf8');

  return { photo1, photo2, pdf, html, md, txt };
}
