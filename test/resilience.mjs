// 오래 켜 두는 화면에서 생기는 일: 구독이 끊겼다 이어지는 경우, 개인 설정이 늦게 오는 경우.
import { launch, newContext, openUser, onboard, ok, makeStages, tab, see, closeSheets, shot } from './lib.mjs';

const space = 'rs' + Date.now();
const browser = await launch();
const pages = {};
const { stage, finish } = makeStages(pages, process.argv.slice(2));
const ctx = await newContext(browser);
let code = '';

async function send(page, text) {
  const input = page.locator('textarea[id^="chat-input-"]').first();
  await input.fill(text);
  await input.press('Enter');
}

await stage('!준비: 두 사람이 같은 스터디에', async () => {
  const mina = (pages.mina = await openUser(ctx, { u: 'mina', role: 'owner', space }));
  await onboard(mina, '미나');
  await mina.click('#home-create');
  await mina.fill('#st-name', '오래 켜 두는 스터디');
  await mina.click('#st-submit');
  await mina.locator('#invite-code').waitFor();
  code = (await mina.locator('#invite-code').innerText()).replace(/\s/g, '');
  await closeSheets(mina);
  const junho = (pages.junho = await openUser(ctx, { u: 'junho', role: 'editor', space }, '#join-' + code.toLowerCase()));
  await onboard(junho, '준호');
  await junho.click('#join-submit');
  await junho.locator('#study-tabs').waitFor();
  await tab(junho, '채팅');
  await tab(mina, '채팅'); // 스터디를 만들면 그 스터디 화면에 들어와 있다
  await send(mina, '끊기기 전 메시지');
  await see(junho, '끊기기 전 메시지');
  ok('채팅이 서로 보임');
});

await stage('구독이 끊겨도 다시 이어짐', async () => {
  const { mina, junho } = pages;
  const before = await junho.evaluate(() => window.__subsOpened());
  const killed = await junho.evaluate(() => window.__killSubs());
  if (killed < 7) throw new Error('열려 있던 구독 수가 예상보다 적음: ' + killed);
  await send(mina, '끊긴 사이에 보낸 메시지');
  await junho.waitForTimeout(600);
  if (await junho.getByText('끊긴 사이에 보낸 메시지').count()) throw new Error('구독이 끊기지 않았음(테스트 전제가 틀림)');
  // 3초쯤 뒤에 다시 열리고, 그 사이에 온 메시지가 보여야 한다
  await see(junho, '끊긴 사이에 보낸 메시지', 9000);
  // 구독마다 다시 여는 시각이 조금씩 다르다(3~4초). 모두 열릴 때까지 기다린다.
  await junho.waitForFunction((want) => window.__subsOpened() >= want, before + killed, { timeout: 6000 }).catch(() => undefined);
  const after = await junho.evaluate(() => window.__subsOpened());
  if (after < before + killed) throw new Error(`다시 연 구독이 모자람: ${after - before}/${killed}`);
  ok(`구독 ${killed}개가 끊긴 뒤 모두 다시 열리고 밀린 메시지가 보임`);
  // 다시 열린 뒤의 실시간 전달과 내 쓰기도 확인
  await send(junho, '다시 이어진 뒤 준호가 보냄');
  await see(mina, '다시 이어진 뒤 준호가 보냄');
  await send(mina, '다시 이어진 뒤 미나가 보냄');
  await see(junho, '다시 이어진 뒤 미나가 보냄');
  ok('다시 이어진 뒤에도 실시간으로 주고받음');
  // 한 번 더 끊어도 같은 결과(간격이 늘어나지만 60초 넘게 살았던 구독은 처음 간격으로 돌아간다)
  await junho.evaluate(() => window.__killSubs());
  await send(mina, '두 번째로 끊긴 사이');
  await see(junho, '두 번째로 끊긴 사이', 14000);
  ok('두 번째로 끊겨도 다시 이어짐');
});

await stage('개인 설정이 늦게 와도 저장된 설정을 지킴', async () => {
  let junho = pages.junho;
  // 저장해 둘 설정: 채팅 알림 끄기, 리마인더 20:30
  await junho.click('#nav-my');
  await junho.click('#my-notif');
  await junho.locator('#nt-remind').waitFor();
  await junho.locator('label[for="nt-chat"], #nt-chat').first().click();
  await junho.fill('#nt-remind-at', '20:30');
  await closeSheets(junho);
  await junho.waitForTimeout(1300);
  await junho.close();

  // 설정 문서만 2.5초 늦게 오는 상황에서, 그 전에 알림 화면을 열어 "읽음" 변경을 만든다
  const t0 = Date.now();
  junho = pages.junho = await openUser(ctx, { u: 'junho', role: 'editor', space, slowsettings: '2500' });
  await junho.locator('#nav-notifs').waitFor({ timeout: 8000 });
  await junho.click('#nav-notifs');
  const early = Date.now() - t0;
  if (early > 2200) throw new Error('알림 화면을 설정보다 먼저 열지 못함(' + early + 'ms)');
  await junho.waitForTimeout(2500 + 800 + 1200);
  const stored = await junho.evaluate(async () => {
    const db = await window.claude.use('db');
    const d = await db.doc('data/users/u_junho/settings').get();
    return d.exists ? d.data() : null;
  });
  if (!stored) throw new Error('설정 문서가 없음');
  if (stored.notif.chat !== false || stored.notif.remindAt !== '20:30') throw new Error('늦게 온 설정을 기본값으로 덮어씀: ' + JSON.stringify(stored.notif));
  if (!(stored.seenAt >= t0)) throw new Error('설정을 받기 전에 한 변경(읽음)이 저장되지 않음: ' + stored.seenAt);
  ok('저장된 설정은 그대로이고, 먼저 한 변경도 그 위에 저장됨');

  // 화면에서도 확인
  await junho.close();
  junho = pages.junho = await openUser(ctx, { u: 'junho', role: 'editor', space });
  await junho.locator('#nav-my').waitFor({ timeout: 8000 });
  await junho.click('#nav-my');
  await junho.click('#my-notif');
  await junho.locator('#nt-remind').waitFor();
  if (await junho.locator('#nt-chat').isChecked()) throw new Error('채팅 알림 설정이 초기화됨');
  if ((await junho.inputValue('#nt-remind-at')) !== '20:30') throw new Error('리마인더 시각이 초기화됨');
  await shot(junho, 'rs-01-settings-kept');
  await closeSheets(junho);
  ok('다시 열어도 설정이 그대로');
});

const code2 = finish();
await browser.close();
process.exit(code2);
