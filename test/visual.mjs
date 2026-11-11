// 화면 점검용 캡처: 휴대폰(밝은·어두운 화면)과 PC 어두운 화면.
//   node test/visual.mjs [variant 이름 일부…]
import { launch, newContext, openUser, shot, onboard, ok, makeStages, tab, toastText, see, closeSheets, checkin, report } from './lib.mjs';
import { makeAssets } from './assets.mjs';

const only = process.argv.slice(2);
const space = 'vz' + Date.now();
const browser = await launch();
const A = await makeAssets(browser);
const ctx = await newContext(browser);
await ctx.clock.install({ time: new Date('2026-11-12T20:10:00+09:00') });
const pages = {};

// ---- 데이터 준비 ----
const mina = (pages.mina = await openUser(ctx, { u: 'mina', role: 'owner', space }, '', { allow404: /\/x$/ }));
await onboard(mina, '미나');
await mina.click('#home-create');
await mina.fill('#st-name', '토익 900 스터디');
await mina.fill('#st-intro', '매일 조금씩, 주 3회 인증해요');
await mina.click('#st-weekly-3');
await mina.selectOption('#st-daily', '30');
await mina.click('#st-submit');
await mina.locator('#invite-code').waitFor();
const code = (await mina.locator('#invite-code').innerText()).replace(/\s/g, '');
await closeSheets(mina);
const join = async (u, nick) => {
  const p = (pages[u] = await openUser(ctx, { u, role: 'editor', space }, '#join-' + code.toLowerCase()));
  await onboard(p, nick);
  await p.click('#join-submit');
  await p.locator('#study-tabs').waitFor();
  return p;
};
const junho = await join('junho', '준호');
const seoyeon = await join('seoyeon', '서연');
const haneul = await join('haneul', '하늘이는공부중');
await checkin(mina, A.photo1, { h: 1, m: 30, tag: '영어', memo: 'LC 파트2 오답 정리, 단어 60개 외움. 내일은 RC 파트5 풀기!' });
await mina.setInputFiles('#ci-album', []).catch(() => undefined);
await checkin(junho, A.photo2, { m: 50, tag: '단어' });
await checkin(seoyeon, A.photo1, { m: 20, tag: '문법', memo: '조금밖에 못 했다' });
// 반응·댓글·채팅
await tab(junho, '피드');
const card = junho.locator('article.ci', { hasText: 'LC 파트2' }).first();
await card.locator('.react-btn').nth(1).click();
await card.locator('.text-btn', { hasText: '댓글' }).click();
await card.locator('input[id^="cm-"]').fill('오답 정리 멋져요! 저도 내일 따라 해 볼게요');
await card.locator('input[id^="cm-"]').press('Enter');
await tab(seoyeon, '피드');
await seoyeon.locator('article.ci', { hasText: 'LC 파트2' }).first().locator('.react-btn').first().click();
const say = async (p, text) => {
  await tab(p, '채팅');
  const i = p.locator('[id^="chat-input-"]');
  await i.fill(text);
  await i.press('Enter');
  await p.locator('.msg', { hasText: text.slice(0, 12) }).first().waitFor();
};
await say(mina, '다들 오늘 몇 시에 공부해?');
await say(junho, '저는 8시부터요!');
await say(junho, '오늘은 단어 위주로 할 거예요');
await say(seoyeon, '나는 도서관이라 10시까지 있을 듯. 끝나고 인증 올릴게 🙌');
await say(mina, '좋아, 다들 화이팅. 주말에 모의고사 같이 풀자');
// 벌금, 학습장 자료
await tab(mina, '통계');
await mina.locator('#fine-open').first().click();
await mina.fill('#fine-amount', '1000');
await mina.click('#fine-save');
await closeSheets(mina);
await mina.click('#nav-room');
await mina.click('#room-add');
await mina.fill('#mat-subject', '영어');
await mina.setInputFiles('#mat-file', [
  { name: '토익 기출 요약.pdf', mimeType: 'application/pdf', buffer: A.pdf },
  { name: '문법 정리.html', mimeType: 'text/html', buffer: A.html },
  { name: '단어장.md', mimeType: 'text/markdown', buffer: A.md },
]);
await mina.locator('.mat-row').nth(2).waitFor({ timeout: 15000 });
await closeSheets(mina);
await mina.click('#room-add');
await mina.locator('#mat-tab').getByRole('tab', { name: '링크' }).click();
await mina.fill('#mat-url', 'example.com/toeic');
await mina.fill('#mat-title', '토익 강의 페이지');
await mina.click('#mat-link-save');
await mina.locator('.mat-row').nth(3).waitFor();
await closeSheets(mina);
// 준호는 집중 모드로 공부 중
await junho.click('#nav-start');
await junho.fill('#focus-subject', '수학');
await junho.click('#focus-start');
await junho.locator('.focus').waitFor();
await ctx.clock.fastForward(17 * 60 * 1000);
console.log('데이터 준비 끝');

