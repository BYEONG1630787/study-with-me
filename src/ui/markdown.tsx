// 가벼운 마크다운 보기. HTML을 그대로 넣지 않고 React 요소로만 그린다.

import React from 'react';

type Node = React.ReactNode;

// 1·2 코드, 3·4 굵게, 5 취소선, 6·7 그림, 8·9 링크, 10·11 기울임, 12 주소
const INLINE_SRC =
  '(`+)([\\s\\S]*?)\\1|\\*\\*([\\s\\S]+?)\\*\\*|__([\\s\\S]+?)__|~~([\\s\\S]+?)~~|!\\[([^\\]]*)\\]\\(([^)\\s]+)(?:\\s+"[^"]*")?\\)|\\[([^\\]]+)\\]\\(([^)\\s]+)(?:\\s+"[^"]*")?\\)|\\*([^*\\s](?:[\\s\\S]*?[^*\\s])?)\\*|_([^_\\s](?:[^_]*?[^_\\s])?)_|(https?:\\/\\/[^\\s<>()]*[^\\s<>().,!?:;\'"])';

function safeUrl(u: string): string | null {
  return /^https?:\/\//i.test(u) ? u : null;
}

function isWord(ch: string | undefined): boolean {
  return !!ch && /[A-Za-z0-9가-힣]/.test(ch);
}

export function inline(text: string, keyBase = 'i', depth = 0): Node[] {
  if (depth > 6) return [text];
  const re = new RegExp(INLINE_SRC, 'g');
  const out: Node[] = [];
  let last = 0;
  let k = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m[0].length === 0) {
      re.lastIndex++;
      continue;
    }
    const key = keyBase + '-' + k++;
    const sub = (s: string) => inline(s, key, depth + 1);
    let node: Node;
    if (m[1]) node = <code key={key}>{m[2].trim()}</code>;
    else if (m[3] !== undefined) node = <strong key={key}>{sub(m[3])}</strong>;
    else if (m[4] !== undefined) node = <strong key={key}>{sub(m[4])}</strong>;
    else if (m[5] !== undefined) node = <del key={key}>{sub(m[5])}</del>;
    else if (m[7] !== undefined) node = <span key={key} className="md-img">{`[그림: ${m[6] || '설명 없음'}]`}</span>;
    else if (m[9] !== undefined) {
      const href = safeUrl(m[9]);
      node = href ? (
        <a key={key} href={href} target="_blank" rel="noopener noreferrer">
          {sub(m[8])}
        </a>
      ) : (
        <span key={key}>{sub(m[8])}</span>
      );
    } else if (m[10] !== undefined) node = <em key={key}>{sub(m[10])}</em>;
    else if (m[11] !== undefined) {
      // 단어 안의 밑줄(snake_case)은 기울임으로 보지 않는다
      if (isWord(text[m.index - 1]) || isWord(text[m.index + m[0].length])) continue;
      node = <em key={key}>{sub(m[11])}</em>;
    } else {
      node = (
        <a key={key} href={m[12]} target="_blank" rel="noopener noreferrer">
          {m[12]}
        </a>
      );
    }
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push(node);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function withBreaks(lines: string[], key: string): Node[] {
  const out: Node[] = [];
  lines.forEach((ln, i) => {
    const hard = / {2,}$/.test(ln) || /\\$/.test(ln);
    out.push(...inline(ln.replace(/( {2,}|\\)$/, ''), `${key}-${i}`));
    if (i < lines.length - 1) out.push(hard ? <br key={`${key}-br${i}`} /> : ' ');
  });
  return out;
}

