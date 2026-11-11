// 게시된 페이지(플랫폼이 뼈대를 씌운 그대로)를 내려받은 사본으로 확인한다.
//   dist/published.html = 게시본 + 가짜 claude. 휴대폰 앱처럼 화면 위아래 안전 영역도 흉내 낸다.

import { launch, newContext, onboard, shot, errors, report, BASE } from './lib.mjs';

const browser = await launch();
const ctx = await newContext(browser, { viewport: { width: 390, height: 844 }, mobile: true, touch: true });
const page = await ctx.newPage();
page.on('console', (m) => {
  if (m.type() === 'error') errors.push('console: ' + m.text());
});
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
const cdp = await ctx.newCDPSession(page);
let insets = false;
try {
  await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: { top: 47, bottom: 34, left: 0, right: 0 } });
  insets = true;
} catch (e) {
  console.log('안전 영역 흉내 불가:', String(e.message).split('\n')[0]);
}
await page.goto(`${BASE}/published.html?u=pub&role=owner&space=pub${Date.now()}`);
await onboard(page, '게시확인');
const r = await page.evaluate(() => {
  const q = (s) => {
    const b = document.querySelector(s)?.getBoundingClientRect();
    return b ? [Math.round(b.top), Math.round(b.bottom)] : null;
  };
  const cs = getComputedStyle(document.documentElement);
  return {
    vh: innerHeight,
    rootPad: [cs.paddingTop, cs.paddingBottom],
    root: q('#root'),
    topbar: q('.topbar'),
    wordmark: q('.topbar .wordmark'),
    rail: q('.rail'),
    navHome: q('#nav-home'),
    title: document.title,
    scrollH: document.documentElement.scrollHeight,
  };
});
console.log(JSON.stringify({ insets, ...r }));
await shot(page, 'published-home');
await page.click('#nav-room');
await shot(page, 'published-room');
await browser.close();
process.exit(report() ? 1 : 0);
