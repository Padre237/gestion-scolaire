// pnpm demo:fictif — base de répétition : données inventées mais plausibles, proches des maquettes (prompt § 6).
// Tout passe par l'API (règles de gestion, numérotation sans trou, journal d'audit) ; les opérations passées sont
// ensuite ramenées à leur date par une « horloge » (seules les dates changent), pour une année déjà commencée.
// Les anciens élèves arrivent par l'import (comme au démarrage réel, IMPORT.md) avec le matricule de leur année d'entrée.
// Téléphones fictifs : 600 000 0xx à 600 000 3xx. Mots de passe de répétition « demo-… », affichés à la fin.
import { creerBase, lireOuCreerConfig, migrer, connexionProprietaire } from '@gs/db';
import { Bd, creerPool } from '@gs/api/src/core/bd.ts';
import { construireApp } from '@gs/api/src/app.ts';
import { creerEtablissement } from '@gs/api/src/core/etablissement.ts';
import { hacher } from '@gs/api/src/core/motdepasse.ts';
import { Client, connecter } from './client.ts';
import { demander, drapeau, sortir } from './commun.ts';
import { communication, pedagogie, vieScolaire } from './fictif-suite.ts';
import {
  ANNEE, AUJ, CLASSES, DATES_GRILLE, DEBUT, FIN, Horloge, RENTREE, aLHeure, choisir, entier, fr, hasard, hhmm, jourSemaine, joursOuvrables,
  minuteActuelle, motDePasseDemo, ouvrable, ouvrableAuPlus, ouvrableAvant, plusJours, type Contexte, type Eleve, type Famille, type Profil,
} from './fictif-outils.ts';

// ---------------------------------------------------------------- noms (inventés, plausibles au Cameroun)
const NOMS_FR = ['ABENA', 'AMOUGOU', 'ATANGANA', 'BELINGA', 'EBODE', 'EKANI', 'ESSOMBA', 'ETOUNDI', 'EWANE', 'KAMDEM', 'KENMOGNE', 'MBALLA',
  'MENDO', 'MOUKOKO', 'MVOGO', 'NANA', 'NDJOCK', 'NGONO', 'NKOA', 'NOAH', 'NTAMACK', 'OWONA', 'POUOKAM', 'SIMO', 'TAMO', 'TCHAMBA', 'WAFO',
  'YOUMBI', 'ZAMBO', 'NJOYA', 'EKWALLA', 'MANGA', 'ONDOA', 'NGUEMA', 'FOTSO', 'TAGNE', 'BIKOÏ', 'YONGA', 'WAMBA', 'ZANG', 'NGUEMO', 'BELLO'];
const NOMS_EN = ['ACHU', 'MBAH', 'NGWA', 'NJI', 'TABI', 'AWAH', 'NFOR', 'BIH', 'NKWAIN', 'CHE', 'AKO', 'NDIP', 'EBAI', 'TAMBE', 'ASHU', 'AYUK',
  'EGBE', 'ENOW', 'MUKETE', 'NJIE', 'FONDONG', 'NGANG', 'FONGANG', 'AKUM', 'NEBA', 'TITA', 'BAME', 'MOFOR', 'NGOH', 'ABUNAW'];
const PRENOMS = {
  fr: { M: ['Paul', 'Marc', 'Emmanuel', 'Ivan', 'Patrick', 'Junior', 'Arnaud', 'Yannick', 'Franck', 'Hervé', 'Cédric', 'Brice', 'Landry', 'Ulrich',
    'Christian', 'Rodrigue', 'Serge', 'Kevin', 'Joël', 'Willy', 'Romuald', 'Bruno', 'Thierry', 'Gaël', 'Stéphane', 'Didier', 'Fabrice', 'Arthur'],
    F: ['Ruth', 'Sandra', 'Gisèle', 'Mireille', 'Rose', 'Carine', 'Brenda', 'Laure', 'Sylvie', 'Nadège', 'Linda', 'Prisca', 'Danielle', 'Estelle',
      'Murielle', 'Vanessa', 'Chantal', 'Ornella', 'Larissa', 'Inès', 'Flore', 'Raïssa', 'Audrey', 'Joëlle', 'Christelle', 'Aminatou'] },
  en: { M: ['Collins', 'Brandon', 'Peter', 'Divine', 'Clinton', 'Godwill', 'Prince', 'Bryan', 'Nelson', 'Elvis', 'Derick', 'Wilson', 'Kelvin',
    'Ronald', 'Bertrand', 'Eric', 'Desmond', 'Leonel', 'Valery'],
    F: ['Grace', 'Precious', 'Mercy', 'Faith', 'Gladys', 'Belinda', 'Mary', 'Joy', 'Sharon', 'Doris', 'Vivian', 'Lilian', 'Nancy', 'Esther',
      'Hilda', 'Comfort', 'Patience', 'Ashley', 'Bridget', 'Blessing'] },
};
const ADULTES = { M: ['Albert', 'Jean', 'Pierre', 'Martin', 'Luc', 'Alain', 'Bernard', 'Daniel', 'Joseph', 'François', 'Thomas', 'Samuel', 'Ibrahim'],
  F: ['Pauline', 'Marie', 'Lucie', 'Denise', 'Judith', 'Thérèse', 'Martha', 'Agnès', 'Odile', 'Hélène', 'Monique', 'Esther', 'Rose', 'Juliette'] };
const ADULTES_EN = { M: ['Peter', 'John', 'Samuel', 'Emmanuel', 'George', 'Joseph', 'Francis'], F: ['Martha', 'Judith', 'Florence', 'Comfort', 'Grace', 'Mary', 'Agnes'] };
const VILLES = ['Yaoundé', 'Douala', 'Bafoussam', 'Bamenda', 'Buea', 'Ebolowa', 'Mbalmayo', 'Kribi', 'Limbé', 'Dschang', 'Bertoua', 'Nkongsamba'];
const NAISSANCE: Record<string, number> = { SIL: 2020, CP: 2019, CE1: 2018, CE2: 2017, CM1: 2016, CM2: 2015,
  'Class 1': 2020, 'Class 2': 2019, 'Class 3': 2018, 'Class 4': 2017, 'Class 5': 2016, 'Class 6': 2015 };
const GRILLE: Record<string, number[]> = {
  SIL: [10000, 20000, 18000, 12000], CP: [10000, 20000, 18000, 12000], CE1: [10000, 25000, 20000, 15000], CE2: [10000, 25000, 20000, 15000],
  CM1: [10000, 28000, 22000, 15000], CM2: [12000, 30000, 25000, 18000],
  'Class 1': [10000, 20000, 18000, 12000], 'Class 2': [10000, 20000, 18000, 12000], 'Class 3': [10000, 25000, 20000, 15000],
  'Class 4': [10000, 25000, 20000, 15000], 'Class 5': [10000, 28000, 22000, 15000], 'Class 6': [12000, 30000, 25000, 18000],
};