// ---- 화면 목록 ----
const goStudy = async (p, t) => {
  await p.click('#nav-home');
  await p.locator('.study-card').first().click();
  await tab(p, t);
  await p.waitForTimeout(250);
};
const bottom = (p) => p.locator('#main').evaluate((el) => el.scrollTo(0, el.scrollHeight));

const views = [
  ['home', async (p) => p.click('#nav-home')],
  ['today', async (p) => goStudy(p, '오늘')],
  ['feed', async (p) => goStudy(p, '피드')],
  ['feed2', async (p) => { await goStudy(p, '피드'); await p.locator('#main').evaluate((el) => el.scrollTo(0, 620)); }],
  ['chat', async (p) => goStudy(p, '채팅')],
  ['stats', async (p) => goStudy(p, '통계')],
  ['stats2', async (p) => { await goStudy(p, '통계'); await bottom(p); }],
  ['info', async (p) => goStudy(p, '정보')],
  ['info2', async (p) => { await goStudy(p, '정보'); await bottom(p); }],
  ['chats', async (p) => p.click('#nav-chats')],
  ['room', async (p) => p.click('#nav-room')],
  ['pdf', async (p) => {
    await p.click('#nav-room');
    await p.locator('.mat-row', { hasText: '토익 기출 요약' }).first().click();
    await p.locator('.pdf-page canvas').first().waitFor({ timeout: 20000 });
    await p.waitForTimeout(900);
  }, async (p) => p.click('#viewer-back')],
  ['html', async (p) => {
    await p.click('#nav-room');
    await p.locator('.mat-row', { hasText: '문법 정리' }).first().click();
    await p.frameLocator('.html-frame').first().getByText('가정법 과거').first().waitFor({ timeout: 8000 });
  }, async (p) => p.click('#viewer-back')],
  ['md', async (p) => {
    await p.click('#nav-room');
    await p.locator('.mat-row', { hasText: '단어장' }).first().click();
    await p.locator('.prose').getByText('abandon').first().waitFor({ timeout: 8000 });
  }, async (p) => p.click('#viewer-back')],
  ['roomtimer', async (p) => {
    await p.click('#nav-room');
    await p.fill('#room-subject', '영어');
    await p.click('#room-start');
    await p.locator('#room-pause').waitFor();
    await ctx.clock.fastForward(12 * 60 * 1000 + 34000);
    await p.waitForTimeout(300);
  }],
  ['pill', async (p) => p.click('#nav-home')],
  ['timercheckin', async (p) => {
    await p.click('#room-pill');
    await p.click('#room-stop');
    await p.locator('#confirm-ok').click({ timeout: 1200 }).catch(() => undefined);
    await p.locator('#ci-submit').waitFor();
  }, async (p) => {
    await closeSheets(p);
    await p.click('#nav-home');
    // 남은 타이머 기록은 지운다(다음 화면에 영향이 없도록)
    const del = p.locator('.pending-card button[aria-label*="지우"], .pending button[aria-label*="지우"]').first();
    if (await del.count()) {
      await del.click();
      await p.locator('#confirm-ok').click({ timeout: 1200 }).catch(() => undefined);
    }
  }],
  ['my', async (p) => p.click('#nav-my')],
  ['my2', async (p) => { await p.click('#nav-my'); await p.locator('#main').evaluate((el) => el.scrollTo(0, 560)); }],
  ['my3', async (p) => { await p.click('#nav-my'); await bottom(p); }],
  ['notifs', async (p) => (await p.locator('#nav-notifs').isVisible()) ? p.click('#nav-notifs') : p.click('#top-notifs')],
  ['checkin', async (p) => {
    await p.click('#nav-home');
    await p.click('#home-checkin');
    await p.locator('#ci-submit').waitFor();
    await p.setInputFiles('#ci-album', [{ name: 'a.png', mimeType: 'image/png', buffer: A.photo2 }]);
    await p.locator('.photo-cell').first().waitFor();
    await p.fill('#ci-m', '40');
  }, closeSheets],
  ['create', async (p) => { await p.click('#nav-home'); await p.locator('#home-create').first().click(); await p.locator('#st-name').waitFor(); }, closeSheets],
  ['invite', async (p) => { await goStudy(p, '오늘'); await p.click('#study-invite'); await p.locator('#invite-code').waitFor(); }, closeSheets],
  ['startfocus', async (p) => { await p.click('#nav-start'); await p.locator('#focus-start').waitFor(); }, closeSheets],
  ['menu', async (p) => { await goStudy(p, '피드'); await p.locator('article.ci', { hasText: '단어' }).first().getByRole('button', { name: '인증 메뉴' }).click(); await p.locator('.menu').waitFor(); }, closeSheets],
  ['focus', async (p) => {
    await p.click('#nav-start');
    await p.fill('#focus-subject', '영어 듣기');
    await p.click('#focus-start');
    await p.locator('.focus').waitFor();
    await ctx.clock.fastForward(47 * 1000);
    await p.waitForTimeout(300);
  }, async (p) => {
    await p.click('#focus-end');
    await p.click('#focus-end-ok');
    await p.locator('#nav-home').waitFor();
  }],
];

