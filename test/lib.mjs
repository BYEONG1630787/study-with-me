// 테스트 도우미: 브라우저 열기, 사용자별 페이지, 오류 모으기, 화면 찍기.

import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const { chromium } = createRequire(import.meta.url)('playwright');

export const root = dirname(dirname(fileURLToPath(import.meta.url)));
export const BASE = process.env.BASE ?? 'http://127.0.0.1:4173';
export const SHOTS = join(root, 'test/shots');
mkdirSync(SHOTS, { recursive: true });

export const errors = [];

export async function launch() {
  return chromium.launch();
}

/** 한 사람의 브라우저(저장소가 서로 섞이지 않게 사람마다 컨텍스트를 따로 쓰려면 shared=false) */
export async function newContext(browser, opts = {}) {
  const ctx = await browser.newContext({
    viewport: opts.viewport ?? { width: 1280, height: 860 },
    deviceScaleFactor: opts.dsf ?? 1,
    colorScheme: opts.dark ? 'dark' : 'light',
    locale: 'ko-KR',
    timezoneId: opts.tz ?? 'Asia/Seoul',
    hasTouch: !!opts.touch,
    isMobile: !!opts.mobile,
    permissions: ['clipboard-read', 'clipboard-write'],
  });
  await ctx.route('https://fonts.googleapis.com/**', (route) => route.fulfill({ status: 302, headers: { location: BASE + '/_fonts.css' } }));
  await ctx.route('https://cdnjs.cloudflare.com/**', (route) => route.abort());
  return ctx;
}

export async function openUser(ctx, q = {}, hash = '', opts = {}) {
  const page = await ctx.newPage();
  const tag = q.u ?? q.role ?? 'page';
  page.on('console', (m) => {
    if (m.type() === 'error') {
      const t = m.text();
      const url = m.location()?.url ?? '';
      if (/Failed to load resource/.test(t) && /favicon/.test(url)) return;
      // 자료 HTML 안의 스크립트를 막았다는 브라우저 안내는 의도한 동작
      if (/Blocked script execution in 'about:srcdoc'/.test(t)) return;
      if (opts.allow404 && /Failed to load resource/.test(t) && opts.allow404.test(url)) return;
      errors.push(`[${tag}] console: ${t}${url ? ' ← ' + url : ''}`);
    }
  });
  page.on('pageerror', (e) => errors.push(`[${tag}] pageerror: ${e.message}\n${(e.stack ?? '').split('\n').slice(0, 4).join('\n')}`));
  const qs = new URLSearchParams(q).toString();
  await page.goto(`${BASE}/test.html?${qs}${hash}`);
  return page;
}

export async function shot(page, name, opts = {}) {
  await page.waitForTimeout(opts.wait ?? 250);
  await page.screenshot({ path: join(SHOTS, name + '.png'), fullPage: !!opts.full });
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let step = 0;
export function ok(msg) {
  step++;
  console.log(`  ✓ ${msg}`);
}

export async function expectText(page, text, timeout = 4000) {
  await page.getByText(text, { exact: false }).first().waitFor({ state: 'visible', timeout });
}

export async function gone(page, selector, timeout = 4000) {
  await page.locator(selector).first().waitFor({ state: 'detached', timeout });
}

/** 가입 화면을 채우고 시작한다 */
export async function onboard(page, nick) {
  await page.locator('#ob-start').waitFor({ timeout: 8000 });
  await page.fill('#pf-nick', nick);
  await page.check('#ob-age');
  await page.check('#ob-agree');
  await page.click('#ob-start');
  await page.locator('#nav-home, #main').first().waitFor({ timeout: 8000 });
}

export function report() {
  if (errors.length) {
    console.log('\n브라우저 오류 ' + errors.length + '건:');
    for (const e of errors.slice(0, 30)) console.log('  ✗ ' + e);
  } else console.log('\n브라우저 오류 없음');
  return errors.length;
}

// ---- 시나리오 공통 도우미 ----

export const tab = (page, label) => page.locator('#study-tabs').getByRole('tab', { name: label }).click();
export const toastText = (page, text) => page.locator('.toast', { hasText: text }).first().waitFor({ timeout: 5000 });
export const see = (page, text, timeout = 5000) => page.getByText(text, { exact: false }).first().waitFor({ state: 'visible', timeout });
export const count = (page, sel) => page.locator(sel).count();
export async function closeSheets(page) {
  for (let i = 0; i < 4; i++) {
    if ((await page.locator('.sheet').count()) === 0) return;
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);
  }
}

export function makeStages(pages, only = []) {
  const fails = [];
  async function stage(name, fn) {
    if (only.length && !only.some((o) => name.includes(o)) && !name.startsWith('!')) return;
    console.log('\n■ ' + name);
    try {
      await fn();
    } catch (e) {
      const msg = String(e && e.message ? e.message : e).split('\n').slice(0, 6).join('\n    ');
      fails.push(`${name}: ${msg}`);
      console.log('  ✗ 실패: ' + msg);
      for (const [who, p] of Object.entries(pages)) {
        try {
          await p.screenshot({ path: join(SHOTS, `fail-${name.replace(/[^a-z0-9가-힣]+/gi, '_')}-${who}.png`) });
        } catch {
          /* ignore */
        }
      }
    }
  }
  function finish() {
    console.log('\n==============================');
    if (fails.length) {
      console.log('실패 ' + fails.length + '건');
      for (const f of fails) console.log(' ✗ ' + f);
    } else console.log('모든 단계 통과');
    const n = report();
    return fails.length || n ? 1 : 0;
  }
  return { stage, finish, fails };
}

/** 사진 한 장과 시간으로 인증을 올린다 */
export async function checkin(page, photo, { h = '', m = '', tag = '', memo = '' } = {}) {
  const btn = page.locator('#today-checkin, #home-checkin').first();
  await btn.click();
  await page.locator('#ci-submit').waitFor();
  await page.setInputFiles('#ci-album', [{ name: 'p.png', mimeType: 'image/png', buffer: photo }]);
  await page.locator('.photo-cell').first().waitFor({ timeout: 8000 });
  if (h) await page.fill('#ci-h', String(h));
  if (m) await page.fill('#ci-m', String(m));
  if (tag) await page.fill('#ci-tag', tag);
  if (memo) await page.fill('#ci-memo', memo);
  await page.locator('#ci-submit:not([disabled])').waitFor({ timeout: 8000 });
  await page.click('#ci-submit');
  await toastText(page, '인증을 올렸어요');
}

/** 페이지 시계를 KST 기준 특정 시각으로 보낸다(앞으로만). "2026-11-16T09:05" */
export async function jumpTo(ctx, page, kst) {
  const target = Date.parse(kst + ':00+09:00');
  const now = await page.evaluate(() => Date.now());
  if (target <= now) throw new Error('이미 지난 시각: ' + kst);
  await ctx.clock.fastForward(target - now);
  await page.waitForTimeout(400);
}
