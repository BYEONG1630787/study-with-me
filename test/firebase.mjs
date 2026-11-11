// GitHub Pages 판(Firebase)을 로컬 에뮬레이터로 확인한다. 두 사람은 서로 다른 브라우저 컨텍스트(서로 다른 익명 계정).
//   firebase emulators:start --only firestore,auth --project demo-sw
//   APP_URL=http://127.0.0.1:4173/index.html FIREBASE_CONFIG='{"apiKey":"demo","projectId":"demo-sw","authDomain":"demo-sw.firebaseapp.com","appId":"1:1:web:1","emulator":"127.0.0.1"}' node build.mjs
//   node test/server.mjs 4173 & node test/firebase.mjs
import { launch, newContext, onboard, ok, makeStages, tab, see, closeSheets, checkin, BASE, errors } from './lib.mjs';
import { makeAssets } from './assets.mjs';

const browser = await launch();
const A = await makeAssets(browser);
const pages = {};
const { stage, finish } = makeStages(pages, process.argv.slice(2));
let code = '';
let link = '';

function watch(page, tag) {
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const t = m.text();
    if (/favicon/.test(m.location()?.url ?? '')) return;
    // 틀린 비밀번호를 일부러 넣는 단계의 400 응답
    if (/status of 400/.test(t) && /identitytoolkit|accounts:signIn/.test(m.location()?.url ?? '')) return;
    errors.push(`[${tag}] console: ${t}`);
  });
  page.on('pageerror', (e) => errors.push(`[${tag}] pageerror: ${e.message}`));
  return page;
}

const stamp = Date.now();
const MINA = { email: `mina${stamp}@example.com`, pw: 'study1234' };
const JUNHO = { email: `junho${stamp}@example.com`, pw: 'study5678' };

async function signUp(page, who) {
  await page.locator('#auth').waitFor({ timeout: 15000 });
  if (await page.locator('#auth-pw2').count() === 0) await page.click('#auth-tab-signup');
  await page.fill('#auth-email', who.email);
  await page.fill('#auth-pw', who.pw);
  await page.fill('#auth-pw2', who.pw);
  await page.click('#auth-submit');
}

async function send(page, text) {
  const input = page.locator('textarea[id^="chat-input-"]').first();
  await input.fill(text);
  await input.press('Enter');
}

const ctxA = await newContext(browser);
const ctxB = await newContext(browser);

