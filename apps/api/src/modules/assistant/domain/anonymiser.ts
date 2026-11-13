// Aucune donnée personnelle ne part chez le fournisseur de l'assistant (RG-31, D-48) : la question est nettoyée avant l'envoi.
// Sont remplacés : adresses électroniques, numéros de téléphone (8 chiffres ou plus), et tout nom connu de l'établissement
// (élèves, responsables, personnel). Mieux vaut remplacer un mot de trop qu'en laisser passer un.

const sansAccent = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const TITRES = new Set(['m', 'mme', 'mlle', 'mr', 'mrs', 'ms', 'dr']);

/** Mots des noms connus, prêts à comparer (3 lettres au moins, sans accent, sans les civilités). */
export function motsDesNoms(noms: string[]): Set<string> {
  const mots = new Set<string>();
  for (const n of noms) for (const m of sansAccent(n).split(/[^a-z'-]+/)) if (m.length >= 3 && !TITRES.has(m)) mots.add(m);
  return mots;
}

export function anonymiser(question: string, mots: Set<string>): { texte: string; remplacements: number } {
  let n = 0;
  let t = question.replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, () => { n++; return '[adresse]'; });
  t = t.replace(/\+?\d[\d\s.-]{6,}\d/g, (x) => (x.replace(/\D/g, '').length >= 8 ? (n++, '[numéro]') : x));
  t = t.replace(/[\p{L}][\p{L}'-]{2,}/gu, (mot) => (mots.has(sansAccent(mot)) ? (n++, '[personne]') : mot));
  return { texte: t, remplacements: n };
}
