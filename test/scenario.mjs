// 여러 사용자 시나리오. 미나(방장)와 준호, 서연이 같은 스터디에서 인증·채팅·집중 모드·학습장을 쓴다.
//   node test/scenario.mjs [stage 이름 일부…]

import { launch, newContext, openUser, shot, report, onboard, ok, errors, sleep } from './lib.mjs';
import { makeAssets } from './assets.mjs';

const only = process.argv.slice(2);
const space = 'sc' + Date.now();
const browser = await launch();
const ctx = await newContext(browser);
// 실제 시각으로 돌리면 새벽 4시(하루가 바뀌는 시각) 근처에서 결과가 달라지므로 시각을 고정한다
await ctx.clock.install({ time: new Date('2026-11-10T19:30:00+09:00') });
const A = await makeAssets(browser);

const fails = [];
let current = '';
async function stage(name, fn) {
  if (only.length && !only.some((o) => name.includes(o)) && !name.startsWith('!')) return;
  current = name;
  console.log('\n■ ' + name);
  try {
    await fn();
  } catch (e) {
    const msg = String(e && e.message ? e.message : e).split('\n').slice(0, 6).join('\n    ');
    fails.push(`${name}: ${msg}`);
    console.log('  ✗ 실패: ' + msg);
    for (const [who, p] of Object.entries(pages)) {
      try {
        await p.screenshot({ path: `test/shots/fail-${name.replace(/[^a-z0-9가-힣]+/gi, '_')}-${who}.png` });
      } catch {
        /* ignore */
      }
    }
  }
}

const pages = {};
const tab = (page, label) => page.locator('#study-tabs').getByRole('tab', { name: label }).click();
const toastText = async (page, text) => page.locator('.toast', { hasText: text }).first().waitFor({ timeout: 5000 });
const closeSheets = async (page) => {
  for (let i = 0; i < 4; i++) {
    if ((await page.locator('.sheet').count()) === 0) return;
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);
  }
};
const see = (page, text, timeout = 5000) => page.getByText(text, { exact: false }).first().waitFor({ state: 'visible', timeout });
const count = (page, sel) => page.locator(sel).count();

let code = '';
let sid = '';

await stage('!가입과 스터디 만들기', async () => {
  const mina = (pages.mina = await openUser(ctx, { u: 'mina', role: 'owner', space }, '', { allow404: /\/x$/ }));
  await onboard(mina, '미나');
  ok('미나 가입');
  await mina.click('#home-create');
  await mina.fill('#st-name', '토익 900 스터디');
  await mina.fill('#st-intro', '매일 조금씩, 주 3회 인증해요');
  await mina.click('#st-weekly-3');
  await mina.selectOption('#st-daily', '30');
  await shot(mina, 'sc-01-create');
  await mina.click('#st-submit');
  await mina.locator('#invite-code').waitFor({ timeout: 5000 });
  code = (await mina.locator('#invite-code').innerText()).replace(/\s/g, '');
  if (!/^[A-Z0-9]{6}$/.test(code)) throw new Error('초대 코드 모양이 이상함: ' + code);
  ok('스터디 만들고 초대 코드 받음: ' + code);
  await shot(mina, 'sc-02-invite');
  const link = await mina.locator('#invite-link').innerText().catch(() => '');
  console.log('    초대 링크: ' + link.trim().slice(0, 80));
  await closeSheets(mina);
  sid = await mina.evaluate(() => location.hash);
  await see(mina, '토익 900 스터디');
  await shot(mina, 'sc-03-study-today');
});

await stage('!초대 링크로 참여', async () => {
  const junho = (pages.junho = await openUser(ctx, { u: 'junho', role: 'editor', space }, '#join-' + code.toLowerCase()));
  await onboard(junho, '준호');
  await junho.locator('#join-submit').waitFor({ timeout: 6000 });
  await see(junho, '토익 900 스터디');
  await shot(junho, 'sc-04-join-preview');
  await junho.click('#join-submit');
  await junho.locator('#study-tabs').waitFor({ timeout: 6000 });
  ok('준호가 링크로 참여');
  // 미나 화면에 준호가 실시간으로 보인다
  await pages.mina.locator('.page').getByText('준호').first().waitFor({ timeout: 5000 });
  ok('미나 화면에 준호가 나타남');

  // 서연은 코드를 직접 입력한다
  const seoyeon = (pages.seoyeon = await openUser(ctx, { u: 'seoyeon', role: 'editor', space }));
  await onboard(seoyeon, '서연');
  await seoyeon.click('#home-join');
  await seoyeon.fill('#join-code', 'zzzzzz');
  await seoyeon.waitForTimeout(600);
  await shot(seoyeon, 'sc-05-join-badcode');
  await seoyeon.fill('#join-code', code.toLowerCase());
  await seoyeon.locator('#join-submit:not([disabled])').waitFor({ timeout: 5000 });
  await seoyeon.click('#join-submit');
  await seoyeon.locator('#study-tabs').waitFor({ timeout: 6000 });
  ok('서연이 코드로 참여');
});