const variants = [
  ['m', { width: 390, height: 844 }, 'light'],
  ['md', { width: 390, height: 844 }, 'dark'],
  ['dd', { width: 1280, height: 860 }, 'dark'],
  ['t', { width: 820, height: 1100 }, 'light'],
];

for (const [vn, vp, scheme] of variants) {
  if (only.length && !only.includes(vn)) continue;
  await mina.setViewportSize(vp);
  await mina.emulateMedia({ colorScheme: scheme });
  await mina.waitForTimeout(300);
  let i = 0;
  for (const [name, enter, leave] of views) {
    i++;
    try {
      await mina.locator('.toast-x').first().click({ timeout: 300 }).catch(() => undefined);
      await enter(mina);
      await shot(mina, `vz-${vn}-${String(i).padStart(2, '0')}-${name}`, { wait: 350 });
      if (leave) await leave(mina);
    } catch (e) {
      console.log(`  ✗ ${vn}/${name}: ${String(e.message).split('\n')[0]}`);
      await mina.screenshot({ path: `test/shots/vz-${vn}-${String(i).padStart(2, '0')}-${name}-FAIL.png` }).catch(() => undefined);
      await closeSheets(mina).catch(() => undefined);
    }
  }
  // 가입 화면
  const nu = await openUser(ctx, { u: 'new' + vn, role: 'editor', space });
  await nu.setViewportSize(vp);
  await nu.emulateMedia({ colorScheme: scheme });
  await nu.locator('#ob-start').waitFor({ timeout: 8000 });
  await nu.fill('#pf-nick', '새친구');
  await shot(nu, `vz-${vn}-00-onboarding`);
  await nu.close();
  ok('캡처: ' + vn);
}
report();
await browser.close();
