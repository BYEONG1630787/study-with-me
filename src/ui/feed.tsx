// 인증 카드, 피드, 사진 크게 보기.

import React, { useEffect, useMemo, useState } from 'react';
import { useApp, getState } from '../store';
import { addComment, deleteCheckin, deleteComment, ensureThumbs, fullPhotoUrl, loadSince, react, reportCheckin, reportComment } from '../actions';
import { feedOf, isBlocked, nickOf } from '../derive';
import { activeMemberIds, isHiddenByReports } from '../logic';
import { addDays, fmtAgo, fmtDay, fmtMin } from '../time';
import { REACTIONS, type CheckIn, type Uid } from '../types';
import { closeSheet, confirmSheet, openSheet, toast, type MenuItem } from '../ui';
import { Avatar, Btn, Empty, Icon, Nick, SheetFrame, useAsync, useNow } from './kit';
import { setBlocked } from '../actions';

function blockUser(uid: Uid) {
  const name = nickOf(getState().profiles, uid);
  confirmSheet({
    title: `${name}님을 차단할까요?`,
    body: '차단하면 이 사람의 인증, 댓글, 채팅이 내 화면에 보이지 않아요. 마이 > 차단 목록에서 풀 수 있어요.',
    okLabel: '차단',
    danger: true,
    onOk: () => {
      setBlocked(uid, true);
      toast('차단했어요', 'ok');
    },
  });
}

/** 신고는 실수로 누르기 쉬워서 한 번 더 묻는다. */
export function confirmReport(title: string, fn: () => Promise<unknown>) {
  confirmSheet({
    title,
    body: '부적절한 내용일 때만 신고해 주세요. 멤버 세 명이 신고하면 모두의 화면에서 자동으로 가려져요.',
    okLabel: '신고',
    danger: true,
    onOk: async () => {
      await fn();
      toast('신고했어요', 'ok');
    },
  });
}

export function userMenuItems(uid: Uid): MenuItem[] {
  return [{ label: '이 사용자 차단', danger: true, run: () => blockUser(uid) }];
}

function Photos({ id, c }: { id: string; c: CheckIn }) {
  const thumbs = useApp((s) => s.thumbs[id]);
  const n = c.photos.length;
  useEffect(() => {
    if (n > 0 && !thumbs) ensureThumbs(c.day, id);
  }, [id, c.day, n, thumbs]);
  if (n === 0) return null;
  return (
    <div className={'ci-photos n' + n}>
      {c.photos.map((ph, i) => {
        const src = thumbs?.[i];
        const ratio = n === 1 ? Math.min(1.78, Math.max(0.8, ph.w / ph.h)) : 1;
        return (
          <button key={ph.pid} type="button" className="ci-photo" style={{ aspectRatio: String(ratio) }} onClick={() => openSheet({ kind: 'lightbox', cid: id, index: i })} aria-label={`사진 ${i + 1} 크게 보기`}>
            {src ? <img src={src} alt="" loading="lazy" /> : <span className="skeleton" />}
          </button>
        );
      })}
    </div>
  );
}

function CommentRow({ cid, cmid, u, t, at, mine, now }: { cid: string; cmid: string; u: Uid; t: string; at: number; mine: boolean; now: number }) {
  const [, run] = useAsync();
  const menu = () => {
    const items: MenuItem[] = mine
      ? [{ label: '댓글 삭제', danger: true, run: () => run(() => deleteComment(cid, cmid)) }]
      : [{ label: '댓글 신고', run: () => confirmReport('이 댓글을 신고할까요?', () => reportComment(cid, cmid)) }, ...userMenuItems(u)];
    openSheet({ kind: 'menu', items });
  };
  return (
    <li className="comment">
      <Avatar uid={u} size={26} />
      <div className="grow">
        <p className="comment-line">
          <span className="comment-name">
            <Nick uid={u} />
          </span>
          <span className="comment-text">{t}</span>
        </p>
        <span className="faint tiny">{fmtAgo(at, now)}</span>
      </div>
      <button type="button" className="mini-more" onClick={menu} aria-label="댓글 메뉴">
        <Icon name="more" size={16} />
      </button>
    </li>
  );
}