await stage('!가입과 스터디 만들기 (미나)', async () => {
  const mina = (pages.mina = watch(await ctxA.newPage(), 'mina'));
  await mina.goto(BASE + '/index.html');
  await mina.locator('#auth-tab-login.on').waitFor({ timeout: 15000 });
  ok('첫 화면은 로그인');
  // 틀린 확인 비밀번호
  await mina.click('#auth-tab-signup');
  await mina.fill('#auth-email', MINA.email);
  await mina.fill('#auth-pw', MINA.pw);
  await mina.fill('#auth-pw2', MINA.pw + 'x');
  await mina.click('#auth-submit');
  await see(mina, '비밀번호 확인이 서로 달라요');
  await signUp(mina, MINA);
  await onboard(mina, '미나');
  ok('회원가입 → 닉네임 정하기 → 홈');
  await mina.click('#home-create');
  await mina.fill('#st-name', '파이어베이스 스터디');
  await mina.click('#st-submit');
  await mina.locator('#invite-code').waitFor();
  code = (await mina.locator('#invite-code').innerText()).replace(/\s/g, '');
  link = await mina.inputValue('#invite-link');
  if (!/#join-/i.test(link)) throw new Error('초대 링크가 없음: ' + link);
  await see(mina, '초대 링크나 메시지를 친구에게 보내 주세요');
  await closeSheets(mina);
  ok('스터디를 만들고 초대 링크를 받음: ' + link.trim());
});

await stage('!초대 링크로 참여 (준호, 다른 계정)', async () => {
  const junho = (pages.junho = watch(await ctxB.newPage(), 'junho'));
  // 초대 링크 그대로 연다
  await junho.goto(link.trim());
  await junho.locator('#auth-tab-signup.on').waitFor({ timeout: 15000 });
  await signUp(junho, JUNHO);
  await onboard(junho, '준호');
  await junho.click('#join-submit');
  await junho.locator('#study-tabs').waitFor();
  await see(junho, '파이어베이스 스터디');
  ok('다른 계정이 링크로 같은 스터디에 들어옴');
});

await stage('채팅을 실시간으로 주고받음', async () => {
  const { mina, junho } = pages;
  await tab(mina, '채팅');
  await tab(junho, '채팅');
  await send(mina, '안녕 준호야');
  await see(junho, '안녕 준호야', 8000);
  await send(junho, '반가워 미나야');
  await see(mina, '반가워 미나야', 8000);
  await see(mina, '준호');
  ok('두 계정이 서로의 메시지를 봄');
});

await stage('인증 올리기와 친구 피드', async () => {
  const { mina, junho } = pages;
  await tab(junho, '오늘');
  await checkin(junho, A.photo1, { h: 1, m: 10, tag: '수학', memo: '파이어베이스에서 인증' });
  await tab(mina, '피드');
  await see(mina, '파이어베이스에서 인증', 8000);
  const img = mina.locator('.feed img, .ci-photo img, img.ci-photo').first();
  await img.waitFor({ timeout: 8000 });
  const w = await img.evaluate((el) => el.naturalWidth);
  if (!w) throw new Error('인증 사진이 보이지 않음');
  ok('준호의 인증(사진 포함)이 미나 피드에 보임');
});

await stage('로그아웃하고 다른 기기에서 같은 계정으로 로그인', async () => {
  const { mina } = pages;
  await mina.click('#nav-my');
  await mina.click('#my-logout');
  await mina.locator('#auth').waitFor({ timeout: 15000 });
  ok('로그아웃하면 로그인 화면');
  const ctxC = await newContext(browser);
  const other = (pages.other = watch(await ctxC.newPage(), 'mina-2'));
  await other.goto(BASE + '/index.html');
  await other.locator('#auth').waitFor({ timeout: 15000 });
  await other.fill('#auth-email', MINA.email);
  await other.fill('#auth-pw', 'wrongpass');
  await other.click('#auth-submit');
  await see(other, '이메일 또는 비밀번호가 맞지 않아요', 8000);
  await other.fill('#auth-pw', MINA.pw);
  await other.click('#auth-submit');
  await other.locator('#nav-home').waitFor({ timeout: 15000 });
  if (await other.locator('#ob-start').count()) throw new Error('다시 닉네임을 물어봄');
  await see(other, '파이어베이스 스터디', 8000);
  ok('다른 기기에서 로그인하면 내 스터디가 그대로 보임');
});

await stage('새로 고쳐도 같은 사람, 설정 유지', async () => {
  let { junho } = pages;
  await junho.click('#nav-my');
  await junho.click('#my-notif');
  await junho.locator('#nt-remind').waitFor();
  await junho.fill('#nt-remind-at', '21:15');
  await closeSheets(junho);
  await junho.waitForTimeout(1500);
  await junho.reload();
  await junho.locator('#nav-my').waitFor({ timeout: 10000 });
  if (await junho.locator('#ob-start').count()) throw new Error('다시 열었더니 가입 화면이 나옴');
  await junho.click('#nav-my');
  await see(junho, '준호');
  await junho.click('#my-notif');
  await junho.locator('#nt-remind').waitFor();
  const v = await junho.inputValue('#nt-remind-at');
  if (v !== '21:15') throw new Error('설정이 저장되지 않음: ' + v);
  await closeSheets(junho);
  ok('새로 고쳐도 같은 계정이고 개인 설정이 남아 있음');
});

const code2 = finish();
await browser.close();
process.exit(code2);