async function main() {
  const config = lireOuCreerConfig();
  console.log(`Base de répétition « ${config.pg.base} » : données fictives de l’année ${ANNEE}.`);
  if (!drapeau('oui')) {
    const ok = await demander(`La base « ${config.pg.base} » sera effacée puis recréée avec des données fictives. Tapez OUI pour continuer`);
    if (ok !== 'OUI') sortir('Rien n’a été modifié.', 0);
  }
  if (AUJ < plusJours(RENTREE, 45)) console.warn('Attention : la rentrée est récente, l’historique des paiements et des notes sera court.');
  await creerBase(config.pg, config.pg.base, true);
  await migrer(config.pg, config.pg.base, (m) => console.log(`  ${m}`));
  const pool = creerPool(config.pg);
  const bd = new Bd(pool);
  const proprio = connexionProprietaire(config.pg);
  await proprio.connect();
  const horloge = new Horloge(proprio);
  await horloge.preparer();
  const app = await construireApp({ bd, dossierWeb: '/inexistant', journal: false });
  await app.ready();
  const debut = Date.now();
  try {
    const parametrage = plusJours(RENTREE, -21);
    await horloge.a(aLHeure(parametrage, '08:30'), () => creerEtablissement(bd, { nomFr: 'Groupe scolaire bilingue La Ruche d’Or', nomEn: 'La Ruche d’Or Bilingual School',
      secretaire: { identifiant: 'secretaire', nomAffiche: 'Mme NDZANA Rose', motDePasse: 'demo-secretaire' } }));
    const sec = await connecter(app, 'secretaire', 'demo-secretaire');
    const ctx = { app, horloge, proprio, sec, comptes: {}, classes: {}, niveaux: {}, personnel: {}, matieres: {}, periodes: [], eleves: [], parents: {} } as unknown as Contexte;
    ctx.parNom = (nom: string) => ctx.eleves.find((e) => `${e.nom} ${e.prenoms}` === nom) ?? sortir(`Élève introuvable : ${nom}`);
    const etape = (t: string) => console.log(`${t}… (${Math.round((Date.now() - debut) / 1000)} s)`);

    etape('Établissement, année, classes et personnel');
    await parametrer(ctx, parametrage);
    etape('Grille des frais');
    await grille(ctx);
    etape('Matières et affectations');
    await pedagogie.parametrage(ctx);
    etape('Inscriptions : import des anciens, puis nouveaux élèves');
    await inscrire(ctx);
    etape('Versements, réductions, caisse et dépenses');
    await finances(ctx);
    etape('Emploi du temps, notes et cahier de textes');
    await pedagogie.suite(ctx);
    etape('Appels, absences et observations');
    await vieScolaire(ctx);
    etape('Annonces et messagerie');
    await communication(ctx);
    etape('Caisse du jour et relevé bancaire');
    await aujourdhui(ctx);
    await finaliser(ctx);
    console.log(`\nBase de répétition prête en ${Math.round((Date.now() - debut) / 1000)} s. Comptes de répétition (jamais ceux de la démonstration) :`);
    for (const [i, m] of [['directrice', 'demo-directrice'], ['secretaire', 'demo-secretaire'], ['econome', 'demo-econome'], ['prefet', 'demo-prefet'],
      ['onana.b', 'demo-onana'], ['eyenga.s', 'demo-eyenga'], ['essama.l', 'demo-essama'], ['600 000 055 (parent)', 'demo-kenfack']] as [string, string][]) console.log(`  ${i.padEnd(22)} ${m}`);
    console.log('Lancez ensuite : pnpm demo:lancer');
  } finally {
    await app.close();
    await proprio.end();
    await pool.end();
  }
}

// ---------------------------------------------------------------- étape 1 : établissement, année, classes, personnel
const ADMIN: [string, string, string, string, string][] = [
  ['directrice', 'Mme ATEBA Marie-Claire', 'directeur', 'directeur', '600 000 201'],
  ['econome', 'M. MBIDA Paul', 'econome', 'econome', '600 000 202'],
  ['prefet', 'M. NKOULOU Gérard', 'prefet', 'prefet', '600 000 204'],
];
export const MATIERE_SEULE: [string | null, string, string, string][] = [
  // identifiant (null : sans compte, maquette Personnel), nom, téléphone, diplôme
  [null, 'Mrs TANYI Rose', '600 000 221', 'Licence en lettres bilingues'],
  ['essama.l', 'M. ESSAMA Luc', '600 000 222', 'Brevet de professeur d’EPS'],
  ['fouda.s', 'M. FOUDA Serge', '600 000 223', 'Licence d’informatique'],
  ['fon.d', 'Mr FON Desmond', '600 000 225', 'Physical Education Certificate'],
];

async function parametrer(ctx: Contexte, jour: string) {
  const { sec, horloge } = ctx;
  await horloge.a(aLHeure(jour, '08:40'), async () => {
    await sec.put('/structure/etablissement', { nomFr: 'Groupe scolaire bilingue La Ruche d’Or', nomEn: 'La Ruche d’Or Bilingual School', devise: 'Travail · Discipline · Réussite',
      villeBp: 'Yaoundé · BP 1234', telephone: '600 000 200', signataire: 'La Directrice', banque: 'Banque de Yaoundé',
      numeroCompte: '00012 345678 90', seuilReduction: 5000 });
    await sec.post('/structure/annees', { libelle: ANNEE, dateDebut: RENTREE, dateFin: FIN, ouvrir: true });
    await sec.post('/structure/cycles', { sousSysteme: 'francophone', ordreEnseignement: 'primaire' });
    await sec.post('/structure/cycles', { sousSysteme: 'anglophone', ordreEnseignement: 'primaire' });
  });
  // Trimestres : le premier s'achève début décembre (composition le 30/11, maquette Notes).
  const etab = await sec.get<{ periodes: { id: string; ordre: number; libelleFr: string; libelleEn: string; sequences: string; trancheOrdre: number }[] }>('/structure/etablissement');
  const bornes = [[RENTREE, `${DEBUT}-12-04`], [`${DEBUT}-12-05`, `${DEBUT + 1}-03-19`], [`${DEBUT + 1}-03-20`, FIN]];
  await horloge.a(aLHeure(jour, '08:50'), async () => {
    for (const p of etab.periodes) {
      const [d, f] = bornes[p.ordre - 1]!;
      await sec.put(`/structure/periodes/${p.id}`, { libelleFr: p.libelleFr, libelleEn: p.libelleEn, dateDebut: d, dateFin: f, sequences: p.sequences, trancheOrdre: p.trancheOrdre });
    }
  });
  ctx.periodes = etab.periodes.map((p) => ({ id: p.id, ordre: p.ordre, dateDebut: bornes[p.ordre - 1]![0]!, dateFin: bornes[p.ordre - 1]![1]! }));
  for (const n of (await sec.get<{ id: string; code: string }[]>('/structure/niveaux'))) ctx.niveaux[n.code] = n.id;
  await horloge.a(aLHeure(jour, '09:10'), async () => {
    for (const c of CLASSES) ctx.classes[c.nom] = (await sec.post<{ id: string }>('/structure/classes', { niveauId: ctx.niveaux[c.niveau], nom: c.nom, effectifMax: 40 })).id;
  });
  // L'année suivante est en préparation : la grille peut y être copiée (maquette Frais).
  await horloge.a(aLHeure(plusJours(jour, 40), '10:00'), () => sec.post('/structure/annees', {
    libelle: `${DEBUT + 1}/${DEBUT + 2}`, dateDebut: `${DEBUT + 1}-09-06`, dateFin: `${DEBUT + 2}-06-23` }));

  const roles = await sec.get<{ id: string; code: string }[]>('/core/roles');
  const role = (c: string) => roles.find((r) => r.code === c)!.id;
  const fiches = await sec.get<{ lignes: { id: string; nomAffiche: string }[] }>('/personnel?taille=50');
  ctx.personnel['secretaire'] = fiches.lignes.find((f) => f.nomAffiche === 'Mme NDZANA Rose')!.id;
  const creer = async (identifiant: string | null, nom: string, fonction: string, statut: string, telephone: string, roleCode: string | null, diplome: string) => {
    const f = await sec.post<{ id: string }>('/personnel', { nomAffiche: nom, fonction, statut, telephone, diplome, entreeLe: RENTREE });
    ctx.personnel[identifiant ?? nom] = f.id;
    ctx.personnel[nom] = f.id;
    if (identifiant && roleCode) {
      await sec.post('/core/comptes', { identifiant, nomAffiche: nom, personnelId: f.id, roles: [{ roleId: role(roleCode) }], motDePasse: motDePasseDemo(identifiant) });
    }
  };
  await horloge.a(aLHeure(plusJours(jour, 1), '09:00'), async () => {
    await sec.patch(`/personnel/${ctx.personnel['secretaire']}`, { telephone: '600 000 203', diplome: 'BTS de secrétariat de direction', entreeLe: RENTREE });
    for (const [id, nom, fonction, roleCode, tel] of ADMIN) await creer(id, nom, fonction, 'permanent', tel, roleCode, 'Licence');
    for (const c of CLASSES) {
      const [id, nom, tel] = c.principal;
      await creer(id, nom, 'instituteur_principal', 'permanent', tel, 'instituteur_principal', c.niveau.startsWith('Class') ? 'Teacher Grade I Certificate' : 'CAPIEMP');
    }
    for (const [id, nom, tel, diplome] of MATIERE_SEULE) await creer(id, nom, 'instituteur_matiere', 'vacataire', tel, id ? 'instituteur_matiere' : null, diplome);
    await creer(null, 'M. ABENA Joseph', 'autre', 'permanent', '600 000 241', null, 'Surveillant général');
    await creer(null, 'Mme MOUKOKO Hélène', 'autre', 'vacataire', '600 000 242', null, 'Infirmière diplômée d’État');
    // Un compte peut cumuler plusieurs rôles (maquette Utilisateurs : Mme NGO Berthe, économe et secrétaire).
    const f = await sec.post<{ id: string }>('/personnel', { nomAffiche: 'Mme NGO Berthe', fonction: 'autre', statut: 'permanent', telephone: '600 000 205', diplome: 'BTS de comptabilité', entreeLe: RENTREE });
    ctx.personnel['ngo.b'] = f.id;
    await sec.post('/core/comptes', { identifiant: 'ngo.b', nomAffiche: 'Mme NGO Berthe', personnelId: f.id, roles: [{ roleId: role('econome') }, { roleId: role('secretaire') }], motDePasse: motDePasseDemo('ngo.b') });
  });
  ctx.dir = await connecter(ctx.app, 'directrice', 'demo-directrice');
  ctx.eco = await connecter(ctx.app, 'econome', 'demo-econome');
  ctx.pre = await connecter(ctx.app, 'prefet', 'demo-prefet');
  const parNomPersonnel: Record<string, Client> = {};
  for (const c of CLASSES) {
    ctx.comptes[c.principal[0]] = await connecter(ctx.app, c.principal[0], motDePasseDemo(c.principal[0]));
    parNomPersonnel[c.principal[1]] = ctx.comptes[c.principal[0]]!;
  }
  for (const [id, nom] of MATIERE_SEULE) if (id) { ctx.comptes[id] = await connecter(ctx.app, id, motDePasseDemo(id)); parNomPersonnel[nom] = ctx.comptes[id]!; }
  ctx.clientDe = (nom: string) => parNomPersonnel[nom];
}

