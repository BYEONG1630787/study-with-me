// pdf.js 불러오기. 페이지와 함께 게시한 파일(vendor/)을 쓰고, 없으면 CDN에서 받는다.

export interface PdfViewport {
  width: number;
  height: number;
}

export interface PdfRenderTask {
  promise: Promise<void>;
  cancel(): void;
}

export interface PdfPage {
  getViewport(o: { scale: number }): PdfViewport;
  render(o: { canvasContext: CanvasRenderingContext2D; viewport: PdfViewport }): PdfRenderTask;
}

export interface PdfDoc {
  numPages: number;
  getPage(n: number): Promise<PdfPage>;
  destroy(): Promise<void>;
}

interface PdfLoadingTask {
  promise: Promise<PdfDoc>;
  destroy(): Promise<void>;
}

interface PdfLib {
  getDocument(src: Record<string, unknown>): PdfLoadingTask;
  GlobalWorkerOptions: { workerSrc: string };
}

interface Loaded {
  lib: PdfLib;
  base: string;
  local: boolean;
}

const CDN = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/';

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const el = document.createElement('script');
    el.src = src;
    el.async = true;
    el.onload = () => resolve();
    el.onerror = () => {
      el.remove();
      reject(new Error('script load failed: ' + src));
    };
    document.head.appendChild(el);
  });
}

let loading: Promise<Loaded> | null = null;

function load(): Promise<Loaded> {
  if (!loading) {
    loading = (async () => {
      const localBase = new URL('vendor/', document.baseURI).href;
      let base = localBase;
      let local = true;
      try {
        await loadScript(localBase + 'pdf.min.js');
      } catch {
        base = CDN;
        local = false;
        await loadScript(CDN + 'pdf.min.js');
      }
      const lib = (window as unknown as { pdfjsLib?: PdfLib }).pdfjsLib;
      if (!lib) throw new Error('pdf.js did not load');
      lib.GlobalWorkerOptions.workerSrc = base + 'pdf.worker.min.js';
      return { lib, base, local };
    })();
    loading.catch(() => {
      loading = null;
    });
  }
  return loading;
}

export interface OpenedPdf {
  doc: PdfDoc;
  close: () => void;
}

// 글꼴 표(cmaps)와 기본 글꼴은 JSON 묶음 두 개로 게시해 두고, 필요한 PDF를 열 때만 받는다.
const packs: Record<string, Promise<Record<string, string>>> = {};

function loadPack(url: string): Promise<Record<string, string>> {
  if (!packs[url]) {
    packs[url] = fetch(url).then((r) => {
      if (!r.ok) throw new Error('pack ' + r.status);
      return r.json() as Promise<Record<string, string>>;
    });
    packs[url].catch(() => {
      delete packs[url];
    });
  }
  return packs[url];
}

function fromBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function factories(base: string) {
  class CMaps {
    async fetch({ name }: { name: string }) {
      const pack = await loadPack(base + 'pdf.cmaps.json');
      const b64 = pack[name + '.bcmap'];
      if (!b64) throw new Error('Unable to load CMap: ' + name);
      return { cMapData: fromBase64(b64), compressionType: 1 /* BINARY */ };
    }
  }
  class Fonts {
    async fetch({ filename }: { filename: string }) {
      const pack = await loadPack(base + 'pdf.fonts.json');
      const b64 = pack[filename];
      if (!b64) throw new Error('Unable to load font data: ' + filename);
      return fromBase64(b64);
    }
  }
  return { CMaps, Fonts };
}

/** PDF 파일을 연다. 한글 등 CJK 글꼴 표(cmaps)는 같이 게시한 파일에서 읽는다. */
export async function openPdf(data: ArrayBuffer): Promise<OpenedPdf> {
  const { lib, base, local } = await load();
  const opts: Record<string, unknown> = { data: new Uint8Array(data), useWorkerFetch: false, isEvalSupported: false };
  if (local) {
    const f = factories(base);
    opts.CMapReaderFactory = f.CMaps;
    opts.StandardFontDataFactory = f.Fonts;
  }
  const task = lib.getDocument(opts);
  const doc = await task.promise;
  return {
    doc,
    close: () => {
      task.destroy().catch(() => undefined);
    },
  };
}