function CommentInput({ cid }: { cid: string }) {
  const [text, setText] = useState('');
  const [busy, run] = useAsync();
  const send = () => {
    if (!text.trim()) return;
    run(async () => {
      await addComment(cid, text);
      setText('');
    });
  };
  return (
    <form
      className="comment-form"
      onSubmit={(e) => {
        e.preventDefault();
        send();
      }}
    >
      <input id={'cm-' + cid} className="input sm" value={text} maxLength={200} placeholder="댓글 달기" onChange={(e) => setText(e.target.value)} aria-label="댓글" />
      <Btn kind="soft" size="sm" type="submit" busy={busy} disabled={!text.trim()}>
        등록
      </Btn>
    </form>
  );
}

export function CheckinCard({ id, c, showStudies }: { id: string; c: CheckIn; showStudies?: boolean }) {
  const uid = useApp((s) => s.uid);
  const today = useApp((s) => s.today);
  const blocks = useApp((s) => s.settings.blocks);
  const studies = useApp((s) => s.studies);
  const readOnly = useApp((s) => s.readOnly);
  const now = useNow(30000);
  const [open, setOpen] = useState(false);
  const [, run] = useAsync();
  const mine = c.uid === uid;

  const comments = useMemo(() => {
    const out: { k: string; u: Uid; t: string; at: number }[] = [];
    for (const k of Object.keys(c.c ?? {})) {
      const cm = c.c![k];
      if (!cm || blocks[cm.u] || isHiddenByReports(cm.rep)) continue;
      out.push({ k, u: cm.u, t: cm.t, at: cm.at });
    }
    return out.sort((a, b) => a.at - b.at);
  }, [c.c, blocks]);

  const counts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const u of Object.keys(c.r ?? {})) {
      const r = c.r![u];
      if (r) m[r.e] = (m[r.e] ?? 0) + 1;
    }
    return m;
  }, [c.r]);
  const myReact = c.r?.[uid]?.e ?? null;
  const reactTotal = Object.values(counts).reduce((a, b) => a + b, 0);

  if (isHiddenByReports(c.rep)) {
    return (
      <article className="ci ci-hidden">
        <Icon name="flag" size={16} />
        <span>신고가 여러 건 접수되어 가려진 인증이에요.</span>
      </article>
    );
  }

  const editable = mine && c.day === today;
  const menu = () => {
    const items: MenuItem[] = [];
    if (editable) {
      items.push({ label: '수정', run: () => openSheet({ kind: 'checkin', edit: id }) });
      items.push({
        label: '삭제',
        danger: true,
        run: () => confirmSheet({ title: '이 인증을 지울까요?', body: '사진과 댓글, 반응도 함께 지워져요.', okLabel: '삭제', danger: true, onOk: () => run(() => deleteCheckin(id), '인증을 지웠어요') }),
      });
    }
    if (!mine) {
      items.push({ label: '인증 신고', run: () => confirmReport('이 인증을 신고할까요?', () => reportCheckin(id)) });
      items.push(...userMenuItems(c.uid));
    }
    openSheet({ kind: 'menu', items });
  };

  const shown = open ? comments : comments.slice(-1);
  return (
    <article className="ci">
      <header className="ci-head">
        <Avatar uid={c.uid} size={38} />
        <div className="grow">
          <div className="ci-name">
            <Nick uid={c.uid} />
          </div>
          <div className="faint tiny">
            {fmtAgo(c.at, now)}
            {c.editedAt ? ' · 수정됨' : ''}
          </div>
        </div>
        {editable || !mine ? (
          <button type="button" className="mini-more" onClick={menu} aria-label="인증 메뉴">
            <Icon name="more" size={18} />
          </button>
        ) : null}
      </header>
      {c.photos.length > 0 ? (
        <Photos id={id} c={c} />
      ) : (
        <div className="ci-ticket">
          <Icon name="timer" size={18} />
          <span>{c.timer === 'room' ? '학습장에서 타이머로 잰 공부' : '집중 모드에서 타이머로 잰 공부'}</span>
        </div>
      )}
      <div className="ci-body">
        <div className="ci-stats">
          <span className="ci-min num">{fmtMin(c.min)}</span>
          {c.tag ? <span className="chip">{c.tag}</span> : null}
          {c.timer ? (
            <span className="chip blue">
              <Icon name="timer" size={13} />
              타이머 인증
            </span>
          ) : null}
          {c.album && c.photos.length > 0 ? <span className="chip mute">앨범에서 올림</span> : null}
        </div>
        {c.memo ? <p className="ci-memo">{c.memo}</p> : null}
        {showStudies && c.sids.length > 0 ? (
          <p className="faint tiny">
            {c.sids
              .map((x) => studies[x]?.name)
              .filter(Boolean)
              .join(' · ')}
          </p>
        ) : null}
        {showStudies && c.sids.length === 0 ? <p className="faint tiny">내 기록에만 남긴 인증</p> : null}
      </div>
      <div className="react-bar">
        {REACTIONS.map((e) => (
          <button key={e} type="button" className={'react-btn' + (myReact === e ? ' on' : '')} disabled={readOnly} onClick={() => run(() => react(id, e))} aria-pressed={myReact === e} aria-label={`${e} 반응`}>
            <span className="emoji">{e}</span>
            {counts[e] ? <span className="num">{counts[e]}</span> : null}
          </button>
        ))}
        <span className="grow" />
        {reactTotal > 0 ? (
          <button type="button" className="text-btn" onClick={() => openSheet({ kind: 'reactors', cid: id })}>
            반응 {reactTotal}
          </button>
        ) : null}
        <button type="button" className="text-btn" onClick={() => setOpen(!open)} aria-expanded={open}>
          댓글 {comments.length}
        </button>
      </div>
      {shown.length > 0 || open ? (
        <div className="comments">
          {!open && comments.length > 1 ? (
            <button type="button" className="text-btn" onClick={() => setOpen(true)}>
              댓글 {comments.length}개 모두 보기
            </button>
          ) : null}
          <ul className="comment-list">
            {shown.map((cm) => (
              <CommentRow key={cm.k} cid={id} cmid={cm.k} u={cm.u} t={cm.t} at={cm.at} mine={cm.u === uid} now={now} />
            ))}
          </ul>
          {open && !readOnly ? <CommentInput cid={id} /> : null}
        </div>
      ) : null}
    </article>
  );
}