// ---------------------------------------------------------------- étape 2 : grille des frais (économe)
async function grille(ctx: Contexte) {
  const anneeId = (await ctx.eco.get<{ anneeId: string }>('/finances/grille')).anneeId;
  await ctx.horloge.a(aLHeure(plusJours(RENTREE, -18), '11:20'), async () => {
    for (const tarif of ['nouveau', 'ancien'] as const) {
      await ctx.eco.put('/finances/grille', { anneeId, tarif, dates: DATES_GRILLE, lignes: Object.entries(GRILLE).map(([code, m]) => ({
        niveauId: ctx.niveaux[code], montants: tarif === 'nouveau' ? m : [m[0]! - 2000, ...m.slice(1)] })) });
    }
  });
}

// ---------------------------------------------------------------- étape 3 : élèves
// Téléphones des familles que nomment les maquettes : réservés avant tout tirage.
const PRIS = new Set<string>(['008', '012', '020', '031', '047', '055', '056', '063', '071', '084', '090', '102', '117', '125', '133', '141', '150', '158'].map((x) => `600 000 ${x}`));
let telephoneSuivant = 10;
function nouveauTelephone(): string {
  let t: string;
  do { t = `600 000 ${String(telephoneSuivant++).padStart(3, '0')}`; } while (PRIS.has(t));
  PRIS.add(t);
  return t;
}

function famille(nom: string, langue: 'fr' | 'en', payeur?: string, telephone?: string, lien?: 'mere' | 'pere'): Famille {
  const l = lien ?? (hasard() < 0.7 ? 'mere' : 'pere');
  const noms = langue === 'en' ? ADULTES_EN : ADULTES;
  if (telephone) PRIS.add(telephone);
  const f: Famille = { nom, telephone: telephone ?? nouveauTelephone(), payeur: payeur ?? `${nom} ${choisir(noms[l === 'mere' ? 'F' : 'M'])}`, lien: l, langue };
  if (hasard() < 0.45) f.second = { nom: `${nom} ${choisir(noms[l === 'mere' ? 'M' : 'F'])}`, telephone: nouveauTelephone(), lien: l === 'mere' ? 'pere' : 'mere' };
  return f;
}

/** Élèves que nomment les maquettes (Eleves, Classes, Appel, Notes, Impayés…), avec leur matricule et leur situation. */
function elevesNommes(): Eleve[] {
  const f = (nom: string, payeur: string, tel: string, lien: 'mere' | 'pere', langue: 'fr' | 'en' = 'fr') => famille(nom, langue, payeur, tel, lien);
  const kenfack: Famille = { nom: 'KENFACK', telephone: '600 000 055', payeur: 'KENFACK Pauline', lien: 'mere', langue: 'fr', second: { nom: 'KENFACK Albert', telephone: '600 000 056', lien: 'pere' } };
  const djomo = f('DJOMO', 'DJOMO Albert', '600 000 008', 'pere');
  const e = (nom: string, prenoms: string, sexe: 'M' | 'F', classe: string, fam: Famille, profil: Profil, type: Eleve['type'], naissance: string | null, matricule?: string): Eleve => {
    const niveau = CLASSES.find((c) => c.nom === classe)!.niveau;
    const n = naissance ?? `${NAISSANCE[niveau]! - (type === 'redoublement' ? 1 : 0)}-${String(entier(1, 12)).padStart(2, '0')}-${String(entier(1, 28)).padStart(2, '0')}`;
    return { nom, prenoms, sexe, classe, niveau, famille: fam, profil, type, naissance: n, lieu: choisir(VILLES), matricule, inscritLe: ouvrableApres(plusJours(RENTREE, -entier(4, 9))),
      niveauScolaire: 12 };
  };
  // Dates et matricules des maquettes (année 2026) ramenés à l'année scolaire en cours.
  const y = (d: string) => d.replace(/^(\d{4})/, (x) => String(Number(x) + DEBUT - 2026));
  const m = (mat: string) => mat.replace(/^(\d{2})/, (x) => String((Number(x) + DEBUT - 2026 + 100) % 100).padStart(2, '0'));
  const nommes: Eleve[] = [
    // CE2 B (maquettes Classes et Appel)
    e('AMOUGOU', 'Steve', 'M', 'CE2 B', f('AMOUGOU', 'AMOUGOU Jean', '600 000 031', 'pere'), 'fixe', 'reinscription', y('2017-08-22'), m('25FR0038')),
    e('ATANGANA', 'Paul', 'M', 'CE2 B', f('ATANGANA', 'ATANGANA Marie', '600 000 047', 'mere'), 'fixe', 'reinscription', y('2016-11-02'), m('25FR0044')),
    e('BIKOÏ', 'Laure', 'F', 'CE2 B', famille('BIKOÏ', 'fr'), 'bon', 'nouvelle', null),
    e('EWANE', 'Sandra', 'F', 'CE2 B', f('EWANE', 'EWANE Lucie', '600 000 133', 'mere'), 'fixe', 'reinscription', null, m('24FR0027')),
    e('KAMGA', 'Arthur', 'M', 'CE2 B', famille('KAMGA', 'fr'), 'bon', 'redoublement', null, m('25FR0051')),
    e('KENFACK', 'Steve', 'M', 'CE2 B', kenfack, 'fixe', 'nouvelle', y('2017-01-05')),
    e('MBALLA', 'Inès', 'F', 'CE2 B', famille('MBALLA', 'fr'), 'bon', 'nouvelle', null),
    e('NANA', 'Ulrich', 'M', 'CE2 B', famille('NANA', 'fr'), 'bon', 'reinscription', null, m('25FR0060')),
    e('NGONO', 'Mireille', 'F', 'CE2 B', famille('NGONO', 'fr'), 'solde', 'reinscription', null, m('24FR0033')),
    e('OWONA', 'Cédric', 'M', 'CE2 B', famille('OWONA', 'fr'), 'tardif', 'nouvelle', null),
    e('SIMO', 'Vanessa', 'F', 'CE2 B', famille('SIMO', 'fr'), 'bon', 'reinscription', null, m('25FR0066')),
    e('TALLA', 'Boris', 'M', 'CE2 B', famille('TALLA', 'fr'), 'fixe', 'nouvelle', null),
    e('YONGA', 'Fabrice', 'M', 'CE2 B', famille('YONGA', 'fr'), 'bon', 'reinscription', null, m('24FR0041')),
    // CM2 A (maquettes Notes, Bulletins, Conseil)
    e('ABENA', 'Christelle', 'F', 'CM2 A', f('ABENA', 'ABENA Rose', '600 000 012', 'mere'), 'fixe', 'nouvelle', y('2015-03-14')),
    e('BELLO', 'Aminatou', 'F', 'CM2 A', f('BELLO', 'BELLO Ibrahim', '600 000 020', 'pere'), 'fixe', 'nouvelle', y('2015-06-30')),
    e('DJOMO', 'Josiane', 'F', 'CM2 A', djomo, 'fixe', 'reinscription', y('2015-02-09'), m('24FR0031')),
    e('ESSOMBA', 'Ruth', 'F', 'CM2 A', f('ESSOMBA', 'ESSOMBA Luc', '600 000 150', 'pere'), 'fixe', 'reinscription', null, m('24FR0019')),
    e('FOKOU', 'Marc', 'M', 'CM2 A', f('FOKOU', 'FOKOU Denise', '600 000 102', 'mere'), 'fixe', 'nouvelle', null),
    e('FOTSO', 'Junior', 'M', 'CM2 A', famille('FOTSO', 'fr'), 'bon', 'reinscription', null, m('23FR0042')),
    e('NDI', 'Emmanuel', 'M', 'CM2 A', f('NDI', 'NDI Thérèse', '600 000 158', 'mere'), 'fixe', 'reinscription', null, m('24FR0036')),
    e('NGUEMO', 'Carine', 'F', 'CM2 A', famille('NGUEMO', 'fr'), 'solde', 'reinscription', null, m('22FR0017')),
    e('TAMO', 'Gisèle', 'F', 'CM2 A', famille('TAMO', 'fr'), 'bon', 'reinscription', null, m('23FR0025')),
    e('TCHOUA', 'Ivan', 'M', 'CM2 A', f('TCHOUA', 'TCHOUA Alain', '600 000 125', 'pere'), 'fixe', 'reinscription', null, m('24FR0044')),
    e('WAMBA', 'Estelle', 'F', 'CM2 A', famille('WAMBA', 'fr'), 'bon', 'reinscription', null, m('23FR0031')),
    e('ZANG', 'Didier', 'M', 'CM2 A', famille('ZANG', 'fr'), 'bon', 'reinscription', null, m('24FR0050')),
    // Autres classes (maquettes Eleves, Impayes, Caisse, Releve)
    e('DJOMO', 'Patrick', 'M', 'CM1 A', djomo, 'fixe', 'reinscription', y('2016-10-17'), m('25FR0012')),
    e('MBARGA', 'Aïcha', 'F', 'CM1 A', f('MBARGA', 'MBARGA Paul', '600 000 063', 'pere'), 'fixe', 'nouvelle', y('2016-12-25')),
    e('KENFACK', 'Loïc', 'M', 'SIL A', kenfack, 'fixe', 'nouvelle', y('2021-04-11')),
    e('ACHU', 'Blessing', 'F', 'Class 6', f('ACHU', 'ACHU Martha', '600 000 090', 'mere', 'en'), 'fixe', 'reinscription', y('2014-07-08'), m('24ANG0002')),
    e('NJI', 'Brandon', 'M', 'Class 2', f('NJI', 'NJI Florence', '600 000 071', 'mere', 'en'), 'fixe', 'nouvelle', y('2019-05-03')),
    e('TABI', 'Grace', 'F', 'Class 5', f('TABI', 'TABI Samuel', '600 000 084', 'pere', 'en'), 'fixe', 'reinscription', y('2015-09-19'), m('25ANG0015')),
    e('MBAH', 'Kevin', 'M', 'Class 3', f('MBAH', 'MBAH Judith', '600 000 141', 'mere', 'en'), 'fixe', 'reinscription', null, m('25ANG0019')),
    e('NGWA', 'Collins', 'M', 'Class 4', f('NGWA', 'NGWA Peter', '600 000 117', 'pere', 'en'), 'fixe', 'reinscription', null, m('24ANG0011')),
  ];
  // Niveaux scolaires : ceux des maquettes Notes et Bulletins pour CM2 A, plausibles ailleurs.
  const niveaux: Record<string, number> = { 'ABENA Christelle': 14.5, 'BELLO Aminatou': 13, 'DJOMO Josiane': 13.5, 'ESSOMBA Ruth': 9.5, 'FOKOU Marc': 10.5,
    'FOTSO Junior': 11, 'NDI Emmanuel': 9, 'NGUEMO Carine': 15.5, 'TAMO Gisèle': 16.5, 'TCHOUA Ivan': 10, 'WAMBA Estelle': 12.5, 'ZANG Didier': 11.5,
    'KENFACK Steve': 13.5, 'KAMGA Arthur': 9.5, 'ATANGANA Paul': 11 };
  for (const x of nommes) x.niveauScolaire = niveaux[`${x.nom} ${x.prenoms}`] ?? Math.round((9 + hasard() * 7) * 2) / 2;
  nommes.find((x) => x.nom === 'NANA')!.classeInitiale = 'CE2 A';
  nommes.find((x) => x.nom === 'TALLA')!.inscritLe = ouvrableAvant(4);
  return nommes;
}

