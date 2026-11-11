// 실행 환경별 동작: 보기 전용, 계정 id 없음, 파일 저장소 없음, claude 없음(체험 모드), 응답 없음.
import { launch, newContext, openUser, shot, onboard, ok, makeStages, tab, toastText, see, count, closeSheets, checkin } from './lib.mjs';
import { makeAssets } from './assets.mjs';

const space = 'md' + Date.now();
const browser = await launch();
const A = await makeAssets(browser);
const pages = {};
const { stage, finish } = makeStages(pages, process.argv.slice(2));
const ctx = await newContext(browser);
let code = '';

await stage('!준비: 방장이 스터디를 만든다', async () => {
  const mina = (pages.mina = await openUser(ctx, { u: 'mina', role: 'owner', space }));
  await onboard(mina, '미나');
  await mina.click('#home-create');
  await mina.fill('#st-name', '모드 점검 스터디');
  await mina.click('#st-submit');
  await mina.locator('#invite-code').waitFor();
  code = (await mina.locator('#invite-code').innerText()).replace(/\s/g, '');
  await closeSheets(mina);
  await checkin(mina, A.photo1, { m: 50, tag: '국어' });
  ok('스터디와 인증 준비');
});

await stage('보기 전용으로 처음 연 사람', async () => {
  const ctxV = await newContext(browser); // 체험 모드 전환이 다른 사용자 페이지에 영향을 주지 않게 따로 연다
  const v = (pages.viewer = await openUser(ctxV, { u: 'viewer1', role: 'viewer', space }));
  await see(v, '보기 전용으로 열렸어요', 8000);
  await shot(v, 'md-01-readonly-gate');
  ok('편집 권한이 없으면 안내 화면');
  await v.click('#gate-local');
  await v.locator('#ob-start').waitFor({ timeout: 8000 });
  await see(v, '체험 모드');
  await onboard(v, '구경꾼');
  await see(v, '체험 모드');
  await shot(v, 'md-02-local-after-gate');
  ok('체험 모드로 전환해서 혼자 써 볼 수 있음');
  // 마이 화면에서 체험 모드를 끝내면 다시 보기 전용 안내로 돌아온다
  await v.click('#nav-my');
  await v.click('#my-leave-local');
  await v.locator('#confirm-ok').click({ timeout: 1500 }).catch(() => undefined);
  await see(v, '보기 전용으로 열렸어요', 8000);
  ok('체험 모드 끝내기 → 공유 저장소로 다시 연결');
  await ctxV.close();
  delete pages.viewer;
});

await stage('쓰기 가능 여부를 모르는 경우(써 보고 판단)', async () => {
  const v = (pages.unknown = await openUser(ctx, { u: 'viewer2', role: 'viewer', canunknown: '1', space }));
  await v.locator('#ob-start').waitFor({ timeout: 8000 });
  await v.fill('#pf-nick', '모름이');
  await v.check('#ob-age');
  await v.check('#ob-agree');
  await v.click('#ob-start');
  await see(v, '보기 전용으로 열렸어요', 8000);
  await shot(v, 'md-03-readonly-after-write');
  ok('첫 저장이 거절되면 보기 전용 안내로 바뀜');
});

