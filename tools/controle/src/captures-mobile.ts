// Captures d'écrans à trois largeurs (téléphone 390, tablette 820, bureau 1280) pour juger le responsive.
// Usage : npx tsx src/captures-mobile.ts --base http://localhost:8080 --compte secretaire --mdp xxx --sortie dossier --routes /a,/b [--largeurs 390,820]
import puppeteer from 'puppeteer';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const arg = (n: string, d?: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : d; };
const BASE = arg('base', 'http://localhost:8080')!;
const SORTIE = resolve(arg('sortie', '../../var/captures-mobile')!);
const compte = arg('compte', 'secretaire')!;
const mdp = arg('mdp') ?? process.env['GS_MDP'] ?? '';
const parent = arg('parent') === '1';
const routes = (arg('routes', '/tableau-de-bord')!).split(',');
const largeurs = (arg('largeurs', '390,820,1280')!).split(',').map(Number);
mkdirSync(SORTIE, { recursive: true });

const nav = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
const page = await nav.newPage();
await page.evaluateOnNewDocument('globalThis.__name = (f) => f;');
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
await page.goto(`${BASE}/connexion`, { waitUntil: 'networkidle0' });
const champs = await page.$$('input');
await champs[0]!.type(compte);
await champs[1]!.type(mdp);
await Promise.all([page.waitForNavigation({ timeout: 15000 }).catch(() => null), page.keyboard.press('Enter')]);
await page.waitForNetworkIdle({ idleTime: 500 }).catch(() => null);
if (/connexion$/.test(new URL(page.url()).pathname)) { console.error('connexion refusée'); process.exit(1); }
const problemes: string[] = [];
for (const l of largeurs) {
  await page.setViewport({ width: l, height: l < 500 ? 844 : 1180, deviceScaleFactor: 1, isMobile: l < 1000, hasTouch: l < 1000 });
  for (const r of routes) {
    await page.goto(`${BASE}${r}`, { waitUntil: 'domcontentloaded' });
    await page.waitForNetworkIdle({ idleTime: 500, timeout: 15000 }).catch(() => null);
    await page.waitForFunction(() => !document.querySelector('.chargement'), { timeout: 8000 }).catch(() => null);
    const etat = await page.evaluate(() => {
      const deb = document.documentElement.scrollWidth - document.documentElement.clientWidth;
      const petits = [...document.querySelectorAll('button, a, input, select, [role="button"]')].filter((e) => {
        const b = (e as HTMLElement).getBoundingClientRect();
        return b.width > 0 && b.height > 0 && (b.height < 40 || b.width < 40) && (e as HTMLElement).offsetParent !== null && !e.closest('kbd');
      }).length;
      const sansLibelle = [...document.querySelectorAll('button, a')].filter((e) => !(e.textContent ?? '').trim() && !e.getAttribute('aria-label') && !e.getAttribute('title')).length;
      return { debordement: deb, petits, sansLibelle };
    });
    const nom = `${l}-${r.replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '') || 'accueil'}`;
    await page.screenshot({ path: resolve(SORTIE, `${nom}.png`), fullPage: true });
    const p: string[] = [];
    if (etat.debordement > 0) p.push(`débordement horizontal de ${etat.debordement}px`);
    if (etat.petits) p.push(`${etat.petits} cibles tactiles < 40px`);
    if (etat.sansLibelle) p.push(`${etat.sansLibelle} boutons ou liens sans libellé accessible`);
    console.log(`${String(l).padStart(4)} ${r.padEnd(32)} ${p.length ? p.join(' · ') : 'ok'}`);
    if (p.length) problemes.push(`${l} ${r}: ${p.join(' · ')}`);
  }
}
await nav.close();
console.log(`\nCaptures : ${SORTIE}`);
process.exitCode = problemes.length ? 1 : 0;
