// 인증 올리기·수정 시트.

import React, { useEffect, useRef, useState } from 'react';
import { useApp } from '../store';
import { editCheckin, errText, postCheckin, setPending } from '../actions';
import { postableStudies, subjectHints } from '../derive';
import { blobDel, blobGet, blobPut, preparePhoto, type Prepared } from '../media';
import { lsJson, lsSet } from '../platform';
import { fmtMin } from '../time';
import { closeSheet, toast } from '../ui';
import { Btn, Field, Icon, SheetFrame } from './kit';

interface FormPhoto extends Prepared {
  key: string;
  album: boolean;
}

interface DraftMeta {
  day: string;
  h: string;
  m: string;
  tag: string;
  memo: string;
  sids: string[];
  album: boolean[];
}

function draftKey(uid: string) {
  return 'sw.draft.' + uid;
}

async function saveDraft(uid: string, meta: DraftMeta, photos: FormPhoto[]) {
  lsSet(draftKey(uid), JSON.stringify(meta));
  for (let i = 0; i < 3; i++) {
    if (photos[i]) await blobPut(`draft:${uid}:${i}`, photos[i].blob);
    else await blobDel(`draft:${uid}:${i}`);
  }
}

function clearDraft(uid: string) {
  lsSet(draftKey(uid), null);
  for (let i = 0; i < 3; i++) blobDel(`draft:${uid}:${i}`).catch(() => undefined);
}

let photoSeq = 1;

