// Joue la procédure de DEMO.md dans un vrai navigateur, à partir de la base vierge de « pnpm demo:vide » :
// neuf étapes, chacune avec le compte du rôle, comme pendant la démonstration en direct. Une capture par geste,
// et un fichier des comptes créés (identifiants et mots de passe affichés une seule fois par l'application).
// Usage : pnpm --filter @gs/controle exec tsx src/procedure.ts --base http://localhost:8080 --secretaire <mot de passe>
//         [--etapes 1,2,3] [--sortie dossier] [--etat fichier.json] [--comptes ../../COMPTES-DEMO.md]
import puppeteer, { type Browser, type BrowserContext, type Page } from 'puppeteer';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const arg = (n: string, d?: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : d; };
const BASE = arg('base', 'http://localhost:8080')!;
// État et captures dans var/ : ils contiennent des mots de passe et ne vont jamais au dépôt.
const SORTIE = resolve(arg('sortie', resolve(process.cwd(), '../../var/procedure'))!);
const ETAT = resolve(arg('etat', resolve(SORTIE, 'etat.json'))!);
const ETAPES = (arg('etapes', '1,2,3,4,5,6,7,8,9')!).split(',').map(Number);
mkdirSync(SORTIE, { recursive: true });

interface Compte { role: string; nom: string; identifiant: string; motDePasse: string; ou: string }
interface Etat { comptes: Compte[]; famille?: { telephone: string; motDePasse: string; nom: string }; etapes: number[] }
const etat: Etat = existsSync(ETAT) ? JSON.parse(readFileSync(ETAT, 'utf8')) : { comptes: [], etapes: [] };
const garder = () => writeFileSync(ETAT, JSON.stringify(etat, null, 2), { mode: 0o600 });
if (!etat.comptes.some((c) => c.identifiant === 'secretaire')) {
  etat.comptes.push({ role: 'Secrétaire', nom: 'Mme NDZANA Rose', identifiant: 'secretaire', motDePasse: arg('secretaire') ?? '', ou: 'bureau' });
}
const compte = (id: string) => etat.comptes.find((c) => c.identifiant === id) ?? (() => { throw new Error(`compte inconnu : ${id}`); })();

// ---------------------------------------------------------------- outils du navigateur

