// Renders a generated skill as typeset blocks. Model output is never injected as HTML: every
// piece of text becomes a React text node, so nothing in a skill can run or inject markup.
import type { CSSProperties, ReactNode } from 'react';

function inline(text: string, key: string): ReactNode[] {
  // \-escapes, **bold**, `code`, *italic* - in that order of precedence. An escaped character is
  // printed as itself (`\|`, `\*`), so the backslash never shows.
  const out: ReactNode[] = [];
  const re = /(\\[\\`*_{}[\]()#+\-.!|<>~]|\*\*[^*]+\*\*|`[^`]+`|\*[^*\s][^*]*\*)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const t = m[0];
    if (t.startsWith('\\')) out.push(t[1]);
    else if (t.startsWith('**')) out.push(<strong key={`${key}b${i++}`} className="font-semibold text-fg">{t.slice(2, -2)}</strong>);
    else if (t.startsWith('`')) out.push(<code key={`${key}c${i++}`} className="rounded-md bg-white/[0.06] px-1.5 py-0.5 font-mono text-[0.86em] text-fg">{t.slice(1, -1)}</code>);
    else out.push(<em key={`${key}i${i++}`}>{t.slice(1, -1)}</em>);
    last = m.index + t.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function stripFrontmatter(md: string): { front: Record<string, string>; body: string } {
  const m = /^---\s*\n([\s\S]*?)\n---\s*\n?/.exec(md);
  if (!m) return { front: {}, body: md };
  const front: Record<string, string> = {};
  for (const line of m[1].split('\n')) {
    const kv = /^([A-Za-z_]+):\s*(.*)$/.exec(line);
    if (kv) front[kv[1]] = kv[2].replace(/^"(.*)"$/, '$1');
  }
  return { front, body: md.slice(m[0].length) };
}

// ---- tables ----

// One row's cells. A pipe escaped as \| is text, not a border (GFM), and so is a pipe inside `code`:
// models write `str | None` in a cell, and splitting there gave the row a column the table doesn't have.
function cells(line: string): string[] {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
  const out: string[] = [];
  let cur = '';
  let code = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '\\' && s[i + 1] === '|') { cur += '|'; i++; continue; }
    // A backtick opens code only when another one closes it later on the line.
    if (c === '`' && (code || s.indexOf('`', i + 1) !== -1)) code = !code;
    if (c === '|' && !code) { out.push(cur.trim()); cur = ''; continue; }
    cur += c;
  }
  out.push(cur.trim());
  return out;
}

const isDelimiter = (line: string) => /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/.test(line);
type Align = 'left' | 'center' | 'right' | undefined;
const alignOf = (c: string): Align => (/^:-+:$/.test(c) ? 'center' : /^-+:$/.test(c) ? 'right' : /^:-+$/.test(c) ? 'left' : undefined);

function Table({ rows, align, k }: { rows: string[][]; align: Align[]; k: string }) {
  const [head, ...body] = rows;
  // Every row gets exactly the header's columns: a short row is padded, and a long one keeps its extra
  // text in the last cell instead of growing a column with no header.
  const n = head.length;
  const fit = (r: string[]) => (r.length > n ? [...r.slice(0, n - 1), r.slice(n - 1).join(' | ')] : [...r, ...Array(n - r.length).fill('')]);
  return (
    <div className="overflow-x-auto rounded-xl border border-line scroll-thin">
      <table className="w-full border-collapse text-left text-[13.5px]">
        <thead>
          <tr className="bg-white/[0.02]">{head.map((c, j) => <th key={j} style={{ textAlign: align[j] }} className="min-w-[7.5rem] px-3 py-2 align-bottom font-medium text-fg-2">{inline(c, `${k}h${j}`)}</th>)}</tr>
        </thead>
        <tbody>
          {body.map((r, ri) => (
            <tr key={ri} className="border-t border-line">{fit(r).map((c, j) => <td key={j} style={{ textAlign: align[j] }} className="min-w-[7.5rem] px-3 py-2 align-top text-fg-2">{inline(c, `${k}r${ri}c${j}`)}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---- code and diagrams ----

// A fence opens with ``` or ~~~ (indented too, as inside a list) and closes with the same character, at
// least as many times.
const FENCE = /^\s*(`{3,}|~{3,})\s*([^\s`]*)/;
// Box drawing, arrows and shapes: a plain-text block holding them is a diagram, not code.
const DIAGRAM = /[─-╿←-⇿■-◿]/;
// Geist Mono has no glyph for these (↑ and ↓ it has), so the browser borrows one from another font at
// another width and the rest of the line slides out of column. Each is set in a cell one character wide.
const BORROWED = /([←→↔-⇿■-◿✀-➿])/;

function Diagram({ lines }: { lines: string[] }) {
  const rows = lines.map((l) => l.replace(/\t/g, '    ').replace(/\s+$/, ''));
  const cols = Math.max(1, ...rows.map((l) => [...l].length));
  return (
    // The font shrinks to fit the diagram's widest line in the box (down to 9px on a phone), so its
    // columns stay whole; past that it scrolls sideways rather than wrapping, which would break them.
    <div className="@container rounded-xl border border-line bg-ink-2">
      <pre className="skill-diagram overflow-x-auto p-4 font-mono text-fg-2 scroll-thin" style={{ '--cols': cols } as CSSProperties}>
        {rows.map((l, r) => (
          <span key={r}>
            {l.split(BORROWED).map((part, j) => (j % 2 ? <span key={j} className="inline-block w-[1ch] text-center leading-none">{part}</span> : part))}
            {r < rows.length - 1 && '\n'}
          </span>
        ))}
      </pre>
    </div>
  );
}

const PLAIN = /^(|text|txt|plain|plaintext|ascii|diagram|tree)$/i;

export function SkillMarkdown({ md }: { md: string }) {
  const lines = stripFrontmatter(md).body.split('\n');
  const blocks: ReactNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const k = `l${i}`;
    if (!line.trim()) { i++; continue; }
    const fence = FENCE.exec(line);
    if (fence) {
      const [, mark, lang] = fence;
      const indent = line.length - line.trimStart().length;
      const close = new RegExp(`^\\s*${mark[0] === '`' ? '`' : '~'}{${mark.length},}\\s*$`);
      const code: string[] = [];
      i++;
      while (i < lines.length && !close.test(lines[i])) {
        const l = lines[i++];
        // Inside a list the fence is indented: its lines lose that much leading space, never more.
        code.push(l.slice(Math.min(indent, l.length - l.trimStart().length)));
      }
      i++;
      if (PLAIN.test(lang) && code.some((l) => DIAGRAM.test(l))) blocks.push(<Diagram key={k} lines={code} />);
      else blocks.push(<pre key={k} className="overflow-x-auto rounded-xl border border-line bg-ink-2 p-4 font-mono text-[13px] leading-relaxed text-fg-2 scroll-thin">{code.join('\n')}</pre>);
      continue;
    }
    // A diagram the model forgot to fence: two or more lines of box drawing in a row.
    if (/[─-╿]/.test(line) && /[─-╿]/.test(lines[i + 1] ?? '')) {
      const art: string[] = [];
      while (i < lines.length && lines[i].trim() && /[─-╿]/.test(lines[i])) art.push(lines[i++]);
      blocks.push(<Diagram key={k} lines={art} />);
      continue;
    }
    // A table: a row of pipes, or any line with a pipe followed by the |---|---| row.
    const lead = line.trimStart().startsWith('|');
    if (lead || (line.includes('|') && (lines[i + 1] ?? '').includes('|') && isDelimiter(lines[i + 1]))) {
      const rows: string[][] = [];
      let align: Align[] = [];
      while (i < lines.length && lines[i].trim() && lines[i].includes('|') && (!lead || lines[i].trimStart().startsWith('|'))) {
        if (rows.length === 1 && isDelimiter(lines[i])) align = cells(lines[i]).map(alignOf);
        else rows.push(cells(lines[i]));
        i++;
      }
      blocks.push(<Table key={k} rows={rows} align={align} k={k} />);
      continue;
    }
    if (/^#{1,2}\s/.test(line)) { blocks.push(<h3 key={k} className="mt-8 text-[22px] font-semibold tracking-[-0.02em] text-fg first:mt-0">{inline(line.replace(/^#+\s/, ''), k)}</h3>); i++; continue; }
    if (/^#{3,}\s/.test(line)) { blocks.push(<h4 key={k} className="mt-5 text-[16px] font-semibold text-fg">{inline(line.replace(/^#+\s/, ''), k)}</h4>); i++; continue; }
    if (/^\s*([-*]|\d+\.)\s/.test(line)) {
      const ordered = /^\s*\d+\./.test(line);
      const items: string[] = [];
      while (i < lines.length && /^\s*([-*]|\d+\.)\s/.test(lines[i])) items.push(lines[i++].replace(/^\s*([-*]|\d+\.)\s/, ''));
      const List = ordered ? 'ol' : 'ul';
      blocks.push(<List key={k} className={`${ordered ? 'list-decimal' : 'list-disc'} space-y-1.5 pl-5 text-[15px] leading-relaxed text-fg-2 marker:text-fg-3`}>{items.map((t, j) => <li key={j}>{inline(t, `${k}i${j}`)}</li>)}</List>);
      continue;
    }
    if (line.startsWith('> ')) { blocks.push(<blockquote key={k} className="border-l-2 border-line-2 pl-4 text-[15px] text-fg-2">{inline(line.slice(2), k)}</blockquote>); i++; continue; }
    blocks.push(<p key={k} className="text-[15px] leading-relaxed text-fg-2">{inline(line, k)}</p>);
    i++;
  }
  // A long unbroken token (a path, a URL, a long identifier) wraps instead of running out of the box.
  return <div className="space-y-4 [overflow-wrap:break-word]">{blocks}</div>;
}