await stage('권한이 보기 전용으로 바뀐 기존 멤버', async () => {
  // 준호가 편집자로 가입·참여한 뒤, 보기 전용으로 다시 연다
  const j = (pages.junho = await openUser(ctx, { u: 'junho', role: 'editor', space }, '#join-' + code.toLowerCase()));
  await onboard(j, '준호');
  await j.click('#join-submit');
  await j.locator('#study-tabs').waitFor();
  await j.close();
  const j2 = (pages.junho = await openUser(ctx, { u: 'junho', role: 'viewer', space }));
  await j2.locator('#nav-home').waitFor({ timeout: 8000 });
  await see(j2, '보기 전용');
  await shot(j2, 'md-04-readonly-member-home');
  await j2.locator('.study-card').first().click();
  await tab(j2, '피드');
  await j2.locator('article.ci').first().waitFor();
  if (!(await j2.locator('article.ci .react-btn').first().isDisabled())) throw new Error('보기 전용인데 반응 버튼이 켜져 있음');
  await tab(j2, '채팅');
  await see(j2, '보기 전용으로 열려 있어요');
  await shot(j2, 'md-05-readonly-member-chat');
  await tab(j2, '오늘');
  if (!(await j2.locator('#today-checkin').isDisabled())) throw new Error('보기 전용인데 인증 버튼이 켜져 있음');
  ok('보기 전용 멤버: 볼 수는 있고 인증·반응·채팅은 막힘');
});

await stage('쓰기 가능 여부를 모르는 기존 멤버(반응이 거절되면 보기 전용)', async () => {
  // 플랫폼이 권한을 알려 주지 않으면 일단 쓸 수 있는 화면으로 열리고, 첫 쓰기가 거절될 때 보기 전용으로 바뀐다.
  // 반응은 update라서 "문서가 지워져 거절된 것"과 구분해야 한다(문서가 남아 있으면 권한 문제).
  await pages.junho.close();
  const k = (pages.junho = await openUser(ctx, { u: 'junho', role: 'viewer', canunknown: '1', space }));
  await k.locator('#nav-home').waitFor({ timeout: 8000 });
  await k.locator('.study-card').first().click();
  await tab(k, '피드');
  const btn = k.locator('article.ci .react-btn').first();
  await btn.waitFor();
  if (await btn.isDisabled()) throw new Error('거절된 적이 없는데 반응 버튼이 꺼져 있음');
  await btn.click();
  await see(k, '보기 전용');
  await k.locator('article.ci .react-btn[disabled]').first().waitFor({ timeout: 5000 });
  await shot(k, 'md-06-readonly-after-update');
  ok('반응(update)이 거절되고 문서는 남아 있으면 보기 전용으로 바뀜');
});

await stage('계정 id가 없는 편집자', async () => {
  const n = (pages.noid = await openUser(ctx, { role: 'editor', noid: '1', space }, '#join-' + code.toLowerCase()));
  await onboard(n, '이름없음');
  await n.click('#join-submit');
  await n.locator('#study-tabs').waitFor();
  await checkin(n, A.photo2, { m: 40, tag: '과학' });
  await pages.mina.locator('.page').getByText('이름없음').first().waitFor({ timeout: 5000 });
  ok('기기 기준 id로 가입·참여·인증');
  // 개인 설정과 학습장은 이 기기에 저장된다
  await n.click('#nav-room');
  await n.click('#room-add');
  await n.setInputFiles('#mat-file', [{ name: '노트.md', mimeType: 'text/markdown', buffer: A.md }]);
  // 파일 하나만 넣으면 바로 그 자료가 열린다
  await n.locator('.viewer .prose').getByText('abandon').first().waitFor({ timeout: 8000 });
  await n.waitForTimeout(600);
  await n.reload();
  await n.locator('#nav-room').waitFor({ timeout: 8000 });
  await n.click('#nav-room');
  await n.locator('.mat-row', { hasText: '노트' }).first().waitFor({ timeout: 8000 });
  await n.locator('.mat-row', { hasText: '노트' }).first().click();
  await n.locator('.prose').getByText('abandon').first().waitFor({ timeout: 6000 });
  await shot(n, 'md-06-noid-room');
  ok('새로고침 뒤에도 같은 사용자로 열리고 학습장 자료가 남아 있음');
  await n.click('#nav-my');
  await n.click('#my-help');
  await see(n, '이 기기를 기준으로');
  await closeSheets(n);
});