let n = 0;
let etape = 0;
const journal: string[] = [];
const dire = (t: string) => { const l = `[${etape}] ${t}`; journal.push(l); console.log(l); };
async function capture(p: Page, nom: string) { await p.screenshot({ path: `${SORTIE}/${etape}-${String(++n).padStart(3, '0')}-${nom}.png`, fullPage: true }); }
async function attendre(p: Page, ms = 400) {
  await p.waitForNetworkIdle({ idleTime: ms, timeout: 15_000 }).catch(() => null);
  await p.waitForFunction(() => !document.querySelector('.chargement'), { timeout: 10_000 }).catch(() => null);
}
/** Clique le dernier élément cliquable dont le texte vaut (ou contient) `texte` ; les fenêtres s'ouvrent en dernier. */
async function clic(p: Page, texte: string, o: { dans?: string; contient?: boolean } = {}) {
  const ok = await p.evaluate((t, dans, contient) => {
    const zone = dans ? [...document.querySelectorAll(dans)].pop() : document.body;
    if (!zone) return false;
    const els = [...zone.querySelectorAll('button, a, [role="menuitem"], [role="button"], .ligne-liste.cliquable, label.case, label.m-radio')] as HTMLElement[];
    const norm = (x: string) => x.replace(/\s+/g, ' ').trim();
    // Libellé sans les touches de raccourci (« Enregistrer » et non « Enregistrer Ctrl S »).
    const libelle = (e: HTMLElement) => { const c = e.cloneNode(true) as HTMLElement; c.querySelectorAll('kbd').forEach((k) => k.remove()); return norm(c.textContent ?? ''); };
    const visibles = els.filter((e) => e.offsetParent !== null && !(e as HTMLButtonElement).disabled);
    const cible = visibles.filter((e) => norm(e.innerText) === t || libelle(e) === t).pop()
      ?? (contient ? visibles.filter((e) => libelle(e).includes(t)).pop() : undefined);
    if (!cible) return false;
    cible.scrollIntoView({ block: 'center' });
    cible.click();
    return true;
  }, texte, o.dans ?? null, o.contient ?? false);
  if (!ok) throw new Error(`élément introuvable : « ${texte} »${o.dans ? ` dans ${o.dans}` : ''}`);
  await attendre(p);
}
async function idChamp(p: Page, libelle: string, rang = -1) {
  const id = await p.evaluate((l, r) => {
    const ls = [...document.querySelectorAll('label.libelle')].filter((x) => (x.textContent ?? '').trim() === l);
    const el = r < 0 ? ls[ls.length + r] : ls[r];
    return el?.getAttribute('for') ?? null;
  }, libelle, rang);
  if (!id) throw new Error(`champ introuvable : « ${libelle} »`);
  return `[id="${id}"]`;
}
async function saisir(p: Page, libelle: string, valeur: string, rang = -1) {
  const sel = await idChamp(p, libelle, rang);
  await p.$eval(sel, (e) => (e as HTMLElement).scrollIntoView({ block: 'center' }));
  await p.click(sel, { clickCount: 3 });
  await p.keyboard.down('Control'); await p.keyboard.press('a'); await p.keyboard.up('Control');
  await p.keyboard.press('Backspace');
  if (valeur) await p.type(sel, valeur);
}
async function saisirAria(p: Page, aria: string, valeur: string) {
  const sel = `[aria-label="${aria}"]`;
  await p.click(sel, { clickCount: 3 });
  await p.keyboard.press('Backspace');
  await p.type(sel, valeur);
}
async function choisir(p: Page, libelle: string, option: string, rang = -1) {
  const sel = await idChamp(p, libelle, rang);
  const r = await p.$eval(sel, (s, o) => {
    const opts = [...(s as HTMLSelectElement).options];
    const opt = opts.find((x) => (x.textContent ?? '').trim() === o) ?? opts.find((x) => (x.textContent ?? '').includes(o));
    if (!opt) return opts.map((x) => x.textContent).join(' | ');
    const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!;
    set.call(s, opt.value);
    s.dispatchEvent(new Event('change', { bubbles: true }));
    return 'ok';
  }, option);
  if (r !== 'ok') throw new Error(`option « ${option} » absente de « ${libelle} » : ${r}`);
  await attendre(p);
}
async function bascule(p: Page, texte: string) {
  const ok = await p.evaluate((t) => {
    const b = [...document.querySelectorAll('.bascules button')].filter((x) => (x.textContent ?? '').trim() === t).pop() as HTMLButtonElement | undefined;
    if (!b) return false;
    b.click();
    return true;
  }, texte);
  if (!ok) throw new Error(`bascule introuvable : « ${texte} »`);
  await attendre(p);
}
const texte = (p: Page, sel = 'body') => p.$eval(sel, (e) => (e as HTMLElement).innerText).catch(() => '');
const fenetre = (p: Page) => texte(p, '.voile:last-of-type');
async function infoFenetre(p: Page, etiquette: string) {
  return p.evaluate((e) => {
    const v = [...document.querySelectorAll('.voile')].pop();
    const bloc = v ? [...v.querySelectorAll('.info-caps')].find((x) => (x.querySelector('.etiquette')?.textContent ?? '').trim() === e) : null;
    return bloc?.querySelector('.valeur')?.textContent?.trim() ?? null;
  }, etiquette);
}
async function verifier(p: Page, attendu: string | RegExp, ou = 'body') {
  const t = await texte(p, ou);
  const ok = typeof attendu === 'string' ? t.includes(attendu) : attendu.test(t);
  if (!ok) throw new Error(`attendu à l'écran : ${attendu}`);
  dire(`  ✓ ${attendu}`);
}
async function aller(p: Page, chemin: string) { await p.goto(`${BASE}${chemin}`, { waitUntil: 'domcontentloaded' }); await attendre(p, 600); }

let navigateur: Browser;
async function session(identifiant: string, o: { mobile?: boolean; parent?: boolean } = {}): Promise<{ ctx: BrowserContext; p: Page }> {
  const ctx = await navigateur.createBrowserContext();
  const p = await ctx.newPage();
  // Reçus et documents s'ouvrent dans un nouvel onglet (PDF) : le PDF est produit, puis l'onglet se ferme.
  ctx.on('targetcreated', (t) => {
    void t.page().then((pg) => {
      if (!pg || pg === p) return;
      setTimeout(() => { dire(`  (document ouvert : ${pg.url().replace(BASE, '')})`); void pg.close().catch(() => null); }, 1500);
    }).catch(() => null);
  });
  await p.evaluateOnNewDocument('globalThis.__name = (f) => f; window.print = () => {};');
  await p.setViewport(o.mobile || o.parent ? { width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true } : { width: 1440, height: 900 });
  p.on('pageerror', (e) => dire(`  ! erreur de la page : ${String(e).split('\n')[0]}`));
  p.on('response', (r) => {
    const u = new URL(r.url());
    if (u.pathname.startsWith('/api/') && r.status() >= 400 && !(r.status() === 401 && u.pathname.endsWith('/auth/moi'))) dire(`  ! API ${r.status()} ${r.request().method()} ${u.pathname}`);
  });
  if (o.parent) {
    const f = etat.famille!;
    await aller(p, '/parent/connexion');
    const champs = await p.$$('input');
    await champs[0]!.type(f.telephone);
    await champs[1]!.type(f.motDePasse);
  } else {
    const c = compte(identifiant);
    await aller(p, o.mobile ? '/instituteur/connexion' : '/connexion');
    await saisir(p, 'Identifiant', c.identifiant);
    await saisir(p, 'Mot de passe', c.motDePasse);
  }
  await Promise.all([p.waitForNavigation({ timeout: 15_000 }).catch(() => null), p.keyboard.press('Enter')]);
  await attendre(p, 600);
  if (/connexion$/.test(new URL(p.url()).pathname)) throw new Error(`connexion refusée pour ${identifiant}`);
  dire(`connexion : ${identifiant}${o.mobile || o.parent ? ' (téléphone)' : ''}`);
  return { ctx, p };
}

