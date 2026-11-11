// Formats d'affichage : montants « 72 000 » (espace fine insécable, comme les maquettes), dates JJ/MM/AAAA, notes 12,5.
const FINE = ' ';

export function montant(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return '–';
  const v = Math.round(Math.abs(Number(n)));
  const s = String(v).replace(/\B(?=(\d{3})+(?!\d))/g, FINE);
  return Number(n) < 0 ? `−${s}` : s;
}
export const fcfa = (n: number | null | undefined) => (n === null || n === undefined ? '–' : `${montant(n)} FCFA`);

/** Note ou coefficient à la française : 12,5 ; avec décimales fixées : 12,50. */
export function decimal(n: number | null | undefined, decimales?: number): string {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return '–';
  const v = Number(n);
  const s = decimales !== undefined ? v.toFixed(decimales) : Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100);
  return s.replace('.', ',');
}
export const note2 = (n: number | null | undefined) => decimal(n, 2);

const d2 = (n: number) => String(n).padStart(2, '0');
export function dateLocale(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const d = new Date(iso.length === 10 ? `${iso}T12:00:00` : iso);
  return Number.isNaN(d.getTime()) ? null : d;
}
export function jjmmaaaa(iso: string | null | undefined): string {
  if (!iso) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso.split('-').reverse().join('/');
  const d = dateLocale(iso);
  return d ? `${d2(d.getDate())}/${d2(d.getMonth() + 1)}/${d.getFullYear()}` : '';
}
export const jjmm = (iso: string | null | undefined) => jjmmaaaa(iso).slice(0, 5);
export function heure(iso: string | null | undefined): string {
  const d = dateLocale(iso);
  return d ? `${d2(d.getHours())}:${d2(d.getMinutes())}` : '';
}
export function aujourdhuiIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${d2(d.getMonth() + 1)}-${d2(d.getDate())}`;
}
/** « 07/11/2026 » → « 2026-11-07 » ; null si la saisie n'est pas une date valide. */
export function versIso(saisie: string): string | null {
  const s = saisie.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1])));
  if (d.getUTCDate() !== Number(m[1]) || d.getUTCMonth() !== Number(m[2]) - 1) return null;
  return d.toISOString().slice(0, 10);
}
export const versEntier = (s: string): number | null => { const v = Number(s.replace(/[\s  ]/g, '')); return s.trim() !== '' && Number.isInteger(v) ? v : null; };
export const versDecimal = (s: string): number | null => { const v = Number(s.trim().replace(',', '.')); return s.trim() !== '' && !Number.isNaN(v) ? v : null; };
export const initiale = (nom: string) => (nom.replace(/^(M\.|Mme|Mr|Mrs|Dr)\s+/, '').trim()[0] ?? '?').toUpperCase();

const UNITES = ['zéro', 'un', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit', 'neuf', 'dix', 'onze', 'douze'];
export const enLettres = (n: number, majuscule = false) => { const s = n >= 0 && n < UNITES.length ? UNITES[n]! : String(n); return majuscule ? s[0]!.toUpperCase() + s.slice(1) : s; };
/** pluriel(3, 'ligne') → « 3 lignes ». */
export const pluriel = (n: number, mot: string, motPluriel?: string) => `${montant(n)} ${Math.abs(n) > 1 ? (motPluriel ?? `${mot}s`) : mot}`;
const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
/** « 2026-11 » → « Novembre 2026 ». */
export function libelleMois(aaaamm: string, majuscule = true): string {
  const [a, m] = aaaamm.split('-');
  const nom = MOIS[Number(m) - 1] ?? '';
  return `${majuscule ? nom.charAt(0).toUpperCase() + nom.slice(1) : nom} ${a}`;
}
const JOURS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
/** « samedi 07/11/2026 ». */
export const jourDate = (iso: string) => { const d = dateLocale(iso); return d ? `${JOURS[d.getDay()]} ${jjmmaaaa(iso)}` : jjmmaaaa(iso); };
export const heures = (minutes: number) => (minutes ? `${decimal(Math.round((minutes / 60) * 10) / 10)} h` : '0');
