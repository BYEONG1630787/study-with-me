// 학습장: 내 자료를 화면에서 보면서 타이머로 공부하는 곳. 공부를 시작해도 잠기지 않는다.

import React, { useMemo, useRef, useState } from 'react';
import { P, useApp } from '../store';
import { MATERIAL_ACCEPT, addMaterialFile, addMaterialLink, elapsedSec, errText, pauseSession, removeMaterial, resumeSession, startSession, stopSession, updateMaterial } from '../actions';
import { subjectHints } from '../derive';
import { fmtTimer } from '../time';
import type { Material, Presence } from '../types';
import { closeSheet, confirmSheet, getUi, openSheet, setRoomMid, toast, useUi } from '../ui';
import { Btn, Empty, Field, Icon, Seg, SheetFrame, useAsync, useNow } from './kit';
import { KIND_ICON, KIND_LABEL, Viewer } from './viewer';

export function fmtSize(n: number): string {
  if (n >= 1024 * 1024) return (n / 1024 / 1024).toFixed(n >= 10 * 1024 * 1024 ? 0 : 1) + 'MB';
  if (n >= 1024) return Math.round(n / 1024) + 'KB';
  return n + 'B';
}

/** 1초마다 바뀌는 시계. 이 부품만 다시 그린다. */
export function Clock({ session, className }: { session: Presence; className?: string }) {
  const now = useNow(session.running ? 500 : 5000);
  return (
    <span className={'timer-text ' + (className ?? '')} role="timer" aria-live="off">
      {fmtTimer(elapsedSec(session, now))}
    </span>
  );
}

/** 공부 끝내기: 잰 시간이 1분을 넘으면 인증 화면을 연다. */
export function finishSession() {
  const p = stopSession();
  if (p) openSheet({ kind: 'checkin', fromTimer: true });
  else toast('1분이 안 되는 공부는 기록하지 않아요.');
}

function RoomTimer() {
  const session = useApp((s) => s.session);
  const s = useApp((x) => x);
  const mid = useUi((u) => u.roomMid);
  const [subject, setSubject] = useState('');
  const hints = useMemo(() => subjectHints(s), [s.materials, s.checkins, s.uid]); // eslint-disable-line react-hooks/exhaustive-deps
  const fallback = mid ? (s.materials[mid]?.subject ?? '') : '';
  const on = session?.mode === 'room';

  const start = () => {
    try {
      startSession('room', subject.trim() || fallback);
    } catch (e) {
      toast(errText(e), 'err');
    }
  };

  if (on && session) {
    return (
      <div className={'room-timer on' + (session.running ? '' : ' paused')}>
        <div className="grow room-timer-main">
          <Clock session={session} />
          <span className="faint tiny">
            {session.running ? '학습 중' : '잠시 멈춤'}
            {session.subject ? ` · ${session.subject}` : ''}
          </span>
        </div>
        {session.running ? (
          <Btn kind="soft" size="sm" icon="pause" onClick={pauseSession} id="room-pause">
            일시정지
          </Btn>
        ) : (
          <Btn kind="soft" size="sm" icon="play" onClick={resumeSession} id="room-resume">
            계속
          </Btn>
        )}
        <Btn size="sm" icon="stop" onClick={finishSession} id="room-stop">
          학습 종료
        </Btn>
      </div>
    );
  }

  return (
    <form
      className="room-timer"
      onSubmit={(e) => {
        e.preventDefault();
        start();
      }}
    >
      <div className="grow">
        <input id="room-subject" className="input sm" value={subject} maxLength={20} list="room-subject-list" placeholder={fallback ? `과목: ${fallback}` : '과목 (선택)'} aria-label="과목" onChange={(e) => setSubject(e.target.value)} autoComplete="off" />
        <datalist id="room-subject-list">
          {hints.map((x) => (
            <option key={x} value={x} />
          ))}
        </datalist>
      </div>
      <Btn type="submit" size="sm" icon="play" id="room-start">
        학습 시작
      </Btn>
    </form>
  );
}

