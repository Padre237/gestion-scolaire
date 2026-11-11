// Passage de chaque écran pour chaque rôle : erreurs du navigateur, appels d'API refusés ou en échec, écrans vides,
// mots qui ne doivent jamais s'afficher (prototype, démo, fictif, undefined…). Une capture par écran.
// Usage : pnpm --filter @gs/controle exec tsx src/parcourir.ts --base http://localhost:8080 [--compte secretaire] [--sortie dossier]
import puppeteer, { type Browser, type Page } from 'puppeteer';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ECRANS } from './ecrans.ts';

const arg = (n: string, d?: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : d; };
const BASE = arg('base', 'http://localhost:8080')!;
const SORTIE = arg('sortie', resolve(process.cwd(), 'parcours'))!;

interface Compte { id: string; mdp: string; parent?: boolean; mobile?: boolean; routes?: string[] }
const COMPTES: Compte[] = [
  { id: 'directrice', mdp: 'demo-directrice' },
  { id: 'secretaire', mdp: 'demo-secretaire' },
  { id: 'econome', mdp: 'demo-econome' },
  { id: 'prefet', mdp: 'demo-prefet' },
  { id: 'onana.b', mdp: 'demo-onana', routes: ['/instituteur/notes', '/instituteur/appel'] },
  { id: 'eyenga.s', mdp: 'demo-eyenga', routes: ['/instituteur/notes', '/instituteur/appel'] },
  { id: 'essama.l', mdp: 'demo-essama', routes: ['/instituteur/notes'] },
  { id: '600000055', mdp: 'demo-kenfack', parent: true, mobile: true,
    routes: ['/parent/accueil', '/parent/notes', '/parent/paiements', '/parent/agenda', '/parent/messages', '/parent/ecrire'] },
];

const INTERDITS = [/prototype/i, /\bdémo\b/i, /démonstration/i, /fictiv?e?s?\b/i, /\bfictif/i, /\bE-\d{2}\b/, /en construction/i, /\bTODO\b/,
  /\bundefined\b/, /\bNaN\b/, /\[object Object\]/, /Invalid Date/, /\bnull\b/];

interface Constat { compte: string; route: string; problemes: string[] }

/** Remplace les repères des routes de maquette (kenfack-steve, dernier) par de vrais identifiants lus dans l'API. */
async function resoudre(page: Page, route: string): Promise<string | null> {
  if (!/kenfack-steve|dernier|:[a-z]/i.test(route)) return route;
  const ids = await page.evaluate(async () => {
    const j = async (u: string) => { const r = await fetch(`/api/v1${u}`, { credentials: 'same-origin' }); return r.ok ? r.json() : null; };
    const eleves = await j('/scolarite/eleves?q=KENFACK&taille=20');
    const steve = eleves?.lignes?.find((l: { nom: string }) => /KENFACK Steve/i.test(l.nom)) ?? eleves?.lignes?.[0];
    const ech = steve?.inscriptionId ? await j(`/finances/inscriptions/${steve.inscriptionId}/echeancier`) : null;
    const versements = (ech?.versements ?? []) as { id: string }[];
    return { eleve: steve?.eleveId ?? null, inscription: steve?.inscriptionId ?? null, versement: versements[versements.length - 1]?.id ?? null };
  });
  let r = route;
  if (r.includes('/finances/encaissement/kenfack-steve')) r = ids.inscription ? r.replace('kenfack-steve', ids.inscription) : '';
  if (r.includes('kenfack-steve')) r = ids.eleve ? r.replace('kenfack-steve', ids.eleve) : '';
  if (r.includes('dernier')) r = ids.versement ? r.replace('dernier', ids.versement) : r;
  return r || null;
}

async function connecter(page: Page, c: Compte) {
  await page.goto(`${BASE}${c.parent ? '/parent/connexion' : '/connexion'}`, { waitUntil: 'networkidle0' });
  const champs = await page.$$('input');
  if (champs.length < 2) throw new Error('écran de connexion sans champs');
  await champs[0]!.type(c.parent ? c.id.replace(/(\d{3})(?=\d)/g, '$1 ') : c.id);
  await champs[1]!.type(c.mdp);
  await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 15_000 }).catch(() => null), page.keyboard.press('Enter')]);
  await attendre(page);
  if (/\/connexion$/.test(new URL(page.url()).pathname)) throw new Error(`connexion refusée : ${await page.evaluate(() => document.body.innerText.slice(0, 200))}`);
}

async function attendre(page: Page) {
  await page.waitForNetworkIdle({ idleTime: 500, timeout: 15_000 }).catch(() => null);
  await page.waitForFunction(() => !document.querySelector('.chargement'), { timeout: 10_000 }).catch(() => null);
}