function dayLabel(day: string, today: string): string {
  if (day === today) return '오늘';
  if (day === addDays(today, -1)) return '어제';
  return fmtDay(day);
}

export function Feed({ sid }: { sid: string }) {
  const s = useApp((x) => x);
  const study = s.studies[sid];
  const [who, setWho] = useState<Uid | null>(null);
  const [days, setDays] = useState(7);
  const rows = useMemo(() => feedOf(s, sid), [s.checkins, s.settings.blocks, sid]); // eslint-disable-line react-hooks/exhaustive-deps
  const members = useMemo(() => (study ? activeMemberIds(study) : []), [study]);
  const filtered = who ? rows.filter((r) => r.c.uid === who) : rows;
  const groups = useMemo(() => {
    const m = new Map<string, { id: string; c: CheckIn }[]>();
    for (const r of filtered) {
      const g = m.get(r.c.day);
      if (g) g.push(r);
      else m.set(r.c.day, [r]);
    }
    return [...m.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1));
  }, [filtered]);
  const shown = groups.slice(0, days);
  const canLoadMore = !!study && s.loadedSince > study.start;
  const more = () => {
    setDays(days + 7);
    if (canLoadMore && groups.length <= days + 7) loadSince(addDays(s.loadedSince, -35) < study.start ? study.start : addDays(s.loadedSince, -35));
  };
  if (!study) return null;
  return (
    <div className="feed">
      <div className="chips-scroll" role="group" aria-label="멤버별 보기">
        <button type="button" className={'chip pick' + (!who ? ' on' : '')} onClick={() => setWho(null)}>
          전체
        </button>
        {members.map((u) => (
          <button key={u} type="button" className={'chip pick' + (who === u ? ' on' : '')} onClick={() => setWho(who === u ? null : u)}>
            {nickOf(s.profiles, u)}
          </button>
        ))}
      </div>
      {filtered.length === 0 ? (
        <Empty icon="camera" title={who ? '이 멤버가 올린 인증이 아직 없어요' : '아직 올라온 인증이 없어요'} body="공부한 사진과 시간을 올리면 여기에 날짜별로 쌓여요." />
      ) : null}
      {shown.map(([day, list]) => (
        <section key={day} className="feed-day">
          <h3 className="day-head">
            <span>{dayLabel(day, s.today)}</span>
            <span className="faint">{list.length}건</span>
          </h3>
          <div className="col">
            {list.map((r) => (
              <CheckinCard key={r.id} id={r.id} c={r.c} />
            ))}
          </div>
        </section>
      ))}
      {groups.length > days || canLoadMore ? (
        <div className="center">
          <Btn kind="line" size="sm" onClick={more}>
            이전 기록 더 보기
          </Btn>
        </div>
      ) : null}
    </div>
  );
}