async function inscrire(ctx: Contexte) {
  const eleves = elevesNommes();
  const familles: Famille[] = [...new Set(eleves.map((e) => e.famille))];
  const pris = new Set(eleves.map((e) => `${e.nom} ${e.prenoms}`));
  const numeros: Record<string, number> = {};
  for (const e of eleves) if (e.matricule) { const k = e.matricule.slice(0, -4); numeros[k] = Math.max(numeros[k] ?? 0, Number(e.matricule.slice(-4))); }
  for (const c of CLASSES) {
    const anglo = c.niveau.startsWith('Class');
    const deja = eleves.filter((e) => e.classe === c.nom).length;
    for (let i = deja; i < c.n + (c.nom === 'CE2 A' ? 0 : 0); i++) {
      const sexe = hasard() < 0.5 ? 'M' : 'F';
      let nom: string, prenoms: string;
      do {
        nom = choisir(anglo ? NOMS_EN : NOMS_FR);
        prenoms = choisir(PRENOMS[anglo ? 'en' : 'fr'][sexe]);
        if (hasard() < 0.2) prenoms += ` ${choisir(PRENOMS[anglo ? 'en' : 'fr'][sexe])}`;
      } while (pris.has(`${nom} ${prenoms}`) || prenoms.split(' ')[0] === prenoms.split(' ')[1]);
      pris.add(`${nom} ${prenoms}`);
      // Fratries : une famille déjà connue sur six accueille un second enfant.
      const soeur = familles.filter((f) => f.nom === nom && f.langue === (anglo ? 'en' : 'fr') && !['KENFACK', 'DJOMO'].includes(f.nom));
      const fam = soeur.length && hasard() < 0.6 ? soeur[0]! : famille(nom, anglo ? 'en' : 'fr');
      if (!familles.includes(fam)) familles.push(fam);
      const premier = c.niveau === 'SIL' || c.niveau === 'Class 1';
      const r = hasard();
      const type: Eleve['type'] = premier || r < 0.22 ? 'nouvelle' : r < 0.27 ? 'redoublement' : 'reinscription';
      const p = hasard();
      const profil: Profil = p < 0.08 ? 'solde' : p < 0.64 ? 'bon' : p < 0.74 ? 'moyen' : p < 0.82 ? 'retard' : p < 0.96 ? 'tardif' : 'attente';
      const inscritLe = ouvrableApres(hasard() < 0.9 ? plusJours(RENTREE, -entier(1, 12)) : plusJours(RENTREE, entier(1, 18)));
      const niveau = c.niveau;
      const naissance = `${NAISSANCE[niveau]! - (type === 'redoublement' ? 1 : 0)}-${String(entier(1, 12)).padStart(2, '0')}-${String(entier(1, 28)).padStart(2, '0')}`;
      let matricule: string | undefined;
      if (type !== 'nouvelle') {
        const entree = DEBUT - entier(1, Math.min(5, Math.max(1, (NAISSANCE[niveau]! <= 2015 ? 5 : 2021 - NAISSANCE[niveau]!))));
        const k = `${String(entree % 100).padStart(2, '0')}${anglo ? 'ANG' : 'FR'}`;
        numeros[k] = (numeros[k] ?? 0) + entier(1, 3);
        matricule = `${k}${String(numeros[k]).padStart(4, '0')}`;
      }
      eleves.push({ nom, prenoms, sexe, classe: c.nom, niveau, famille: fam, type, profil, inscritLe, naissance, lieu: choisir(VILLES), matricule,
        niveauScolaire: Math.round((8 + hasard() * 9) * 2) / 2 });
    }
  }
  // Réductions : fratrie (sous le seuil, accordée par l'économe) ; enfant du personnel (au-delà, validée par la directrice).
  for (const e of eleves) {
    const freres = eleves.filter((x) => x.famille === e.famille);
    if (freres.length > 1 && freres.indexOf(e) > 0 && e.profil !== 'attente' && !['DJOMO'].includes(e.nom)) e.reductions = [{ ordre: 2, montant: 5000, motif: 'Fratrie' }];
  }
  eleves.find((e) => e.nom === 'KENFACK' && e.prenoms === 'Steve')!.reductions = [{ ordre: 2, montant: 5000, motif: 'Fratrie' }];
  eleves.find((e) => e.nom === 'KENFACK' && e.prenoms === 'Loïc')!.reductions = undefined;
  for (const e of eleves.filter((x) => x.profil === 'bon' && !x.reductions && x.famille.langue === 'fr').slice(4, 6)) e.reductions = [{ ordre: 3, montant: 7500, motif: 'Enfant du personnel' }];
  ctx.eleves = eleves;

  // Anciens élèves : import du fichier de l'an passé (écran Données, IMPORT.md), avec leur matricule d'origine.
  const anciens = eleves.filter((e) => e.type !== 'nouvelle');
  const lignes = anciens.map((e, i) => ({
    ligne: i + 2, matricule: e.matricule, nom: e.nom, prenoms: e.prenoms, sexe: e.sexe, dateNaissance: fr(e.naissance), lieuNaissance: e.lieu,
    classe: e.classeInitiale ?? e.classe, type: e.type === 'redoublement' ? 'Redoublement' : 'Réinscription', responsable: e.famille.payeur,
    lien: e.famille.lien === 'pere' ? 'Père' : 'Mère', telephone: e.famille.telephone, langue: e.famille.langue,
    responsable2: e.famille.second?.nom ?? null, lien2: e.famille.second ? (e.famille.second.lien === 'pere' ? 'Père' : 'Mère') : null, telephone2: e.famille.second?.telephone ?? null,
  }));
  const essai = await ctx.sec.post<{ valides: number; erreurs: unknown[] }>('/scolarite/import', { essai: true, lignes });
  if (essai.erreurs.length) sortir(`Import des anciens refusé : ${JSON.stringify(essai.erreurs.slice(0, 3))}`);
  await ctx.horloge.a(aLHeure(plusJours(RENTREE, -14), '10:05'), () => ctx.sec.post('/scolarite/import', { essai: false, lignes }));

  // Nouveaux élèves : inscrits au guichet, jour après jour.
  const nouveaux = eleves.filter((e) => e.type === 'nouvelle').sort((a, b) => a.inscritLe.localeCompare(b.inscritLe));
  let minute = 0, jourCourant = '';
  for (const e of nouveaux) {
    if (e.inscritLe !== jourCourant) { jourCourant = e.inscritLe; minute = 7 * 60 + 50; }
    minute += entier(6, 14);
    const resp = [{ nom: e.famille.payeur, lien: e.famille.lien, telephone: e.famille.telephone, langue: e.famille.langue, payeur: true, recoitSms: true }];
    if (e.famille.second) resp.push({ nom: e.famille.second.nom, lien: e.famille.second.lien, telephone: e.famille.second.telephone, langue: e.famille.langue, payeur: false, recoitSms: hasard() < 0.5 });
    await ctx.horloge.a(aLHeure(e.inscritLe, hhmm(Math.min(minute, 16 * 60 + 30))), () =>
      ctx.sec.post('/scolarite/inscriptions', {
        eleve: { nom: e.nom, prenoms: e.prenoms, sexe: e.sexe, dateNaissance: e.naissance, lieuNaissance: e.lieu },
        responsables: resp, classeId: ctx.classes[e.classe], type: 'nouvelle', tarif: 'nouveau', doublonEcarte: true,
      }));
  }
  // Identifiants et échéanciers, pour planifier les versements.
  const liste = await ctx.sec.get<{ lignes: { inscriptionId: string; eleveId: string; nom: string }[] }>('/scolarite/eleves?taille=1000');
  for (const e of eleves) {
    const l = liste.lignes.find((x) => x.nom === `${e.nom} ${e.prenoms}`);
    if (!l) continue;
    e.inscriptionId = l.inscriptionId;
    e.eleveId = l.eleveId;
    const ech = await ctx.eco.get<{ lignes: { id: string; ordre: number; aPayer: number }[] }>(`/finances/inscriptions/${e.inscriptionId}/echeancier`);
    e.lignes = ech.lignes.map((x) => ({ id: x.id, ordre: x.ordre, aPayer: x.aPayer }));
  }
  // NANA Ulrich passe de CE2 A en CE2 B en octobre (maquette Classes, « Mouvements de l'année »).
  const nana = ctx.parNom('NANA Ulrich');
  await ctx.horloge.a(aLHeure(ouvrableAuPlus(`${DEBUT}-10-12`), '09:40'), () => ctx.sec.post(`/scolarite/inscriptions/${nana.inscriptionId}/changement-classe`,
    { classeId: ctx.classes['CE2 B'], motif: 'Demande des parents : rapprochement avec un cousin' }));
}