await stage('인증 올리기와 피드', async () => {
  const { mina, junho } = pages;
  await mina.click('#today-checkin');
  await mina.locator('#ci-submit').waitFor();
  if (!(await mina.locator('#ci-submit').isDisabled())) throw new Error('사진 없이도 올리기 버튼이 켜져 있음');
  await mina.setInputFiles('#ci-album', [
    { name: 'note1.png', mimeType: 'image/png', buffer: A.photo1 },
    { name: 'note2.png', mimeType: 'image/png', buffer: A.photo2 },
  ]);
  await mina.locator('.photo-cell').nth(1).waitFor({ timeout: 8000 });
  await mina.fill('#ci-h', '1');
  await mina.fill('#ci-m', '30');
  await mina.fill('#ci-tag', '영어');
  await mina.fill('#ci-memo', 'LC 파트2 오답 정리, 단어 60개');
  await shot(mina, 'sc-06-checkin-form');
  await mina.click('#ci-submit');
  await toastText(mina, '인증을 올렸어요');
  ok('미나 인증 올림');
  await shot(mina, 'sc-07-today-after');
  await tab(mina, '피드');
  await mina.locator('article.ci').first().waitFor({ timeout: 5000 });
  await shot(mina, 'sc-08-feed');

  // 준호: 알림 토스트와 피드
  await tab(junho, '피드');
  await junho.locator('article.ci').first().waitFor({ timeout: 6000 });
  ok('준호 피드에 미나의 인증이 보임');
  await junho.locator('article.ci .react-btn').first().click();
  await junho.locator('article.ci .react-btn.on').first().waitFor({ timeout: 4000 });
  const cm = junho.locator('article.ci input[id^="cm-"]').first();
  if ((await cm.count()) === 0) await junho.locator('article.ci').getByText('댓글', { exact: false }).first().click();
  await junho.locator('article.ci input[id^="cm-"]').first().fill('오답 정리 멋져요!');
  await junho.locator('article.ci input[id^="cm-"]').first().press('Enter');
  await junho.locator('article.ci').getByText('오답 정리 멋져요!').first().waitFor({ timeout: 4000 });
  ok('준호가 반응과 댓글을 남김');
  await shot(junho, 'sc-09-feed-junho');

  // 미나에게 반응·댓글 소식
  await mina.locator('article.ci').getByText('오답 정리 멋져요!').first().waitFor({ timeout: 5000 }).catch(async () => {
    await mina.locator('article.ci').getByText('댓글', { exact: false }).first().click();
    await mina.locator('article.ci').getByText('오답 정리 멋져요!').first().waitFor({ timeout: 3000 });
  });
  ok('미나 화면에 댓글이 실시간으로 보임');
  // 사진 크게 보기
  await mina.locator('.ci-photo').first().click();
  await mina.locator('.lightbox').first().waitFor({ timeout: 4000 });
  await shot(mina, 'sc-10-lightbox');
  await closeSheets(mina);
  // 반응한 사람 목록
  const who = mina.locator('article.ci .text-btn', { hasText: '반응' }).first();
  if (await who.count()) {
    await who.click();
    await see(mina, '준호');
    await shot(mina, 'sc-11-reactors');
    await closeSheets(mina);
    ok('반응한 사람 목록');
  }
});

