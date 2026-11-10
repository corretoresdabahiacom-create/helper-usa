import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { dict } from '../web/src/dict';

const walk = (d: string): string[] => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(p) ? [p] : []; });

describe('i18n', () => {
  const en = Object.keys(dict.en);
  it('pt and es have exactly the same keys as en', () => {
    for (const l of ['pt', 'es'] as const) {
      const keys = Object.keys(dict[l]);
      expect(en.filter((k) => !keys.includes(k)), `${l} missing`).toEqual([]);
      expect(keys.filter((k) => !en.includes(k)), `${l} extra`).toEqual([]);
    }
  });
  it('no empty translations and placeholders match en', () => {
    for (const l of ['pt', 'es'] as const) for (const k of en) {
      expect(dict[l][k]?.trim(), `${l}:${k}`).toBeTruthy();
      const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join();
      expect(ph(dict[l][k]), `${l}:${k} placeholders`).toBe(ph(dict.en[k]));
    }
  });
  it('every static t("key") used in source exists', () => {
    const missing: string[] = [];
    for (const f of walk('web/src')) {
      const src = readFileSync(f, 'utf8');
      for (const m of src.matchAll(/\bt\(\s*'([a-z_]+(?:\.[A-Za-z_0-9]+)+)'/g)) if (!(m[1] in dict.en)) missing.push(`${f}: ${m[1]}`);
    }
    expect(missing).toEqual([]);
  });
});
