import { en } from './dict.en';
import { es } from './dict.es';
import { pt } from './dict.pt';
import { legal } from './legal';

export type Lang = 'en' | 'pt' | 'es';
export const dict: Record<Lang, Record<string, string>> = { en: { ...en, ...legal.en }, pt: { ...pt, ...legal.pt }, es: { ...es, ...legal.es } };