// ---------------------------------------------------------------- étape 4 : versements, réductions, caisse, dépenses
interface Prevu { jour: string; minute: number; eleve: Eleve; montant: number; mode: 'especes' | 'versement_bancaire' | 'virement' | 'cheque'; bordereau?: string }
let bordereauSuivant = 4300;
const nouveauBordereau = () => `BV-00${bordereauSuivant += entier(3, 9)}`;
/** Premier jour ouvrable à partir de la date donnée. */
const ouvrableApres = (jour: string) => { let j = jour; while (!ouvrable(j)) j = plusJours(j, 1); return j; };
const jourEntre = (du: string, au: string) => { const j = joursOuvrables(du, au); return j.length ? choisir(j) : null; };

function aPayer(e: Eleve, ordre: number) {
  return e.lignes!.find((x) => x.ordre === ordre)!.aPayer - (e.reductions?.find((r) => r.ordre === ordre)?.montant ?? 0);
}

function planifier(e: Eleve): Prevu[] {
  const [ins, t1, t2, t3] = [aPayer(e, 1), aPayer(e, 2), aPayer(e, 3), aPayer(e, 4)];
  const p: Prevu[] = [];
  const mode = (): Prevu['mode'] => { const r = hasard(); return r < 0.88 ? 'especes' : r < 0.97 ? 'versement_bancaire' : r < 0.985 ? 'virement' : 'cheque'; };
  const ajouter = (jour: string | null, montant: number) => {
    if (!jour || montant <= 0) return;
    const m = mode();
    p.push({ jour, minute: entier(7 * 60 + 50, 16 * 60 + 10), eleve: e, montant, mode: m, bordereau: m === 'versement_bancaire' ? nouveauBordereau() : undefined });
  };
  if (e.profil === 'attente') return p;
  ajouter(ouvrableAuPlus(e.inscritLe), ins);
  const t1Du = plusJours(RENTREE, 3), t1Au = `${DEBUT}-09-30`;
  const arrondi = (x: number) => Math.round(x / 1000) * 1000;
  switch (e.profil) {
    case 'solde':
      ajouter(jourEntre(t1Du, t1Au), t1);
      ajouter(jourEntre(`${DEBUT}-10-05`, `${DEBUT}-10-31`), t2);
      ajouter(jourEntre(`${DEBUT}-11-01`, plusJours(AUJ, -1)), t3);
      break;
    case 'bon': {
      if (hasard() < 0.3) { const a = arrondi(t1 / 2); ajouter(jourEntre(t1Du, `${DEBUT}-09-18`), a); ajouter(jourEntre(`${DEBUT}-09-19`, t1Au), t1 - a); }
      else ajouter(jourEntre(t1Du, t1Au), t1);
      ajouter(jourEntre(`${DEBUT}-10-12`, plusJours(AUJ, -1)), arrondi(t2 * choisir([0, 0, 0.25, 0.5, 0.5, 1])));
      break;
    }
    case 'moyen':
      ajouter(jourEntre(t1Du, `${DEBUT}-10-25`), arrondi(t1 * choisir([0.4, 0.5, 0.6, 0.7])));
      break;
    case 'tardif':
      ajouter(jourEntre(`${DEBUT}-10-06`, plusJours(AUJ, -1)), t1);
      break;
    default:
      break;
  }
  return p;
}

const MODELE_RELANCE = {
  fr: 'Bonjour [responsable], il reste [montant] FCFA à régler pour [élève] ([classe]) depuis le [date limite]. Merci de passer à la caisse ou de déposer à la banque. [école]',
  en: 'Hello [responsable], [montant] FCFA is still due for [élève] ([classe]) since [date limite]. Please pay at the cashier’s office or at the bank. [school]',
};
// Pièce justificative fictive : un PDF d'une page, sans contenu personnel.
export const PDF_PIECE = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/MediaBox[0 0 595 842]/Parent 2 0 R>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n').toString('base64');

