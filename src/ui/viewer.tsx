// 학습장 자료 보기: PDF, HTML, 이미지, 글, 마크다운, 웹 링크.

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../store';
import { errText, materialBlob, updateMaterial } from '../actions';
import { readText } from '../media';
import { openPdf, type PdfDoc, type PdfRenderTask } from '../pdf';
import type { Material, MaterialKind } from '../types';
import { openSheet, setRoomMid } from '../ui';
import { Btn, CopyBox, Empty, Icon, Seg } from './kit';
import { Markdown } from './markdown';

const ZOOMS = [0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3];

export const KIND_LABEL: Record<MaterialKind, string> = { pdf: 'PDF', html: 'HTML', image: '이미지', text: '텍스트', md: '마크다운', link: '웹 링크' };
export const KIND_ICON: Record<MaterialKind, string> = { pdf: 'file', html: 'file', image: 'image', text: 'list', md: 'list', link: 'link' };

function ZoomCtl({ zoom, setZoom }: { zoom: number; setZoom: (z: number) => void }) {
  const i = ZOOMS.indexOf(zoom);
  return (
    <div className="zoom-ctl" role="group" aria-label="확대·축소">
      <Btn kind="ghost" size="sm" icon="zoomOut" disabled={i <= 0} onClick={() => setZoom(ZOOMS[Math.max(0, i - 1)])} label="축소" id="viewer-zoom-out" />
      <button type="button" className="zoom-label num" onClick={() => setZoom(1)} aria-label="원래 크기로">
        {Math.round(zoom * 100)}%
      </button>
      <Btn kind="ghost" size="sm" icon="zoomIn" disabled={i >= ZOOMS.length - 1} onClick={() => setZoom(ZOOMS[Math.min(ZOOMS.length - 1, i + 1)])} label="확대" id="viewer-zoom-in" />
    </div>
  );
}

export function Viewer({ mid }: { mid: string }) {
  const m = useApp((s) => s.materials[mid]);
  const loaded = useApp((s) => s.materialsLoaded);
  const [blob, setBlob] = useState<Blob | null | undefined>(undefined); // undefined = 불러오는 중, null = 이 기기에 없음
  const [err, setErr] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const kind = m?.kind;
  const asset = m?.asset;

  useEffect(() => {
    if (!m || m.kind === 'link') return;
    let alive = true;
    setBlob(undefined);
    setErr(null);
    materialBlob(mid, m).then(
      (b) => alive && setBlob(b),
      (e) => alive && setErr(errText(e)),
    );
    return () => {
      alive = false;
    };
  }, [mid, kind, asset]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!m) {
    return (
      <div className="viewer">
        <div className="viewer-bar">
          <Btn kind="ghost" size="sm" icon="left" onClick={() => setRoomMid(null)} label="자료 목록으로" />
        </div>
        {loaded ? <Empty icon="file" title="자료를 찾을 수 없어요" body="지워진 자료예요." /> : <p className="center faint pad">불러오는 중…</p>}
      </div>
    );
  }

  const zoomable = m.kind !== 'link' && m.kind !== 'html';
  let body: React.ReactNode;
  if (m.kind === 'link') body = <LinkView m={m} />;
  else if (err) body = <Empty icon="file" title="자료를 열지 못했어요" body={err} />;
  else if (blob === undefined) body = <p className="center faint pad">자료를 불러오는 중…</p>;
  else if (blob === null)
    body = (
      <Empty icon="file" title="이 기기에는 파일이 없어요" body="이 자료는 처음 넣은 기기에만 저장돼 있어요. 그 기기에서 열거나, 여기에서 파일을 다시 넣어 주세요.">
        <Btn kind="soft" onClick={() => openSheet({ kind: 'editMaterial', mid })}>
          자료 정리하기
        </Btn>
      </Empty>
    );
  else if (m.kind === 'pdf') body = <PdfView key={mid} mid={mid} blob={blob} zoom={zoom} startPage={m.page ?? 1} />;
  else if (m.kind === 'html') body = <HtmlView blob={blob} title={m.title} />;
  else if (m.kind === 'image') body = <ImageView blob={blob} zoom={zoom} title={m.title} />;
  else if (m.kind === 'md') body = <TextView blob={blob} zoom={zoom} markdown />;
  else body = <TextView blob={blob} zoom={zoom} />;

  return (
    <div className="viewer">
      <div className="viewer-bar">
        <Btn kind="ghost" size="sm" icon="left" onClick={() => setRoomMid(null)} label="자료 목록으로" id="viewer-back" />
        <div className="grow viewer-title">
          <span className="row-title">{m.title}</span>
          <span className="faint tiny">
            {KIND_LABEL[m.kind]}
            {m.subject ? ` · ${m.subject}` : ''}
          </span>
        </div>
        {zoomable && blob ? <ZoomCtl zoom={zoom} setZoom={setZoom} /> : null}
        <Btn kind="ghost" size="sm" icon="edit" onClick={() => openSheet({ kind: 'editMaterial', mid })} label="자료 정보 수정" id="viewer-edit" />
      </div>
      <div className="viewer-body">{body}</div>
    </div>
  );
}

