// Montant en lettres, en français et en anglais (conception § 9.2), testé sur les cas pièges :
// 71, 80, 91, 100, 200, 1 000, 1 000 000.

const UNITES_FR = ['zéro', 'un', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit', 'neuf', 'dix', 'onze', 'douze',
  'treize', 'quatorze', 'quinze', 'seize'];
const DIZAINES_FR = ['', 'dix', 'vingt', 'trente', 'quarante', 'cinquante', 'soixante'];

function moinsDeCentFr(n: number, final: boolean): string {
  if (n <= 16) return UNITES_FR[n]!;
  if (n < 20) return `dix-${UNITES_FR[n - 10]}`;
  const d = Math.floor(n / 10);
  const u = n % 10;
  if (d === 7 || d === 9) {
    // 70-79 : soixante-dix… ; 90-99 : quatre-vingt-dix…
    const base = d === 7 ? 'soixante' : 'quatre-vingt';
    const reste = 10 + u;
    if (d === 7 && u === 1) return 'soixante et onze';
    return `${base}-${moinsDeCentFr(reste, false)}`;
  }
  if (d === 8) {
    if (u === 0) return final ? 'quatre-vingts' : 'quatre-vingt';
    return `quatre-vingt-${UNITES_FR[u]}`;
  }
  if (u === 0) return DIZAINES_FR[d]!;
  if (u === 1) return `${DIZAINES_FR[d]} et un`;
  return `${DIZAINES_FR[d]}-${UNITES_FR[u]}`;
}

/** 0 ≤ n < 1000 ; `final` : le nombre termine l'expression (accord de « cents », « vingts »). */
function moinsDeMilleFr(n: number, final: boolean): string {
  const c = Math.floor(n / 100);
  const r = n % 100;
  const parties: string[] = [];
  if (c > 0) {
    if (c === 1) parties.push('cent');
    else parties.push(`${UNITES_FR[c]} ${r === 0 && final ? 'cents' : 'cent'}`);
  }
  if (r > 0 || c === 0) parties.push(moinsDeCentFr(r, final));
  return parties.join(' ');
}

export function enLettresFr(n: number): string {
  if (!Number.isInteger(n) || n < 0) throw new Error('Montant entier positif attendu');
  if (n === 0) return 'zéro';
  const milliards = Math.floor(n / 1e9);
  const millions = Math.floor((n % 1e9) / 1e6);
  const milliers = Math.floor((n % 1e6) / 1e3);
  const reste = n % 1e3;
  const parties: string[] = [];
  if (milliards) parties.push(`${moinsDeMilleFr(milliards, true)} milliard${milliards > 1 ? 's' : ''}`);
  if (millions) parties.push(`${moinsDeMilleFr(millions, true)} million${millions > 1 ? 's' : ''}`);
  if (milliers) parties.push(milliers === 1 ? 'mille' : `${moinsDeMilleFr(milliers, false)} mille`);
  if (reste) parties.push(moinsDeMilleFr(reste, true));
  return parties.join(' ');
}

/** « Quinze mille francs CFA » ; « Un million de francs CFA ». */
export function francsCfaFr(n: number): string {
  const lettres = enLettresFr(n);
  const de = n > 0 && n % 1e6 === 0 ? ' de' : '';
  const s = `${lettres}${de} francs CFA`;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const UNITES_EN = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve',
  'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const DIZAINES_EN = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

function moinsDeMilleEn(n: number): string {
  const c = Math.floor(n / 100);
  const r = n % 100;
  const parties: string[] = [];
  if (c) parties.push(`${UNITES_EN[c]} hundred`);
  if (r) {
    const txt = r < 20 ? UNITES_EN[r]! : DIZAINES_EN[Math.floor(r / 10)]! + (r % 10 ? `-${UNITES_EN[r % 10]}` : '');
    parties.push(c ? `and ${txt}` : txt);
  }
  return parties.join(' ');
}

export function enLettresEn(n: number): string {
  if (!Number.isInteger(n) || n < 0) throw new Error('Montant entier positif attendu');
  if (n === 0) return 'zero';
  const echelles: [number, string][] = [[1e9, 'billion'], [1e6, 'million'], [1e3, 'thousand']];
  const parties: string[] = [];
  let reste = n;
  for (const [v, mot] of echelles) {
    const q = Math.floor(reste / v);
    if (q) parties.push(`${moinsDeMilleEn(q)} ${mot}`);
    reste %= v;
  }
  if (reste) parties.push(reste < 100 && parties.length ? `and ${moinsDeMilleEn(reste)}` : moinsDeMilleEn(reste));
  return parties.join(' ');
}

/** « Fifteen thousand CFA francs ». */
export function francsCfaEn(n: number): string {
  const s = `${enLettresEn(n)} CFA francs`;
  return s.charAt(0).toUpperCase() + s.slice(1);
}