// ---------------------------------------------------------------- données de la démonstration

const PERSONNEL: [string, string, string, string, string, string][] = [
  // nom affiché, fonction (libellé de la liste), statut, téléphone, identifiant, rôle
  ['Mme ATEBA Marie-Claire', 'Directeur', 'Permanent', '600 000 201', 'directrice', 'Directeur'],
  ['M. MBIDA Paul', 'Économe', 'Permanent', '600 000 202', 'econome', 'Économe'],
  ['M. NKOULOU Gérard', 'Préfet des études', 'Permanent', '600 000 204', 'prefet', 'Préfet des études'],
  ['M. ONANA Bertrand', 'Instituteur principal', 'Permanent', '600 000 211', 'onana.b', 'Instituteur principal'],
  ['M. ESSAMA Luc', 'Instituteur de matière', 'Vacataire', '600 000 212', 'essama.l', 'Instituteur de matière'],
];
const NIVEAUX: [string, number[], number[]][] = [
  // niveau, montants nouveaux élèves, montants anciens élèves (inscription, tranches 1 à 3)
  ['SIL', [10000, 20000, 18000, 12000], [8000, 20000, 18000, 12000]],
  ['CP', [10000, 20000, 18000, 12000], [8000, 20000, 18000, 12000]],
  ['CE1', [10000, 25000, 20000, 15000], [8000, 25000, 20000, 15000]],
  ['CE2', [10000, 25000, 20000, 15000], [8000, 25000, 20000, 15000]],
  ['CM1', [10000, 28000, 22000, 15000], [8000, 28000, 22000, 15000]],
  ['CM2', [12000, 30000, 25000, 18000], [10000, 30000, 25000, 18000]],
];
const ELEVES: { nom: string; prenoms: string; sexe: string; naissance: string; lieu: string; niveau: string; classe: string; resp: string; lien: string; tel: string; verse: number }[] = [
  { nom: 'FOUDA', prenoms: 'Junior', sexe: 'Garçon', naissance: '14/03/2015', lieu: 'Yaoundé', niveau: 'CM2', classe: 'CM2 A', resp: 'Mme FOUDA Brigitte', lien: 'Mère', tel: '600 000 301', verse: 17000 },
  { nom: 'FOUDA', prenoms: 'Grâce', sexe: 'Fille', naissance: '02/06/2021', lieu: 'Yaoundé', niveau: 'SIL', classe: 'SIL A', resp: 'Mme FOUDA Brigitte', lien: 'Mère', tel: '600 000 301', verse: 10000 },
  { nom: 'NGONO', prenoms: 'Esther', sexe: 'Fille', naissance: '22/01/2015', lieu: 'Mbalmayo', niveau: 'CM2', classe: 'CM2 A', resp: 'M. NGONO Paul', lien: 'Père', tel: '600 000 302', verse: 42000 },
  { nom: 'BELINGA', prenoms: 'Kevin', sexe: 'Garçon', naissance: '09/09/2014', lieu: 'Obala', niveau: 'CM2', classe: 'CM2 A', resp: 'Mme BELINGA Rose', lien: 'Mère', tel: '600 000 303', verse: 12000 },
];
const NOTES: Record<string, Record<string, string>> = {
  'Mathématiques': { 'BELINGA Kevin': '11', 'FOUDA Junior': '14,5', 'NGONO Esther': '16' },
  'Français': { 'BELINGA Kevin': '9,5', 'FOUDA Junior': '13', 'NGONO Esther': '15' },
  'EPS': { 'BELINGA Kevin': '15', 'FOUDA Junior': '16', 'NGONO Esther': '14' },
};

// ---------------------------------------------------------------- étapes