async function finances(ctx: Contexte) {
  const { eco, dir, sec, horloge } = ctx;
  const par = (n: string) => ctx.parNom(n);
  // Réductions, juste après l'inscription.
  for (const e of ctx.eleves.filter((x) => x.reductions && x.inscriptionId)) {
    for (const r of e.reductions!) {
      const jour = ouvrableAuPlus(plusJours(e.inscritLe < RENTREE ? plusJours(RENTREE, -3) : e.inscritLe, 1));
      const res = await horloge.a(aLHeure(jour, '09:15'), () =>
        eco.post<{ appliquee: boolean; demandeId: string | null }>('/finances/reductions', { ligneEcheanceId: e.lignes!.find((l) => l.ordre === r.ordre)!.id, montant: r.montant, motif: r.motif }));
      if (!res.appliquee) await horloge.a(aLHeure(ouvrableAuPlus(plusJours(jour, 2)), '11:40'), () => dir.post(`/finances/demandes/${res.demandeId}/decision`, { decision: 'validee' }));
    }
  }

  // Versements : plan des élèves ordinaires, situations fixées pour ceux des maquettes (Eleves, Impayes, Releve).
  const prevus: Prevu[] = ctx.eleves.filter((e) => e.profil !== 'fixe' && e.inscriptionId).flatMap(planifier);
  const fixe = (nom: string, jour: string, h: string, montant: number, mode: Prevu['mode'] = 'especes', bv?: string) => {
    if (jour >= AUJ || montant <= 0) return;
    const [hh, mm] = h.split(':').map(Number) as [number, number];
    prevus.push({ jour: ouvrableAuPlus(jour), minute: hh * 60 + mm, eleve: par(nom), montant, mode, bordereau: bv });
  };
  const inscription = (nom: string) => ouvrableAuPlus(par(nom).inscritLe);
  const ins = (nom: string) => aPayer(par(nom), 1);
  const t = (nom: string, o: number) => aPayer(par(nom), o);
  // KENFACK Steve : 40 000 versés sur 65 000 (maquette Fiche-eleve) ; KENFACK Loïc : 15 000 aujourd'hui.
  fixe('KENFACK Steve', inscription('KENFACK Steve'), '10:20', ins('KENFACK Steve'));
  fixe('KENFACK Steve', `${DEBUT}-09-25`, '09:05', t('KENFACK Steve', 2));
  fixe('KENFACK Steve', `${DEBUT}-10-20`, '15:30', 10000);
  fixe('KENFACK Loïc', inscription('KENFACK Loïc'), '10:25', ins('KENFACK Loïc'));
  fixe('KENFACK Loïc', `${DEBUT}-09-29`, '11:00', 5000);
  fixe('AMOUGOU Steve', inscription('AMOUGOU Steve'), '08:40', ins('AMOUGOU Steve'));
  fixe('AMOUGOU Steve', `${DEBUT}-09-22`, '14:10', 10000);
  fixe('ATANGANA Paul', inscription('ATANGANA Paul'), '09:10', ins('ATANGANA Paul'));
  fixe('ATANGANA Paul', `${DEBUT}-09-24`, '15:20', 5000);
  fixe('ABENA Christelle', inscription('ABENA Christelle'), '08:15', ins('ABENA Christelle'));
  fixe('ABENA Christelle', `${DEBUT}-09-15`, '10:40', t('ABENA Christelle', 2));
  fixe('ABENA Christelle', `${DEBUT}-10-14`, '11:30', t('ABENA Christelle', 3));
  fixe('ABENA Christelle', ouvrableAvant(8), '09:25', t('ABENA Christelle', 4));
  fixe('BELLO Aminatou', inscription('BELLO Aminatou'), '11:45', ins('BELLO Aminatou'));
  fixe('BELLO Aminatou', `${DEBUT}-09-21`, '08:55', t('BELLO Aminatou', 2));
  fixe('DJOMO Josiane', inscription('DJOMO Josiane'), '09:35', ins('DJOMO Josiane'));
  fixe('DJOMO Josiane', `${DEBUT}-09-28`, '10:00', t('DJOMO Josiane', 2));
  fixe('DJOMO Patrick', inscription('DJOMO Josiane'), '09:30', ins('DJOMO Patrick'));
  fixe('DJOMO Patrick', `${DEBUT}-10-02`, '10:45', t('DJOMO Patrick', 2) - 10000);
  fixe('ESSOMBA Ruth', inscription('ESSOMBA Ruth'), '13:05', ins('ESSOMBA Ruth'));
  fixe('ESSOMBA Ruth', `${DEBUT}-09-23`, '09:45', t('ESSOMBA Ruth', 2) - 8000);
  fixe('EWANE Sandra', inscription('EWANE Sandra'), '10:50', ins('EWANE Sandra'));
  fixe('EWANE Sandra', `${DEBUT}-09-27`, '12:10', t('EWANE Sandra', 2) - 12000);
  fixe('MBAH Kevin', inscription('MBAH Kevin'), '14:30', ins('MBAH Kevin'));
  fixe('NDI Emmanuel', inscription('NDI Emmanuel'), '08:25', ins('NDI Emmanuel'));
  fixe('NGWA Collins', inscription('NGWA Collins'), '14:00', ins('NGWA Collins'));
  fixe('NGWA Collins', `${DEBUT}-10-09`, '09:20', t('NGWA Collins', 2) - 15000);
  fixe('TCHOUA Ivan', inscription('TCHOUA Ivan'), '15:10', ins('TCHOUA Ivan'));
  fixe('TCHOUA Ivan', `${DEBUT}-09-30`, '11:50', t('TCHOUA Ivan', 2) - 10000);
  fixe('ACHU Blessing', inscription('ACHU Blessing'), '12:00', ins('ACHU Blessing'));
  fixe('ACHU Blessing', `${DEBUT}-10-03`, '10:30', t('ACHU Blessing', 2) - 18000);
  fixe('MBARGA Aïcha', inscription('MBARGA Aïcha'), '13:20', ins('MBARGA Aïcha'));
  fixe('NJI Brandon', inscription('NJI Brandon'), '11:10', ins('NJI Brandon'));
  fixe('NJI Brandon', `${DEBUT}-09-24`, '10:10', t('NJI Brandon', 2));
  fixe('TABI Grace', inscription('TABI Grace'), '10:05', ins('TABI Grace'));
  fixe('TABI Grace', `${DEBUT}-09-26`, '09:00', t('TABI Grace', 2));
  fixe('TABI Grace', `${DEBUT}-10-16`, '14:45', t('TABI Grace', 3));
  // Versements bancaires du mois : ils seront rapprochés du relevé (maquette Releve).
  const recents = joursOuvrables(plusJours(AUJ, -12), plusJours(AUJ, -1)).filter((j) => j.slice(0, 7) === AUJ.slice(0, 7));
  const rj = (i: number) => recents.length ? recents[Math.min(i, recents.length - 1)]! : ouvrableAvant(1);
  fixe('NJI Brandon', rj(1), '09:40', 15000, 'versement_bancaire', 'BV-004452');
  fixe('TABI Grace', rj(3), '10:15', t('TABI Grace', 4), 'versement_bancaire', 'BV-004503');
  for (const [i, e] of ctx.eleves.filter((x) => x.profil === 'bon' && x.inscriptionId).slice(0, 3).entries()) {
    fixe(`${e.nom} ${e.prenoms}`, rj(i * 2), hhmm(entier(8 * 60, 15 * 60)), Math.min(t(`${e.nom} ${e.prenoms}`, 4), 10000), 'versement_bancaire', `BV-0044${31 + i * 7}`);
  }

  // Annulations (RG-16) : versement saisi sur le mauvais élève, montant mal saisi.
  const erreurs = [
    { nom: 'ACHU Blessing', jour: ouvrableAvant(entier(12, 15)), minute: 15 * 60 + 40, montant: 5000, motif: 'Montant mal saisi' },
    { nom: 'NGWA Collins', jour: ouvrableAvant(4), minute: 9 * 60 + 12, montant: 15000, motif: 'Versement saisi sur le mauvais élève' },
  ];
  // Sorties de caisse : demandes de la secrétaire et de l'économe, validées par la directrice (RG-19, E-42).
  const sorties = await eco.get<{ categories: { id: string; libelle: string }[] }>('/caisse/sorties');
  const cat = (l: string) => sorties.categories.find((c) => c.libelle === l)!.id;
  await horloge.a(aLHeure(ouvrableAuPlus(plusJours(RENTREE, 2)), '12:00'), async () => {
    for (const [l, m] of [['Fournitures', 200000], ['Entretien', 200000], ['Eau et électricité', 120000], ['Personnel vacataire', 240000], ['Sport', 60000]] as const) {
      await eco.put(`/caisse/categories/${cat(l)}/budget`, { montant: m });
    }
  });
  type Sortie = { objet: string; categorie: string; montant: number; motif: string; par: Client; demande: string; decision: 'validee' | 'refusee' | null; decaisse: string | null; piece?: string };
  const plan: Sortie[] = [];
  const anciennes: [string, string, number, string, Client][] = [
    ['Cahiers et craies de la rentrée', 'Fournitures', 52000, 'Rentrée des classes', sec], ['Produits d’entretien', 'Entretien', 18500, 'Stock épuisé', sec],
    ['Facture d’eau de septembre', 'Eau et électricité', 22000, 'Facture du mois', eco], ['Vacations de septembre · 2 vacataires', 'Personnel vacataire', 60000, 'États signés', eco],
    ['Ramettes de papier', 'Fournitures', 31500, 'Impression des évaluations', sec], ['Réparation de la toiture du préau', 'Entretien', 36500, 'Fuite après l’orage', sec],
    ['Feutres et marqueurs', 'Fournitures', 32000, 'Tableaux blancs des classes', sec], ['Chasubles de sport', 'Sport', 6000, 'Match inter-classes', sec],
    ['Facture d’électricité de septembre', 'Eau et électricité', 26000, 'Facture du mois', eco], ['Entretien des toilettes', 'Entretien', 35000, 'Vidange de la fosse', sec],
  ];
  const septOct = joursOuvrables(plusJours(RENTREE, 1), ouvrableAvant(12));
  anciennes.forEach(([objet, categorie, montant, motif, p], i) => {
    const j = septOct[Math.min(septOct.length - 1, Math.floor((i * septOct.length) / anciennes.length))] ?? ouvrableAvant(12);
    plan.push({ objet, categorie, montant, motif, par: p, demande: j, decision: 'validee', decaisse: ouvrableAuPlus(plusJours(j, 1)), piece: i % 3 === 0 ? 'États signés' : 'Facture' });
  });
  plan.push(
    { objet: 'Achat d’un ballon', categorie: 'Sport', montant: 12000, motif: 'Ballon crevé pendant l’EPS', par: sec, demande: ouvrableAvant(8), decision: 'refusee', decaisse: null },
    { objet: 'Vacations d’octobre · 2 vacataires', categorie: 'Personnel vacataire', montant: 60000, motif: 'États signés', par: eco, demande: ouvrableAvant(7), decision: 'validee', decaisse: ouvrableAvant(6), piece: 'États signés' },
    { objet: 'Facture d’électricité d’octobre', categorie: 'Eau et électricité', montant: 48000, motif: 'Facture du mois', par: eco, demande: ouvrableAvant(2), decision: 'validee', decaisse: null },
  );
  const ids: Record<string, string> = {};
  for (const s of plan) {
    const r = await horloge.a(aLHeure(s.demande, hhmm(entier(8 * 60, 11 * 60))), () => s.par.post<{ id: string }>('/caisse/sorties',
      { objet: s.objet, categorieId: cat(s.categorie), montant: s.montant, motif: s.motif }));
    ids[s.objet] = r.id;
    if (s.decision) await horloge.a(aLHeure(s.demande, hhmm(entier(14 * 60, 16 * 60 + 30))), () => dir.post(`/caisse/sorties/${r.id}/decision`,
      { decision: s.decision, motif: s.decision === 'refusee' ? 'Budget du sport à revoir au conseil d’établissement' : null }));
  }

  // Journées de caisse : ouverture, versements, annulations, décaissements, dépôts, clôture.
  const jours = [...new Set([...prevus.map((p) => p.jour), ...erreurs.map((e) => e.jour), ...plan.map((s) => s.decaisse).filter((x): x is string => !!x)])].filter((j) => j < AUJ).sort();
  const mercredis = jours.filter((x) => jourSemaine(x) === 3);
  let depots = 0;
  for (const [n, jour] of jours.entries()) {
    // Les jours de décaissement, l'économe sort du coffre de quoi payer : le fonds initial les couvre.
    const aDecaisser = plan.filter((x) => x.decaisse === jour && x.decision === 'validee').reduce((t, x) => t + x.montant, 0);
    const session = await horloge.a(aLHeure(jour, hhmm(7 * 60 + entier(30, 45))), () => eco.post<{ id: string }>('/caisse/sessions',
      { caisse: 'principale', fondsInitial: 20000 + aDecaisser }));
    for (const p of prevus.filter((x) => x.jour === jour).sort((a, b) => a.minute - b.minute)) {
      const etat = await eco.get<{ totaux: { reste: number } }>(`/finances/inscriptions/${p.eleve.inscriptionId}/echeancier`);
      const montant = Math.min(p.montant, etat.totaux.reste);
      if (montant <= 0) continue;
      await horloge.a(aLHeure(jour, hhmm(p.minute)), () => eco.post('/finances/versements', {
        inscriptionId: p.eleve.inscriptionId, montant, mode: p.mode,
        ...(p.mode === 'versement_bancaire' ? { banque: 'Banque de Yaoundé', bordereau: p.bordereau, dateBordereau: jour } : {}),
      }, { 'idempotency-key': `fictif-${p.eleve.inscriptionId}-${jour}-${p.minute}-${montant}` }));
    }
    for (const err of erreurs.filter((x) => x.jour === jour)) {
      const e = par(err.nom);
      const v = await horloge.a(aLHeure(jour, hhmm(err.minute - 30)), () => eco.post<{ id: string }>('/finances/versements',
        { inscriptionId: e.inscriptionId, montant: err.montant, mode: 'especes' }, { 'idempotency-key': `fictif-erreur-${err.nom}` }));
      const a = await horloge.a(aLHeure(jour, hhmm(err.minute - 10)), () => eco.post<{ demandeId: string }>(`/finances/versements/${v.id}/annulation`, { motif: err.motif }));
      await horloge.a(aLHeure(jour, hhmm(err.minute)), () => eco.post(`/finances/demandes/${a.demandeId}/decision`, { decision: 'validee' }));
    }
    for (const s of plan.filter((x) => x.decaisse === jour && x.decision === 'validee')) {
      await horloge.a(aLHeure(jour, '13:15'), () => eco.post(`/caisse/sorties/${ids[s.objet]}/decaissement`));
      if (s.piece) await horloge.a(aLHeure(jour, '13:20'), () => eco.put(`/caisse/sorties/${ids[s.objet]}/piece`, { nom: s.piece, base64: PDF_PIECE, type: 'application/pdf' }));
    }
    // Dépôt à la banque chaque mercredi ; le dernier porte le bordereau BV-004471 (maquette Comptes).
    const j = await eco.get<{ kpi: { attendues: number } }>('/caisse/journee');
    if (jourSemaine(jour) === 3 && j.kpi.attendues > 60000) {
      const dernier = jour === mercredis.at(-1);
      const montant = dernier ? Math.min(150000, j.kpi.attendues - 20000) : Math.floor((j.kpi.attendues - 20000) / 10000) * 10000;
      depots++;
      await horloge.a(aLHeure(jour, '15:45'), () => eco.post('/caisse/depots', { montant, banque: 'Banque de Yaoundé',
        bordereau: dernier ? 'BV-004471' : `BV-00${4200 + depots * 7}`, deposeLe: jour }));
    }
    const fin = await eco.get<{ kpi: { attendues: number } }>('/caisse/journee');
    const ecart = n === Math.floor(jours.length / 2) ? -500 : 0;
    await horloge.a(aLHeure(jour, hhmm(16 * 60 + entier(30, 50))), () => eco.post(`/caisse/sessions/${session.id}/cloture`,
      { montantCompte: fin.kpi.attendues + ecart, motifEcart: ecart ? 'Erreur de rendu de monnaie' : null }));
  }

  // Caisse APE : cotisations encaissées par Mme NGO Berthe (économe et secrétaire).
  const ngo = await connecter(ctx.app, 'ngo.b', motDePasseDemo('ngo.b'));
  const jourApe = ouvrableAvant(3);
  const s = await horloge.a(aLHeure(jourApe, '08:00'), () => ngo.post<{ id: string }>('/caisse/sessions', { caisse: 'ape', fondsInitial: 12000 }));
  for (const [i, m] of [10000, 5000, 10000, 5000].entries()) {
    await horloge.a(aLHeure(jourApe, hhmm(9 * 60 + i * 50)), () => ngo.post('/caisse/entrees', { libelle: `Cotisation APE · famille ${choisir(NOMS_FR)}`, montant: m }));
  }
  await horloge.a(aLHeure(jourApe, '12:30'), () => ngo.post(`/caisse/sessions/${s.id}/cloture`, { montantCompte: 42000, motifEcart: null }));

  // Demandes en attente de la directrice (maquette Validations).
  const mbarga = par('MBARGA Aïcha');
  await horloge.a(aLHeure(ouvrableAvant(1), '14:40'), () => eco.post('/finances/reductions',
    { ligneEcheanceId: mbarga.lignes!.find((l) => l.ordre === 3)!.id, montant: 10000, motif: 'Fratrie de trois enfants' }));
  const talla = par('TALLA Boris');
  await horloge.a(aLHeure(talla.inscritLe, '11:20'), () => sec.post('/finances/derogations',
    { inscriptionId: talla.inscriptionId, motif: `Versement bancaire annoncé pour le ${fr(plusJours(AUJ, 2))}` }));

  // Relances : SMS aux familles en retard début octobre, avis remis en main propre, nouvelle vague de SMS.
  const premierOct = joursOuvrables(`${DEBUT}-10-01`, `${DEBUT}-10-04`)[0];
  if (premierOct) await horloge.a(aLHeure(premierOct, '17:05'), () => eco.post('/communication/sms', { cible: 'debiteurs', modele: 'relance', texteFr: MODELE_RELANCE.fr, texteEn: MODELE_RELANCE.en }));
  const quinze = joursOuvrables(`${DEBUT}-10-15`, `${DEBUT}-10-17`)[0];
  if (quinze) await horloge.a(aLHeure(quinze, '10:00'), () => eco.post('/finances/avis', { inscriptionIds: [par('FOKOU Marc').inscriptionId] }));
  const vingt = joursOuvrables(`${DEBUT}-10-20`, `${DEBUT}-10-22`)[0];
  if (vingt) await horloge.a(aLHeure(vingt, '17:10'), () => eco.post('/communication/sms', { cible: 'selection', modele: 'relance', texteFr: MODELE_RELANCE.fr, texteEn: MODELE_RELANCE.en,
    inscriptionIds: ['ACHU Blessing', 'MBARGA Aïcha', 'TCHOUA Ivan'].map((n) => par(n).inscriptionId) }));
}

