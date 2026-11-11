// 사진 줄이기와 기기 안 파일 보관.

export interface Prepared {
  blob: Blob; // 긴 변 1600px 이하 JPEG (위치 정보 등 EXIF는 다시 그리면서 사라진다)
  thumb: string; // 목록용 작은 data URL
  w: number;
  h: number;
  url: string; // 미리보기용 object URL
}

interface Decoded {
  src: CanvasImageSource;
  w: number;
  h: number;
  close: () => void;
}

async function decode(file: Blob): Promise<Decoded> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' } as ImageBitmapOptions);
      return { src: bmp, w: bmp.width, h: bmp.height, close: () => bmp.close() };
    } catch {
      /* 아래 <img> 방식으로 다시 시도 */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('decode'));
      img.src = url;
    });
    return { src: img, w: img.naturalWidth, h: img.naturalHeight, close: () => URL.revokeObjectURL(url) };
  } catch (e) {
    URL.revokeObjectURL(url);
    throw e;
  }
}

function draw(d: Decoded, max: number): HTMLCanvasElement {
  const s = Math.min(1, max / Math.max(d.w, d.h));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(d.w * s));
  c.height = Math.max(1, Math.round(d.h * s));
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(d.src, 0, 0, c.width, c.height);
  return c;
}

function toBlob(c: HTMLCanvasElement, q: number): Promise<Blob> {
  return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error('encode'))), 'image/jpeg', q));
}

function shrinkDataUrl(c: HTMLCanvasElement, startQ: number, maxChars: number): string {
  let q = startQ;
  let out = c.toDataURL('image/jpeg', q);
  while (out.length > maxChars && q > 0.32) {
    q -= 0.1;
    out = c.toDataURL('image/jpeg', q);
  }
  return out;
}

/** 인증 사진 한 장을 올릴 준비: 원본(1600px)과 썸네일(640px)을 만든다. */
export async function preparePhoto(file: Blob): Promise<Prepared> {
  const d = await decode(file);
  try {
    const full = draw(d, 1600);
    const blob = await toBlob(full, 0.82);
    const thumb = shrinkDataUrl(draw(d, 640), 0.62, 70000);
    return { blob, thumb, w: full.width, h: full.height, url: URL.createObjectURL(blob) };
  } finally {
    d.close();
  }
}

/** 자산 저장소를 못 쓸 때 문서 하나(256KiB)에 들어가도록 줄인 data URL */
export async function inlineData(blob: Blob): Promise<string> {
  const d = await decode(blob);
  try {
    for (const max of [1280, 1024, 800, 640]) {
      const out = shrinkDataUrl(draw(d, max), 0.72, 236000);
      if (out.length <= 236000) return out;
    }
    return shrinkDataUrl(draw(d, 480), 0.5, 236000);
  } finally {
    d.close();
  }
}

/** 프로필 사진: 가운데를 잘라 128px 정사각형으로 */
export async function prepareAvatar(file: Blob): Promise<string> {
  const d = await decode(file);
  try {
    const side = Math.min(d.w, d.h);
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, 128, 128);
    ctx.drawImage(d.src, (d.w - side) / 2, (d.h - side) / 2, side, side, 0, 0, 128, 128);
    return shrinkDataUrl(c, 0.8, 16000);
  } finally {
    d.close();
  }
}

// ---- 기기 안 파일 보관 (IndexedDB) ----

const memBlobs = new Map<string, Blob>();
let filesDb: Promise<IDBDatabase | null> | null = null;

function openFiles(): Promise<IDBDatabase | null> {
  if (!filesDb) {
    filesDb = new Promise((resolve) => {
      const timer = setTimeout(() => resolve(null), 2000);
      try {
        const req = indexedDB.open('sw-files', 1);
        req.onupgradeneeded = () => {
          req.result.createObjectStore('blobs');
        };
        req.onsuccess = () => {
          clearTimeout(timer);
          resolve(req.result);
        };
        req.onerror = () => {
          clearTimeout(timer);
          resolve(null);
        };
      } catch {
        clearTimeout(timer);
        resolve(null);
      }
    });
  }
  return filesDb;
}

function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T | null> {
  return openFiles().then(
    (db) =>
      new Promise<T | null>((resolve) => {
        if (!db) return resolve(null);
        try {
          const req = fn(db.transaction('blobs', mode).objectStore('blobs'));
          req.onsuccess = () => resolve(req.result ?? null);
          req.onerror = () => resolve(null);
        } catch {
          resolve(null);
        }
      }),
  );
}

export async function blobPut(key: string, blob: Blob): Promise<void> {
  memBlobs.set(key, blob);
  await tx('readwrite', (s) => s.put(blob, key));
}

export async function blobGet(key: string): Promise<Blob | null> {
  const m = memBlobs.get(key);
  if (m) return m;
  const v = await tx<unknown>('readonly', (s) => s.get(key));
  return v instanceof Blob ? v : null;
}

export async function blobDel(key: string): Promise<void> {
  memBlobs.delete(key);
  await tx('readwrite', (s) => s.delete(key));
}

/** prefix로 시작하는 보관 파일 가운데 keep이 아니라고 한 것을 지운다(다시 받을 수 있는 사본 정리용). */
export async function blobPrune(prefix: string, keep: (rest: string) => boolean): Promise<void> {
  const keys = (await tx<IDBValidKey[]>('readonly', (s) => s.getAllKeys())) ?? [];
  for (const k of keys) {
    if (typeof k === 'string' && k.startsWith(prefix) && !keep(k.slice(prefix.length))) await blobDel(k);
  }
}

/** 파일을 글자로 읽는다. UTF-8이 아니면 EUC-KR로 다시 읽어 본다(옛 한글 문서 대비). */
export async function readText(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  const head = new Uint8Array(buf.slice(0, 2));
  // UTF-16 문서(BOM으로 구분)는 그대로 읽는다
  if (head.length === 2 && ((head[0] === 0xff && head[1] === 0xfe) || (head[0] === 0xfe && head[1] === 0xff))) {
    try {
      return new TextDecoder(head[0] === 0xff ? 'utf-16le' : 'utf-16be').decode(buf);
    } catch {
      /* 아래 방식으로 다시 시도 */
    }
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    try {
      return new TextDecoder('euc-kr').decode(buf);
    } catch {
      return new TextDecoder('utf-8').decode(buf);
    }
  }
}
