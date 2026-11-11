// 안드로이드 앱(Capacitor)에서만: 뒤로 가기 버튼이 앱을 바로 끄지 않고 열린 창과 화면을 하나씩 닫게 한다.

import { App } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { back, closeSheet, getUi, goTab, setRoomMid } from './ui';

export function setupNative() {
  if (!Capacitor.isNativePlatform()) return;
  void App.addListener('backButton', () => {
    const ui = getUi();
    if (ui.sheets.length) return closeSheet();
    if (ui.roomMid) return setRoomMid(null);
    if (ui.stack.length) return back();
    if (ui.route.name !== 'home') return goTab('home');
    void App.minimizeApp();
  });
}
