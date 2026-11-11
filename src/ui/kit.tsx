// 공용 부품: 아이콘, 아바타, 버튼, 시트, 도장 등.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useApp } from '../store';
import { errText } from '../actions';
import { NO_NAME } from '../derive';
import { toast } from '../ui';
import type { Uid } from '../types';

const ICONS: Record<string, React.ReactNode> = {
  home: <path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />,
  book: (
    <>
      <path d="M5 4h6a2 2 0 0 1 2 2v14a2 2 0 0 0-2-2H5z" />
      <path d="M19 4h-4a2 2 0 0 0-2 2v14a2 2 0 0 1 2-2h4z" />
    </>
  ),
  chat: <path d="M4 5h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1h-9l-5 4v-4H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z" />,
  user: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c0-4 3.6-6 8-6s8 2 8 6" />
    </>
  ),
  users: (
    <>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20c0-3.5 2.9-5.5 6.5-5.5s6.5 2 6.5 5.5" />
      <path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18.5 14.9c1.9.7 3 2.3 3 5.1" />
    </>
  ),
  bell: (
    <>
      <path d="M6 9a6 6 0 1 1 12 0c0 5 2 6 2 7H4c0-1 2-2 2-7z" />
      <path d="M10 20a2 2 0 0 0 4 0" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  camera: (
    <>
      <path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z" />
      <circle cx="12" cy="13.5" r="3.5" />
    </>
  ),
  image: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="8.5" cy="9.5" r="1.5" />
      <path d="M21 16l-5-5-8 8" />
    </>
  ),
  timer: (
    <>
      <circle cx="12" cy="13" r="8" />
      <path d="M12 9v4l2.5 2.5M9 2h6" />
    </>
  ),
  lock: (
    <>
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </>
  ),
  pause: <path d="M8 5v14M16 5v14" />,
  play: <path d="M7 4l13 8-13 8z" />,
  stop: <rect x="6" y="6" width="12" height="12" rx="1.5" />,
  send: <path d="M4 12l16-8-6 16-3-7z" />,
  more: (
    <>
      <circle cx="5" cy="12" r="1.2" />
      <circle cx="12" cy="12" r="1.2" />
      <circle cx="19" cy="12" r="1.2" />
    </>
  ),
  close: <path d="M6 6l12 12M18 6L6 18" />,
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  left: <path d="M15 5l-7 7 7 7" />,
  right: <path d="M9 5l7 7-7 7" />,
  down: <path d="M5 9l7 7 7-7" />,
  trash: <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6" />,
  flag: <path d="M5 21V4M5 4h12l-2 4 2 4H5" />,
  copy: (
    <>
      <rect x="8" y="8" width="12" height="12" rx="2" />
      <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
    </>
  ),
  link: <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />,
  crown: <path d="M4 18h16M4 18 3 8l5 4 4-7 4 7 5-4-1 10" />,
  gear: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9 7 7M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1" />
    </>
  ),
  fire: <path d="M12 3c1 3 5 5 5 10a5 5 0 0 1-10 0c0-2 1-3 2-4 0 2 1 3 2 3 0-3-1-5 1-9z" />,
  edit: <path d="M4 20h4l10-10-4-4L4 16zM13 7l4 4" />,
  file: <path d="M6 3h8l4 4v14H6zM14 3v4h4" />,
  external: <path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />,
  zoomIn: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.3-4.3M8 11h6M11 8v6" />
    </>
  ),
  zoomOut: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.3-4.3M8 11h6" />
    </>
  ),
  poke: <path d="M9 11V5a1.5 1.5 0 0 1 3 0v5m0-1.500a1.5 1.5 0 0 1 3 0V11m0-.5a1.5 1.5 0 0 1 3 0V15a6 6 0 0 1-6 6h-1a6 6 0 0 1-5-2.700L4 14.500a1.500 1.500 0 0 1 2.500-1.600L9 15" />,
  trophy: <path d="M8 4h8v5a4 4 0 0 1-8 0zM8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4M8 20h8M10 17h4" />,
  calendar: (
    <>
      <rect x="4" y="5" width="16" height="16" rx="2" />
      <path d="M4 10h16M9 3v4M15 3v4" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 8h.01" />
    </>
  ),
  leave: <path d="M10 4H5v16h5M15 8l4 4-4 4M19 12H9" />,
  upload: <path d="M12 16V4M7 9l5-5 5 5M4 20h16" />,
  list: <path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01" />,
  expand: <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />,
  coin: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M8 9l1.500 6L12 9l2.500 6L16 9M7.500 12h9" />
    </>
  ),
  chart: <path d="M4 20V10M10 20V4M16 20v-7M21 20H3" />,
  megaphone: <path d="M4 10v4h3l8 4V6l-8 4zM18 9a4 4 0 0 1 0 6" />,
};