// ---------------------------------------------------------------- dernière étape : la journée d'aujourd'hui (maquette Caisse)
async function aujourdhui(ctx: Contexte) {
  const { eco, sec, horloge } = ctx;
  if (ouvrable(AUJ)) {
    const maintenant = minuteActuelle() - 5;
    // Heures de la maquette ; si la journée est moins avancée, elles se resserrent avant l'heure actuelle.
    const heures = [7 * 60 + 42, 8 * 60 + 5, 10 * 60 + 8, 10 * 60 + 55, 11 * 60 + 30, 13 * 60 + 15, 15 * 60 + 7, 15 * 60 + 35];
    const echelle = maintenant >= heures.at(-1)! ? 1 : Math.max(0.02, (maintenant - 6 * 60) / (heures.at(-1)! - 6 * 60));
    const h = (i: number) => aLHeure(AUJ, hhmm(Math.round(6 * 60 + (heures[i]! - 6 * 60) * echelle)));
    await horloge.a(h(0), () => eco.post('/caisse/sessions', { caisse: 'principale', fondsInitial: 20000 }));
    const sorties = await eco.get<{ categories: { id: string; libelle: string }[] }>('/caisse/sorties');
    const cat = (l: string) => sorties.categories.find((c) => c.libelle === l)!.id;
    await horloge.a(h(1), () => sec.post('/caisse/sorties', { objet: 'Réparation du photocopieur', categorieId: cat('Entretien'), montant: 35000, motif: 'Panne depuis la semaine dernière' }));
    const verser = async (i: number, nom: string, montant: number, mode = 'especes', bv?: string) => {
      const e = ctx.parNom(nom);
      await horloge.a(h(i), () => eco.post('/finances/versements', { inscriptionId: e.inscriptionId, montant, mode,
        ...(bv ? { banque: 'Banque de Yaoundé', bordereau: bv, dateBordereau: AUJ } : {}) }, { 'idempotency-key': `fictif-jour-${nom}` }));
    };
    await verser(2, 'AMOUGOU Steve', 20000);
    await verser(3, 'KENFACK Loïc', 15000);
    await horloge.a(h(4), () => eco.post('/caisse/entrees', { libelle: 'Vente de carnets de correspondance', montant: 6000 }));
    await horloge.a(h(5), async () => {
      const s = await sec.post<{ id: string }>('/caisse/sorties', { objet: 'Achat de craie et de marqueurs', categorieId: cat('Fournitures'), montant: 8500, motif: 'Stock épuisé' });
      await ctx.dir.post(`/caisse/sorties/${s.id}/decision`, { decision: 'validee' });
      await eco.post(`/caisse/sorties/${s.id}/decaissement`);
      await eco.put(`/caisse/sorties/${s.id}/piece`, { nom: 'Facture', base64: PDF_PIECE, type: 'application/pdf' });
    });
    await verser(6, 'DJOMO Patrick', 25000);
    await verser(7, 'DJOMO Josiane', 12000, 'versement_bancaire', 'BV-004498');
  }
  // Relevé bancaire du mois : versements bancaires du mois, un virement sans bordereau, un écart, le dépôt de la caisse.
  const mois = AUJ.slice(0, 7);
  const v = await ctx.proprio.query<{ jour: string; montant: number; bordereau: string; nom: string }>(`
    SELECT to_char(v.date_bordereau, 'DD/MM/YYYY') AS jour, v.montant::int AS montant, v.bordereau,
           e.nom || ' ' || left(split_part(rs.nom, ' ', 2), 1) AS nom
      FROM finances.versement v JOIN scolarite.inscription i ON i.id = v.inscription_id JOIN scolarite.eleve e ON e.id = i.eleve_id
      JOIN scolarite.eleve_responsable er ON er.eleve_id = e.id AND er.payeur JOIN scolarite.responsable rs ON rs.id = er.responsable_id
     WHERE v.mode = 'versement_bancaire' AND v.statut = 'valide' AND to_char(v.date_bordereau, 'YYYY-MM') = $1 AND v.date_bordereau < $2::date
     ORDER BY v.date_bordereau, v.numero_recu`, [mois, AUJ]);
  const lignes = v.rows.map((x) => ({ date: x.jour, texte: `${x.jour};VERST ESP ${x.nom};${x.bordereau === 'BV-004503' ? x.montant - 2000 : x.montant};${x.bordereau}` }));
  const d = await ctx.proprio.query<{ jour: string }>(`SELECT to_char(depose_le, 'DD/MM/YYYY') AS jour FROM caisse.depot_banque WHERE bordereau = 'BV-004471' AND to_char(depose_le, 'YYYY-MM') = $1`, [mois]);
  if (d.rows[0]) lignes.push({ date: d.rows[0].jour, texte: `${d.rows[0].jour};VERST CAISSE ECOLE;150000;BV-004471` });
  const vir = fr(joursOuvrables(`${mois}-01`, plusJours(AUJ, -1)).at(-3) ?? ouvrableAvant(1));
  lignes.push({ date: vir, texte: `${vir};VIR MBARGA PAUL;${aPayer(ctx.parNom('MBARGA Aïcha'), 2)};` });
  const cle = (x: string) => x.split('/').reverse().join('');
  lignes.sort((a, b) => cle(a.date).localeCompare(cle(b.date)));
  await horloge.a(aLHeure(AUJ, hhmm(Math.max(7 * 60, minuteActuelle() - 20))), () => eco.post('/finances/releve', { mois, csv: ['date;libellé;montant;référence', ...lignes.map((l) => l.texte)].join('\n') }));
}