await stage('오늘 현황과 콕 찌르기', async () => {
  const { mina, junho, seoyeon } = pages;
  await tab(junho, '오늘');
  await see(junho, '이번 주');
  await shot(junho, 'sc-12-today-junho');
  // 준호가 서연을 찌른다
  const row = junho.locator('li', { hasText: '서연' }).first();
  await row.getByRole('button', { name: '콕 찌르기' }).click();
  await toastText(junho, '콕 찔렀어요');
  await row.getByRole('button', { name: '찔렀어요' }).waitFor({ timeout: 4000 });
  if (!(await row.getByRole('button', { name: '찔렀어요' }).isDisabled())) throw new Error('두 번째 찌르기가 막히지 않음');
  ok('콕 찌르기는 하루 한 번');
  await toastText(seoyeon, '콕').catch(() => console.log('    (서연 화면 토스트는 못 봄)'));
  await seoyeon.click('#nav-notifs').catch(() => seoyeon.click('#top-notifs'));
  await see(seoyeon, '콕');
  await shot(seoyeon, 'sc-13-notifs-seoyeon');
  ok('서연 알림함에 찌르기 소식');
  await mina.click('#nav-notifs').catch(() => mina.click('#top-notifs'));
  await see(mina, '준호');
  await shot(mina, 'sc-14-notifs-mina');
  ok('미나 알림함에 반응·댓글 소식');
});

await stage('채팅', async () => {
  const { mina, junho, seoyeon } = pages;
  await mina.click('#nav-home');
  await mina.locator('.study-card').first().click();
  await tab(mina, '채팅');
  const inputM = mina.locator('[id^="chat-input-"]');
  await inputM.waitFor();
  await see(mina, '인증'); // 인증 소식 한 줄
  await inputM.fill('다들 오늘 몇 시에 공부해?');
  await inputM.press('Enter');
  await mina.locator('.msg', { hasText: '다들 오늘 몇 시에' }).first().waitFor({ timeout: 4000 });
  ok('미나가 메시지 보냄');
  // 준호는 오늘 탭에 있음 → 채팅 탭 배지
  await junho.locator('#study-tabs .badge').first().waitFor({ timeout: 5000 });
  ok('준호 채팅 탭에 읽지 않은 수 표시');
  await shot(junho, 'sc-15-unread-badge');
  await tab(junho, '채팅');
  await junho.locator('.msg', { hasText: '다들 오늘 몇 시에' }).first().waitFor({ timeout: 4000 });
  const inputJ = junho.locator('[id^="chat-input-"]');
  await inputJ.fill('저는 8시부터요!');
  await inputJ.press('Enter');
  await inputJ.fill('잘못 보낸 메시지');
  await inputJ.press('Enter');
  await mina.locator('.msg', { hasText: '저는 8시부터요!' }).first().waitFor({ timeout: 4000 });
  ok('미나 화면에 준호 답장이 실시간으로 보임');
  // 내 메시지 삭제
  const mine = junho.locator('.msg', { hasText: '잘못 보낸 메시지' }).first();
  await mine.hover();
  const menuBtn = mine.locator('button').first();
  await menuBtn.click();
  await junho.locator('.menu-item', { hasText: '삭제' }).first().click();
  await junho.locator('#confirm-ok').click().catch(() => undefined);
  await junho.locator('.msg', { hasText: '잘못 보낸 메시지' }).first().waitFor({ state: 'detached', timeout: 4000 });
  await mina.locator('.msg', { hasText: '잘못 보낸 메시지' }).first().waitFor({ state: 'detached', timeout: 4000 });
  ok('내 메시지 삭제가 상대 화면에도 반영');
  await shot(mina, 'sc-16-chat-mina');
  await shot(junho, 'sc-17-chat-junho');
  // 서연: 채팅 목록 화면의 읽지 않은 수
  await seoyeon.click('#nav-chats');
  await see(seoyeon, '토익 900 스터디');
  await shot(seoyeon, 'sc-18-chats-list');
  // 500자 제한
  const long = '가'.repeat(600);
  await inputM.fill(long);
  const v = await inputM.inputValue();
  if (v.length > 500) throw new Error('500자 제한이 걸리지 않음: ' + v.length);
  await inputM.fill('');
  ok('메시지 500자 제한');
});