export function LightboxSheet({ cid, index }: { cid: string; index: number }) {
  const c = useApp((s) => s.checkins[cid]);
  const thumbs = useApp((s) => s.thumbs[cid]);
  const [i, setI] = useState(index);
  const [full, setFull] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const ph = c?.photos[i];
  useEffect(() => {
    let alive = true;
    setFull(null);
    setFailed(false);
    if (ph) fullPhotoUrl(ph).then((u) => alive && setFull(u));
    return () => {
      alive = false;
    };
  }, [ph?.pid]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!c || !ph) return null;
  const n = c.photos.length;
  const src = !failed && full ? full : thumbs?.[i];
  return (
    <SheetFrame onClose={closeSheet} plain wide title={`사진 ${i + 1} / ${n}`}>
      <div className="lightbox">
        {src ? <img src={src} alt="인증 사진" onError={() => setFailed(true)} /> : <span className="skeleton" style={{ aspectRatio: String(ph.w / ph.h) }} />}
        {n > 1 ? (
          <div className="lightbox-nav">
            <Btn kind="soft" size="sm" icon="left" onClick={() => setI((i + n - 1) % n)} label="이전 사진" />
            <span className="num">
              {i + 1} / {n}
            </span>
            <Btn kind="soft" size="sm" icon="right" onClick={() => setI((i + 1) % n)} label="다음 사진" />
          </div>
        ) : null}
      </div>
    </SheetFrame>
  );
}

export function ReactorsSheet({ cid }: { cid: string }) {
  const c = useApp((s) => s.checkins[cid]);
  const blocks = useApp((s) => s.settings.blocks);
  const rows = Object.keys(c?.r ?? {})
    .map((u) => ({ u, r: c!.r![u] }))
    .filter((x) => x.r && !blocks[x.u])
    .sort((a, b) => b.r!.at - a.r!.at);
  return (
    <SheetFrame title="반응한 사람" onClose={closeSheet}>
      {rows.length === 0 ? <p className="muted">아직 반응이 없어요.</p> : null}
      <ul className="list">
        {rows.map((x) => (
          <li key={x.u} className="list-row">
            <Avatar uid={x.u} size={32} />
            <span className="grow">
              <Nick uid={x.u} />
            </span>
            <span className="emoji lg">{x.r!.e}</span>
          </li>
        ))}
      </ul>
    </SheetFrame>
  );
}

export function CheckinDetailSheet({ cid }: { cid: string }) {
  const c = useApp((s) => s.checkins[cid]);
  return (
    <SheetFrame title="인증" onClose={closeSheet}>
      {c ? <CheckinCard id={cid} c={c} showStudies /> : <p className="muted">지워진 인증이에요.</p>}
    </SheetFrame>
  );
}

export { isBlocked };
