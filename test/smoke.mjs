import { launch, newContext, openUser, shot, report, onboard, ok, expectText } from './lib.mjs';

const browser = await launch();
const ctx = await newContext(browser);
const page = await openUser(ctx, { u: 'mina', role: 'owner', space: 'smoke' + Date.now() });
await page.waitForTimeout(1200);
await shot(page, 'smoke-01-onboarding');
await onboard(page, '미나');
ok('가입');
await page.waitForTimeout(500);
await shot(page, 'smoke-02-home');
for (const t of ['room', 'chats', 'my']) {
  await page.click('#nav-' + t);
  await page.waitForTimeout(400);
  await shot(page, 'smoke-03-' + t);
}
report();
await browser.close();