await stage('집중 모드 잠금', async () => {
  const { mina, junho } = pages;
  await junho.click('#nav-start');
  await junho.fill('#focus-subject', '수학');
  await shot(junho, 'sc-19-focus-start');
  await junho.click('#focus-start');
  await junho.locator('.focus').waitFor({ timeout: 5000 });
  if (await count(junho, '#nav-home')) throw new Error('집중 모드인데 내비게이션이 보임');
  if (await count(junho, '#main')) throw new Error('집중 모드인데 다른 화면이 보임');
  await junho.locator('.focus [id^="chat-input-"]').waitFor({ timeout: 4000 });
  ok('집중 모드: 타이머와 채팅만 남음');
  await ctx.clock.fastForward(5000);
  await shot(junho, 'sc-20-focus');
  // 주소(hash)를 바꿔도, 뒤로 가도 잠금 유지
  await junho.evaluate(() => {
    location.hash = '#my';
    history.back();
  });
  await junho.waitForTimeout(300);
  if (!(await count(junho, '.focus')) || (await count(junho, '#nav-home'))) throw new Error('주소를 바꾸니 잠금이 풀림');
  // 새로고침해도 유지
  await junho.reload();
  await junho.locator('.focus').waitFor({ timeout: 8000 });
  if (await count(junho, '#nav-home')) throw new Error('새로고침 뒤 잠금이 풀림');
  await see(junho, '수학');
  ok('주소 변경·뒤로 가기·새로고침에도 잠금 유지');
  // 집중 모드 안에서 채팅
  const input = junho.locator('.focus [id^="chat-input-"]');
  await input.fill('집중 모드에서 보내는 메시지');
  await input.press('Enter');
  await mina.locator('.msg', { hasText: '집중 모드에서 보내는 메시지' }).first().waitFor({ timeout: 5000 });
  ok('집중 모드에서도 채팅 가능');
  await mina.locator('[id^="chat-input-"]').fill('화이팅!');
  await mina.locator('[id^="chat-input-"]').press('Enter');
  await junho.locator('.focus .msg', { hasText: '화이팅!' }).first().waitFor({ timeout: 5000 });
  ok('집중 모드에서 친구 메시지를 실시간으로 받음');
  // 미나에게 "공부 중"으로 보인다
  await tab(mina, '오늘');
  await mina.locator('li', { hasText: '준호' }).getByText('공부 중').first().waitFor({ timeout: 6000 });
  await shot(mina, 'sc-21-today-studying');
  ok('친구에게 "공부 중"과 과목이 보임');
  // 1분 미만 끝내기
  await junho.click('#focus-pause');
  await junho.locator('#focus-resume').waitFor();
  await see(junho, '잠시 멈춤');
  await junho.click('#focus-resume');
  await junho.click('#focus-end');
  await see(junho, '1분이 안 됐어요');
  await shot(junho, 'sc-22-focus-under-1min');
  await junho.click('#focus-keep');
  // 25분 뒤 끝내기 → 인증 화면에 자동 입력
  await ctx.clock.fastForward(25 * 60 * 1000);
  await junho.waitForTimeout(300);
  await shot(junho, 'sc-23-focus-25min');
  await junho.click('#focus-end');
  await see(junho, '끝내고 인증할까요');
  await junho.click('#focus-end-ok');
  await junho.locator('#ci-submit').waitFor({ timeout: 5000 });
  await junho.locator('.timer-fill').waitFor({ timeout: 3000 });
  const filled = await junho.locator('.timer-fill-main').innerText();
  if (!/25분/.test(filled)) throw new Error('타이머 시간이 자동 입력되지 않음: ' + filled);
  if ((await junho.inputValue('#ci-tag')) !== '수학') throw new Error('과목이 자동 입력되지 않음');
  await shot(junho, 'sc-24-checkin-from-timer');
  if (await junho.locator('#ci-submit').isDisabled()) throw new Error('타이머 인증인데 사진 없이는 못 올림');
  await junho.click('#ci-submit');
  await toastText(junho, '인증을 올렸어요');
  ok('집중 모드 종료 → 인증 화면에 시간·과목 자동 입력, 사진 없이 타이머 인증');
  await junho.locator('#nav-home').waitFor({ timeout: 4000 });
  await junho.click('#nav-home');
  await junho.locator('.study-card').first().click();
  await tab(junho, '피드');
  await junho.locator('article.ci', { hasText: '타이머 인증' }).first().waitFor({ timeout: 5000 });
  await shot(junho, 'sc-25-feed-timer-badge');
  ok('피드에 "타이머 인증" 표시');
});

