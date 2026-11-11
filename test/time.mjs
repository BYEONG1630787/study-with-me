// 날짜가 넘어가는 경우: 다음 날, 연속 인증, 주간 달성, 규칙 변경 적용, 주간 결산, 벌금 장부.
import { launch, newContext, openUser, shot, onboard, ok, makeStages, tab, toastText, see, count, closeSheets, checkin, jumpTo } from './lib.mjs';
import { makeAssets } from './assets.mjs';

const space = 'tm' + Date.now();
const browser = await launch();
const ctx = await newContext(browser);
// 2026-11-10 (화) 오후 9시 30분 KST 에서 시작
await ctx.clock.install({ time: new Date('2026-11-10T21:30:00+09:00') });
const A = await makeAssets(browser);
const pages = {};
const { stage, finish } = makeStages(pages, process.argv.slice(2));
let code = '';

await stage('!준비: 스터디와 멤버', async () => {
  const mina = (pages.mina = await openUser(ctx, { u: 'mina', role: 'owner', space }));
  await onboard(mina, '미나');
  await mina.click('#home-create');
  await mina.fill('#st-name', '아침 공부방');
  await mina.click('#st-weekly-3');
  await mina.selectOption('#st-daily', '30');
  await mina.click('#st-submit');
  await mina.locator('#invite-code').waitFor();
  code = (await mina.locator('#invite-code').innerText()).replace(/\s/g, '');
  await closeSheets(mina);
  const junho = (pages.junho = await openUser(ctx, { u: 'junho', role: 'editor', space }, '#join-' + code.toLowerCase()));
  await onboard(junho, '준호');
  await junho.click('#join-submit');
  await junho.locator('#study-tabs').waitFor();
  // 벌금 1,000원
  await tab(mina, '통계');
  await mina.locator('#fine-open').first().click();
  await mina.fill('#fine-amount', '1000');
  await mina.click('#fine-save');
  await closeSheets(mina);
  await tab(mina, '오늘');
  ok('스터디(주 3회·하루 30분), 멤버 2명, 벌금 1,000원');
});

await stage('1일차(화): 인증과 부분 인증', async () => {
  const { mina, junho } = pages;
  await checkin(mina, A.photo1, { h: 1, m: 0, tag: '영어' });
  await see(mina, '오늘 인증을 마쳤어요');
  await checkin(junho, A.photo2, { m: 20, tag: '수학' });
  // 하루 최소 30분을 못 채웠으니 "10분 더 인증하기"
  await see(junho, '10분 더 인증하기');
  await shot(junho, 'tm-01-partial');
  ok('30분 미만은 인증 횟수로 세지 않고 "10분 더 인증하기"로 안내');
  await checkin(junho, A.photo1, { m: 15, tag: '수학' });
  await see(junho, '오늘 인증을 마쳤어요');
  ok('같은 날 인증을 합산해서 최소 시간을 채우면 완료 (20분 + 15분)');
  // 규칙을 주 5회로 바꾸기(다음 주 월요일부터)
  await tab(mina, '정보');
  await mina.click('#study-edit');
  await mina.click('#st-weekly-5');
  await mina.click('#st-submit');
  await closeSheets(mina);
  await see(mina, '11/16(월)부터: 주 5회');
  ok('규칙 변경 예약');
  // 준호가 집중 모드로 30분 공부하고 인증하지 않은 채 둔다
  await junho.click('#nav-start');
  await junho.click('#focus-start');
  await junho.locator('.focus').waitFor();
  await ctx.clock.fastForward(30 * 60 * 1000);
  await junho.click('#focus-end');
  await junho.click('#focus-end-ok');
  await junho.locator('#ci-submit').waitFor();
  await closeSheets(junho);
  await junho.click('#nav-home');
  await junho.locator('#pending-checkin').waitFor({ timeout: 4000 });
  await shot(junho, 'tm-02-pending');
  ok('인증하지 않은 공부 30분이 홈에 남음');
});

await stage('2일차(수): 날짜가 바뀐 뒤', async () => {
  const { mina, junho } = pages;
  await jumpTo(ctx, mina, '2026-11-11T07:00');
  await mina.click('#nav-home');
  await see(mina, '11월 11일 (수)');
  await see(mina, '채워 볼까요');
  await shot(mina, 'tm-03-next-day-home');
  ok('새벽 4시가 지나면 오늘이 수요일로 바뀌고 인증 전 상태가 됨');
  if (await count(junho, '#pending-checkin')) throw new Error('전날 인증하지 않은 공부가 다음 날에도 남아 있음');
  ok('전날 인증하지 않은 타이머 기록은 사라짐');
  // 어제 인증은 수정할 수 없다
  await mina.locator('.study-card').first().click();
  await tab(mina, '피드');
  await mina.locator('article.ci').first().waitFor();
  const menus = await mina.locator('article.ci', { hasText: '미나' }).getByRole('button', { name: '인증 메뉴' }).count();
  if (menus) throw new Error('어제 올린 내 인증에 수정 메뉴가 보임');
  await see(mina, '어제');
  await shot(mina, 'tm-04-feed-yesterday');
  ok('어제 인증은 수정·삭제 메뉴가 없음, 피드가 날짜별로 묶임');
  await tab(mina, '오늘');
  await checkin(mina, A.photo2, { m: 45, tag: '영어' });
  await mina.click('#nav-home');
  await see(mina, '2일');
  await shot(mina, 'tm-05-streak2');
  ok('이틀 연속 인증 → 연속 2일');
});