// ------------------------------------------------------------------ PDF

function PdfPageView({ doc, n, cssW, ratio, root }: { doc: PdfDoc; n: number; cssW: number; ratio: number; root: HTMLElement | null }) {
  const holder = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chain = useRef<Promise<void>>(Promise.resolve());
  const [near, setNear] = useState(false);
  const [own, setOwn] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const el = holder.current;
    if (!el || !root) return;
    if (typeof IntersectionObserver !== 'function') {
      setNear(true);
      return;
    }
    const io = new IntersectionObserver((es) => setNear(es[es.length - 1].isIntersecting), { root, rootMargin: '100% 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, [root]);

  useEffect(() => {
    if (!near || cssW < 10) return;
    let cancelled = false;
    let task: PdfRenderTask | null = null;
    chain.current = chain.current.then(async () => {
      if (cancelled) return;
      try {
        const page = await doc.getPage(n);
        if (cancelled) return;
        const vp1 = page.getViewport({ scale: 1 });
        setOwn(vp1.height / vp1.width);
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        let scale = (cssW / vp1.width) * dpr;
        const area = vp1.width * vp1.height * scale * scale;
        const maxArea = 12e6; // 휴대폰에서 캔버스가 너무 커지지 않게
        if (area > maxArea) scale *= Math.sqrt(maxArea / area);
        const vp = page.getViewport({ scale });
        const canvas = canvasRef.current;
        if (!canvas || cancelled) return;
        canvas.width = Math.max(1, Math.floor(vp.width));
        canvas.height = Math.max(1, Math.floor(vp.height));
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        task = page.render({ canvasContext: ctx, viewport: vp });
        await task.promise;
        setFailed(false);
      } catch (e) {
        if (!cancelled && (e as { name?: string } | null)?.name !== 'RenderingCancelledException') setFailed(true);
      }
    });
    return () => {
      cancelled = true;
      try {
        task?.cancel();
      } catch {
        /* 이미 끝난 그리기 */
      }
    };
  }, [near, doc, n, cssW]);

  return (
    <div ref={holder} className="pdf-page" data-page={n} style={{ width: cssW, height: Math.round(cssW * (own ?? ratio)) }}>
      {near ? <canvas ref={canvasRef} aria-label={`${n}쪽`} role="img" /> : null}
      {failed ? <span className="pdf-fail">이 쪽을 그리지 못했어요</span> : null}
    </div>
  );
}

function PdfView({ mid, blob, zoom, startPage }: { mid: string; blob: Blob; zoom: number; startPage: number }) {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const pagesRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<HTMLDivElement | null>(null);
  const [doc, setDoc] = useState<PdfDoc | null>(null);
  const [ratio, setRatio] = useState(1.414);
  const [err, setErr] = useState<string | null>(null);
  const [boxW, setBoxW] = useState(0);
  const [page, setPage] = useState(Math.max(1, startPage));
  const [draft, setDraft] = useState<string | null>(null);
  const pageRef = useRef(page);
  pageRef.current = page;
  const saved = useRef(startPage);
  const jumped = useRef(false);
  const raf = useRef(0);
  const setBoxRef = useCallback((el: HTMLDivElement | null) => {
    boxRef.current = el;
    setBox(el);
  }, []);

  useEffect(() => {
    let alive = true;
    let close: (() => void) | null = null;
    (async () => {
      try {
        const opened = await openPdf(await blob.arrayBuffer());
        if (!alive) {
          opened.close();
          return;
        }
        close = opened.close;
        const p1 = await opened.doc.getPage(1);
        const vp = p1.getViewport({ scale: 1 });
        if (!alive) return;
        setRatio(vp.height / vp.width);
        setDoc(opened.doc);
      } catch {
        if (alive) setErr('PDF를 열지 못했어요. 암호가 걸려 있거나 손상된 파일일 수 있어요.');
      }
    })();
    return () => {
      alive = false;
      close?.();
    };
  }, [blob]);

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const measure = () => setBoxW(el.clientWidth);
    measure();
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    window.addEventListener('resize', measure);
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [box]);

  const fit = Math.max(120, Math.min(boxW - 24, 920));
  const cssW = Math.round(fit * zoom);

  const scrollToPage = (n: number) => {
    const el = boxRef.current;
    const kid = pagesRef.current?.children[n - 1] as HTMLElement | undefined;
    if (el && kid) el.scrollTop = Math.max(0, kid.offsetTop - 8);
  };

  // 처음 열 때는 마지막으로 본 쪽으로, 크기를 바꿀 때는 보던 쪽을 유지한다
  useLayoutEffect(() => {
    if (!doc || !boxW) return;
    if (!jumped.current) {
      jumped.current = true;
      const n = Math.min(Math.max(1, startPage), doc.numPages);
      if (n > 1) scrollToPage(n);
      return;
    }
    scrollToPage(pageRef.current);
  }, [doc, cssW]); // eslint-disable-line react-hooks/exhaustive-deps

  // 보던 쪽 기억하기
  useEffect(() => {
    if (!doc || page === saved.current) return;
    const t = setTimeout(() => {
      saved.current = page;
      updateMaterial(mid, { page }).catch(() => undefined);
    }, 2500);
    return () => clearTimeout(t);
  }, [page, doc, mid]);
  useEffect(
    () => () => {
      if (pageRef.current !== saved.current) updateMaterial(mid, { page: pageRef.current }).catch(() => undefined);
      if (raf.current) cancelAnimationFrame(raf.current);
    },
    [mid],
  );

  const onScroll = () => {
    if (raf.current) return;
    raf.current = requestAnimationFrame(() => {
      raf.current = 0;
      const el = boxRef.current;
      const kids = pagesRef.current?.children;
      if (!el || !kids || kids.length === 0) return;
      const line = el.scrollTop + el.clientHeight * 0.4;
      let lo = 0;
      let hi = kids.length - 1;
      while (lo < hi) {
        const md = (lo + hi + 1) >> 1;
        if ((kids[md] as HTMLElement).offsetTop <= line) lo = md;
        else hi = md - 1;
      }
      setPage(lo + 1);
    });
  };

  const goPage = (n: number) => {
    if (!doc) return;
    const t = Math.min(Math.max(1, Math.round(n) || 1), doc.numPages);
    setPage(t);
    scrollToPage(t);
  };

  const pages = useMemo(() => (doc ? Array.from({ length: doc.numPages }, (_, i) => i + 1) : []), [doc]);

  if (err) return <Empty icon="file" title="PDF를 열지 못했어요" body={err} />;

  return (
    <div className="pdf">
      <div
        className="pdf-box"
        ref={setBoxRef}
        onScroll={onScroll}
        tabIndex={0}
        aria-label="PDF 내용"
      >
        {!doc ? <p className="center faint pad">PDF를 여는 중…</p> : null}
        <div className="pdf-pages" ref={pagesRef}>
          {doc && boxW ? pages.map((n) => <PdfPageView key={n} doc={doc} n={n} cssW={cssW} ratio={ratio} root={box} />) : null}
        </div>
      </div>
      {doc ? (
        <div className="pdf-ctl">
          <Btn kind="ghost" size="sm" icon="left" disabled={page <= 1} onClick={() => goPage(page - 1)} label="이전 쪽" id="pdf-prev" />
          <form
            className="pdf-pageno"
            onSubmit={(e) => {
              e.preventDefault();
              if (draft !== null) goPage(Number(draft));
              setDraft(null);
            }}
          >
            <input
              id="pdf-page"
              className="input sm num"
              inputMode="numeric"
              pattern="[0-9]*"
              value={draft ?? String(page)}
              aria-label="쪽 번호"
              onChange={(e) => setDraft(e.target.value.replace(/\D/g, '').slice(0, 5))}
              onFocus={(e) => e.currentTarget.select()}
              onBlur={() => {
                if (draft !== null && draft !== '') goPage(Number(draft));
                setDraft(null);
              }}
            />
            <span className="num">/ {doc.numPages}</span>
          </form>
          <Btn kind="ghost" size="sm" icon="right" disabled={page >= doc.numPages} onClick={() => goPage(page + 1)} label="다음 쪽" id="pdf-next" />
        </div>
      ) : null}
    </div>
  );
}

// ------------------------------------------------------------------ HTML

const SKIP = new Set(['script', 'style', 'head', 'title', 'meta', 'link', 'base', 'noscript', 'template', 'iframe', 'frame', 'frameset', 'object', 'embed', 'applet', 'svg', 'math', 'canvas', 'video', 'audio', 'source', 'track', 'form', 'input', 'button', 'select', 'option', 'textarea', 'dialog', 'map', 'area']);
const KEEP = new Set(['h2', 'h3', 'h4', 'h5', 'h6', 'p', 'ul', 'ol', 'li', 'strong', 'b', 'em', 'i', 'u', 's', 'del', 'ins', 'code', 'pre', 'blockquote', 'br', 'hr', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption', 'span', 'div', 'figure', 'figcaption', 'dl', 'dt', 'dd', 'sub', 'sup', 'mark', 'small', 'kbd', 'abbr', 'cite', 'q', 'details', 'summary']);
const RENAME: Record<string, string> = { h1: 'h2', center: 'div', font: 'span', nav: 'div', aside: 'div', main: 'div', header: 'div', footer: 'div', section: 'div', article: 'div', address: 'div', tt: 'code', strike: 's', big: 'span' };
const NO_TEXT = new Set(['table', 'thead', 'tbody', 'tfoot', 'tr', 'ul', 'ol', 'dl']);

/** HTML을 안전한 요소만 남겨 React 요소로 바꾼다(스크립트·스타일·양식은 버린다). */
function sanitize(html: string): { nodes: React.ReactNode[]; cut: boolean } {
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  let count = 0;
  let cut = false;
  const conv = (node: ChildNode, key: string, depth: number, parent: string): React.ReactNode => {
    if (count > 20000 || depth > 120) {
      cut = true;
      return null;
    }
    if (node.nodeType === 3) {
      const t = node.textContent ?? '';
      if (NO_TEXT.has(parent) && !t.trim()) return null;
      return t;
    }
    if (node.nodeType !== 1) return null;
    count++;
    const el = node as Element;
    const raw = el.tagName.toLowerCase();
    if (SKIP.has(raw)) return null;
    const tag = RENAME[raw] ?? raw;
    if (raw === 'img') {
      const src = el.getAttribute('src') ?? '';
      const alt = el.getAttribute('alt') ?? '';
      if (/^data:image\/(png|jpe?g|gif|webp);base64,/i.test(src)) return <img key={key} src={src} alt={alt} />;
      return (
        <span key={key} className="md-img">
          [그림{alt ? `: ${alt}` : ''}]
        </span>
      );
    }
    const kids = Array.from(el.childNodes).map((c, i) => conv(c, `${key}.${i}`, depth + 1, KEEP.has(tag) ? tag : parent));
    if (raw === 'a') {
      const href = el.getAttribute('href') ?? '';
      return /^https?:\/\//i.test(href) ? (
        <a key={key} href={href} target="_blank" rel="noopener noreferrer">
          {kids}
        </a>
      ) : (
        <span key={key}>{kids}</span>
      );
    }
    if (!KEEP.has(tag)) return <React.Fragment key={key}>{kids}</React.Fragment>;
    if (tag === 'br' || tag === 'hr') return React.createElement(tag, { key });
    const props: Record<string, unknown> = { key };
    if (tag === 'td' || tag === 'th') {
      const cs = Number(el.getAttribute('colspan'));
      const rs = Number(el.getAttribute('rowspan'));
      if (cs > 1 && cs < 100) props.colSpan = cs;
      if (rs > 1 && rs < 100) props.rowSpan = rs;
    }
    if (tag === 'ol') {
      const st = Number(el.getAttribute('start'));
      if (st > 1) props.start = st;
    }
    return React.createElement(tag, props, ...kids);
  };
  const nodes = Array.from(parsed.body ? parsed.body.childNodes : []).map((c, i) => conv(c, String(i), 0, 'body'));
  return { nodes, cut };
}

function HtmlView({ blob, title }: { blob: Blob; title: string }) {
  const [text, setText] = useState<string | null>(null);
  const [mode, setMode] = useState<'frame' | 'read'>('frame');
  const [scripts, setScripts] = useState(false);
  useEffect(() => {
    let alive = true;
    setText(null);
    readText(blob).then(
      (t) => alive && setText(t),
      () => alive && setText(''),
    );
    return () => {
      alive = false;
    };
  }, [blob]);
  const safe = useMemo(() => (text !== null && mode === 'read' ? sanitize(text) : null), [text, mode]);
  if (text === null) return <p className="center faint pad">자료를 불러오는 중…</p>;
  return (
    <div className="html-view">
      <div className="html-bar">
        <Seg
          id="html-mode"
          options={[
            { value: 'frame', label: '원본 그대로' },
            { value: 'read', label: '읽기 모드' },
          ]}
          value={mode}
          onChange={setMode}
        />
        {mode === 'frame' ? (
          <label className="check-row inline" htmlFor="html-scripts">
            <input id="html-scripts" type="checkbox" checked={scripts} onChange={(e) => setScripts(e.target.checked)} />
            <span>스크립트 실행</span>
          </label>
        ) : null}
      </div>
      {mode === 'frame' ? (
        <>
          <iframe key={scripts ? 'on' : 'off'} className="html-frame" title={title} sandbox={scripts ? 'allow-scripts' : ''} srcDoc={text} referrerPolicy="no-referrer" />
          <p className="hint html-hint">격리된 영역에서 열어요. 다른 사이트에서 불러오는 그림이나 글꼴은 보이지 않을 수 있어요. 화면이 비어 있으면 읽기 모드로 바꿔 보세요.</p>
        </>
      ) : (
        <div className="html-read">
          <div className="prose">{safe?.nodes}</div>
          {safe?.cut ? <p className="hint">문서가 너무 커서 일부만 보여 줘요.</p> : null}
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ 이미지·글·링크

function ImageView({ blob, zoom, title }: { blob: Blob; zoom: number; title: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    const u = URL.createObjectURL(blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [blob]);
  return <div className="img-view">{url ? <img src={url} alt={title} style={{ width: `${Math.round(zoom * 100)}%` }} /> : null}</div>;
}

const TEXT_MAX = 600000;

function TextView({ blob, zoom, markdown }: { blob: Blob; zoom: number; markdown?: boolean }) {
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    setText(null);
    readText(blob).then(
      (t) => alive && setText(t),
      () => alive && setText(''),
    );
    return () => {
      alive = false;
    };
  }, [blob]);
  const shown = text !== null && text.length > TEXT_MAX ? text.slice(0, TEXT_MAX) : text;
  const view = useMemo(() => (shown === null ? null : markdown ? <Markdown text={shown} /> : <pre className="text-pre">{shown}</pre>), [shown, markdown]);
  if (text === null) return <p className="center faint pad">자료를 불러오는 중…</p>;
  return (
    <div className="text-view" style={{ fontSize: `${zoom}rem` }}>
      {view}
      {text.length > TEXT_MAX ? <p className="hint">문서가 길어서 앞부분만 보여 줘요.</p> : null}
    </div>
  );
}

function LinkView({ m }: { m: Material }) {
  const url = m.url ?? '';
  let host = '';
  try {
    host = new URL(url).host;
  } catch {
    host = url;
  }
  return (
    <div className="link-view">
      <div className="card col gap">
        <div className="row gap">
          <span className="notif-icon">
            <Icon name="link" size={18} />
          </span>
          <div className="grow">
            <p className="row-title">{m.title}</p>
            <p className="faint tiny">{host}</p>
          </div>
        </div>
        <a className="btn primary md block" href={url} target="_blank" rel="noopener noreferrer" id="link-open">
          <Icon name="external" size={18} />
          <span>새 탭에서 열기</span>
        </a>
        <CopyBox id="link-url" text={url} label="주소 복사" />
        <p className="hint">다른 사이트는 이 화면 안에 넣을 수 없어서 새 탭에서 열어요. 학습 타이머는 탭을 옮겨도 계속 가요.</p>
      </div>
    </div>
  );
}