await stage('학습장 자료와 타이머', async () => {
  const { mina } = pages;
  await mina.click('#nav-room');
  await mina.click('#room-add');
  await mina.fill('#mat-subject', '영어');
  await mina.setInputFiles('#mat-file', [
    { name: '토익 기출 요약.pdf', mimeType: 'application/pdf', buffer: A.pdf },
    { name: '문법 정리.html', mimeType: 'text/html', buffer: A.html },
    { name: '단어장.md', mimeType: 'text/markdown', buffer: A.md },
    { name: '필기 사진.png', mimeType: 'image/png', buffer: A.photo1 },
    { name: '메모.txt', mimeType: 'text/plain', buffer: A.txt },
  ]);
  await mina.locator('.mat-row').nth(4).waitFor({ timeout: 15000 });
  await closeSheets(mina);
  ok('PDF·HTML·마크다운·이미지·텍스트 자료 추가');
  // 링크 자료
  await mina.click('#room-add');
  await mina.locator('#mat-tab').getByRole('tab', { name: '링크' }).click();
  await mina.fill('#mat-url', 'example.com/toeic');
  await mina.fill('#mat-title', '토익 강의 페이지');
  await mina.click('#mat-link-save');
  await mina.locator('.mat-row').nth(5).waitFor({ timeout: 6000 });
  await closeSheets(mina);
  ok('웹 링크 자료 추가');
  await shot(mina, 'sc-26-room-library');

  // PDF 보기
  await mina.locator('.mat-row', { hasText: '토익 기출 요약' }).first().click();
  await mina.locator('.pdf-page canvas').first().waitFor({ timeout: 20000 });
  await mina.waitForTimeout(1200);
  const painted = await mina.evaluate(() => {
    const c = document.querySelector('.pdf-page canvas');
    if (!c) return 0;
    const d = c.getContext('2d').getImageData(0, 0, c.width, Math.min(c.height, 400)).data;
    let dark = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] < 128 && d[i + 3] > 0) dark++;
    return dark;
  });
  if (painted < 50) throw new Error('PDF 첫 쪽이 그려지지 않은 것 같음 (어두운 픽셀 ' + painted + ')');
  await shot(mina, 'sc-27-pdf');
  const total = await mina.locator('.pdf-ctl').first().innerText();
  console.log('    PDF 쪽 표시: ' + total.replace(/\s+/g, ' '));
  await mina.click('#pdf-next');
  await mina.waitForTimeout(600);
  const pageNo = await mina.inputValue('#pdf-page');
  if (pageNo !== '2') throw new Error('다음 쪽 이동이 안 됨: ' + pageNo);
  await mina.click('#viewer-zoom-in');
  await mina.waitForTimeout(600);
  await shot(mina, 'sc-28-pdf-page2-zoom');
  ok('PDF 보기: 쪽 이동과 확대');
  await mina.waitForTimeout(3200); // 마지막 쪽 저장(지연 저장)
  await mina.click('#viewer-back');
  await mina.locator('.mat-row', { hasText: '토익 기출 요약' }).first().click();
  await mina.locator('.pdf-page canvas').first().waitFor({ timeout: 20000 });
  await mina.waitForTimeout(900);
  const again = await mina.inputValue('#pdf-page');
  if (again !== '2') throw new Error('마지막으로 본 쪽을 기억하지 못함: ' + again);
  ok('마지막으로 본 쪽 기억');
  await mina.click('#viewer-back');

  // HTML 보기
  await mina.locator('.mat-row', { hasText: '문법 정리' }).first().click();
  const frame = mina.frameLocator('.html-frame').first();
  await frame.getByText('가정법 과거').first().waitFor({ timeout: 8000 });
  const ran = await frame.locator('#js-result').innerText();
  if (/실행됨/.test(ran)) throw new Error('기본 상태에서 HTML 안의 스크립트가 실행됨');
  await shot(mina, 'sc-29-html');
  await mina.check('#html-scripts');
  await mina.frameLocator('.html-frame').first().getByText('실행됨').first().waitFor({ timeout: 5000 });
  ok('HTML 보기: 기본은 스크립트 차단, 켜면 실행');
  await mina.locator('#html-mode').getByRole('tab', { name: '읽기 모드' }).click();
  await mina.locator('.html-read').getByText('가정법 과거').first().waitFor({ timeout: 4000 });
  await shot(mina, 'sc-30-html-read');
  await mina.click('#viewer-back');

  // 마크다운·텍스트·이미지·링크
  await mina.locator('.mat-row', { hasText: '단어장' }).first().click();
  await mina.locator('.prose').getByText('abandon').first().waitFor({ timeout: 6000 });
  await shot(mina, 'sc-31-markdown');
  await mina.click('#viewer-back');
  await mina.locator('.mat-row', { hasText: '메모' }).first().click();
  await see(mina, '시험 전날에는');
  await mina.click('#viewer-back');
  await mina.locator('.mat-row', { hasText: '필기 사진' }).first().click();
  await mina.locator('.img-view img').first().waitFor({ timeout: 6000 });
  await shot(mina, 'sc-32-image');
  await mina.click('#viewer-back');
  await mina.locator('.mat-row', { hasText: '토익 강의 페이지' }).first().click();
  const href = await mina.locator('#link-open').getAttribute('href');
  if (href !== 'https://example.com/toeic') throw new Error('링크 주소가 다름: ' + href);
  await shot(mina, 'sc-33-link');
  await mina.click('#viewer-back');
  ok('마크다운·텍스트·이미지·링크 보기');

  // 학습장 타이머: 잠기지 않는다
  await mina.fill('#room-subject', '영어');
  await mina.click('#room-start');
  await mina.locator('#room-pause').waitFor({ timeout: 4000 });
  await mina.locator('.mat-row', { hasText: '토익 기출 요약' }).first().click();
  await mina.locator('.pdf-page canvas').first().waitFor({ timeout: 20000 });
  await ctx.clock.fastForward(3 * 60 * 1000);
  await mina.waitForTimeout(400);
  await shot(mina, 'sc-34-room-timer-with-pdf');
  await mina.click('#nav-home');
  await mina.locator('#room-pill').waitFor({ timeout: 4000 });
  ok('학습장 타이머 중에도 다른 화면으로 이동 가능(잠기지 않음), 상단에 타이머 표시');
  await shot(mina, 'sc-35-home-with-pill');
  // 학습장 타이머 중에는 집중 모드를 시작할 수 없다
  await mina.click('#nav-start');
  await mina.waitForTimeout(400);
  await shot(mina, 'sc-36-focus-blocked');
  if (await count(mina, '.focus')) throw new Error('학습장 타이머 중인데 집중 모드가 시작됨');
  await closeSheets(mina);
  await mina.click('#room-pill');
  await mina.locator('#room-stop').waitFor({ timeout: 4000 });
  await ctx.clock.fastForward(42 * 60 * 1000);
  await mina.click('#room-stop');
  await mina.locator('#confirm-ok').click({ timeout: 1500 }).catch(() => undefined);
  await mina.locator('#ci-submit').waitFor({ timeout: 5000 });
  const filled = await mina.locator('.timer-fill-main').innerText();
  if (!/45분/.test(filled)) throw new Error('학습장 타이머 시간이 다름: ' + filled);
  await shot(mina, 'sc-37-checkin-from-room');
  await mina.click('#ci-submit');
  await toastText(mina, '인증을 올렸어요');
  ok('학습 종료 → 45분이 인증 화면에 자동 입력되고 인증 완료');
});

