// 시작점.

import React from 'react';
import { createRoot } from 'react-dom/client';
import { localPlatform } from './platform';
import { boot, restart } from './store';
import { App, ErrorBoundary } from './ui/app';

const el = document.getElementById('root');
if (el) {
  el.textContent = '';
  createRoot(el).render(
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