export function CheckinSheet({ fromTimer, edit }: { fromTimer?: boolean; edit?: string }) {
  const s = useApp((x) => x);
  const editing = edit ? s.checkins[edit] : null;
  const pending = fromTimer && !edit ? s.pending : null;
  const postable = postableStudies(s);
  const options = editing
    ? [...postable, ...editing.sids.filter((x) => !postable.some((r) => r.sid === x) && s.studies[x]).map((x) => ({ sid: x, study: s.studies[x], ended: true }))]
    : postable;

  const initMin = editing ? editing.min : 0;
  const [photos, setPhotos] = useState<FormPhoto[]>([]);
  const [h, setH] = useState(initMin >= 60 ? String(Math.floor(initMin / 60)) : '');
  const [m, setM] = useState(initMin % 60 ? String(initMin % 60) : '');
  const [useTimer, setUseTimer] = useState(!!pending);
  const [tag, setTag] = useState(editing?.tag ?? pending?.subject ?? '');
  const [memo, setMemo] = useState(editing?.memo ?? '');
  const [sids, setSids] = useState<string[]>(() => (editing ? editing.sids : postable.map((r) => r.sid)));
  const [busy, setBusy] = useState(false);
  const [reading, setReading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [restored, setRestored] = useState(false);
  const camRef = useRef<HTMLInputElement>(null);
  const albRef = useRef<HTMLInputElement>(null);
  const photosRef = useRef<FormPhoto[]>([]);
  photosRef.current = photos;
  const touch = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  const timerMin = pending ? Math.floor(pending.sec / 60) : 0;
  const hints = subjectHints(s);

  // 임시 저장된 인증 불러오기(올리다 실패했던 것)
  useEffect(() => {
    if (edit || fromTimer) return;
    const meta = lsJson<DraftMeta>(draftKey(s.uid));
    if (!meta) return;
    if (meta.day !== s.today) {
      clearDraft(s.uid);
      toast('마감이 지나서 임시 저장된 인증은 올리지 못했어요.');
      return;
    }
    let alive = true;
    (async () => {
      const list: FormPhoto[] = [];
      for (let i = 0; i < 3; i++) {
        const b = await blobGet(`draft:${s.uid}:${i}`);
        if (!b) continue;
        try {
          list.push({ ...(await preparePhoto(b)), key: 'p' + photoSeq++, album: !!meta.album[i] });
        } catch {
          /* 읽지 못한 사진은 건너뛴다 */
        }
      }
      if (!alive) return;
      setPhotos(list);
      setH(meta.h);
      setM(meta.m);
      setTag(meta.tag);
      setMemo(meta.memo);
      setSids(meta.sids.filter((x) => postable.some((r) => r.sid === x)));
      setRestored(true);
    })();
    return () => {
      alive = false;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(
    () => () => {
      for (const p of photosRef.current) URL.revokeObjectURL(p.url);
    },
    [],
  );

  const onFiles = async (e: React.ChangeEvent<HTMLInputElement>, fromAlbum: boolean) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    const room = 3 - photosRef.current.length;
    if (files.length > room) toast('사진은 3장까지 올릴 수 있어요.');
    setReading(true);
    for (const f of files.slice(0, room)) {
      try {
        const p = await preparePhoto(f);
        setPhotos((cur) => (cur.length >= 3 ? cur : [...cur, { ...p, key: 'p' + photoSeq++, album: fromAlbum }]));
      } catch {
        toast('사진을 읽지 못했어요. JPG나 PNG 사진으로 다시 시도해 주세요.', 'err');
      }
    }
    setReading(false);
  };

  const removePhoto = (key: string) => {
    setPhotos((cur) => {
      const hit = cur.find((p) => p.key === key);
      if (hit) URL.revokeObjectURL(hit.url);
      return cur.filter((p) => p.key !== key);
    });
  };

  const manualMin = (Number(h) || 0) * 60 + (Number(m) || 0);
  const min = useTimer ? timerMin : manualMin;

  const submit = async () => {
    if (busy) return;
    setErr(null);
    setBusy(true);
    try {
      if (edit) {
        await editCheckin(edit, { min, tag, memo, sids });
        toast('인증을 고쳤어요', 'ok');
      } else {
        await postCheckin({ min, tag, memo, sids, photos, album: photos.some((p) => p.album), timer: useTimer && pending ? pending.mode : null });
        if (fromTimer) setPending(null);
        clearDraft(s.uid);
        toast('인증을 올렸어요', 'ok');
      }
      closeSheet();
    } catch (e) {
      setErr(errText(e));
      setBusy(false);
      if (!edit && !fromTimer && (photos.length > 0 || memo))
        saveDraft(s.uid, { day: s.today, h, m, tag, memo, sids, album: photos.map((p) => p.album) }, photos).catch(() => undefined);
    }
  };

  const toggleSid = (sid: string) => setSids((cur) => (cur.includes(sid) ? cur.filter((x) => x !== sid) : [...cur, sid]));
  const needPhoto = !edit && !useTimer && photos.length === 0;
  const title = edit ? '인증 수정' : '공부 인증';

  return (
    <SheetFrame
      title={title}
      onClose={closeSheet}
      footer={
        <>
          {err ? (
            <p className="error-text" role="alert">
              {err} {!edit ? '작성한 내용은 임시 저장했어요.' : ''}
            </p>
          ) : null}
          <Btn block size="lg" busy={busy} disabled={reading || min < 1 || needPhoto} onClick={submit} id="ci-submit">
            {err ? '다시 시도' : edit ? '수정 저장' : '인증 올리기'}
          </Btn>
        </>
      }
    >
      <form
        className="col gap-lg"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        {restored ? <p className="note">올리다 멈췄던 인증을 불러왔어요.</p> : null}
        {!edit ? (
          <div className="field">
            <span className="label">
              사진 <span className="faint">{useTimer ? '선택 · 3장까지' : '1~3장'}</span>
            </span>
            <div className="photo-grid">
              {photos.map((p) => (
                <div key={p.key} className="photo-cell">
                  <img src={p.url} alt="올릴 사진" />
                  <button type="button" className="photo-x" onClick={() => removePhoto(p.key)} aria-label="사진 빼기">
                    <Icon name="close" size={14} />
                  </button>
                </div>
              ))}
              {photos.length < 3 ? (
                <div className="photo-add">
                  {touch ? (
                    <button type="button" className="photo-btn" onClick={() => camRef.current?.click()} disabled={reading}>
                      <Icon name="camera" size={22} />
                      <span>카메라</span>
                    </button>
                  ) : null}
                  <button type="button" className="photo-btn" onClick={() => albRef.current?.click()} disabled={reading}>
                    <Icon name="image" size={22} />
                    <span>{touch ? '앨범' : '사진 고르기'}</span>
                  </button>
                </div>
              ) : null}
            </div>
            {reading ? <p className="hint">사진을 줄이는 중…</p> : <p className="hint">사진은 올리기 전에 작게 줄이고 위치 정보를 지워요. 앨범 사진에는 "앨범에서 올림" 표시가 붙어요.</p>}
            <input ref={camRef} id="ci-camera" type="file" accept="image/*" capture="environment" hidden onChange={(e) => onFiles(e, false)} />
            <input ref={albRef} id="ci-album" type="file" accept="image/*" multiple hidden onChange={(e) => onFiles(e, true)} />
          </div>
        ) : null}

        {useTimer && pending ? (
          <div className="timer-fill">
            <Icon name="timer" size={20} />
            <div className="grow">
              <p className="timer-fill-main num">{fmtMin(timerMin)}</p>
              <p className="faint tiny">{pending.mode === 'room' ? '학습장' : '집중 모드'} 타이머로 잰 시간이에요. "타이머 인증" 표시가 붙어요.</p>
            </div>
            <button type="button" className="text-btn" onClick={() => setUseTimer(false)}>
              직접 입력
            </button>
          </div>
        ) : (
          <div className="field">
            <span className="label">공부 시간</span>
            <div className="row gap">
              <div className="unit-input">
                <input id="ci-h" className="input num" inputMode="numeric" pattern="[0-9]*" maxLength={2} value={h} onChange={(e) => setH(e.target.value.replace(/\D/g, '').slice(0, 2))} aria-label="시간" placeholder="0" />
                <span>시간</span>
              </div>
              <div className="unit-input">
                <input id="ci-m" className="input num" inputMode="numeric" pattern="[0-9]*" maxLength={2} value={m} onChange={(e) => setM(e.target.value.replace(/\D/g, '').slice(0, 2))} aria-label="분" placeholder="0" />
                <span>분</span>
              </div>
            </div>
            {pending && !useTimer ? (
              <button type="button" className="text-btn" onClick={() => setUseTimer(true)}>
                타이머로 잰 시간({fmtMin(timerMin)}) 쓰기
              </button>
            ) : null}
            {editing?.timer ? <p className="hint">시간을 바꾸면 "타이머 인증" 표시가 사라져요.</p> : null}
          </div>
        )}

        <Field label="과목" htmlFor="ci-tag" hint="선택 · 20자까지">
          <input id="ci-tag" className="input" value={tag} maxLength={20} list="ci-tag-list" placeholder="예: 영어, 자료구조" onChange={(e) => setTag(e.target.value)} />
          <datalist id="ci-tag-list">
            {hints.map((x) => (
              <option key={x} value={x} />
            ))}
          </datalist>
        </Field>

        <Field label="한 줄 메모" htmlFor="ci-memo" hint={`선택 · ${memo.length}/200`}>
          <textarea id="ci-memo" className="input" rows={2} maxLength={200} value={memo} placeholder="오늘 공부한 내용을 짧게 남겨 보세요" onChange={(e) => setMemo(e.target.value)} />
        </Field>

        <div className="field">
          <span className="label">올릴 스터디</span>
          {options.length === 0 ? (
            <p className="hint">참여 중인 스터디가 없어요. 이 인증은 내 기록에만 남아요.</p>
          ) : (
            <div className="check-list">
              {options.map((r) => (
                <label key={r.sid} className="check-row" htmlFor={'ci-sid-' + r.sid}>
                  <input id={'ci-sid-' + r.sid} type="checkbox" checked={sids.includes(r.sid)} onChange={() => toggleSid(r.sid)} />
                  <span>{r.study.name}</span>
                </label>
              ))}
            </div>
          )}
          {options.length > 0 && sids.length === 0 ? <p className="hint">스터디를 고르지 않으면 내 기록에만 남아요.</p> : null}
        </div>
      </form>
    </SheetFrame>
  );
}
