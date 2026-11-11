// 시작점. GitHub Pages 판(Firebase)에서는 로그인부터 하고, claude.ai 안에서는 바로 앱을 연다.

import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { FIREBASE_CONFIG } from './env';
import { localPlatform } from './platform';
import { boot, restart } from './store';
import { App, ErrorBoundary } from './ui/app';
import { AuthScreen } from './ui/auth';

function runApp(root: Root) {
  root.render(
    <ErrorBoundary>
      <App />
    </ErrorBoundary>,
  );
  boot().catch((e) => {
    console.error('[sw] boot failed, falling back to this device only', e);
    try {
      restart(localPlatform());
    } catch (e2) {
      console.error('[sw] local fallback failed', e2);
    }
  });
}

async function start(el: HTMLElement) {
  el.textContent = '';
  const root = createRoot(el);
  const inClaude = typeof (window as unknown as { claude?: unknown }).claude !== 'undefined';
  if (FIREBASE_CONFIG && !inClaude) {
    const { currentUser } = await import('./firebase');
    const user = await currentUser(FIREBASE_CONFIG).catch(() => null);
    if (!user) {
      root.render(
        <ErrorBoundary>
          <AuthScreen onDone={() => runApp(root)} />
        </ErrorBoundary>,
      );
      return;
    }
  }
  runApp(root);
}

const el = document.getElementById('root');
if (el) void start(el);
