// 앱 뼈대: 시작 화면, 가입, 내비게이션, 시트·토스트, 화면 안 알림.

import React, { Component, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { getState, onEvent, switchToLocal, useApp, type AppEvent } from '../store';
import { AppError, flushPending, normalizeCode, saveProfile } from '../actions';
import { buildNotifs, nickOf, remindDue, totalUnread, unseenNotifs } from '../derive';
import { APP_NAME } from '../env';
import { isActiveMember, isEnded } from '../logic';
import { lsGet, lsSet } from '../platform';
import { kstHour, weekStart } from '../time';
import { dismissToast, getUi, go, goTab, openSheet, toast, useUi, type Route, type Sheet } from '../ui';
import { ChatsPage } from './chat';
import { CheckinSheet } from './checkin';
import { CheckinDetailSheet, LightboxSheet, ReactorsSheet } from './feed';
import { FocusScreen } from './focus';
import { HomePage } from './home';
import { Btn, Icon, useAsync } from './kit';
import { MyPage } from './my';
import { NotifsPage } from './notifs';
import { AddMaterialSheet, Clock, EditMaterialSheet, RoomPage } from './room';
import { BlocksSheet, ConfirmSheet, FineSheet, HelpSheet, InviteSheet, JoinSheet, MenuSheet, NotifSettingsSheet, ProfileFields, ProfileSheet, StartFocusSheet, StudyFormSheet, TermsSheet } from './sheets';
import { StudyPage } from './study';

// ------------------------------------------------------------------ 시트·토스트

const sheetIds = new WeakMap<object, number>();
let sheetSeq = 1;
function sheetKey(s: Sheet): number {
  let id = sheetIds.get(s);
  if (!id) {
    id = sheetSeq++;
    sheetIds.set(s, id);
  }
  return id;
}

function SheetView({ sheet }: { sheet: Sheet }) {
  switch (sheet.kind) {
    case 'checkin':
      return <CheckinSheet fromTimer={sheet.fromTimer} edit={sheet.edit} />;
    case 'createStudy':
      return <StudyFormSheet />;
    case 'editStudy':
      return <StudyFormSheet sid={sheet.sid} />;
    case 'join':
      return <JoinSheet code={sheet.code} />;
    case 'invite':
      return <InviteSheet sid={sheet.sid} />;
    case 'startFocus':
      return <StartFocusSheet />;
    case 'profile':
      return <ProfileSheet />;
    case 'reactors':
      return <ReactorsSheet cid={sheet.cid} />;
    case 'confirm':
      return <ConfirmSheet title={sheet.title} body={sheet.body} okLabel={sheet.okLabel} danger={sheet.danger} onOk={sheet.onOk} />;
    case 'notifSettings':
      return <NotifSettingsSheet />;
    case 'blocks':
      return <BlocksSheet />;
    case 'terms':
      return <TermsSheet />;
    case 'help':
      return <HelpSheet />;
    case 'addMaterial':
      return <AddMaterialSheet />;
    case 'editMaterial':
      return <EditMaterialSheet mid={sheet.mid} />;
    case 'lightbox':
      return <LightboxSheet cid={sheet.cid} index={sheet.index} />;
    case 'menu':
      return <MenuSheet title={sheet.title} items={sheet.items} />;
    case 'fine':
      return <FineSheet sid={sheet.sid} />;
    case 'checkinDetail':
      return <CheckinDetailSheet cid={sheet.cid} />;
    default:
      return null;
  }
}

function SheetHost() {
  const sheets = useUi((u) => u.sheets);
  return (
    <>
      {sheets.map((sh) => (
        <SheetView key={sheetKey(sh)} sheet={sh} />
      ))}
    </>
  );
}

function Toasts() {
  const toasts = useUi((u) => u.toasts);
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={'toast ' + t.kind}>
          <span className="grow">{t.text}</span>
          {t.action ? (
            <button
              type="button"
              className="toast-action"
              onClick={() => {
                dismissToast(t.id);
                t.action!.run();
              }}
            >
              {t.action.label}
            </button>
          ) : null}
          <button type="button" className="toast-x" onClick={() => dismissToast(t.id)} aria-label="알림 닫기">
            <Icon name="close" size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ 시작·가입

function Wordmark({ big }: { big?: boolean }) {
  return (
    <span className={'wordmark' + (big ? ' big' : '')}>
      <span className="wordmark-seal" aria-hidden="true">
        윗미
      </span>
      <span>{APP_NAME}</span>
    </span>
  );
}

function Splash({ slow }: { slow: boolean }) {
  return (
    <div className="gate">
      <Wordmark big />
      <p className="muted">공부 기록을 불러오는 중…</p>
      {slow ? (
        <div className="card col gap gate-card">
          <p>연결이 오래 걸리고 있어요. 조금 더 기다리거나, 이 기기에만 저장하는 체험 모드로 먼저 써 볼 수 있어요.</p>
          <Btn kind="soft" onClick={switchToLocal} id="splash-local">
            이 기기에서 체험하기
          </Btn>
        </div>
      ) : null}
    </div>
  );
}

function ReadOnlyGate() {
  return (
    <div className="gate">
      <Wordmark big />
      <div className="card col gap gate-card">
        <h1 className="confirm-title">보기 전용으로 열렸어요</h1>
        <p className="muted">이 페이지에 인증을 올리려면 편집 권한이 필요해요. 페이지를 공유해 준 친구에게 내 이메일을 <b>편집자</b>로 초대해 달라고 요청해 주세요. 공개 링크 공유가 켜져 있으면 꺼 달라고도 말해 주세요. 권한을 받은 뒤 페이지를 새로 열면 바로 시작할 수 있어요.</p>
        <Btn kind="soft" onClick={switchToLocal} id="gate-local">
          이 기기에서 체험하기
        </Btn>
        <p className="hint">체험 모드의 기록은 이 기기의 브라우저에만 저장되고 친구와 공유되지 않아요.</p>
      </div>
    </div>
  );
}

function Onboarding() {
  const readOnly = useApp((s) => s.readOnly);
  const mode = useApp((s) => s.mode);
  const host = useApp((s) => s.host);
  const [nick, setNick] = useState('');
  const [color, setColor] = useState(() => Math.floor(Math.random() * 8));
  const [photo, setPhoto] = useState<string | null>(null);
  const [age, setAge] = useState(false);
  const [agree, setAgree] = useState(false);
  const [busy, run] = useAsync();
  if (readOnly) return <ReadOnlyGate />;
  const len = Array.from(nick.trim()).length;
  const ok = len >= 2 && len <= 12 && age && agree;
  const missing = [len < 2 || len > 12 ? '닉네임 2~12자' : '', !age ? '만 14세 이상 체크' : '', !agree ? '이용 규칙 동의 체크' : ''].filter(Boolean);
  // 한글 입력기(IME)가 마지막 글자를 아직 조합 중이면 상태가 한 박자 늦을 수 있어서, 누른 순간의 입력칸 값을 읽는다
  const submit = () =>
    run(() => {
      const el = document.getElementById('pf-nick') as HTMLInputElement | null;
      const raw = el ? el.value : nick;
      if (raw !== nick) setNick(raw);
      const n = Array.from(raw.trim()).length;
      if (n < 2 || n > 12) throw new AppError('닉네임은 2~12자로 적어 주세요.');
      if (!age || !agree) throw new AppError('아래 두 가지에 체크해 주세요.');
      return saveProfile({ nick: raw, color, photo });
    });
  return (
    <div className="gate onboarding">
      <Wordmark big />
      <p className="display gate-tag">친구들과 함께 채우는 공부 인증 플래너</p>
      <form
        className="card col gap-lg gate-card"
        onSubmit={(e) => {
          e.preventDefault();
          if ((e.nativeEvent as unknown as { isComposing?: boolean }).isComposing) return;
          submit();
        }}
      >
        <ProfileFields nick={nick} setNick={setNick} color={color} setColor={setColor} photo={photo} setPhoto={setPhoto} />
        <div className="check-list">
          <label className="check-row" htmlFor="ob-age">
            <input id="ob-age" type="checkbox" checked={age} onChange={(e) => setAge(e.target.checked)} />
            <span>만 14세 이상이에요</span>
          </label>
          <label className="check-row" htmlFor="ob-agree">
            <input id="ob-agree" type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
            <span>이용 규칙과 개인정보 안내에 동의해요</span>
          </label>
          <button type="button" className="text-btn" onClick={() => openSheet({ kind: 'terms' })} id="ob-terms">
            이용 규칙과 개인정보 안내 읽기
          </button>
        </div>
        <Btn type="submit" block size="lg" busy={busy} id="ob-start">
          시작하기
        </Btn>
        {!ok && !busy ? (
          <p className="hint" id="ob-missing">
            시작하려면 아직 필요해요: {missing.join(', ')}
          </p>
        ) : null}
        <p className="hint">{host === 'firebase' ? '이 브라우저에 자동으로 계정이 만들어져서 비밀번호가 필요 없어요. 늘 쓰는 브라우저에서 열어 주세요.' : mode === 'cloud' ? 'Claude 계정으로 자동으로 구분되기 때문에 비밀번호를 따로 만들지 않아요.' : '지금은 체험 모드예요. 기록이 이 기기의 브라우저에만 저장돼요.'}</p>
      </form>
    </div>
  );
}

// ------------------------------------------------------------------ 내비게이션

const TABS: { name: 'home' | 'room' | 'chats' | 'my'; label: string; icon: string }[] = [
  { name: 'home', label: '홈', icon: 'home' },
  { name: 'room', label: '학습장', icon: 'book' },
  { name: 'chats', label: '채팅', icon: 'chat' },
  { name: 'my', label: '마이', icon: 'user' },
];

function activeTab(route: Route): string {
  if (route.name === 'study') return route.tab === 'chat' ? 'chats' : 'home';
  return route.name;
}

function Shell() {
  const route = useUi((u) => u.route);
  const unread = useApp((s) => totalUnread(s));
  const unseen = useApp((s) => unseenNotifs(s, Date.now()));
  const readOnly = useApp((s) => s.readOnly);
  const mode = useApp((s) => s.mode);
  const session = useApp((s) => s.session);
  const mainRef = useRef<HTMLElement>(null);
  const routeKey = route.name === 'study' ? `study:${route.sid}:${route.tab}` : route.name;
  const cur = activeTab(route);

  useLayoutEffect(() => {
    const el = mainRef.current;
    if (el) el.scrollTop = 0;
  }, [routeKey]);

  const tabBtn = (t: (typeof TABS)[number]) => (
    <button key={t.name} type="button" className={'nav-item' + (cur === t.name ? ' on' : '')} onClick={() => goTab(t.name)} aria-current={cur === t.name ? 'page' : undefined} id={'nav-' + t.name}>
      <span className="nav-icon">
        <Icon name={t.icon} size={22} />
        {t.name === 'chats' && unread > 0 ? <span className="badge">{unread > 99 ? '99+' : unread}</span> : null}
      </span>
      <span className="nav-label">{t.label}</span>
    </button>
  );

  let page: React.ReactNode;
  if (route.name === 'home') page = <HomePage />;
  else if (route.name === 'room') page = <RoomPage />;
  else if (route.name === 'chats') page = <ChatsPage />;
  else if (route.name === 'my') page = <MyPage />;
  else if (route.name === 'notifs') page = <NotifsPage />;
  else page = <StudyPage key={route.sid} sid={route.sid} tab={route.tab} />;

  return (
    <div className="shell">
      <nav className="rail" aria-label="주요 메뉴">
        <div className="rail-brand">
          <Wordmark />
        </div>
        {tabBtn(TABS[0])}
        {tabBtn(TABS[1])}
        <button type="button" className="nav-start" onClick={() => openSheet({ kind: 'startFocus' })} id="nav-start" aria-label="공부 시작">
          <Icon name="lock" size={22} />
          <span>공부 시작</span>
        </button>
        {tabBtn(TABS[2])}
        {tabBtn(TABS[3])}
        <button type="button" className={'nav-item only-wide' + (route.name === 'notifs' ? ' on' : '')} onClick={() => route.name !== 'notifs' && go({ name: 'notifs' })} id="nav-notifs">
          <span className="nav-icon">
            <Icon name="bell" size={22} />
            {unseen > 0 ? <span className="badge">{unseen > 99 ? '99+' : unseen}</span> : null}
          </span>
          <span className="nav-label">알림</span>
        </button>
      </nav>
      <div className="stage">
        <header className="topbar only-narrow">
          <Wordmark />
          <button type="button" className="icon-btn" onClick={() => route.name !== 'notifs' && go({ name: 'notifs' })} aria-label={unseen > 0 ? `알림, 새 소식 ${unseen}개` : '알림'} id="top-notifs">
            <Icon name="bell" size={22} />
            {unseen > 0 ? <span className="badge">{unseen > 99 ? '99+' : unseen}</span> : null}
          </button>
        </header>
        {readOnly ? (
          <div className="banner warn" role="status">
            <span className="grow">보기 전용으로 열려 있어요. 기록하려면 페이지 주인에게 편집자로 초대해 달라고 요청해 주세요.</span>
            <button type="button" className="text-btn" onClick={switchToLocal}>
              이 기기에서 체험하기
            </button>
          </div>
        ) : mode === 'local' ? (
          <div className="banner" role="status">
            <span className="grow">체험 모드예요. 기록이 이 기기에만 저장되고 친구와 공유되지 않아요.</span>
            <button type="button" className="text-btn" onClick={() => openSheet({ kind: 'help' })}>
              자세히
            </button>
          </div>
        ) : null}
        <main className="main" ref={mainRef} id="main">
          {page}
        </main>
        {session?.mode === 'room' && route.name !== 'room' ? (
          <button type="button" className={'room-pill' + (session.running ? '' : ' paused')} onClick={() => goTab('room')} id="room-pill" aria-label="학습장으로 돌아가기">
            <Icon name="book" size={16} />
            <span>{session.running ? '학습 중' : '멈춤'}</span>
            <Clock session={session} />
          </button>
        ) : null}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ 화면 안 알림

function isQuiet(now: number): boolean {
  const h = kstHour(now);
  return h >= 22 || h < 8;
}

function handleEvent(e: AppEvent) {
  const s = getState();
  const ui = getUi();
  const n = s.settings.notif;
  const me = s.profiles[s.uid];
  if (!me || me.deleted) return;
  if (s.session?.mode === 'focus') return; // 집중 모드에서는 채팅 화면만 보인다
  if (n.quiet && isQuiet(Date.now())) return;
  const name = (u: string) => nickOf(s.profiles, u);
  if (e.type === 'msg') {
    if (!n.chat || s.settings.blocks[e.row.u]) return;
    if (ui.route.name === 'study' && ui.route.sid === e.sid && ui.route.tab === 'chat') return;
    const st = s.studies[e.sid];
    toast(`${name(e.row.u)}: ${e.row.t.length > 40 ? e.row.t.slice(0, 40) + '…' : e.row.t}`, 'info', { label: st ? '채팅 보기' : '보기', run: () => go({ name: 'study', sid: e.sid, tab: 'chat' }) });
  } else if (e.type === 'checkin') {
    if (!n.friend || s.settings.blocks[e.c.uid]) return;
    const shared = e.c.sids.some((sid) => s.studies[sid] && isActiveMember(s.studies[sid], s.uid) && !isEnded(s.studies[sid], s.today));
    if (!shared) return;
    toast(`${name(e.c.uid)}님이 인증을 올렸어요`, 'info', { label: '보기', run: () => openSheet({ kind: 'checkinDetail', cid: e.id }) });
  } else if (e.type === 'poke') {
    if (!n.poke || s.settings.blocks[e.poke.from]) return;
    toast(`${name(e.poke.from)}님이 콕 찔렀어요. 공부하자!`, 'info', { label: '인증하기', run: () => openSheet({ kind: 'checkin' }) });
  } else if (e.type === 'react') {
    if (!n.react || s.settings.blocks[e.from]) return;
    toast(`${name(e.from)}님이 내 인증에 ${e.e} 반응을 남겼어요`, 'info', { label: '보기', run: () => openSheet({ kind: 'checkinDetail', cid: e.cid }) });
  } else if (e.type === 'comment') {
    if (!n.react || s.settings.blocks[e.from]) return;
    toast(`${name(e.from)}님의 댓글: ${e.t.length > 40 ? e.t.slice(0, 40) + '…' : e.t}`, 'info', { label: '보기', run: () => openSheet({ kind: 'checkinDetail', cid: e.cid }) });
  }
}

/** 리마인더와 주간 결과는 하루·한 주에 한 번만 띄운다. */
function checkTimed() {
  const s = getState();
  const me = s.profiles[s.uid];
  if (s.boot !== 'ready' || !me || me.deleted || !s.checkinsLoaded || !s.studiesLoaded) return;
  if (s.session?.mode === 'focus') return;
  const now = Date.now();
  if (s.settings.notif.quiet && isQuiet(now)) return;
  const rk = 'sw.remind.' + s.uid;
  if (remindDue(s, now) && lsGet(rk) !== s.today) {
    lsSet(rk, s.today);
    toast('오늘 인증이 아직 없어요. 마감은 새벽 4시예요.', 'info', { label: '인증하기', run: () => openSheet({ kind: 'checkin' }) });
    return;
  }
  const wk = 'sw.weekly.' + s.uid;
  const ws = weekStart(s.today);
  if (s.settings.notif.weekly && lsGet(wk) !== ws && buildNotifs(s, now).some((x) => x.kind === 'weekly')) {
    lsSet(wk, ws);
    toast('지난주 결과가 나왔어요.', 'info', { label: '보기', run: () => go({ name: 'notifs' }) });
  }
}

function readJoinHash(): string | null {
  try {
    const m = /^#?join-([A-Za-z0-9]{6})$/.exec(location.hash || '');
    return m ? normalizeCode(m[1]) : null;
  } catch {
    return null;
  }
}

/** 한 번 쓴 초대 링크는 주소에서 지운다(새로고침할 때마다 참여 화면이 다시 뜨지 않게). */
function clearJoinHash() {
  try {
    if (!/^#?join-/i.test(location.hash || '')) return;
    history.replaceState(null, '', location.pathname + location.search);
  } catch {
    try {
      location.hash = '';
    } catch {
      /* 주소를 못 바꾸는 환경이면 그대로 둔다 */
    }
  }
}

// ------------------------------------------------------------------ 앱

export function App() {
  const boot = useApp((s) => s.boot);
  const slow = useApp((s) => s.slow);
  const revoked = useApp((s) => s.revoked);
  const me = useApp((s) => s.profiles[s.uid]);
  const focus = useApp((s) => s.session?.mode === 'focus');
  const open = useUi((u) => u.sheets.length > 0);
  const [joinCode, setJoinCode] = useState<string | null>(readJoinHash);
  const screenRef = useRef<HTMLDivElement>(null);
  const hasProfile = !!me && !me.deleted && !!me.nick;
  const ready = boot === 'ready' && hasProfile && !revoked;

  useEffect(() => onEvent(handleEvent), []);

  useEffect(() => {
    const first = setTimeout(checkTimed, 4000);
    const t = setInterval(checkTimed, 60000);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, []);

  useEffect(() => {
    const onHash = () => {
      const c = readJoinHash();
      if (c) setJoinCode(c);
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  // 초대 링크로 들어왔으면 가입을 마친 뒤 참여 화면을 연다
  useEffect(() => {
    if (!ready || focus || !joinCode) return;
    openSheet({ kind: 'join', code: joinCode });
    setJoinCode(null);
    clearJoinHash();
  }, [ready, focus, joinCode]);

  // 페이지를 떠날 때 모아 둔 설정(읽음 표시 등)을 바로 저장한다
  useEffect(() => {
    const leave = () => flushPending();
    const vis = () => {
      if (document.visibilityState === 'hidden') flushPending();
    };
    window.addEventListener('pagehide', leave);
    document.addEventListener('visibilitychange', vis);
    return () => {
      window.removeEventListener('pagehide', leave);
      document.removeEventListener('visibilitychange', vis);
    };
  }, []);

  // 시트가 떠 있는 동안 뒤 화면은 조작할 수 없게 한다
  useEffect(() => {
    screenRef.current?.toggleAttribute('inert', open);
  }, [open]);

  let screen: React.ReactNode;
  if (revoked)
    screen = (
      <div className="gate">
        <Wordmark big />
        <div className="card col gap gate-card">
          <h1 className="confirm-title">접근 권한이 바뀌었어요</h1>
          <p className="muted">이 페이지를 볼 수 있는 권한이 바뀌었어요. 페이지를 새로 열어 주세요.</p>
        </div>
      </div>
    );
  else if (boot !== 'ready') screen = <Splash slow={slow} />;
  else if (!hasProfile) screen = <Onboarding />;
  else if (focus) screen = <FocusScreen />;
  else screen = <Shell />;

  return (
    <>
      <div className="screen" ref={screenRef}>
        {screen}
      </div>
      <SheetHost />
      <Toasts />
    </>
  );
}

export class ErrorBoundary extends Component<{ children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: unknown) {
    console.error('[sw] render failed', error);
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="gate">
        <div className="card col gap gate-card">
          <h1 className="confirm-title">화면을 그리다 문제가 생겼어요</h1>
          <p className="muted">기록은 그대로 남아 있어요. 다시 시도해도 같으면 페이지를 새로 열어 주세요.</p>
          <Btn onClick={() => this.setState({ failed: false })}>다시 시도</Btn>
        </div>
      </div>
    );
  }
}