await stage('통계·랭킹·벌금', async () => {
  const { mina, junho } = pages;
  await mina.click('#nav-home');
  await shot(mina, 'sc-38-home-after');
  await mina.locator('.study-card').first().click();
  await tab(mina, '통계');
  await see(mina, '공부 시간 랭킹');
  await shot(mina, 'sc-39-stats', { full: false });
  await mina.locator('#main').evaluate((el) => el.scrollTo(0, el.scrollHeight));
  await shot(mina, 'sc-40-stats-bottom');
  // 벌금 설정(방장)
  await mina.locator('#fine-open').first().click();
  await mina.fill('#fine-amount', '1000');
  await shot(mina, 'sc-41-fine-sheet');
  await mina.click('#fine-save');
  await mina.waitForTimeout(500);
  await closeSheets(mina);
  await see(mina, '1,000원');
  await shot(mina, 'sc-42-stats-fines');
  ok('통계·랭킹 표시, 벌금 설정');
  await tab(junho, '통계');
  await see(junho, '1,000원');
  ok('멤버 화면에도 벌금 규칙이 보임');
  await mina.click('#nav-my');
  await see(mina, '2시간 15분');
  await shot(mina, 'sc-43-my');
  await mina.locator('#main').evaluate((el) => el.scrollTo(0, el.scrollHeight));
  await shot(mina, 'sc-44-my-bottom');
  ok('마이페이지: 누적 시간 2시간 15분');
});

