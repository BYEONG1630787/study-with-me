// 화면 상태: 지금 보는 화면, 떠 있는 시트, 토스트.

import { useSyncExternalStore } from 'react';

export type StudyTab = 'today' | 'feed' | 'chat' | 'stats' | 'info';

export type Route =
  | { name: 'home' }
  | { name: 'room' }
  | { name: 'chats' }
  | { name: 'my' }
  | { name: 'notifs' }
  | { name: 'study'; sid: string; tab: StudyTab };

export interface MenuItem {
  label: string;
  danger?: boolean;
  run: () => void;
}

export type Sheet =
  | { kind: 'checkin'; fromTimer?: boolean; edit?: string }
  | { kind: 'createStudy' }
  | { kind: 'editStudy'; sid: string }
  | { kind: 'join'; code?: string }
  | { kind: 'invite'; sid: string }
  | { kind: 'startFocus' }
  | { kind: 'profile' }
  | { kind: 'reactors'; cid: string }
  | { kind: 'confirm'; title: string; body?: string; okLabel: string; danger?: boolean; onOk: () => unknown }
  | { kind: 'notifSettings' }
  | { kind: 'blocks' }
  | { kind: 'terms' }
  | { kind: 'help' }
  | { kind: 'addMaterial' }
  | { kind: 'editMaterial'; mid: string }
  | { kind: 'lightbox'; cid: string; index: number }
  | { kind: 'menu'; title?: string; items: MenuItem[] }
  | { kind: 'fine'; sid: string }
  | { kind: 'checkinDetail'; cid: string };

export interface Toast {
  id: number;
  text: string;
  kind: 'info' | 'ok' | 'err';
  action?: { label: string; run: () => void };
}

export interface UiState {
  route: Route;
  stack: Route[];
  sheets: Sheet[];
  toasts: Toast[];
  roomMid: string | null; // 학습장에서 열어 둔 자료
}

let ui: UiState = { route: { name: 'home' }, stack: [], sheets: [], toasts: [], roomMid: null };
const subs = new Set<() => void>();

function set(patch: Partial<UiState>) {
  ui = { ...ui, ...patch };
  for (const l of [...subs]) l();
}

export function getUi(): UiState {
  return ui;
}

export function useUi<T>(sel: (u: UiState) => T): T {
  return useSyncExternalStore(
    (l) => {
      subs.add(l);
      return () => subs.delete(l);
    },
    () => sel(ui),
  );
}

/** 하단 탭으로 이동: 뒤로 가기 기록을 비운다 */
export function goTab(name: 'home' | 'room' | 'chats' | 'my') {
  set({ route: { name }, stack: [] });
}

export function go(route: Route) {
  set({ route, stack: [...ui.stack, ui.route].slice(-20) });
}

/** 같은 화면 안에서 탭만 바꿀 때 */
export function replaceRoute(route: Route) {
  set({ route });
}

export function back() {
  const stack = [...ui.stack];
  const prev = stack.pop() ?? { name: 'home' as const };
  set({ route: prev, stack });
}

export function resetUi() {
  set({ route: { name: 'home' }, stack: [], sheets: [], roomMid: null });
}

export function openSheet(s: Sheet) {
  set({ sheets: [...ui.sheets, s] });
}

export function closeSheet() {
  set({ sheets: ui.sheets.slice(0, -1) });
}

export function closeAllSheets() {
  set({ sheets: [] });
}

export function setRoomMid(mid: string | null) {
  set({ roomMid: mid });
}

let toastSeq = 1;

export function toast(text: string, kind: Toast['kind'] = 'info', action?: Toast['action']) {
  const id = toastSeq++;
  set({ toasts: [...ui.toasts.slice(-2), { id, text, kind, action }] });
  setTimeout(() => dismissToast(id), action ? 6000 : 3600);
}

export function dismissToast(id: number) {
  if (ui.toasts.some((t) => t.id === id)) set({ toasts: ui.toasts.filter((t) => t.id !== id) });
}

export function confirmSheet(opts: { title: string; body?: string; okLabel: string; danger?: boolean; onOk: () => unknown }) {
  openSheet({ kind: 'confirm', ...opts });
}