const LIST_RE = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/;
const BLOCK_START = /^\s{0,3}(#{1,6}\s|>|```|~~~)/;

/** 표의 한 줄을 칸으로 나눈다. `\|`는 글자로 본다. */
function splitRow(line: string): string[] {
  const cells: string[] = [];
  let cur = '';
  const s = line.trim();
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '\\' && s[i + 1] === '|') {
      cur += '|';
      i++;
    } else if (ch === '|') {
      cells.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  cells.push(cur.trim());
  if (s.startsWith('|')) cells.shift();
  if (s.endsWith('|') && cells.length && cells[cells.length - 1] === '') cells.pop();
  return cells;
}

/** 빈 줄이 없는 목록 줄 묶음을 받아 <ul>/<ol>로 만든다. */
function parseList(lines: string[], key: string, depth = 0): Node {
  const first = LIST_RE.exec(lines[0]);
  if (!first || depth > 8) return <p key={key}>{withBreaks(lines.map((x) => x.trim()), key)}</p>;
  const baseIndent = first[1].length;
  const ordered = /\d/.test(first[2]);
  const items: { head: string; rest: string[] }[] = [];
  for (const ln of lines) {
    const m = LIST_RE.exec(ln);
    if (m && m[1].length <= baseIndent + 1) items.push({ head: m[3], rest: [] });
    else if (items.length) items[items.length - 1].rest.push(ln);
  }
  const children = items.map((it, i) => {
    const k = `${key}-${i}`;
    const task = /^\[( |x|X)\]\s+/.exec(it.head);
    const head = task ? it.head.slice(task[0].length) : it.head;
    let j = 0;
    const cont: string[] = [];
    while (j < it.rest.length && !LIST_RE.test(it.rest[j])) cont.push(it.rest[j++].trim());
    const nested = it.rest.slice(j);
    return (
      <li key={k} className={task ? 'md-task' : undefined}>
        {task ? (
          <span className="md-check" aria-label={task[1] === ' ' ? '아직' : '완료'}>
            {task[1] === ' ' ? '☐' : '☑'}
          </span>
        ) : null}
        {withBreaks([head, ...cont], k)}
        {nested.length ? parseList(nested, k + 'n', depth + 1) : null}
      </li>
    );
  });
  if (ordered) {
    const start = Number(/\d+/.exec(first[2])![0]);
    return (
      <ol key={key} start={start}>
        {children}
      </ol>
    );
  }
  return <ul key={key}>{children}</ul>;
}

function blocks(src: string, keyBase: string, depth = 0): Node[] {
  const lines = src.replace(/\r\n?/g, '\n').split('\n');
  const out: Node[] = [];
  let i = 0;
  let k = 0;
  while (i < lines.length) {
    const line = lines[i];
    const key = `${keyBase}${k++}`;
    if (!line.trim()) {
      i++;
      continue;
    }
    const fence = /^\s*(```+|~~~+)/.exec(line);
    if (fence) {
      const ch = fence[1][0];
      const n = fence[1].length;
      const body: string[] = [];
      i++;
      while (i < lines.length) {
        const t = lines[i].trim();
        if (t.length >= n && t.split('').every((c) => c === ch)) break;
        body.push(lines[i++]);
      }
      i++;
      out.push(
        <pre key={key} className="md-code">
          <code>{body.join('\n')}</code>
        </pre>,
      );
      continue;
    }
    const h = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (h) {
      // 자료 제목 아래에 놓이므로 제목 단계를 하나씩 낮춘다
      out.push(React.createElement('h' + Math.min(6, h[1].length + 1), { key, className: 'md-h' + h[1].length }, inline(h[2], key)));
      i++;
      continue;
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      out.push(<hr key={key} />);
      i++;
      continue;
    }
    if (/^\s*>/.test(line) && depth < 6) {
      const body: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) body.push(lines[i++].replace(/^\s*>\s?/, ''));
      out.push(<blockquote key={key}>{blocks(body.join('\n'), key + 'q', depth + 1)}</blockquote>);
      continue;
    }
    if (line.includes('|') && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(lines[i + 1]) && lines[i + 1].includes('-')) {
      const head = splitRow(line);
      const aligns = splitRow(lines[i + 1]).map((c): 'center' | 'right' | undefined => (c.startsWith(':') && c.endsWith(':') ? 'center' : c.endsWith(':') ? 'right' : undefined));
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim() && lines[i].includes('|')) rows.push(splitRow(lines[i++]));
      out.push(
        <div key={key} className="md-table-wrap">
          <table>
            <thead>
              <tr>
                {head.map((c, n) => (
                  <th key={n} style={{ textAlign: aligns[n] }}>
                    {inline(c, `${key}h${n}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, rn) => (
                <tr key={rn}>
                  {head.map((_, n) => (
                    <td key={n} style={{ textAlign: aligns[n] }}>
                      {inline(r[n] ?? '', `${key}r${rn}c${n}`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }
    if (LIST_RE.test(line)) {
      const body: string[] = [];
      while (i < lines.length) {
        const ln = lines[i];
        if (!ln.trim()) {
          // 빈 줄 다음에도 목록이나 들여쓴 줄이 이어지면 같은 목록이다
          const next = lines[i + 1];
          if (next !== undefined && next.trim() && (LIST_RE.test(next) || /^\s{2,}\S/.test(next))) {
            i++;
            continue;
          }
          break;
        }
        if (!LIST_RE.test(ln) && BLOCK_START.test(ln)) break;
        body.push(ln);
        i++;
      }
      out.push(parseList(body, key));
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !BLOCK_START.test(lines[i]) && !(para.length > 0 && LIST_RE.test(lines[i]))) {
      para.push(lines[i].replace(/^\s+/, ''));
      i++;
    }
    if (para.length === 0) {
      // 어느 규칙에도 맞지 않는 줄은 그대로 한 문단으로 둔다(무한 반복 방지)
      para.push(line.trim());
      i++;
    }
    out.push(<p key={key}>{withBreaks(para, key)}</p>);
  }
  return out;
}

export function Markdown({ text }: { text: string }) {
  return <div className="prose md">{blocks(text, 'b')}</div>;
}
