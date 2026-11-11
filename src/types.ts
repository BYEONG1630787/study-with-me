// 스터디 윗미 데이터 타입. 모든 문서는 platform db(또는 로컬 저장소)에 JSON으로 저장된다.

export type Uid = string;

export interface Profile {
  nick: string;
  color: number; // 아바타 색 번호
  photo?: string | null; // 작은 data URL
  createdAt: number;
  agreedAt: number;
  deleted?: boolean;
}

/** 인증 규칙 한 판. from(공부 날짜)부터 적용된다. */
export interface RuleRev {
  from: string;
  weekly: number; // 주당 목표 횟수 1~7
  dailyMin: number; // 하루 최소 공부 시간(분), 0 = 없음
}

export interface Member {
  role: 'host' | 'member';
  state: 'active' | 'left' | 'kicked';
  joinedAt: number;
  leftAt?: number | null;
  kickedCode?: string | null;
}

export interface Study {
  name: string;
  intro: string;
  start: string;
  end: string | null;
  max: number;
  code: string;
  status: 'open' | 'ended';
  endedAt?: number | null;
  rules: RuleRev[];
  members: Record<Uid, Member>;
  fineAmount: number; // 주간 목표 미달성 1회당 벌금(원), 0 = 사용 안 함
  fineFrom: string | null; // 벌금을 적용하기 시작한 주(월요일)
  paid?: Record<string, boolean | null>; // `${주 시작일}_${uid}` → 납부 여부
  createdAt: number;
  createdBy: Uid;
}

export interface PhotoRef {
  pid: string;
  w: number;
  h: number;
  asset?: string | null; // 원본이 자산 저장소에 있으면 그 id
}

export interface Reaction {
  e: string;
  at: number;
}

export interface Comment {
  u: Uid;
  t: string;
  at: number;
  rep?: Record<Uid, number>;
}

export interface CheckIn {
  uid: Uid;
  day: string; // 공부 날짜(새벽 4시 기준)
  min: number;
  tag: string;
  memo: string;
  sids: string[];
  photos: PhotoRef[];
  album: boolean;
  timer: 'focus' | 'room' | null;
  at: number;
  editedAt?: number | null;
  r?: Record<Uid, Reaction | null>;
  c?: Record<string, Comment | null>;
  rep?: Record<Uid, number>;
}

export interface Msg {
  u: Uid;
  t: string;
  at: number;
  rep?: Record<Uid, number>;
}

/** 진행 중인 공부 세션. 친구들에게 "공부 중"으로 보인다. */
export interface Presence {
  mode: 'focus' | 'room' | null;
  running: boolean;
  startedAt: number; // 지금 구간이 시작된 시각(ms)
  base: number; // 그 전까지 쌓인 초
  subject: string;
  began: number; // 세션 첫 시작 시각
  at: number; // 마지막 변경 시각
}

export interface PendingSession {
  sec: number;
  mode: 'focus' | 'room';
  subject: string;
  began: number;
  ended: number;
}

export interface Poke {
  from: Uid;
  to: Uid;
  sid: string;
  day: string;
  at: number;
}

export interface NotifSettings {
  remind: boolean;
  remindAt: string; // 'HH:MM' (KST)
  friend: boolean;
  react: boolean;
  weekly: boolean;
  poke: boolean;
  chat: boolean;
  quiet: boolean; // 밤 10시~오전 8시에는 팝업 알림을 띄우지 않음
}

export interface Settings {
  notif: NotifSettings;
  seenAt: number;
  read: Record<string, number>;
  blocks: Record<Uid, boolean | null>;
}

export type MaterialKind = 'pdf' | 'html' | 'image' | 'text' | 'md' | 'link';

export interface Material {
  title: string;
  subject: string;
  kind: MaterialKind;
  mime: string;
  size: number;
  asset?: string | null; // 자산 저장소 id (여러 기기에서 열 수 있음)
  local?: string | null; // 이 값과 같은 기기에만 파일이 있음
  url?: string | null; // 웹 링크
  page?: number; // 마지막으로 본 쪽
  at: number;
}

export const DEFAULT_SETTINGS: Settings = {
  notif: { remind: true, remindAt: '21:00', friend: true, react: true, weekly: true, poke: true, chat: true, quiet: false },
  seenAt: 0,
  read: {},
  blocks: {},
};

export const REACTIONS = ['👍', '🔥', '👏', '😮'] as const;
export const MAX_STUDIES = 5;
export const REPORT_HIDE = 3;