// ---------------------------------------------------------------- finitions : comptes famille de répétition, dernières activités, vacations
async function finaliser(ctx: Contexte) {
  const { proprio } = ctx;
  // Le mot de passe du compte famille KENFACK est connu pour la répétition (maquette Mobile-parent-connexion).
  await proprio.query(`UPDATE core.compte SET mot_de_passe = $1 WHERE type = 'famille' AND identifiant = '600000055'`, [await hacher('demo-kenfack')]);
  await proprio.query(`UPDATE core.compte SET derniere_activite = now() - (random() * interval '30 hours') WHERE type = 'personnel'`);
  await proprio.query(`UPDATE core.compte SET derniere_activite = now() - (random() * interval '6 days') WHERE type = 'famille' AND random() < 0.4`);
  // Heures de vacation des vacataires (affichage seul, E-26).
  for (const [, nom] of MATIERE_SEULE) {
    for (const [k, prevues, faites] of [[-1, 24, entier(18, 24)], [0, 24, entier(4, 10)]] as const) {
      const dt = new Date(`${AUJ}T12:00:00Z`);
      dt.setUTCMonth(dt.getUTCMonth() + k, 1);
      await proprio.query(`INSERT INTO personnel.vacation (etablissement_id, personnel_id, mois, heures_prevues, heures_effectuees)
                           SELECT etablissement_id, id, $2::date, $3, $4 FROM personnel.fiche WHERE id = $1 ON CONFLICT DO NOTHING`,
        [ctx.personnel[nom], dt.toISOString().slice(0, 10), prevues, faites]);
    }
  }
}

await main();
