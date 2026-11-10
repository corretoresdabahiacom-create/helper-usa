/** Minimal text-only PDF writer (Helvetica, WinAnsi). No dependencies; runs in Workers. Non-Latin1 characters are replaced with '?'. */
const enc = (s: string) => {
  const out: number[] = [];
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    out.push(cp >= 32 && cp <= 255 ? cp : cp === 9 ? 32 : 63);
  }
  return out;
};
const esc = (bytes: number[]) => {
  const r: number[] = [];
  for (const b of bytes) { if (b === 40 || b === 41 || b === 92) r.push(92); r.push(b); }
  return r;
};
function wrap(line: string, max: number): string[] {
  if (line.length <= max) return [line];
  const words = line.split(' '); const out: string[] = []; let cur = '';
  for (const w of words) {
    if (w.length > max) { if (cur) out.push(cur); for (let i = 0; i < w.length; i += max) out.push(w.slice(i, i + max)); cur = ''; continue; }
    if ((cur + ' ' + w).trim().length > max) { out.push(cur); cur = w; } else cur = (cur + ' ' + w).trim();
  }
  if (cur) out.push(cur);
  return out;
}
export function textToPdf(title: string, lines: string[]): Uint8Array {
  const perPage = 52; const flat: string[] = [];
  for (const l of lines) flat.push(...wrap(l, 92));
  const pages: string[][] = [];
  for (let i = 0; i < Math.max(flat.length, 1); i += perPage) pages.push(flat.slice(i, i + perPage));
  const objs: (number[] | string)[] = [];
  const parts: number[][] = [];
  const add = (b: number[] | string) => { objs.push(b); return objs.length; };
  const catalog = add('<< /Type /Catalog /Pages 2 0 R >>');
  add(''); // pages placeholder (id 2)
  const font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  const pageIds: number[] = [];
  pages.forEach((pl, pi) => {
    const content: number[] = [];
    const push = (s: string) => content.push(...[...s].map((c) => c.charCodeAt(0)));
    push('BT /F1 14 Tf 50 800 Td ('); content.push(...esc(enc(title))); push(`) Tj ET\nBT /F1 10 Tf 50 780 Td 14 TL\n`);
    for (const l of pl) { push('('); content.push(...esc(enc(l))); push(') Tj T*\n'); }
    push(`ET\nBT /F1 8 Tf 50 30 Td (Page ${pi + 1}/${pages.length}) Tj ET`);
    const cid = add([...[...`<< /Length ${content.length} >>\nstream\n`].map((c) => c.charCodeAt(0)), ...content, ...[...'\nendstream'].map((c) => c.charCodeAt(0))]);
    pageIds.push(add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents ${cid} 0 R /Resources << /Font << /F1 ${font} 0 R >> >> >>`));
  });
  objs[1] = `<< /Type /Pages /Kids [${pageIds.map((i) => `${i} 0 R`).join(' ')}] /Count ${pageIds.length} >>`;
  const head = [...'%PDF-1.4\n'].map((c) => c.charCodeAt(0)); let pos = head.length; const offs: number[] = [];
  parts.push(head);
  objs.forEach((o, i) => {
    const body = typeof o === 'string' ? [...o].map((c) => c.charCodeAt(0)) : o;
    const b = [...`${i + 1} 0 obj\n`].map((c) => c.charCodeAt(0)).concat(body, [...'\nendobj\n'].map((c) => c.charCodeAt(0)));
    offs.push(pos); pos += b.length; parts.push(b);
  });
  let x = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const o of offs) x += `${String(o).padStart(10, '0')} 00000 n \n`;
  x += `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${pos}\n%%EOF`;
  parts.push([...x].map((c) => c.charCodeAt(0)));
  return Uint8Array.from(parts.flat());
}