function Library() {
  const materials = useApp((s) => s.materials);
  const loaded = useApp((s) => s.materialsLoaded);
  const readOnly = useApp((s) => s.readOnly);
  const hasAssets = useApp((s) => s.hasAssets);
  const [subject, setSubject] = useState<string | null>(null);
  const device = P().deviceId;

  const rows = useMemo(
    () =>
      Object.keys(materials)
        .map((id) => ({ id, m: materials[id] }))
        .sort((a, b) => b.m.at - a.m.at),
    [materials],
  );
  const subjects = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) set.add(r.m.subject || '');
    return [...set].sort((a, b) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b, 'ko')));
  }, [rows]);
  const active = subject !== null && subjects.includes(subject) ? subject : null;
  const groups = subjects.filter((x) => active === null || x === active).map((x) => ({ subject: x, rows: rows.filter((r) => (r.m.subject || '') === x) }));

  return (
    <div className="library">
      <div className="row between gap">
        <div>
          <h1 className="page-title">학습장</h1>
          <p className="faint tiny">자료를 넣어 두고 화면에서 보면서 공부해요. 자료는 나만 볼 수 있어요.</p>
        </div>
        <Btn icon="plus" size="sm" onClick={() => openSheet({ kind: 'addMaterial' })} disabled={readOnly} id="room-add">
          자료 추가
        </Btn>
      </div>

      {subjects.length > 1 ? (
        <div className="chips-scroll" role="group" aria-label="과목별 보기">
          <button type="button" className={'chip pick' + (active === null ? ' on' : '')} onClick={() => setSubject(null)}>
            전체
          </button>
          {subjects.map((x) => (
            <button key={x || '-'} type="button" className={'chip pick' + (active === x ? ' on' : '')} onClick={() => setSubject(active === x ? null : x)}>
              {x || '과목 없음'}
            </button>
          ))}
        </div>
      ) : null}

      {!loaded ? <p className="center faint pad">불러오는 중…</p> : null}
      {loaded && rows.length === 0 ? (
        <Empty icon="book" title="아직 넣어 둔 자료가 없어요" body="PDF, HTML, 이미지, 글 파일을 넣거나 웹 링크를 추가해 보세요. 과목별로 묶어서 볼 수 있어요.">
          <Btn icon="upload" onClick={() => openSheet({ kind: 'addMaterial' })} disabled={readOnly}>
            첫 자료 넣기
          </Btn>
        </Empty>
      ) : null}

      {groups.map((g) => (
        <section key={g.subject || '-'}>
          <h2 className="sec-title">
            {g.subject || '과목 없음'}
            <span className="faint">{g.rows.length}개</span>
          </h2>
          <ul className="list card flush">
            {g.rows.map(({ id, m }) => {
              const away = !m.asset && m.kind !== 'link' && !!m.local && m.local !== device;
              return (
                <li key={id} className="mat-row">
                  <button type="button" className="list-row as-btn" onClick={() => setRoomMid(id)}>
                    <span className={'mat-icon k-' + m.kind}>
                      <Icon name={KIND_ICON[m.kind]} size={18} />
                    </span>
                    <span className="grow">
                      <span className="row-title">{m.title}</span>
                      <span className="row-sub">
                        {KIND_LABEL[m.kind]}
                        {m.size ? ` · ${fmtSize(m.size)}` : ''}
                        {m.kind === 'pdf' && m.page && m.page > 1 ? ` · ${m.page}쪽까지 봄` : ''}
                        {away ? ' · 다른 기기에 있음' : !m.asset && m.kind !== 'link' ? ' · 이 기기에만 있음' : ''}
                      </span>
                    </span>
                  </button>
                  <button type="button" className="mini-more" onClick={() => openSheet({ kind: 'editMaterial', mid: id })} aria-label={`${m.title} 정보 수정`}>
                    <Icon name="more" size={18} />
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
      {loaded && rows.length > 0 && !hasAssets ? <p className="hint">파일은 이 기기의 브라우저에만 저장돼요. 다른 기기에서는 목록만 보이고 파일은 다시 넣어야 해요.</p> : null}
    </div>
  );
}

export function RoomPage() {
  const mid = useUi((u) => u.roomMid);
  return (
    <div className="page fill room">
      <RoomTimer />
      {mid ? <Viewer key={mid} mid={mid} /> : <Library />}
    </div>
  );
}

// ------------------------------------------------------------------ 자료 추가·수정

export function AddMaterialSheet() {
  const s = useApp((x) => x);
  const [tab, setTab] = useState<'file' | 'link'>('file');
  const [subject, setSubject] = useState('');
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const hints = subjectHints(s);

  const addFiles = async (files: File[]) => {
    if (!files.length || busy) return;
    setBusy(true);
    let ok = 0;
    let last: string | null = null;
    let deviceOnly = false;
    const errors: string[] = [];
    for (let i = 0; i < files.length; i++) {
      setProgress(`${i + 1}/${files.length} 넣는 중… ${files[i].name}`);
      try {
        const r = await addMaterialFile(files[i], subject);
        ok++;
        last = r.mid;
        deviceOnly = deviceOnly || r.deviceOnly;
      } catch (e) {
        errors.push(`${files[i].name}: ${errText(e)}`);
      }
    }
    setBusy(false);
    setProgress(null);
    if (errors.length) toast(errors[0] + (errors.length > 1 ? ` (외 ${errors.length - 1}건)` : ''), 'err');
    if (ok > 0) {
      toast(deviceOnly ? `자료 ${ok}개를 이 기기에 넣었어요` : `자료 ${ok}개를 넣었어요`, 'ok');
      closeSheet();
      if (files.length === 1 && last) setRoomMid(last);
    }
  };

  const addLink = async () => {
    if (busy || !url.trim()) return;
    setBusy(true);
    try {
      await addMaterialLink(url, title, subject);
      toast('링크를 넣었어요', 'ok');
      closeSheet();
    } catch (e) {
      toast(errText(e), 'err');
      setBusy(false);
    }
  };

  return (
    <SheetFrame
      title="자료 추가"
      onClose={closeSheet}
      footer={
        tab === 'link' ? (
          <Btn block size="lg" busy={busy} disabled={!url.trim()} onClick={addLink} id="mat-link-save">
            링크 넣기
          </Btn>
        ) : undefined
      }
    >
      <div className="col gap-lg">
        <Seg
          id="mat-tab"
          options={[
            { value: 'file', label: '파일' },
            { value: 'link', label: '웹 링크' },
          ]}
          value={tab}
          onChange={setTab}
        />
        <Field label="과목" htmlFor="mat-subject" hint="선택 · 같은 과목끼리 묶여요">
          <input id="mat-subject" className="input" value={subject} maxLength={20} list="mat-subject-list" placeholder="예: 영어, 자료구조" onChange={(e) => setSubject(e.target.value)} autoComplete="off" />
          <datalist id="mat-subject-list">
            {hints.map((x) => (
              <option key={x} value={x} />
            ))}
          </datalist>
        </Field>
        {tab === 'file' ? (
          <>
            <div
              className={'dropzone' + (over ? ' over' : '')}
              onDragOver={(e) => {
                e.preventDefault();
                setOver(true);
              }}
              onDragLeave={() => setOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setOver(false);
                addFiles(Array.from(e.dataTransfer.files ?? []));
              }}
            >
              <Icon name="upload" size={26} />
              <p className="row-title">{progress ?? 'PDF, HTML, 이미지, 글 파일'}</p>
              <p className="faint tiny">파일 하나에 20MB까지 · 여러 개를 한 번에 고를 수 있어요</p>
              <Btn kind="soft" busy={busy} onClick={() => fileRef.current?.click()} id="mat-pick">
                파일 고르기
              </Btn>
              <input
                ref={fileRef}
                id="mat-file"
                type="file"
                accept={MATERIAL_ACCEPT}
                multiple
                hidden
                onChange={(e) => {
                  const files = Array.from(e.target.files ?? []);
                  e.target.value = '';
                  addFiles(files);
                }}
              />
            </div>
            <p className="hint">{s.hasAssets ? '파일은 이 페이지의 파일 저장소에 올라가고, 목록은 나만 볼 수 있어요.' : '파일은 이 기기의 브라우저에만 저장돼요. 다른 기기에서는 다시 넣어야 해요.'}</p>
          </>
        ) : (
          <>
            <Field label="주소" htmlFor="mat-url">
              <input id="mat-url" className="input" type="url" inputMode="url" value={url} placeholder="https://" onChange={(e) => setUrl(e.target.value)} autoComplete="off" />
            </Field>
            <Field label="이름" htmlFor="mat-title" hint="선택 · 비워 두면 주소로 표시해요">
              <input id="mat-title" className="input" value={title} maxLength={60} onChange={(e) => setTitle(e.target.value)} autoComplete="off" />
            </Field>
            <p className="hint">웹 링크는 새 탭에서 열려요.</p>
          </>
        )}
      </div>
    </SheetFrame>
  );
}

export function EditMaterialSheet({ mid }: { mid: string }) {
  const m: Material | undefined = useApp((s) => s.materials[mid]);
  const hints = useApp((s) => s.materials);
  const [title, setTitle] = useState(m?.title ?? '');
  const [subject, setSubject] = useState(m?.subject ?? '');
  const [busy, run] = useAsync();
  if (!m) return null;
  const subjects = [...new Set(Object.values(hints).map((x) => x.subject).filter(Boolean))];
  const save = () =>
    run(async () => {
      await updateMaterial(mid, { title, subject });
      closeSheet();
    }, '자료 정보를 고쳤어요');
  const remove = () =>
    confirmSheet({
      title: '이 자료를 지울까요?',
      body: '목록과 파일이 함께 지워져요.',
      okLabel: '삭제',
      danger: true,
      onOk: () =>
        run(async () => {
          await removeMaterial(mid);
          if (getUi().roomMid === mid) setRoomMid(null);
          closeSheet();
        }, '자료를 지웠어요'),
    });
  return (
    <SheetFrame
      title="자료 정보"
      onClose={closeSheet}
      footer={
        <div className="row gap">
          <Btn kind="line" icon="trash" onClick={remove} id="mat-delete">
            삭제
          </Btn>
          <span className="grow" />
          <Btn busy={busy} disabled={!title.trim()} onClick={save} id="mat-save">
            저장
          </Btn>
        </div>
      }
    >
      <form
        className="col gap-lg"
        onSubmit={(e) => {
          e.preventDefault();
          if (title.trim()) save();
        }}
      >
        <Field label="이름" htmlFor="mat-edit-title">
          <input id="mat-edit-title" className="input" value={title} maxLength={60} onChange={(e) => setTitle(e.target.value)} autoComplete="off" />
        </Field>
        <Field label="과목" htmlFor="mat-edit-subject">
          <input id="mat-edit-subject" className="input" value={subject} maxLength={20} list="mat-edit-subject-list" onChange={(e) => setSubject(e.target.value)} autoComplete="off" />
          <datalist id="mat-edit-subject-list">
            {subjects.map((x) => (
              <option key={x} value={x} />
            ))}
          </datalist>
        </Field>
        <p className="faint tiny">
          {KIND_LABEL[m.kind]}
          {m.size ? ` · ${fmtSize(m.size)}` : ''}
          {m.url ? ` · ${m.url}` : ''}
        </p>
      </form>
    </SheetFrame>
  );
}