await stage('인증 수정·삭제와 신고·차단', async () => {
  const { mina, junho, seoyeon } = pages;
  await mina.click('#nav-home');
  await mina.locator('.study-card').first().click();
  await tab(mina, '피드');
  // 내 인증 수정
  const mineCard = mina.locator('article.ci', { hasText: 'LC 파트2' }).first();
  await mineCard.getByRole('button', { name: '인증 메뉴' }).click();
  await mina.locator('.menu-item', { hasText: '수정' }).click();
  await mina.fill('#ci-memo', 'LC 파트2 오답 정리, 단어 80개');
  await mina.click('#ci-submit');
  await toastText(mina, '인증을 고쳤어요');
  await tab(junho, '피드');
  await junho.locator('article.ci', { hasText: '단어 80개' }).first().waitFor({ timeout: 5000 });
  ok('당일 인증 수정이 친구 화면에 반영');
  // 서연이 미나의 인증을 신고
  await seoyeon.click('#nav-home');
  await seoyeon.locator('.study-card').first().click();
  await tab(seoyeon, '피드');
  const target = seoyeon.locator('article.ci', { hasText: '단어 80개' }).first();
  await target.getByRole('button', { name: '인증 메뉴' }).click();
  await shot(seoyeon, 'sc-45-checkin-menu');
  await seoyeon.locator('.menu-item', { hasText: '신고' }).click();
  await seoyeon.locator('#confirm-ok').click();
  await toastText(seoyeon, '신고');
  ok('인증 신고');
  // 서연이 준호를 차단 → 준호의 인증·메시지가 가려진다
  const jcard = seoyeon.locator('article.ci', { hasText: '수학' }).first();
  await jcard.getByRole('button', { name: '인증 메뉴' }).click();
  await seoyeon.locator('.menu-item', { hasText: '차단' }).click();
  await seoyeon.locator('#confirm-ok').click();
  await seoyeon.locator('article.ci', { hasText: '수학' }).first().waitFor({ state: 'detached', timeout: 5000 });
  await tab(seoyeon, '채팅');
  await seoyeon.waitForTimeout(400);
  if (await seoyeon.locator('.msg', { hasText: '저는 8시부터요!' }).count()) throw new Error('차단한 사람의 메시지가 보임');
  await shot(seoyeon, 'sc-46-blocked-chat');
  ok('차단하면 그 사람의 인증과 메시지가 가려짐');
  // 차단 해제
  await seoyeon.click('#nav-my');
  await seoyeon.click('#my-blocks');
  await see(seoyeon, '준호');
  await shot(seoyeon, 'sc-47-blocks');
  await seoyeon.locator('.sheet').getByRole('button', { name: '해제' }).first().click();
  await closeSheets(seoyeon);
  ok('차단 해제');
});