async function examiner(navigateur: Browser, c: Compte): Promise<Constat[]> {
  const contexte = await navigateur.createBrowserContext();
  const page = await contexte.newPage();
  // tsx nomme les fonctions avec __name : la page doit le connaître pour les fonctions passées à evaluate.
  await page.evaluateOnNewDocument('globalThis.__name = (f) => f;');
  await page.setViewport(c.mobile ? { width: 390, height: 844, deviceScaleFactor: 1 } : { width: 1440, height: 900 });
  let erreurs: string[] = [];
  page.on('pageerror', (e) => erreurs.push(`exception : ${(e as Error).message.split('\n')[0]}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) erreurs.push(`console : ${m.text().slice(0, 160)}`); });
  page.on('response', (r) => {
    const u = new URL(r.url());
    if (u.pathname.startsWith('/api/') && r.status() >= 400 && !(r.status() === 401 && u.pathname === '/api/v1/auth/moi'))
      erreurs.push(`API ${r.status()} ${r.request().method()} ${u.pathname}${u.search}`);
  });
  const constats: Constat[] = [];
  try {
    await connecter(page, c);
  } catch (e) {
    await contexte.close();
    return [{ compte: c.id, route: '(connexion)', problemes: [(e as Error).message, ...erreurs] }];
  }
  // Routes : celles du compte, ses écrans de maquette, puis les modules et onglets qu'il voit.
  const aVoir: string[] = [new URL(page.url()).pathname, ...(c.routes ?? []), ...ECRANS.filter((e) => e.compte?.split(':')[0] === c.id).map((e) => e.route)];
  const vus = new Set<string>();
  for (let i = 0; i < aVoir.length && vus.size < 90; i++) {
    const brute = aVoir[i]!;
    const route = await resoudre(page, brute);
    if (!route || vus.has(route)) continue;
    vus.add(route);
    erreurs = [];
    const petit = route.startsWith('/parent') || route.startsWith('/instituteur');
    await page.setViewport(petit ? { width: 390, height: 844, deviceScaleFactor: 1 } : { width: 1440, height: 900 });
    await page.goto(`${BASE}${route}`, { waitUntil: 'domcontentloaded' });
    await attendre(page);
    const etat = await page.evaluate(() => {
      const zone = document.querySelector('main.principal');
      const sansEntete = zone ? [...zone.children].filter((x) => !x.matches('.entete, .onglets')).map((x) => (x as HTMLElement).innerText).join('\n')
        : document.body.innerText;
      const liens = [...document.querySelectorAll('.lateral .menu a, .onglets a, .mobile-onglets a')].map((a) => (a as HTMLAnchorElement).getAttribute('href') ?? '');
      return { texte: document.body.innerText, contenu: sansEntete.trim().length, liens, chemin: location.pathname,
        erreurEcran: [...document.querySelectorAll('.note.danger')].map((x) => (x as HTMLElement).innerText).join(' | ') };
    });
    const problemes = [...erreurs];
    if (etat.chemin !== route.split('?')[0]) problemes.push(`redirigé vers ${etat.chemin}`);
    if (etat.contenu < 25) problemes.push('écran vide');
    for (const re of INTERDITS) { const m = etat.texte.match(re); if (m) problemes.push(`texte interdit « ${m[0]} » : …${etat.texte.slice(Math.max(0, m.index! - 40), m.index! + 40).replace(/\n/g, ' ')}…`); }
    if (etat.erreurEcran) problemes.push(`message d'erreur : ${etat.erreurEcran.slice(0, 200)}`);
    const nom = route.replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '') || 'accueil';
    mkdirSync(resolve(SORTIE, c.id), { recursive: true });
    await page.screenshot({ path: resolve(SORTIE, c.id, `${nom}.png`), fullPage: true });
    constats.push({ compte: c.id, route, problemes });
    for (const l of etat.liens) if (l.startsWith('/') && !aVoir.includes(l)) aVoir.push(l);
  }
  await contexte.close();
  return constats;
}

const choisi = arg('compte');
const navigateur = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--ignore-certificate-errors'] });
const tous: Constat[] = [];
try {
  for (const c of COMPTES.filter((x) => !choisi || x.id === choisi)) {
    const r = await examiner(navigateur, c);
    tous.push(...r);
    const ko = r.filter((x) => x.problemes.length);
    console.log(`${c.id.padEnd(12)} ${r.length} écrans, ${ko.length} avec problème`);
    for (const x of ko) console.log(`  ${x.route}\n    - ${[...new Set(x.problemes)].join('\n    - ')}`);
  }
} finally {
  await navigateur.close();
}
mkdirSync(SORTIE, { recursive: true });
writeFileSync(resolve(SORTIE, 'rapport.json'), JSON.stringify(tous, null, 2));
const total = tous.filter((x) => x.problemes.length).length;
console.log(`\n${tous.length} écrans parcourus, ${total} avec problème. Captures et rapport : ${SORTIE}`);
process.exitCode = total ? 1 : 0;