async function etape1() {
  const { ctx, p } = await session('secretaire');
  await aller(p, '/parametres/etablissement');
  await capture(p, 'etablissement-vierge');
  await saisir(p, 'Devise', 'Travail · Discipline · Réussite');
  await saisir(p, 'Ville et boîte postale', 'Yaoundé · BP 1234');
  await saisir(p, 'Téléphone', '600 000 200');
  await saisir(p, 'Réductions sans validation jusqu’à (FCFA)', '10000');
  await saisir(p, 'Signataire des documents', 'Mme ATEBA Marie-Claire, directrice');
  await clic(p, 'Enregistrer', { contient: true });
  dire('identité et seuil de réduction (10 000 FCFA) enregistrés');
  await clic(p, 'Créer l’année scolaire');
  await saisir(p, 'Du', '07/09/2026');
  await saisir(p, 'Au', '25/06/2027');
  await capture(p, 'annee');
  await clic(p, 'Créer l’année', { dans: '.voile' });
  await clic(p, 'Ouvrir');
  await clic(p, 'Ouvrir l’année', { dans: '.voile' });
  await verifier(p, 'Ouverte');
  await clic(p, 'Ajouter un cycle');
  await bascule(p, 'Francophone');
  await bascule(p, 'Primaire');
  await capture(p, 'cycle');
  await clic(p, 'Ajouter le cycle', { dans: '.voile' });
  await verifier(p, 'Francophone');
  await capture(p, 'etablissement-parametre');

  await aller(p, '/personnel');
  for (const [nom, fonction, statut, tel, identifiant, role] of PERSONNEL) {
    await clic(p, 'Nouvelle fiche', { contient: true });
    await saisir(p, 'Nom affiché', nom);
    await choisir(p, 'Fonction', fonction);
    await bascule(p, statut);
    await saisir(p, 'Téléphone', tel);
    await clic(p, 'Créer la fiche', { dans: '.voile' });
    await clic(p, 'Créer son compte');
    await saisir(p, 'Identifiant de connexion', identifiant);
    const coches = await p.evaluate(() => [...document.querySelectorAll('.voile label.case')].filter((l) => (l.querySelector('input') as HTMLInputElement).checked).map((l) => (l.textContent ?? '').trim()));
    if (!coches.includes(role)) await clic(p, role, { dans: '.voile' });
    await capture(p, `compte-${identifiant}`);
    await clic(p, 'Créer le compte', { dans: '.voile' });
    const mdp = await infoFenetre(p, 'Mot de passe');
    if (!mdp) throw new Error(`mot de passe non affiché pour ${identifiant}`);
    etat.comptes = etat.comptes.filter((c) => c.identifiant !== identifiant);
    etat.comptes.push({ role, nom, identifiant, motDePasse: mdp, ou: ['onana.b'].includes(identifiant) ? 'bureau et téléphone' : 'bureau' });
    garder();
    dire(`compte créé : ${identifiant} (${role})`);
    await clic(p, 'J’ai noté le mot de passe', { dans: '.voile' });
  }
  await capture(p, 'personnel');
  await aller(p, '/parametres/utilisateurs');
  await capture(p, 'utilisateurs');
  await ctx.close();

  // Préparation des frais par l'économe
  const e = await session('econome');
  await aller(e.p, '/finances/grille');
  for (const tarif of ['Nouveaux élèves', 'Anciens élèves']) {
    await bascule(e.p, tarif);
    for (const [i, d] of ['07/09/2026', '30/09/2026', '30/11/2026', '31/01/2027'].entries()) await saisirAria(e.p, `Date limite ${i + 1}`, d);
    for (const [niveau, nouveaux, anciens] of NIVEAUX) {
      const m = tarif === 'Nouveaux élèves' ? nouveaux : anciens;
      for (const [k, t] of ['Inscription', 'Tranche 1', 'Tranche 2', 'Tranche 3'].entries()) await saisirAria(e.p, `${niveau} · ${t}`, String(m[k]));
    }
    await clic(e.p, 'Enregistrer', { contient: true });
    await verifier(e.p, 'Grille enregistrée');
    await capture(e.p, `grille-${tarif.split(' ')[0]!.toLowerCase()}`);
  }
  await e.ctx.close();
}

