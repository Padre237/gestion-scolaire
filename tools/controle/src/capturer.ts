// Captures de l'application réelle (D-20) : chaque écran à la taille de son PNG de référence (E-11).
// Usage : pnpm --filter @gs/controle capturer -- --base http://localhost:8443 --ecran Main [--ecran …] [--tout]
import puppeteer, { type Browser, type Page } from 'puppeteer';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ECRANS, type Ecran } from './ecrans.ts';

const RACINE = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
export const MAQUETTES = resolve(RACINE, '../maquettes-gestion-scolaire');
export const SORTIE = resolve(RACINE, 'controle/captures');

const arg = (n: string, d?: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : d; };
const tous = (n: string) => process.argv.flatMap((a, i) => (a === `--${n}` ? [process.argv[i + 1]!] : []));

/** Taille du PNG de référence (en-tête IHDR). */
export function taillePng(chemin: string): { largeur: number; hauteur: number } {
  const b = readFileSync(chemin);
  return { largeur: b.readUInt32BE(16), hauteur: b.readUInt32BE(20) };
}

async function connecter(page: Page, base: string, e: Ecran) {
  if (!e.compte) return;
  const [id, mdp] = e.compte.split(':');
  const parent = e.parent ?? false;
  await page.goto(`${base}/api/v1/auth/accueil`);
  const r = await page.evaluate(async (id, mdp, parent) => {
    const res = await fetch(parent ? '/api/v1/auth/connexion-parent' : '/api/v1/auth/connexion', {
      method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'same-origin',
      body: JSON.stringify(parent ? { telephone: id, motDePasse: mdp, client: 'web' } : { identifiant: id, motDePasse: mdp, client: 'web' }) });
    return res.status;
  }, id!, mdp!, parent);
  if (r !== 200) throw new Error(`Connexion refusée pour ${id} (${r})`);
}

export async function capturer(navigateur: Browser, base: string, e: Ecran): Promise<string> {
  const png = resolve(MAQUETTES, 'images', e.image);
  const t = taillePng(png);
  const echelle = e.mobile ? 2 : 1;
  const page = await navigateur.newPage();
  await page.setViewport({ width: Math.round(t.largeur / echelle), height: Math.round(t.hauteur / echelle), deviceScaleFactor: echelle });
  // Le mode Nuit est un réglage du poste : on le pose avant de charger l'application.
  await page.evaluateOnNewDocument((nuit) => { localStorage.setItem('gs.mode', nuit ? 'nuit' : 'jour'); localStorage.setItem('gs.langue', 'fr'); }, !!e.nuit);
  await connecter(page, base, e);
  await page.goto(`${base}${e.route}`, { waitUntil: 'networkidle0', timeout: 60_000 });
  await page.waitForSelector('flt-glass-pane, flutter-view', { timeout: 60_000 });
  await new Promise((r) => setTimeout(r, e.attente ?? 2500));
  for (const action of e.actions ?? []) await action(page);
  mkdirSync(SORTIE, { recursive: true });
  const sortie = resolve(SORTIE, `${e.nom}.png`);
  await page.screenshot({ path: sortie as `${string}.png` });
  await page.close();
  return sortie;
}

if (process.argv[1]?.endsWith('capturer.ts')) {
  const base = arg('base', 'http://localhost:8443')!;
  const choix = process.argv.includes('--tout') ? ECRANS : ECRANS.filter((e) => tous('ecran').includes(e.nom));
  const navigateur = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--font-render-hinting=none'] });
  for (const e of choix) {
    try {
      console.log(`${e.nom} → ${await capturer(navigateur, base, e)}`);
    } catch (err) {
      console.error(`${e.nom} : ${(err as Error).message}`);
    }
  }
  await navigateur.close();
}