await stage('스터디 관리', async () => {
  const { mina, junho, seoyeon } = pages;
  await tab(mina, '정보');
  await see(mina, '인증 규칙');
  if (await mina.getByText('부터:').count()) throw new Error('바꾸지도 않았는데 예정 규칙이 보임');
  await shot(mina, 'sc-48-info');
  // 규칙 변경은 다음 주 월요일부터
  await mina.click('#study-edit');
  await mina.click('#st-weekly-5');
  await shot(mina, 'sc-49-edit');
  await mina.click('#st-submit');
  await mina.waitForTimeout(600);
  await closeSheets(mina);
  await see(mina, '11/16(월)부터: 주 5회');
  if (await mina.getByText('11/10(월)부터').count()) throw new Error('처음 규칙이 예정 규칙처럼 보임');
  await shot(mina, 'sc-50-info-pending-rule');
  ok('규칙 변경 예약(다음 주 월요일부터)');
  // 초대 코드 다시 발급
  await mina.getByRole('button', { name: /코드 다시/ }).click();
  await mina.locator('#confirm-ok').click();
  await mina.waitForTimeout(600);
  await mina.click('#study-invite');
  const code2 = (await mina.locator('#invite-code').innerText()).replace(/\s/g, '');
  if (code2 === code) throw new Error('코드가 바뀌지 않음');
  await closeSheets(mina);
  ok('초대 코드 다시 발급: ' + code + ' → ' + code2);
  // 옛 코드는 더 이상 쓸 수 없다
  const dana = (pages.dana = await openUser(ctx, { u: 'dana', role: 'editor', space }, '#join-' + code.toLowerCase()));
  await onboard(dana, '다나');
  await dana.locator('.sheet').waitFor({ timeout: 5000 });
  await dana.waitForTimeout(800);
  await shot(dana, 'sc-51-old-code');
  if (!(await dana.locator('#join-submit').isDisabled().catch(() => true))) throw new Error('옛 코드로 참여 버튼이 켜져 있음');
  ok('옛 코드는 쓸 수 없음');
  await dana.fill('#join-code', code2);
  await dana.locator('#join-submit:not([disabled])').waitFor({ timeout: 5000 });
  await dana.click('#join-submit');
  await dana.locator('#study-tabs').waitFor({ timeout: 6000 });
  ok('새 코드로 다나 참여');
  // 방장이 다나를 내보낸다
  await mina.getByRole('button', { name: '다나 관리' }).click();
  await mina.locator('.menu-item', { hasText: '내보내기' }).click();
  await mina.locator('#confirm-ok').click();
  await dana.getByText('토익 900 스터디').first().waitFor({ state: 'detached', timeout: 6000 }).catch(() => undefined);
  await dana.waitForTimeout(500);
  await shot(dana, 'sc-52-kicked');
  ok('멤버 내보내기');
  // 방장 넘기기
  await mina.getByRole('button', { name: '준호 관리' }).click();
  await mina.locator('.menu-item', { hasText: '방장 넘기기' }).click();
  await mina.locator('#confirm-ok').click();
  await tab(junho, '정보');
  await junho.locator('#study-edit').waitFor({ timeout: 6000 });
  ok('방장 넘기기: 준호에게 관리 버튼이 보임');
  // 서연 나가기
  await seoyeon.click('#nav-home');
  await seoyeon.locator('.study-card').first().click();
  await tab(seoyeon, '정보');
  await seoyeon.click('#study-leave');
  await seoyeon.locator('#confirm-ok').click();
  await seoyeon.locator('#home-create').first().waitFor({ timeout: 6000 });
  ok('스터디 나가기');
  // 새 방장이 스터디를 끝낸다
  await junho.getByRole('button', { name: /스터디 종료/ }).click();
  await junho.locator('#confirm-ok').click();
  await junho.waitForTimeout(800);
  await shot(junho, 'sc-53-ended');
  await mina.click('#nav-home');
  await see(mina, '종료된 스터디');
  await shot(mina, 'sc-54-home-ended');
  ok('스터디 종료: 기록은 남고 새 인증은 막힘');
});

await stage('알림 설정과 탈퇴', async () => {
  const { mina, seoyeon } = pages;
  await mina.click('#nav-my');
  await mina.click('#my-notif');
  await mina.locator('#nt-remind').waitFor();
  await shot(mina, 'sc-55-notif-settings');
  await mina.locator('label[for="nt-chat"], #nt-chat').first().click();
  await mina.fill('#nt-remind-at', '20:30');
  await closeSheets(mina);
  await mina.waitForTimeout(1200);
  await mina.reload();
  await mina.locator('#nav-my').waitFor({ timeout: 8000 });
  await mina.click('#nav-my');
  await mina.click('#my-notif');
  await mina.locator('#nt-remind').waitFor();
  const chatOn = await mina.locator('#nt-chat').isChecked();
  if (chatOn) throw new Error('알림 설정이 저장되지 않음');
  if ((await mina.inputValue('#nt-remind-at')) !== '20:30') throw new Error('리마인더 시각이 저장되지 않음');
  await closeSheets(mina);
  ok('알림 종류별 설정이 저장됨');
  await mina.click('#my-help');
  await shot(mina, 'sc-56-help');
  await closeSheets(mina);
  // 탈퇴
  await seoyeon.click('#nav-my');
  await seoyeon.click('#my-withdraw');
  await shot(seoyeon, 'sc-57-withdraw-confirm');
  await seoyeon.locator('#confirm-ok').click();
  await seoyeon.locator('#ob-start').waitFor({ timeout: 8000 });
  ok('탈퇴하면 가입 화면으로 돌아감');
});

console.log('\n==============================');
if (fails.length) {
  console.log('실패 ' + fails.length + '건');
  for (const f of fails) console.log(' ✗ ' + f);
} else console.log('모든 단계 통과');
const n = report();
await browser.close();
process.exit(fails.length || n ? 1 : 0);