async function etape2() {
  const { ctx, p } = await session('secretaire');
  await aller(p, '/parametres/etablissement');
  for (const niveau of ['SIL', 'CE2', 'CM2']) {
    await clic(p, 'Ajouter une classe');
    await choisir(p, 'Niveau', niveau);
    await clic(p, 'Ajouter la classe', { dans: '.voile', contient: true }).catch(async () => clic(p, 'Ajouter', { dans: '.voile' }));
  }
  await verifier(p, 'CM2 A');
  await capture(p, 'classes');

  for (const e of ELEVES) {
    await aller(p, '/scolarite/inscription');
    await saisir(p, 'Nom', e.nom);
    await saisir(p, 'Prénoms', e.prenoms);
    await choisir(p, 'Sexe', e.sexe);
    await saisir(p, 'Date de naissance', e.naissance);
    await saisir(p, 'Lieu de naissance', e.lieu);
    await saisir(p, 'Nom du responsable 1', e.resp);
    await choisir(p, 'Lien', e.lien, 0);
    await saisir(p, 'Téléphone', e.tel, 0);
    await attendre(p, 800);
    await choisir(p, 'Sous-système', 'Francophone');
    await choisir(p, 'Niveau', e.niveau);
    await choisir(p, 'Classe', e.classe);
    await choisir(p, 'Type', 'Nouvelle');
    await capture(p, `inscription-${e.prenoms.toLowerCase()}`);
    await clic(p, 'Enregistrer l\'inscription', { contient: true });
    const titre = await fenetre(p);
    if (!/Élève inscrit/.test(titre)) throw new Error(`inscription de ${e.nom} ${e.prenoms} : ${titre || (await texte(p)).slice(0, 300)}`);
    const mdp = await infoFenetre(p, 'Mot de passe');
    if (mdp && e.tel === '600 000 301') { etat.famille = { telephone: e.tel, motDePasse: mdp, nom: 'Famille FOUDA' }; garder(); }
    if (mdp) etat.comptes = etat.comptes.filter((c) => c.identifiant !== e.tel);
    if (mdp) { etat.comptes.push({ role: 'Parent', nom: `Famille ${e.nom}`, identifiant: e.tel, motDePasse: mdp, ou: 'téléphone' }); garder(); }
    dire(`inscrit : ${e.nom} ${e.prenoms} en ${e.classe}${mdp ? ` · compte famille ${e.tel} créé` : ' · famille reconnue, même compte'}`);
    await capture(p, `inscrit-${e.prenoms.toLowerCase()}`);
    await clic(p, 'Continuer', { dans: '.voile' }).catch(() => clic(p, 'Fermer', { dans: '.voile' }));
  }
  await aller(p, '/messages/annonces');
  await saisir(p, 'Titre', 'Réunion des parents');
  await saisir(p, 'Texte en français', 'Réunion des parents le samedi 14 novembre à 10 h, dans la salle polyvalente.');
  await saisir(p, 'Text in English', 'Parents’ meeting on Saturday 14 November at 10 a.m., in the main hall.');
  await capture(p, 'annonce');
  await clic(p, 'Publier');
  await verifier(p, 'Réunion des parents');
  await capture(p, 'annonce-publiee');
  await ctx.close();
}

async function etape3() {
  const { ctx, p } = await session('econome');
  await aller(p, '/finances/caisse');
  await saisir(p, 'Fonds initial (FCFA)', '20000');
  await clic(p, 'Ouvrir la session');
  await capture(p, 'session-ouverte');
  for (const e of ELEVES) {
    await aller(p, '/finances/caisse');
    await clic(p, 'Encaisser un élève', { contient: true });
    await p.type('[aria-label="Rechercher un élève"]', `${e.nom} ${e.prenoms}`);
    await attendre(p, 600);
    await clic(p, `${e.nom} ${e.prenoms}`, { dans: '.voile', contient: true });
    await p.waitForSelector('#montant-verse', { timeout: 10_000 });
    await p.click('#montant-verse', { clickCount: 3 });
    await p.type('#montant-verse', String(e.verse));
    await capture(p, `encaissement-${e.prenoms.toLowerCase()}`);
    await clic(p, 'Valider et imprimer', { contient: true });
    await p.waitForFunction(() => location.pathname.startsWith('/finances/recus/'), { timeout: 15_000 });
    await attendre(p, 600);
    await verifier(p, 'REÇU DE PAIEMENT');
    dire(`encaissé : ${e.verse} FCFA pour ${e.nom} ${e.prenoms}`);
    await capture(p, `recu-${e.prenoms.toLowerCase()}`);
  }
  // Réduction au-delà du seuil pour FOUDA Junior : demande au directeur.
  await aller(p, '/scolarite/eleves');
  await clic(p, 'FOUDA Junior', { contient: true });
  await clic(p, 'Accorder une réduction');
  await saisir(p, 'Montant de la réduction (FCFA)', '15000');
  await saisir(p, 'Motif', 'Cas social : perte d’emploi du père');
  await capture(p, 'reduction');
  await clic(p, 'Valider', { dans: '.voile' });
  await verifier(p, 'Demande envoyée au directeur');
  await capture(p, 'fiche-apres-reduction');
  await aller(p, '/finances/impayes');
  await capture(p, 'impayes');
  await ctx.close();
}