await stage('3일차(목): 주간 목표 달성', async () => {
  const { mina } = pages;
  await jumpTo(ctx, mina, '2026-11-12T20:00');
  await mina.click('#nav-home');
  await see(mina, '11월 12일 (목)');
  await mina.locator('.study-card').first().click();
  await checkin(mina, A.photo1, { h: 2, tag: '영어' });
  await mina.locator('.my-week .stamp').waitFor({ timeout: 4000 });
  await shot(mina, 'tm-06-week-achieved');
  ok('주 3회를 채우면 달성 도장');
  await tab(mina, '통계');
  await see(mina, '1 / 2명');
  await shot(mina, 'tm-07-stats-week1');
  ok('통계: 목표를 채운 멤버 1/2명');
});

await stage('다음 주 월요일: 결산, 규칙 적용, 벌금', async () => {
  const { mina, junho } = pages;
  await jumpTo(ctx, mina, '2026-11-16T09:05');
  await ctx.clock.fastForward(61 * 1000); // 1분마다 도는 결산 확인을 한 번 더 돌린다
  await mina.waitForTimeout(500);
  await mina.click('#nav-home');
  await see(mina, '11월 16일 (월)');
  await shot(mina, 'tm-08-monday-home');
  await mina.click('#nav-notifs');
  await mina.waitForTimeout(300);
  await shot(mina, 'tm-09-monday-notifs-mina');
  await see(mina, '지난주');
  ok('월요일 오전에 지난주 결과 알림(미나)');
  await junho.click('#nav-notifs');
  await see(junho, '지난주');
  await shot(junho, 'tm-10-monday-notifs-junho');
  ok('월요일 오전에 지난주 결과 알림(준호)');
  // 규칙이 주 5회로 바뀌었다
  await mina.click('#nav-home');
  await mina.locator('.study-card').first().click();
  await see(mina, '주 5회');
  await tab(mina, '오늘');
  await see(mina, '/ 5회');
  ok('새 규칙(주 5회)이 월요일부터 적용');
  // 지난주 통계와 벌금
  await tab(mina, '통계');
  await mina.click('#stats-prev');
  await see(mina, '11월 9일 ~ 11월 15일');
  await shot(mina, 'tm-11-stats-lastweek');
  await mina.locator('#main').evaluate((el) => el.scrollTo(0, el.scrollHeight));
  await mina.waitForTimeout(200);
  await shot(mina, 'tm-12-fines');
  const unpaid = await mina.locator('.tile', { hasText: '미납' }).innerText();
  if (!/1,000원/.test(unpaid)) throw new Error('미납 금액이 1,000원이 아님: ' + unpaid);
  await see(mina, '인증 1/3회');
  ok('벌금 장부: 지난주 목표를 못 채운 준호에게 1,000원 기록');
  const paid = mina.locator('input[id^="paid-"]').first();
  await paid.check();
  await mina.waitForTimeout(500);
  await tab(junho, '통계').catch(async () => {
    await junho.click('#nav-home');
    await junho.locator('.study-card').first().click();
    await tab(junho, '통계');
  });
  await junho.locator('#main').evaluate((el) => el.scrollTo(0, el.scrollHeight));
  const done = await junho.locator('.tile', { hasText: '납부 완료' }).innerText();
  if (!/1,000원/.test(done)) throw new Error('납부 완료 금액이 반영되지 않음: ' + done);
  await shot(junho, 'tm-13-fines-junho');
  ok('방장이 납부 표시 → 멤버 화면에 반영');
  // 연속 인증은 끊겼고 최장 기록은 남는다
  await mina.click('#nav-my');
  await shot(mina, 'tm-14-my-monday');
  const tiles = await mina.locator('.tile').allInnerTexts();
  const streak = tiles.find((t) => t.startsWith('연속 인증'));
  const best = tiles.find((t) => t.startsWith('최장 연속'));
  if (!/0일/.test(streak ?? '')) throw new Error('연속 인증이 끊기지 않음: ' + streak);
  if (!/3일/.test(best ?? '')) throw new Error('최장 연속이 3일이 아님: ' + best);
  ok('연속 인증 0일, 최장 연속 3일');
  await mina.click('#cal-prev').catch(() => undefined);
});

const codeOut = finish();
await browser.close();
process.exit(codeOut);