export type IconName = keyof typeof ICONS;

export function Icon({ name, size = 20, fill }: { name: string; size?: number; fill?: boolean }) {
  return (
    <svg className="icon" width={size} height={size} viewBox="0 0 24 24" fill={fill ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {ICONS[name] ?? null}
    </svg>
  );
}

export function Avatar({ uid, size = 36 }: { uid: Uid; size?: number }) {
  const p = useApp((s) => s.profiles[uid]);
  const gone = !p || p.deleted || !p.nick;
  const style = { width: size, height: size, fontSize: Math.round(size * 0.42) };
  if (!gone && p.photo) return <img className="avatar" style={style} src={p.photo} alt="" />;
  return (
    <span className={'avatar av-' + (gone ? 'x' : (p.color ?? 0) % 8)} style={style} aria-hidden="true">
      {gone ? '?' : Array.from(p.nick)[0]}
    </span>
  );
}

export function Nick({ uid }: { uid: Uid }) {
  const p = useApp((s) => s.profiles[uid]);
  const me = useApp((s) => s.uid);
  const name = !p || p.deleted || !p.nick ? NO_NAME : p.nick;
  return (
    <>
      {name}
      {uid === me ? <span className="me-tag">나</span> : null}
    </>
  );
}

type BtnKind = 'primary' | 'soft' | 'ghost' | 'line' | 'danger';

export function Btn(props: {
  kind?: BtnKind;
  size?: 'sm' | 'md' | 'lg';
  block?: boolean;
  icon?: string;
  busy?: boolean;
  disabled?: boolean;
  type?: 'button' | 'submit';
  onClick?: (e: React.MouseEvent) => void;
  children?: React.ReactNode;
  id?: string;
  label?: string;
  className?: string;
}) {
  const { kind = 'primary', size = 'md', block, icon, busy, disabled, type = 'button', onClick, children, id, label, className } = props;
  const cls = ['btn', kind, size, block ? 'block' : '', !children ? 'icon-only' : '', className ?? ''].filter(Boolean).join(' ');
  return (
    <button id={id} type={type} className={cls} disabled={disabled || busy} onClick={onClick} aria-label={label} title={label}>
      {busy ? <span className="spin" aria-hidden="true" /> : icon ? <Icon name={icon} size={size === 'sm' ? 16 : 18} /> : null}
      {children ? <span>{children}</span> : null}
    </button>
  );
}

/** 비동기 동작 실행기: 진행 중 표시와 오류 토스트를 맡는다. */
export function useAsync(): [boolean, (fn: () => Promise<unknown> | unknown, okMsg?: string) => Promise<boolean>] {
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);
  const lock = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const run = useCallback(async (fn: () => Promise<unknown> | unknown, okMsg?: string) => {
    if (lock.current) return false;
    lock.current = true;
    setBusy(true);
    try {
      await fn();
      if (okMsg) toast(okMsg, 'ok');
      return true;
    } catch (e) {
      toast(errText(e), 'err');
      return false;
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  }, []);
  return [busy, run];
}

/** 주기적으로 바뀌는 현재 시각 */
export function useNow(ms = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

export function SheetFrame(props: { title?: string; onClose: () => void; children: React.ReactNode; footer?: React.ReactNode; wide?: boolean; plain?: boolean; labelId?: string }) {
  const { title, onClose, children, footer, wide, plain } = props;
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // 시트가 겹쳐 있어도 한 번에 하나만 닫히게 한다
        e.stopImmediatePropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey);
    const prev = document.activeElement as HTMLElement | null;
    const el = ref.current;
    if (el && !el.contains(document.activeElement)) el.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      if (prev && document.contains(prev)) prev.focus?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div
      className="sheet-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className={'sheet' + (wide ? ' wide' : '') + (plain ? ' plain' : '')} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={ref}>
        {title !== undefined ? (
          <div className="sheet-head">
            <h2 className="sheet-title">{title}</h2>
            <Btn kind="ghost" size="sm" icon="close" onClick={onClose} label="닫기" />
          </div>
        ) : null}
        <div className="sheet-body">{children}</div>
        {footer ? <div className="sheet-foot">{footer}</div> : null}
      </div>
    </div>
  );
}