async function etape4() {
  const { ctx, p } = await session('prefet');
  await aller(p, '/pedagogie/matieres');
  await choisir(p, 'Niveau', 'CM2');
  for (const [fr, en, ab, abEn, coef] of [['Mathématiques', 'Mathematics', 'Maths', 'Maths', '4'], ['Français', 'French', '', '', '4'], ['Éducation physique et sportive', 'Physical education', 'EPS', 'PE', '1']]) {
    await clic(p, 'Ajouter une matière');
    await saisir(p, 'Matière', fr!);
    await saisir(p, 'Subject', en!);
    if (ab) { await saisir(p, 'Abrégé', ab); await saisir(p, 'Abrégé en anglais', abEn!); }
    await saisir(p, 'Coef.', coef!);
    await clic(p, 'Ajouter', { dans: '.voile' });
    dire(`matière ajoutée : ${fr}`);
  }
  for (const [matiere, inst] of [['Toutes les matières : instituteur principal', 'M. ONANA Bertrand'], ['Éducation physique et sportive', 'M. ESSAMA Luc']]) {
    await clic(p, 'Affecter', { contient: false }).catch(async () => clic(p, 'Affecter un instituteur'));
    await choisir(p, 'Classe', 'CM2 A');
    await choisir(p, 'Matière', matiere!);
    await choisir(p, 'Instituteur', inst!);
    await clic(p, 'Enregistrer', { dans: '.voile' });
    dire(`affecté : ${inst} · ${matiere}`);
  }
  await capture(p, 'matieres');
  await aller(p, '/pedagogie/notes');
  await choisir(p, 'Classe', 'CM2 A');
  await clic(p, 'Ouvrir la saisie');
  await clic(p, 'Ouvrir la saisie', { dans: '.voile' });
  dire('saisie de la séquence ouverte');
  await capture(p, 'saisie-ouverte');
  await ctx.close();

  // L'instituteur principal place les cours de sa classe et les soumet au préfet.
  const ip = await session('onana.b');
  await aller(ip.p, '/emploi-du-temps');
  const plan: [string, number, string][] = [
    ['Lundi', 0, 'Mathématiques'], ['Lundi', 1, 'Français'], ['Mardi', 0, 'Français'], ['Mardi', 1, 'Mathématiques'],
    ['Mercredi', 0, 'Mathématiques'], ['Mercredi', 1, 'Éducation physique et sportive'], ['Mercredi', 2, 'Français'],
    ['Jeudi', 0, 'Français'], ['Jeudi', 1, 'Mathématiques'], ['Vendredi', 0, 'Mathématiques'], ['Vendredi', 1, 'Éducation physique et sportive'],
  ];
  for (const [jour, rang, matiere] of plan) {
    const ok = await ip.p.evaluate((j, r) => {
      const table = [...document.querySelectorAll('table')].find((t) => (t.textContent ?? '').includes('Lundi'));
      if (!table) return 'table';
      const entetes = [...table.querySelectorAll('thead th')].map((x) => (x.textContent ?? '').trim());
      const col = entetes.findIndex((h) => h.startsWith(j));
      const lignes = [...table.querySelectorAll('tbody tr')].map((tr) => tr.children[col]?.querySelector('button[title="Placer un cours"]')).filter(Boolean) as HTMLButtonElement[];
      const b = lignes[r];
      if (!b) return `case ${j} ${r} absente (${lignes.length})`;
      b.click();
      return 'ok';
    }, jour, rang);
    if (ok !== 'ok') throw new Error(`emploi du temps : ${ok}`);
    await attendre(ip.p);
    await choisir(ip.p, 'Matière', matiere);
    await clic(ip.p, 'Placer', { dans: '.voile' });
  }
  await capture(ip.p, 'edt-place');
  await clic(ip.p, 'Soumettre au préfet', { contient: true });
  dire('emploi du temps de CM2 A soumis au préfet');
  await ip.ctx.close();

  const pr = await session('prefet');
  await aller(pr.p, '/emploi-du-temps');
  await choisir(pr.p, 'Classe', 'CM2 A');
  await clic(pr.p, 'Valider et publier', { contient: true });
  await verifier(pr.p, 'Emploi du temps publié');
  await capture(pr.p, 'edt-publie');
  await pr.ctx.close();
}

async function saisirNotesMobile(p: Page, matiere: string) {
  const notes = NOTES[matiere === 'Éducation physique et sportive' ? 'EPS' : matiere]!;
  const lignes = await p.$$eval('input[data-note]', (xs) => xs.map((x) => (x as HTMLInputElement).getAttribute('aria-label') ?? (x.closest('[data-eleve]') as HTMLElement | null)?.dataset['eleve'] ?? ''));
  const champs = await p.$$('input[data-note]:not([readonly])');
  for (const [i, c] of champs.entries()) {
    const etiquette = lignes[i] ?? '';
    const nom = Object.keys(notes).find((k) => etiquette.includes(k)) ?? Object.keys(notes)[i]!;
    await c.click({ clickCount: 3 });
    await c.type(notes[nom]!);
  }
}