await stage('파일 저장소가 없는 화면', async () => {
  const p = (pages.noassets = await openUser(ctx, { u: 'sora', role: 'editor', noassets: '1', space }, '#join-' + code.toLowerCase()));
  await onboard(p, '소라');
  await p.click('#join-submit');
  await p.locator('#study-tabs').waitFor();
  await checkin(p, A.photo1, { h: 1, tag: '역사' });
  await tab(p, '피드');
  await p.locator('article.ci', { hasText: '역사' }).locator('.ci-photo img').first().waitFor({ timeout: 6000 });
  // 다른 사람 화면에서도 사진이 보이고, 크게 보기도 된다
  const m = pages.mina;
  await tab(m, '피드');
  await m.locator('article.ci', { hasText: '역사' }).locator('.ci-photo').first().click();
  await m.locator('.lightbox img').first().waitFor({ timeout: 6000 });
  const natural = await m.locator('.lightbox img').first().evaluate((img) => new Promise((r) => (img.complete ? r(img.naturalWidth) : (img.onload = () => r(img.naturalWidth)))));
  if (!(natural > 600)) throw new Error('크게 보기 사진이 너무 작음: ' + natural);
  await shot(m, 'md-07-noassets-lightbox');
  await closeSheets(m);
  ok('파일 저장소 없이도 사진 인증과 크게 보기 가능(문서에 줄여 담음): 가로 ' + natural + 'px');
  // 학습장 자료는 기기에 저장
  await p.click('#nav-room');
  await p.click('#room-add');
  await see(p, '이 기기의 브라우저에만');
  await p.setInputFiles('#mat-file', [{ name: '기출.pdf', mimeType: 'application/pdf', buffer: A.pdf }]);
  await p.locator('.pdf-page canvas').first().waitFor({ timeout: 20000 });
  await p.click('#viewer-back');
  await see(p, '이 기기의 브라우저에만');
  await p.locator('.mat-row', { hasText: '기출' }).first().click();
  await p.locator('.pdf-page canvas').first().waitFor({ timeout: 20000 });
  await shot(p, 'md-08-noassets-pdf');
  ok('학습장 자료는 기기에 저장되고 PDF가 열림');
});

await stage('claude 없이 연 페이지(체험 모드)', async () => {
  const ctx2 = await newContext(browser);
  const l = (pages.local = await openUser(ctx2, { role: 'none' }));
  await l.locator('#ob-start').waitFor({ timeout: 8000 });
  await see(l, '체험 모드');
  await onboard(l, '혼자');
  await l.click('#home-create');
  await l.fill('#st-name', '혼공');
  await l.click('#st-submit');
  await l.locator('#invite-code').waitFor();
  await shot(l, 'md-09-local-invite');
  await closeSheets(l);
  await checkin(l, A.photo1, { m: 30 });
  await l.reload();
  await l.locator('#nav-home').waitFor({ timeout: 8000 });
  await see(l, '혼공');
  await see(l, '30분');
  await shot(l, 'md-10-local-home');
  ok('체험 모드: 이 기기에만 저장되고 새로고침 뒤에도 남음');
  await ctx2.close();
  delete pages.local;
});

await stage('저장소가 응답하지 않을 때', async () => {
  const ctx3 = await newContext(browser);
  await ctx3.clock.install();
  const h = (pages.hang = await openUser(ctx3, { u: 'slow', role: 'editor', hang: '1', space }));
  await see(h, '불러오는 중');
  await ctx3.clock.fastForward(6000);
  await see(h, '연결이 오래 걸리고 있어요', 6000);
  await shot(h, 'md-11-slow');
  ok('느리면 안내와 체험 모드 버튼');
  await ctx3.clock.fastForward(5000);
  await h.locator('#ob-start').waitFor({ timeout: 8000 });
  await see(h, '체험 모드');
  ok('끝내 응답이 없으면 체험 모드로 시작');
  await ctx3.close();
  delete pages.hang;
});

const out = finish();
await browser.close();
process.exit(out);