export function Empty({ icon, title, body, children }: { icon?: string; title: string; body?: string; children?: React.ReactNode }) {
  return (
    <div className="empty">
      {icon ? (
        <div className="empty-icon">
          <Icon name={icon} size={26} />
        </div>
      ) : null}
      <p className="empty-title">{title}</p>
      {body ? <p className="empty-body">{body}</p> : null}
      {children ? <div className="empty-actions">{children}</div> : null}
    </div>
  );
}

export function Seg<T extends string>({ options, value, onChange, id }: { options: { value: T; label: string; badge?: number }[]; value: T; onChange: (v: T) => void; id?: string }) {
  return (
    <div className="seg" role="tablist" id={id}>
      {options.map((o) => (
        <button key={o.value} type="button" role="tab" aria-selected={o.value === value} className={'seg-item' + (o.value === value ? ' on' : '')} onClick={() => onChange(o.value)}>
          {o.label}
          {o.badge ? <span className="badge">{o.badge > 99 ? '99+' : o.badge}</span> : null}
        </button>
      ))}
    </div>
  );
}

/** 인주 도장. 달성한 날·주에 찍는다. */
export function Stamp({ text = '인증', size = 34, faded }: { text?: string; size?: number; faded?: boolean }) {
  const big = size >= 64;
  return (
    <span className={'stamp' + (faded ? ' faded' : '') + (big ? ' big' : '')} style={{ width: size, height: size, fontSize: big ? size * 0.19 : size * 0.32 }} aria-label={text}>
      <span>{text}</span>
    </span>
  );
}

export function Field({ label, hint, htmlFor, children }: { label: string; hint?: string; htmlFor?: string; children: React.ReactNode }) {
  return (
    <div className="field">
      <label className="label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {hint ? <p className="hint">{hint}</p> : null}
    </div>
  );
}

export function Toggle({ id, checked, onChange, label, sub }: { id: string; checked: boolean; onChange: (v: boolean) => void; label: string; sub?: string }) {
  return (
    <label className="toggle-row" htmlFor={id}>
      <span className="grow">
        <span className="toggle-label">{label}</span>
        {sub ? <span className="toggle-sub">{sub}</span> : null}
      </span>
      <input id={id} type="checkbox" className="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

/** 클립보드 복사. 막히면 false를 돌려준다(그때는 글자를 직접 선택하게 한다). */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function CopyBox({ id, text, label }: { id: string; text: string; label: string }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  return (
    <div className="copybox">
      <textarea id={id} ref={ref} className="input copy-text" readOnly rows={Math.min(4, Math.max(1, text.split('\n').length))} value={text} onFocus={(e) => e.currentTarget.select()} />
      <Btn
        kind="soft"
        size="sm"
        icon="copy"
        onClick={async () => {
          if (await copyText(text)) toast('복사했어요', 'ok');
          else {
            ref.current?.focus();
            ref.current?.select();
            toast('글자를 선택했어요. 복사(Ctrl+C)해 주세요.');
          }
        }}
      >
        {label}
      </Btn>
    </div>
  );
}