async function etape5() {
  const { ctx, p } = await session('onana.b', { mobile: true });
  await capture(p, 'mes-classes');
  for (const matiere of ['Mathématiques', 'Français']) {
    await aller(p, '/instituteur/notes');
    // La grille reprend le dernier choix gardé sur le téléphone : Retour mène à « Mes classes ».
    if (await p.$('input[data-note]')) { await p.click('[aria-label="Retour"]'); await attendre(p); }
    await clic(p, matiere, { contient: true });
    await p.waitForSelector('input[data-note]', { timeout: 10_000 });
    if (matiere === 'Français') {
      await p.setOfflineMode(true);
      dire('téléphone hors connexion');
    }
    await saisirNotesMobile(p, matiere);
    await capture(p, `notes-${matiere.toLowerCase()}`);
    await clic(p, 'Enregistrer sur le téléphone', { contient: true });
    if (matiere === 'Français') {
      await verifier(p, /Hors ligne/);
      await capture(p, 'hors-ligne');
      await p.setOfflineMode(false);
      dire('réseau rétabli');
      await p.waitForFunction(() => /synchronisation faite/i.test(document.body.innerText), { timeout: 45_000 }).catch(() => null);
      await attendre(p, 800);
      await capture(p, 'synchronise');
    }
    dire(`notes de ${matiere} enregistrées`);
  }
  await aller(p, '/instituteur/appel');
  await capture(p, 'appel');
  const boutons = await p.$$('button');
  let absent = false;
  for (const b of boutons) {
    const t = (await b.evaluate((x) => x.textContent ?? '')).trim();
    if (t === 'A' && !absent) { await b.click(); absent = true; }
  }
  await attendre(p);
  await clic(p, 'Enregistrer l\'appel', { contient: true });
  await capture(p, 'appel-enregistre');
  dire('appel enregistré, un absent');
  await ctx.close();
}

async function etape6() {
  const { ctx, p } = await session('essama.l');
  await aller(p, '/pedagogie/notes');
  await capture(p, 'vue-instituteur-matiere');
  const champs = await p.$$('input.champ:not([readonly])');
  const notes = Object.values(NOTES['EPS']!);
  let k = 0;
  for (const c of champs) {
    const aria = await c.evaluate((x) => x.getAttribute('aria-label') ?? '');
    if (!/note/i.test(aria) || k >= notes.length) continue;
    await c.click({ clickCount: 3 });
    await c.type(notes[k++]!);
  }
  dire(`${k} notes d'EPS saisies`);
  await clic(p, 'Enregistrer');
  await verifier(p, /enregistr/i);
  await capture(p, 'eps-enregistre');
  await aller(p, '/finances/caisse');
  dire(`adresse hors de ses droits /finances/caisse → ${new URL(p.url()).pathname}`);
  await capture(p, 'hors-droits');
  await ctx.close();
}

async function etape7() {
  const ip = await session('onana.b');
  await aller(ip.p, '/pedagogie/fusion');
  await capture(ip.p, 'fusion');
  await clic(ip.p, 'Calculer les notes finales', { contient: true });
  await clic(ip.p, 'Transmettre au préfet', { contient: true });
  await verifier(ip.p, 'transmises');
  dire('notes transmises au préfet');
  await ip.ctx.close();

  const { ctx, p } = await session('prefet');
  await aller(p, '/pedagogie/bulletins');
  await choisir(p, 'Classe', 'CM2 A');
  await clic(p, 'Recalculer', { contient: true }).catch(() => dire('  (pas de bouton Recalculer)'));
  await capture(p, 'bulletins');
  await clic(p, 'Publier les 3 bulletins', { contient: true });
  await clic(p, 'Publier', { dans: '.voile' });
  await verifier(p, 'Bulletins publiés');
  await capture(p, 'bulletins-publies');
  await ctx.close();
}

async function etape8() {
  const { ctx, p } = await session('', { parent: true });
  await capture(p, 'accueil');
  await aller(p, '/parent/notes');
  await capture(p, 'notes-bloque');
  await aller(p, '/parent/paiements');
  await capture(p, 'paiements');
  await aller(p, '/parent/ecrire');
  await clic(p, 'Économe', { contient: true });
  await choisir(p, 'Au sujet de', 'Junior');
  await saisir(p, 'Votre message', 'Bonjour, je souhaite payer le reste de la tranche 1 en deux fois. Est-ce possible ? Merci.');
  await capture(p, 'ecrire');
  await clic(p, 'Envoyer', { contient: true });
  dire('message envoyé à l’économe');
  await capture(p, 'envoye');
  await ctx.close();
}

async function etape9() {
  const { ctx, p } = await session('directrice');
  await aller(p, '/finances/validations');
  await capture(p, 'a-valider');
  await clic(p, 'Valider');
  await clic(p, 'Valider', { dans: '.voile' }).catch(() => null);
  dire('réduction validée');
  await capture(p, 'reduction-validee');
  await aller(p, '/pedagogie/bulletins');
  await choisir(p, 'Classe', 'CM2 A');
  await clic(p, 'Voir les', { contient: true });
  await capture(p, 'bulletins-bloques');
  const leve = await p.evaluate(() => {
    const ligne = [...document.querySelectorAll('.ligne-liste')].find((l) => (l.textContent ?? '').includes('FOUDA Junior'));
    const b = ligne ? [...ligne.querySelectorAll('button')].find((x) => (x.textContent ?? '').includes('Lever le blocage')) as HTMLButtonElement | undefined : undefined;
    if (!b) return false;
    b.click();
    return true;
  });
  if (!leve) throw new Error('ligne « FOUDA Junior » sans bouton Lever le blocage');
  await attendre(p);
  await saisir(p, 'Motif', 'Engagement de la mère à solder avant le 30/11');
  await clic(p, 'Lever le blocage', { dans: '.voile' });
  dire('blocage levé');
  await capture(p, 'blocage-leve');
  await aller(p, '/parametres/audit');
  await capture(p, 'journal');
  await aller(p, '/pilotage/statistiques');
  await capture(p, 'pilotage');
  await aller(p, '/tableau-de-bord');
  await capture(p, 'tableau-de-bord');
  await ctx.close();
  const parent = await session('', { parent: true });
  await aller(parent.p, '/parent/notes');
  await capture(parent.p, 'bulletin-visible');
  await parent.ctx.close();
}

// ---------------------------------------------------------------- fichier des comptes

function ecrireComptes() {
  const chemin = resolve(arg('comptes', resolve(process.cwd(), '../../COMPTES-DEMO.md'))!);
  const OU: Record<string, string> = { 'bureau': 'PC : /connexion', 'bureau et téléphone': 'PC : /connexion · téléphone : /instituteur/connexion', 'téléphone': 'téléphone : /parent/connexion' };
  const sec = etat.comptes.find((c) => c.identifiant === 'secretaire');
  const lignes = [
    '# Comptes de la démonstration', '',
    'Fichier local : il ne quitte pas ce poste et n’entre jamais dans le dépôt (`.gitignore`). L’application ne montre chaque mot de passe qu’une fois ; ceux-ci ont été notés pendant la procédure de DEMO.md.', '',
    `Sur ce PC : ${BASE} · sur un téléphone du même Wi-Fi : l’adresse affichée par \`pnpm demo:lancer\`.`, '',
    '## 1. Base actuelle : la démonstration jouée (sauvegarde « apres-demo »)', '',
    '| Rôle | Nom | Identifiant | Mot de passe | Connexion |', '|---|---|---|---|---|',
    ...etat.comptes.map((c) => `| ${c.role} | ${c.nom} | \`${c.identifiant}\` | \`${c.motDePasse}\` | ${OU[c.ou] ?? c.ou} |`), '',
    '## 2. Base vierge de départ (sauvegarde « depart »)', '',
    `Un seul compte : \`secretaire\`, mot de passe \`${sec?.motDePasse ?? ''}\`. Les autres comptes se créent à l’étape 1, avec de nouveaux mots de passe.`, '',
    '## 3. Base de répétition (sauvegarde « repetition », pnpm demo:fictif)', '',
    '| Rôle | Identifiant | Mot de passe |', '|---|---|---|',
    '| Directeur | `directrice` | `demo-directrice` |', '| Secrétaire | `secretaire` | `demo-secretaire` |', '| Économe | `econome` | `demo-econome` |',
    '| Préfet des études | `prefet` | `demo-prefet` |', '| Instituteur principal (CM2 A) | `onana.b` | `demo-onana` |', '| Instituteur principal (CE2 B) | `eyenga.s` | `demo-eyenga` |',
    '| Instituteur de matière (EPS) | `essama.l` | `demo-essama` |', '| Parent (famille KENFACK) | `600 000 055` | `demo-kenfack` |', '',
    '## Passer d’un état à l’autre', '', '```',
    'pnpm demo:restaurer depart --oui        base vierge, avant la démonstration',
    'pnpm demo:restaurer apres-demo --oui    démonstration jouée (section 1)',
    'pnpm demo:restaurer repetition --oui    école remplie (section 3)', '```', '',
  ];
  writeFileSync(chemin, lignes.join('\n'), { mode: 0o600 });
  console.log(`Comptes écrits dans ${chemin}`);
}

const ETAPES_F = [etape1, etape2, etape3, etape4, etape5, etape6, etape7, etape8, etape9];
navigateur = await puppeteer.launch({ headless: true, args: ['--no-sandbox'], protocolTimeout: 60_000 });
try {
  for (const k of ETAPES) {
    etape = k;
    n = 0;
    console.log(`\n=== Étape ${k}`);
    await ETAPES_F[k - 1]!();
    if (!etat.etapes.includes(k)) etat.etapes.push(k);
    garder();
  }
} catch (e) {
  dire(`ARRÊT : ${(e as Error).message}`);
  const pages = (await Promise.all(navigateur.browserContexts().map((c) => c.pages()))).flat();
  for (const p of pages.slice(-1)) await capture(p, 'arret').catch(() => null);
  process.exitCode = 1;
} finally {
  writeFileSync(resolve(SORTIE, `journal-${ETAPES.join('-')}.txt`), journal.join('\n'));
  ecrireComptes();
  await navigateur.close();
}
