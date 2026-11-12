// demo:fictif — une année scolaire entrée par l'API : structure, inscriptions, versements et caisse, emploi du temps,
// notes et bulletins, conseils de classe, appels et absences, annonces et messagerie, départs et clôture.
// L'horloge date chaque opération ; les années passées sont complètes et clôturées, l'année en cours s'arrête aujourd'hui.
import { hacher } from '@gs/api/src/core/motdepasse.ts';
import { Client, connecter } from './client.ts';
import { sortir } from './commun.ts';
import {
  ABREGES, ADMIN, CLASSES, GROUPES, MATIERE_SEULE, NOMS_FR, anglophone, classeDe, classesSuivantes, elevesDe, grilleDe, maternelle, matieresDuNiveau, matieresPar,
} from './fictif-ecole.ts';
import {
  AUJ, DEBUT, aLHeure, choisir, entier, fr, hasard, hhmm, jj, jourEntre, jourSemaine, joursOuvrables, minuteActuelle, motDePasseDemo, ouvrable, ouvrableApres,
  ouvrableAuPlus, ouvrableAvant, plusJours, type Annee, type Contexte, type Eleve, type Passage,
} from './fictif-outils.ts';

export const ECOLE = { nomFr: 'Groupe scolaire bilingue La Ruche d’Or', nomEn: 'La Ruche d’Or Bilingual School' };
const BANQUE = 'Banque de Yaoundé';
export const PDF_PIECE = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/MediaBox[0 0 595 842]/Parent 2 0 R>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n').toString('base64');

// ---------------------------------------------------------------- repères d'une année
export const bornesPeriodes = (a: Annee): [string, string][] => [[a.rentree, `${a.debut}-12-04`], [`${a.debut}-12-05`, `${a.debut + 1}-03-19`], [`${a.debut + 1}-03-20`, a.fin]];
export const datesGrille = (a: Annee) => [a.rentree, `${a.debut}-09-30`, `${a.debut}-11-30`, `${a.debut + 1}-01-31`];
/** Fenêtres des six séquences (devoirs) : deux par trimestre. */
const fenetreSequence = (a: Annee, n: number): [string, string] => ([
  [`${a.debut}-10-05`, `${a.debut}-10-16`], [`${a.debut}-11-18`, `${a.debut}-11-29`], [`${a.debut + 1}-01-19`, `${a.debut + 1}-01-30`],
  [`${a.debut + 1}-03-02`, `${a.debut + 1}-03-13`], [`${a.debut + 1}-04-20`, `${a.debut + 1}-04-30`], [`${a.debut + 1}-06-01`, `${a.debut + 1}-06-11`],
] as [string, string][])[n - 1]!;
const passageDe = (e: Eleve, a: Annee): Passage => e.parcours[a.debut]!;
const nomDe = (e: Eleve) => `${e.nom} ${e.prenoms}`;
const principalDe = (ctx: Contexte, classe: string) => ctx.comptes[classeDe(classe).principal[0]]!;
/** Instituteur qui tient une matière dans une classe, cette année-là (spécialiste ou principal). */
const titulaire = (ctx: Contexte, a: Annee, classe: string, matiere: string): Client | undefined => {
  const ex = matieresPar(a.debut).find(([, m, cl]) => m === matiere && cl.includes(classe));
  return ex ? ctx.clientDe(ex[0]) : principalDe(ctx, classe);
};
const elevesClasse = (ctx: Contexte, a: Annee, classe: string) => elevesDe(ctx.eleves, a.debut).filter((e) => passageDe(e, a).classe === classe && passageDe(e, a).inscriptionId);

// ---------------------------------------------------------------- fondation : établissement, personnel, année 0
export async function fondation(ctx: Contexte, a: Annee) {
  const { sec, horloge } = ctx;
  const jour = plusJours(a.rentree, -21);
  await horloge.a(aLHeure(jour, '08:40'), async () => {
    await sec.put('/structure/etablissement', { ...ECOLE, devise: 'Travail · Discipline · Réussite', villeBp: 'Yaoundé · BP 1234', telephone: '600 000 200',
      signataire: 'La Directrice', banque: BANQUE, numeroCompte: '00012 345678 90', seuilReduction: 5000 });
    for (const ss of ['francophone', 'anglophone'] as const) for (const o of ['maternelle', 'primaire'] as const) await sec.post('/structure/cycles', { sousSysteme: ss, ordreEnseignement: o });
  });
  for (const n of (await sec.get<{ id: string; code: string }[]>('/structure/niveaux'))) ctx.niveaux[n.code] = n.id;
  await creerAnnee(ctx, a, aLHeure(jour, '08:50'), true);

  const roles = await sec.get<{ id: string; code: string }[]>('/core/roles');
  const role = (c: string) => roles.find((r) => r.code === c)!.id;
  const fiches = await sec.get<{ lignes: { id: string; nomAffiche: string }[] }>('/personnel?taille=50');
  ctx.personnel['secretaire'] = fiches.lignes.find((f) => f.nomAffiche === 'Mme NDZANA Rose')!.id;
  const creer = async (identifiant: string | null, nom: string, fonction: string, statut: string, telephone: string, roleCode: string | null, diplome: string, entreeLe: string) => {
    const f = await sec.post<{ id: string }>('/personnel', { nomAffiche: nom, fonction, statut, telephone, diplome, entreeLe });
    ctx.personnel[identifiant ?? nom] = f.id;
    ctx.personnel[nom] = f.id;
    if (identifiant && roleCode) await sec.post('/core/comptes', { identifiant, nomAffiche: nom, personnelId: f.id, roles: [{ roleId: role(roleCode) }], motDePasse: motDePasseDemo(identifiant) });
  };
  await horloge.a(aLHeure(plusJours(jour, 1), '09:00'), async () => {
    await sec.patch(`/personnel/${ctx.personnel['secretaire']}`, { telephone: '600 000 203', diplome: 'BTS de secrétariat de direction', entreeLe: a.rentree });
    for (const [id, nom, fonction, roleCode, tel] of ADMIN) await creer(id, nom, fonction, 'permanent', tel, roleCode, 'Licence', a.rentree);
    for (const c of CLASSES) {
      const [id, nom, tel] = c.principal;
      await creer(id, nom, 'instituteur_principal', 'permanent', tel, 'instituteur_principal', anglophone(c.niveau) ? 'Teacher Grade I Certificate' : maternelle(c.niveau) ? 'CAPIEMP · option maternelle' : 'CAPIEMP', a.rentree);
    }
    for (const [id, nom, tel, diplome, depuis] of MATIERE_SEULE) if (depuis <= a.debut) await creer(id, nom, 'instituteur_matiere', 'vacataire', tel, id ? 'instituteur_matiere' : null, diplome, a.rentree);
    await creer(null, 'M. ABENA Joseph', 'autre', 'permanent', '600 000 241', null, 'Surveillant général', a.rentree);
    await creer(null, 'Mme MOUKOKO Hélène', 'autre', 'vacataire', '600 000 242', null, 'Infirmière diplômée d’État', a.rentree);
    // Un compte peut cumuler plusieurs rôles (maquette Utilisateurs : Mme NGO Berthe, économe et secrétaire).
    const f = await sec.post<{ id: string }>('/personnel', { nomAffiche: 'Mme NGO Berthe', fonction: 'autre', statut: 'permanent', telephone: '600 000 205', diplome: 'BTS de comptabilité', entreeLe: a.rentree });
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
  ctx.clientDe = (nom: string) => parNomPersonnel[nom];
  // Les instituteurs de matière arrivés plus tard sont créés à leur rentrée.
  ctx.arriveeVacataire = async (an: Annee) => {
    for (const [id, nom, tel, diplome, depuis] of MATIERE_SEULE) {
      if (depuis !== an.debut || ctx.personnel[nom]) continue;
      await horloge.a(aLHeure(plusJours(an.rentree, -5), '10:00'), () => creer(id, nom, 'instituteur_matiere', 'vacataire', tel, id ? 'instituteur_matiere' : null, diplome, an.rentree));
    }
    for (const [id, nom] of MATIERE_SEULE) if (id && ctx.personnel[nom] && !ctx.comptes[id]) { ctx.comptes[id] = await connecter(ctx.app, id, motDePasseDemo(id)); parNomPersonnel[nom] = ctx.comptes[id]!; }
  };
  await ctx.arriveeVacataire(a);
  // Groupes et matières (maquette Matieres), une fois pour toutes.
  const groupes: Record<string, string> = {};
  await horloge.a(aLHeure(plusJours(a.rentree, -8), '10:30'), async () => {
    for (const [f, e] of GROUPES) groupes[f] = (await ctx.pre.post<{ id: string }>('/pedagogie/groupes', { libelleFr: f, libelleEn: e })).id;
    for (const niveau of [...new Set(CLASSES.map((c) => c.niveau))]) {
      for (const m of matieresDuNiveau(niveau)) {
        const r = await ctx.pre.post<{ id: string }>('/pedagogie/matieres', { libelleFr: m.libelle, libelleEn: m.en, abregeFr: m.abrege, abregeEn: m.abregeEn,
          groupeId: groupes[m.groupe], niveauId: ctx.niveaux[niveau], coefficient: m.coefficient, bareme: 20 });
        ctx.matieres[m.libelle] = r.id;
      }
    }
  });
}

/** Crée une année (ouverte tout de suite pour la première, en préparation sinon), ses périodes et ses classes. */
export async function creerAnnee(ctx: Contexte, a: Annee, quand: Date, ouvrir: boolean) {
  const { sec, horloge } = ctx;
  a.id = (await horloge.a(quand, () => sec.post<{ id: string }>('/structure/annees', { libelle: a.libelle, dateDebut: a.rentree, dateFin: a.fin, ouvrir }))).id;
  // Trimestres : le premier s'achève début décembre (composition le 30/11, maquette Notes).
  for (const [i, [d, f]] of bornesPeriodes(a).entries()) {
    await ctx.proprio.query('UPDATE structure.periode SET date_debut = $1, date_fin = $2 WHERE annee_id = $3 AND ordre = $4', [d, f, a.id, i + 1]);
  }
  await horloge.a(new Date(quand.getTime() + 20 * 60_000), async () => {
    for (const c of CLASSES) a.classes[c.nom] = (await sec.post<{ id: string }>('/structure/classes', { niveauId: ctx.niveaux[c.niveau], nom: c.nom, effectifMax: 40, anneeId: a.id })).id;
  });
}

/** Périodes et séquences de l'année ouverte, lues dans l'API. */
export async function lirePeriodes(ctx: Contexte, a: Annee) {
  const seq = await ctx.pre.get<{ id: string; ordre: number; sequences: { id: string; numero: number; type: string }[] }[]>('/pedagogie/sequences');
  const bornes = bornesPeriodes(a);
  a.periodes = seq.map((p) => ({ id: p.id, ordre: p.ordre, dateDebut: bornes[p.ordre - 1]![0], dateFin: bornes[p.ordre - 1]![1],
    sequences: p.sequences.filter((s) => s.type === 'devoir').map((s) => ({ id: s.id, numero: s.numero })) }));
}

// ---------------------------------------------------------------- grille des frais (économe)
export async function grille(ctx: Contexte, a: Annee, quand: Date) {
  const montants = grilleDe(a.debut);
  await ctx.horloge.a(quand, async () => {
    for (const tarif of ['nouveau', 'ancien'] as const) {
      await ctx.eco.put('/finances/grille', { anneeId: a.id, tarif, dates: datesGrille(a), lignes: Object.entries(montants).map(([code, m]) => ({
        niveauId: ctx.niveaux[code], montants: tarif === 'nouveau' ? m : [m[0]! - 2000, ...m.slice(1)] })) });
    }
  });
}

// ---------------------------------------------------------------- inscriptions
/** Première année gérée : les anciens arrivent par l'import (IMPORT.md) avec le matricule de leur année d'entrée, les nouveaux au guichet. */
export async function inscriptionsInitiales(ctx: Contexte, a: Annee) {
  const eleves = elevesDe(ctx.eleves, a.debut);
  const anciens = eleves.filter((e) => e.entree < a.debut);
  const numeros: Record<string, number> = {};
  for (const e of anciens) {
    const k = `${String(e.entree % 100).padStart(2, '0')}${anglophone(classeDe(passageDe(e, a).classe).niveau) ? 'ANG' : 'FR'}`;
    numeros[k] = (numeros[k] ?? 0) + entier(1, 2);
    e.matricule = `${k}${String(numeros[k]).padStart(4, '0')}`;
  }
  const lignes = anciens.map((e, i) => {
    const p = passageDe(e, a);
    return { ligne: i + 2, matricule: e.matricule, nom: e.nom, prenoms: e.prenoms, sexe: e.sexe, dateNaissance: fr(e.naissance), lieuNaissance: e.lieu,
      classe: p.classe, type: p.type === 'redoublement' ? 'Redoublement' : 'Réinscription', responsable: e.famille.payeur,
      lien: e.famille.lien === 'pere' ? 'Père' : 'Mère', telephone: e.famille.telephone, langue: e.famille.langue,
      responsable2: e.famille.second?.nom ?? null, lien2: e.famille.second ? (e.famille.second.lien === 'pere' ? 'Père' : 'Mère') : null, telephone2: e.famille.second?.telephone ?? null };
  });
  const essai = await ctx.sec.post<{ valides: number; erreurs: unknown[] }>('/scolarite/import', { essai: true, lignes });
  if (essai.erreurs.length) sortir(`Import des anciens refusé : ${JSON.stringify(essai.erreurs.slice(0, 3))}`);
  const jourImport = ouvrableApres(plusJours(a.rentree, -14));
  await ctx.horloge.a(aLHeure(jourImport, '10:05'), () => ctx.sec.post('/scolarite/import', { essai: false, lignes }));
  for (const e of anciens) e.inscritLe = jourImport;
  await guichet(ctx, a);
}

/** Les nouveaux de l'année, inscrits au guichet jour après jour. */
export async function guichet(ctx: Contexte, a: Annee) {
  const nouveaux = elevesDe(ctx.eleves, a.debut).filter((e) => passageDe(e, a).type === 'nouvelle' && e.entree === a.debut);
  for (const e of nouveaux) if (!e.inscritLe || e.inscritLe < plusJours(a.rentree, -30)) {
    e.inscritLe = ouvrableApres(hasard() < 0.9 ? plusJours(a.rentree, -entier(1, 12)) : plusJours(a.rentree, entier(1, 18)));
  }
  if (a.courante) ctx.parNom('TALLA Boris').inscritLe = ouvrableAvant(4);
  nouveaux.sort((x, y) => x.inscritLe!.localeCompare(y.inscritLe!));
  let minute = 0, jourCourant = '';
  for (const e of nouveaux) {
    if (e.inscritLe !== jourCourant) { jourCourant = e.inscritLe!; minute = 7 * 60 + 50; }
    minute += entier(5, 12);
    const resp = [{ nom: e.famille.payeur, lien: e.famille.lien, telephone: e.famille.telephone, langue: e.famille.langue, payeur: true, recoitSms: true }];
    if (e.famille.second) resp.push({ nom: e.famille.second.nom, lien: e.famille.second.lien, telephone: e.famille.second.telephone, langue: e.famille.langue, payeur: false, recoitSms: hasard() < 0.5 });
    const classe = e.classeInitiale && a.courante ? e.classeInitiale : passageDe(e, a).classe;
    await ctx.horloge.a(aLHeure(e.inscritLe!, hhmm(Math.min(minute, 16 * 60 + 30))), () =>
      ctx.sec.post('/scolarite/inscriptions', {
        eleve: { nom: e.nom, prenoms: e.prenoms, sexe: e.sexe, dateNaissance: e.naissance, lieuNaissance: e.lieu },
        responsables: resp, classeId: a.classes[classe], type: 'nouvelle', tarif: 'nouveau', doublonEcarte: true,
      }));
  }
}

/** Relit dans l'API les inscriptions de l'année : identifiants, classe réelle, échéanciers. */
export async function synchroniser(ctx: Contexte, a: Annee) {
  const liste = await ctx.sec.get<{ lignes: { inscriptionId: string; eleveId: string; nom: string; classe: string; matricule: string }[] }>('/scolarite/eleves?taille=1000');
  const parNom = new Map(liste.lignes.map((l) => [l.nom, l]));
  const parEleve = new Map(liste.lignes.map((l) => [l.eleveId, l]));
  for (const e of elevesDe(ctx.eleves, a.debut)) {
    const l = (e.eleveId && parEleve.get(e.eleveId)) || parNom.get(nomDe(e));
    const p = passageDe(e, a);
    if (!l) { console.warn(`  inscription absente : ${nomDe(e)} (${p.classe}, ${a.libelle})`); delete e.parcours[a.debut]; continue; }
    e.eleveId = l.eleveId;
    e.matricule = l.matricule;
    p.inscriptionId = l.inscriptionId;
    p.classe = l.classe;
  }
  // Classes réelles des élèves nommés par les maquettes : un changement de classe à la rentrée si la clôture les a placés ailleurs.
  if (a.courante) {
    for (const e of ctx.eleves.filter((x) => x.parcours[a.debut]?.profil === 'fixe')) {
      const voulue = e.nom === 'NANA' ? 'CE2 B' : nomClasseVoulue(e);
      const p = passageDe(e, a);
      if (voulue && p.classe !== voulue && p.inscriptionId) {
        await ctx.horloge.a(aLHeure(e.nom === 'NANA' ? ouvrableAuPlus(`${a.debut}-10-12`) : ouvrableApres(plusJours(a.rentree, 1)), '09:40'), () =>
          ctx.sec.post(`/scolarite/inscriptions/${p.inscriptionId}/changement-classe`, { classeId: a.classes[voulue],
            motif: e.nom === 'NANA' ? 'Demande des parents : rapprochement avec un cousin' : 'Équilibrage des classes à la rentrée' }));
        p.classe = voulue;
      }
    }
  }
  for (const e of elevesDe(ctx.eleves, a.debut)) {
    const p = passageDe(e, a);
    const ech = await ctx.eco.get<{ lignes: { id: string; ordre: number; aPayer: number }[] }>(`/finances/inscriptions/${p.inscriptionId}/echeancier`);
    p.lignes = ech.lignes.map((x) => ({ id: x.id, ordre: x.ordre, aPayer: x.aPayer }));
  }
}
const CLASSES_VOULUES: Record<string, string> = { 'KAMGA Arthur': 'CE2 B', 'AMOUGOU Steve': 'CE2 B', 'ATANGANA Paul': 'CE2 B', 'EWANE Sandra': 'CE2 B', 'NGONO Mireille': 'CE2 B',
  'SIMO Vanessa': 'CE2 B', 'YONGA Fabrice': 'CE2 B', 'DJOMO Josiane': 'CM2 A', 'ESSOMBA Ruth': 'CM2 A', 'FOTSO Junior': 'CM2 A', 'NDI Emmanuel': 'CM2 A',
  'NGUEMO Carine': 'CM2 A', 'TAMO Gisèle': 'CM2 A', 'TCHOUA Ivan': 'CM2 A', 'WAMBA Estelle': 'CM2 A', 'ZANG Didier': 'CM2 A', 'DJOMO Patrick': 'CM1 A' };
const nomClasseVoulue = (e: Eleve) => CLASSES_VOULUES[nomDe(e)] ?? null;

// ---------------------------------------------------------------- versements, réductions, caisse, dépenses
interface Prevu { jour: string; minute: number; eleve: Eleve; montant: number; mode: 'especes' | 'versement_bancaire' | 'virement' | 'cheque'; bordereau?: string }
let bordereauSuivant = 5000; // au-delà des bordereaux nommés par les maquettes (BV-0044xx)
const nouveauBordereau = () => `BV-00${bordereauSuivant += entier(3, 9)}`;
const modeAuHasard = (): Prevu['mode'] => { const r = hasard(); return r < 0.88 ? 'especes' : r < 0.97 ? 'versement_bancaire' : r < 0.985 ? 'virement' : 'cheque'; };
const arrondi = (x: number) => Math.round(x / 1000) * 1000;

function aPayer(e: Eleve, a: Annee, ordre: number) {
  const l = passageDe(e, a).lignes!.find((x) => x.ordre === ordre);
  return (l?.aPayer ?? 0) - (a.courante ? (e.reductions?.find((r) => r.ordre === ordre)?.montant ?? 0) : 0);
}

/** Échéancier de versements d'un élève pour l'année : profils de l'année en cours (maquettes) ou des années passées (soldé, arriéré). */
function planifier(e: Eleve, a: Annee): Prevu[] {
  const p = passageDe(e, a);
  const arriere = p.lignes!.find((l) => l.ordre === 0)?.aPayer ?? 0;
  const [ins, t1, t2, t3] = [aPayer(e, a, 1), aPayer(e, a, 2), aPayer(e, a, 3), aPayer(e, a, 4)];
  const r: Prevu[] = [];
  const ajouter = (jour: string | null, montant: number) => {
    if (!jour || montant <= 0 || jour > a.fin) return;
    const m = modeAuHasard();
    r.push({ jour, minute: entier(7 * 60 + 50, 16 * 60 + 10), eleve: e, montant, mode: m, bordereau: m === 'versement_bancaire' ? nouveauBordereau() : undefined });
  };
  const debut = e.inscritLe && e.inscritLe > plusJours(a.rentree, -40) ? e.inscritLe : ouvrableApres(plusJours(a.rentree, -14));
  const D = a.debut;
  if (!a.courante) {
    // Années passées : l'arriéré et l'inscription dès la rentrée, puis les tranches à leur saison ; les « arriérés » laissent la tranche 3.
    ajouter(ouvrableAuPlus(debut), arriere + ins);
    const fin = p.fin === 'depart' ? `${D + 1}-03-30` : `${D + 1}-05-25`;
    if (hasard() < 0.3) { const x = arrondi(t1 / 2); ajouter(jourEntre(plusJours(a.rentree, 3), `${D}-10-15`), x); ajouter(jourEntre(`${D}-10-16`, `${D}-11-30`), t1 - x); }
    else ajouter(jourEntre(plusJours(a.rentree, 3), `${D}-11-30`), t1);
    if (p.profil === 'arriere') {
      if (hasard() < 0.6) ajouter(jourEntre(`${D}-12-01`, `${D + 1}-02-28`), arrondi(t2 * choisir([0.5, 1])));
    } else {
      ajouter(jourEntre(`${D}-12-01`, `${D + 1}-02-28`), t2);
      if (hasard() < 0.25) { const x = arrondi(t3 / 2); ajouter(jourEntre(`${D + 1}-03-01`, `${D + 1}-04-15`), x); ajouter(jourEntre(`${D + 1}-04-16`, fin), t3 - x); }
      else ajouter(jourEntre(`${D + 1}-03-01`, fin), t3);
    }
    return r;
  }
  if (p.profil === 'attente') return r;
  ajouter(ouvrableAuPlus(debut), arriere + ins);
  const t1Du = plusJours(a.rentree, 3), t1Au = `${D}-09-30`;
  switch (p.profil) {
    case 'solde':
      ajouter(jourEntre(t1Du, t1Au), t1);
      ajouter(jourEntre(`${D}-10-05`, `${D}-10-31`), t2);
      ajouter(jourEntre(`${D}-11-01`, plusJours(AUJ, -1)), t3);
      break;
    case 'bon': {
      if (hasard() < 0.3) { const x = arrondi(t1 / 2); ajouter(jourEntre(t1Du, `${D}-09-18`), x); ajouter(jourEntre(`${D}-09-19`, t1Au), t1 - x); }
      else ajouter(jourEntre(t1Du, t1Au), t1);
      ajouter(jourEntre(`${D}-10-12`, plusJours(AUJ, -1)), arrondi(t2 * choisir([0, 0, 0.25, 0.5, 0.5, 1])));
      break;
    }
    case 'moyen': ajouter(jourEntre(t1Du, `${D}-10-25`), arrondi(t1 * choisir([0.4, 0.5, 0.6, 0.7]))); break;
    case 'tardif': ajouter(jourEntre(`${D}-10-06`, plusJours(AUJ, -1)), t1); break;
    default: break;
  }
  return r;
}

const MODELE_RELANCE = {
  fr: 'Bonjour [responsable], il reste [montant] FCFA à régler pour [élève] ([classe]) depuis le [date limite]. Merci de passer à la caisse ou de déposer à la banque. [école]',
  en: 'Hello [responsable], [montant] FCFA is still due for [élève] ([classe]) since [date limite]. Please pay at the cashier’s office or at the bank. [school]',
};
const SORTIES_ANNEE: [string, string, number, string, 'sec' | 'eco', string][] = [
  // objet, catégorie, montant, motif, demandeur, mois (MM de l'année scolaire, 09..06)
  ['Cahiers et craies de la rentrée', 'Fournitures', 52000, 'Rentrée des classes', 'sec', '09'], ['Produits d’entretien', 'Entretien', 18500, 'Stock épuisé', 'sec', '09'],
  ['Facture d’eau de septembre', 'Eau et électricité', 22000, 'Facture du mois', 'eco', '10'], ['Vacations de septembre · 2 vacataires', 'Personnel vacataire', 60000, 'États signés', 'eco', '10'],
  ['Ramettes de papier', 'Fournitures', 31500, 'Impression des évaluations', 'sec', '10'], ['Réparation de la toiture du préau', 'Entretien', 36500, 'Fuite après l’orage', 'sec', '10'],
  ['Feutres et marqueurs', 'Fournitures', 32000, 'Tableaux blancs des classes', 'sec', '11'], ['Chasubles de sport', 'Sport', 6000, 'Match inter-classes', 'sec', '11'],
  ['Facture d’électricité d’octobre', 'Eau et électricité', 48000, 'Facture du mois', 'eco', '11'], ['Vacations d’octobre · 2 vacataires', 'Personnel vacataire', 60000, 'États signés', 'eco', '11'],
  ['Entretien des toilettes', 'Entretien', 35000, 'Vidange de la fosse', 'sec', '12'], ['Vacations de novembre · 2 vacataires', 'Personnel vacataire', 60000, 'États signés', 'eco', '12'],
  ['Fête de fin d’année · décorations', 'Fournitures', 45000, 'Fête de Noël des maternelles', 'sec', '12'], ['Facture d’électricité de décembre', 'Eau et électricité', 41000, 'Facture du mois', 'eco', '01'],
  ['Vacations de janvier · 2 vacataires', 'Personnel vacataire', 60000, 'États signés', 'eco', '02'], ['Peinture des salles de maternelle', 'Entretien', 120000, 'Travaux des vacances de février', 'sec', '02'],
  ['Ballons et filets', 'Sport', 28000, 'Tournoi inter-écoles', 'sec', '03'], ['Facture d’eau de février', 'Eau et électricité', 24000, 'Facture du mois', 'eco', '03'],
  ['Vacations de mars · 2 vacataires', 'Personnel vacataire', 60000, 'États signés', 'eco', '04'], ['Photocopies des compositions', 'Fournitures', 38000, 'Compositions du 3e trimestre', 'sec', '05'],
  ['Vacations de mai · 2 vacataires', 'Personnel vacataire', 60000, 'États signés', 'eco', '06'], ['Facture d’électricité de mai', 'Eau et électricité', 39000, 'Facture du mois', 'eco', '06'],
];

export async function financesAnnee(ctx: Contexte, a: Annee) {
  const { eco, dir, sec, horloge } = ctx;
  const eleves = elevesDe(ctx.eleves, a.debut).filter((e) => passageDe(e, a).inscriptionId && passageDe(e, a).lignes);
  // Réductions de l'année en cours, juste après l'inscription.
  if (a.courante) {
    for (const e of eleves.filter((x) => x.reductions)) {
      const p = passageDe(e, a);
      for (const r of e.reductions!) {
        const l = p.lignes!.find((x) => x.ordre === r.ordre);
        if (!l) continue;
        const jour = ouvrableAuPlus(plusJours(e.inscritLe! < a.rentree ? plusJours(a.rentree, -3) : e.inscritLe!, 1));
        const res = await horloge.a(aLHeure(jour, '09:15'), () => eco.post<{ appliquee: boolean; demandeId: string | null }>('/finances/reductions', { ligneEcheanceId: l.id, montant: r.montant, motif: r.motif }));
        if (!res.appliquee) await horloge.a(aLHeure(ouvrableAuPlus(plusJours(jour, 2)), '11:40'), () => dir.post(`/finances/demandes/${res.demandeId}/decision`, { decision: 'validee' }));
      }
    }
  }
  const prevus: Prevu[] = eleves.filter((e) => passageDe(e, a).profil !== 'fixe').flatMap((e) => planifier(e, a));
  if (a.courante) versementsNommes(ctx, a, prevus);

  // Sorties de caisse : demandes de la secrétaire et de l'économe, validées par la directrice (RG-19, E-42).
  await eco.get('/caisse/sorties'); // crée les catégories par défaut si besoin
  const categories = (await ctx.proprio.query<{ id: string; libelle: string }>('SELECT id, libelle FROM caisse.categorie')).rows;
  const cat = (l: string) => categories.find((c) => c.libelle === l)!.id;
  // Budgets : ils se règlent pour la période en cours (année en cours seulement).
  if (a.courante) await horloge.a(aLHeure(ouvrableApres(plusJours(a.rentree, 2)), '12:00'), async () => {
    for (const [l, m] of [['Fournitures', 400000], ['Entretien', 400000], ['Eau et électricité', 300000], ['Personnel vacataire', 500000], ['Sport', 80000]] as const) {
      await eco.put(`/caisse/categories/${cat(l)}/budget`, { montant: m });
    }
  });
  type Sortie = { objet: string; categorie: string; montant: number; motif: string; par: Client; demande: string; decision: 'validee' | 'refusee' | null; decaisse: string | null; piece?: string };
  const plan: Sortie[] = [];
  for (const [objet, categorie, montant, motif, qui, mois] of SORTIES_ANNEE) {
    const annee = Number(mois) >= 9 ? a.debut : a.debut + 1;
    const j = jourEntre(`${annee}-${mois}-02`, `${annee}-${mois}-26`);
    if (!j || j > ouvrableAvant(12)) continue;
    plan.push({ objet, categorie, montant, motif, par: qui === 'sec' ? sec : eco, demande: j, decision: 'validee', decaisse: ouvrableAuPlus(plusJours(j, 1)), piece: hasard() < 0.4 ? 'États signés' : 'Facture' });
  }
  if (a.courante) {
    plan.push(
      { objet: 'Achat d’un ballon', categorie: 'Sport', montant: 12000, motif: 'Ballon crevé pendant l’EPS', par: sec, demande: ouvrableAvant(8), decision: 'refusee', decaisse: null },
      { objet: 'Facture d’électricité du mois', categorie: 'Eau et électricité', montant: 48000, motif: 'Facture du mois', par: eco, demande: ouvrableAvant(2), decision: 'validee', decaisse: null },
    );
  }
  const ids: Record<string, string> = {};
  for (const s of plan) {
    const r = await horloge.a(aLHeure(s.demande, hhmm(entier(8 * 60, 11 * 60))), () => s.par.post<{ id: string }>('/caisse/sorties', { objet: s.objet, categorieId: cat(s.categorie), montant: s.montant, motif: s.motif }));
    ids[s.objet] = r.id;
    if (s.decision) await horloge.a(aLHeure(s.demande, hhmm(entier(14 * 60, 16 * 60 + 30))), () => dir.post(`/caisse/sorties/${r.id}/decision`,
      { decision: s.decision, motif: s.decision === 'refusee' ? 'Budget du sport à revoir au conseil d’établissement' : null }));
  }
  // Annulations (RG-16) : versement saisi sur le mauvais élève, montant mal saisi.
  const erreurs = a.courante ? [
    { nom: 'ACHU Blessing', jour: ouvrableAvant(entier(12, 15)), minute: 15 * 60 + 40, montant: 5000, motif: 'Montant mal saisi' },
    { nom: 'NGWA Collins', jour: ouvrableAvant(4), minute: 9 * 60 + 12, montant: 15000, motif: 'Versement saisi sur le mauvais élève' },
  ] : [1, 2, 3].map((k) => ({ nom: nomDe(choisir(eleves)), jour: jourEntre(`${a.debut}-${jj(8 + k)}-05`, `${a.debut}-${jj(8 + k)}-25`) ?? a.rentree, minute: 14 * 60 + k * 17, montant: 5000, motif: k % 2 ? 'Montant mal saisi' : 'Versement saisi sur le mauvais élève' }));

  // Journées de caisse : ouverture, versements, annulations, décaissements, dépôts, clôture.
  const dernier = a.courante ? AUJ : plusJours(a.fin, 20);
  const jours = [...new Set([...prevus.map((p) => p.jour), ...erreurs.map((e) => e.jour), ...plan.map((s) => s.decaisse).filter((x): x is string => !!x)])].filter((j) => j < dernier && j < AUJ).sort();
  const mercredis = jours.filter((x) => jourSemaine(x) === 3);
  let depots = 0;
  for (const [n, jour] of jours.entries()) {
    const aDecaisser = plan.filter((x) => x.decaisse === jour && x.decision === 'validee').reduce((t, x) => t + x.montant, 0);
    const session = await horloge.a(aLHeure(jour, hhmm(7 * 60 + entier(30, 45))), () => eco.post<{ id: string }>('/caisse/sessions', { caisse: 'principale', fondsInitial: 20000 + aDecaisser }));
    const duJour = prevus.filter((x) => x.jour === jour).sort((x, y) => x.minute - y.minute);
    // Tous les versements de la journée dans une seule opération datée ; l'heure de chacun est posée ensuite.
    const faits: { id: string; minute: number }[] = [];
    await horloge.a(aLHeure(jour, '09:00'), async () => {
      for (const p of duJour) {
        const insc = passageDe(p.eleve, a).inscriptionId!;
        const etat = await eco.get<{ totaux: { reste: number } }>(`/finances/inscriptions/${insc}/echeancier`);
        const montant = Math.min(p.montant, etat.totaux.reste);
        if (montant <= 0) continue;
        const v = await eco.post<{ id: string }>('/finances/versements', { inscriptionId: insc, montant, mode: p.mode,
          ...(p.mode === 'versement_bancaire' ? { banque: BANQUE, bordereau: p.bordereau, dateBordereau: jour } : {}) },
        { 'idempotency-key': `fictif-${insc}-${jour}-${p.minute}-${montant}` });
        faits.push({ id: v.id, minute: p.minute });
      }
    });
    if (faits.length) await heuresDesVersements(ctx, jour, faits);
    for (const err of erreurs.filter((x) => x.jour === jour)) {
      const e = ctx.parNom(err.nom);
      const insc = passageDe(e, a).inscriptionId;
      if (!insc) continue;
      const v = await horloge.a(aLHeure(jour, hhmm(err.minute - 30)), () => eco.post<{ id: string }>('/finances/versements', { inscriptionId: insc, montant: err.montant, mode: 'especes' }, { 'idempotency-key': `fictif-erreur-${err.nom}-${jour}` }));
      const an = await horloge.a(aLHeure(jour, hhmm(err.minute - 10)), () => eco.post<{ demandeId: string }>(`/finances/versements/${v.id}/annulation`, { motif: err.motif }));
      await horloge.a(aLHeure(jour, hhmm(err.minute)), () => eco.post(`/finances/demandes/${an.demandeId}/decision`, { decision: 'validee' }));
    }
    for (const s of plan.filter((x) => x.decaisse === jour && x.decision === 'validee')) {
      await horloge.a(aLHeure(jour, '13:15'), async () => {
        await eco.post(`/caisse/sorties/${ids[s.objet]}/decaissement`);
        if (s.piece) await eco.put(`/caisse/sorties/${ids[s.objet]}/piece`, { nom: s.piece, base64: PDF_PIECE, type: 'application/pdf' });
      });
    }
    const j = await eco.get<{ kpi: { attendues: number } }>('/caisse/journee');
    if (jourSemaine(jour) === 3 && j.kpi.attendues > 60000) {
      const dernierMercredi = a.courante && jour === mercredis.at(-1);
      const montant = dernierMercredi ? Math.min(150000, j.kpi.attendues - 20000) : Math.floor((j.kpi.attendues - 20000) / 10000) * 10000;
      depots++;
      await horloge.a(aLHeure(jour, '15:45'), () => eco.post('/caisse/depots', { montant, banque: BANQUE, bordereau: dernierMercredi ? 'BV-004471' : `BV-00${3100 + depots * 7 + (a.debut - DEBUT + 2) * 300}`, deposeLe: jour }));
    }
    const fin = await eco.get<{ kpi: { attendues: number } }>('/caisse/journee');
    const ecart = n === Math.floor(jours.length / 2) ? -500 : 0;
    await horloge.a(aLHeure(jour, hhmm(16 * 60 + entier(30, 50))), () => eco.post(`/caisse/sessions/${session.id}/cloture`, { montantCompte: fin.kpi.attendues + ecart, motifEcart: ecart ? 'Erreur de rendu de monnaie' : null }));
  }

  // Relances : SMS aux familles en retard début octobre et début décembre, avis remis en main propre.
  const sms = async (jour: string | null) => { if (jour) await horloge.a(aLHeure(jour, '17:05'), () => eco.post('/communication/sms', { cible: 'debiteurs', modele: 'relance', texteFr: MODELE_RELANCE.fr, texteEn: MODELE_RELANCE.en })); };
  await sms(jourEntre(`${a.debut}-10-01`, `${a.debut}-10-04`));
  if (!a.courante) { await sms(jourEntre(`${a.debut}-12-08`, `${a.debut}-12-12`)); await sms(jourEntre(`${a.debut + 1}-03-02`, `${a.debut + 1}-03-06`)); }
  if (a.courante) {
    const quinze = jourEntre(`${a.debut}-10-15`, `${a.debut}-10-17`);
    if (quinze) await horloge.a(aLHeure(quinze, '10:00'), () => eco.post('/finances/avis', { inscriptionIds: [passageDe(ctx.parNom('FOKOU Marc'), a).inscriptionId] }));
    const vingt = jourEntre(`${a.debut}-10-20`, `${a.debut}-10-22`);
    if (vingt) await horloge.a(aLHeure(vingt, '17:10'), () => eco.post('/communication/sms', { cible: 'selection', modele: 'relance', texteFr: MODELE_RELANCE.fr, texteEn: MODELE_RELANCE.en,
      inscriptionIds: ['ACHU Blessing', 'MBARGA Aïcha', 'TCHOUA Ivan'].map((n) => passageDe(ctx.parNom(n), a).inscriptionId) }));
    await caisseApeEtDemandes(ctx, a);
  }
}

/** Les versements d'une journée ont été enregistrés d'un trait : on pose l'heure prévue de chacun (reçu, mouvement de caisse, journal). */
async function heuresDesVersements(ctx: Contexte, jour: string, faits: { id: string; minute: number }[]) {
  const ids = faits.map((f) => f.id);
  const heures = faits.map((f) => `${jour}T${hhmm(f.minute)}:00+01:00`);
  await ctx.proprio.query(`
    WITH h AS (SELECT unnest($1::uuid[]) AS id, unnest($2::timestamptz[]) AS t)
    UPDATE finances.versement v SET encaisse_le = h.t FROM h WHERE v.id = h.id`, [ids, heures]);
  await ctx.proprio.query(`
    WITH h AS (SELECT unnest($1::uuid[]) AS id, unnest($2::timestamptz[]) AS t)
    UPDATE caisse.mouvement m SET horodatage = h.t FROM h WHERE m.versement_id = h.id`, [ids, heures]);
  await ctx.proprio.query(`
    WITH h AS (SELECT unnest($1::uuid[]) AS id, unnest($2::timestamptz[]) AS t)
    UPDATE core.journal_audit j SET horodatage = h.t FROM h WHERE j.ligne_id = h.id`, [ids, heures]);
}

/** Situations des élèves des maquettes (Fiche-eleve, Impayes, Releve), pour l'année en cours. */
function versementsNommes(ctx: Contexte, a: Annee, prevus: Prevu[]) {
  const par = (n: string) => ctx.parNom(n);
  const fixe = (nom: string, jour: string, h: string, montant: number, mode: Prevu['mode'] = 'especes', bv?: string) => {
    if (jour >= AUJ || montant <= 0 || !passageDe(par(nom), a).lignes) return;
    const [hh, mm] = h.split(':').map(Number) as [number, number];
    prevus.push({ jour: ouvrableAuPlus(jour), minute: hh * 60 + mm, eleve: par(nom), montant, mode, bordereau: bv });
  };
  const inscription = (nom: string) => ouvrableAuPlus(par(nom).inscritLe!);
  const ins = (nom: string) => aPayer(par(nom), a, 1) + (passageDe(par(nom), a).lignes!.find((l) => l.ordre === 0)?.aPayer ?? 0);
  const t = (nom: string, o: number) => aPayer(par(nom), a, o);
  const D = a.debut;
  fixe('KENFACK Steve', inscription('KENFACK Steve'), '10:20', ins('KENFACK Steve'));
  fixe('KENFACK Steve', `${D}-09-25`, '09:05', t('KENFACK Steve', 2));
  fixe('KENFACK Steve', `${D}-10-20`, '15:30', 10000);
  fixe('KENFACK Loïc', inscription('KENFACK Loïc'), '10:25', ins('KENFACK Loïc'));
  fixe('KENFACK Loïc', `${D}-09-29`, '11:00', 5000);
  fixe('AMOUGOU Steve', inscription('AMOUGOU Steve'), '08:40', ins('AMOUGOU Steve'));
  fixe('AMOUGOU Steve', `${D}-09-22`, '14:10', 10000);
  fixe('ATANGANA Paul', inscription('ATANGANA Paul'), '09:10', ins('ATANGANA Paul'));
  fixe('ATANGANA Paul', `${D}-09-24`, '15:20', 5000);
  fixe('ABENA Christelle', inscription('ABENA Christelle'), '08:15', ins('ABENA Christelle'));
  fixe('ABENA Christelle', `${D}-09-15`, '10:40', t('ABENA Christelle', 2));
  fixe('ABENA Christelle', `${D}-10-14`, '11:30', t('ABENA Christelle', 3));
  fixe('ABENA Christelle', ouvrableAvant(8), '09:25', t('ABENA Christelle', 4));
  fixe('BELLO Aminatou', inscription('BELLO Aminatou'), '11:45', ins('BELLO Aminatou'));
  fixe('BELLO Aminatou', `${D}-09-21`, '08:55', t('BELLO Aminatou', 2));
  fixe('DJOMO Josiane', inscription('DJOMO Josiane'), '09:35', ins('DJOMO Josiane'));
  fixe('DJOMO Josiane', `${D}-09-28`, '10:00', t('DJOMO Josiane', 2));
  fixe('DJOMO Patrick', inscription('DJOMO Josiane'), '09:30', ins('DJOMO Patrick'));
  fixe('DJOMO Patrick', `${D}-10-02`, '10:45', t('DJOMO Patrick', 2) - 10000);
  fixe('ESSOMBA Ruth', inscription('ESSOMBA Ruth'), '13:05', ins('ESSOMBA Ruth'));
  fixe('ESSOMBA Ruth', `${D}-09-23`, '09:45', t('ESSOMBA Ruth', 2) - 8000);
  fixe('EWANE Sandra', inscription('EWANE Sandra'), '10:50', ins('EWANE Sandra'));
  fixe('EWANE Sandra', `${D}-09-27`, '12:10', t('EWANE Sandra', 2) - 12000);
  fixe('MBAH Kevin', inscription('MBAH Kevin'), '14:30', ins('MBAH Kevin'));
  fixe('NDI Emmanuel', inscription('NDI Emmanuel'), '08:25', ins('NDI Emmanuel'));
  fixe('NGWA Collins', inscription('NGWA Collins'), '14:00', ins('NGWA Collins'));
  fixe('NGWA Collins', `${D}-10-09`, '09:20', t('NGWA Collins', 2) - 15000);
  fixe('TCHOUA Ivan', inscription('TCHOUA Ivan'), '15:10', ins('TCHOUA Ivan'));
  fixe('TCHOUA Ivan', `${D}-09-30`, '11:50', t('TCHOUA Ivan', 2) - 10000);
  fixe('ACHU Blessing', inscription('ACHU Blessing'), '12:00', ins('ACHU Blessing'));
  fixe('ACHU Blessing', `${D}-10-03`, '10:30', t('ACHU Blessing', 2) - 18000);
  fixe('MBARGA Aïcha', inscription('MBARGA Aïcha'), '13:20', ins('MBARGA Aïcha'));
  fixe('NJI Brandon', inscription('NJI Brandon'), '11:10', ins('NJI Brandon'));
  fixe('NJI Brandon', `${D}-09-24`, '10:10', t('NJI Brandon', 2));
  fixe('TABI Grace', inscription('TABI Grace'), '10:05', ins('TABI Grace'));
  fixe('TABI Grace', `${D}-09-26`, '09:00', t('TABI Grace', 2));
  fixe('TABI Grace', `${D}-10-16`, '14:45', t('TABI Grace', 3));
  for (const n of ['FOKOU Marc', 'FOTSO Junior', 'NGUEMO Carine', 'TAMO Gisèle', 'WAMBA Estelle', 'ZANG Didier', 'BIKOÏ Laure', 'MBALLA Inès', 'NANA Ulrich', 'NGONO Mireille', 'OWONA Cédric', 'SIMO Vanessa', 'YONGA Fabrice', 'KAMGA Arthur']) {
    fixe(n, inscription(n), hhmm(entier(8 * 60, 15 * 60)), ins(n));
    if (hasard() < 0.7) fixe(n, `${D}-${jj(entier(9, 10))}-${jj(entier(5, 28))}`, hhmm(entier(8 * 60, 15 * 60)), arrondi(t(n, 2) * choisir([0.5, 1, 1])));
  }
  // Versements bancaires du mois : ils seront rapprochés du relevé (maquette Releve).
  const recents = joursOuvrables(plusJours(AUJ, -12), plusJours(AUJ, -1)).filter((j) => j.slice(0, 7) === AUJ.slice(0, 7));
  const rj = (i: number) => recents.length ? recents[Math.min(i, recents.length - 1)]! : ouvrableAvant(1);
  fixe('NJI Brandon', rj(1), '09:40', 15000, 'versement_bancaire', 'BV-004452');
  fixe('TABI Grace', rj(3), '10:15', t('TABI Grace', 4), 'versement_bancaire', 'BV-004503');
  for (const [i, e] of elevesDe(ctx.eleves, a.debut).filter((x) => passageDe(x, a).profil === 'bon' && passageDe(x, a).lignes).slice(0, 3).entries()) {
    fixe(nomDe(e), rj(i * 2), hhmm(entier(8 * 60, 15 * 60)), Math.min(t(nomDe(e), 4), 10000), 'versement_bancaire', `BV-0044${31 + i * 7}`);
  }
}

async function caisseApeEtDemandes(ctx: Contexte, a: Annee) {
  const { eco, sec, horloge } = ctx;
  const ngo = await connecter(ctx.app, 'ngo.b', motDePasseDemo('ngo.b'));
  const jourApe = ouvrableAvant(3);
  const s = await horloge.a(aLHeure(jourApe, '08:00'), () => ngo.post<{ id: string }>('/caisse/sessions', { caisse: 'ape', fondsInitial: 12000 }));
  for (const [i, m] of [10000, 5000, 10000, 5000].entries()) {
    await horloge.a(aLHeure(jourApe, hhmm(9 * 60 + i * 50)), () => ngo.post('/caisse/entrees', { libelle: `Cotisation APE · famille ${choisir(NOMS_FR)}`, montant: m }));
  }
  await horloge.a(aLHeure(jourApe, '12:30'), () => ngo.post(`/caisse/sessions/${s.id}/cloture`, { montantCompte: 42000, motifEcart: null }));
  // Demandes en attente de la directrice (maquette Validations).
  const mbarga = passageDe(ctx.parNom('MBARGA Aïcha'), a);
  await horloge.a(aLHeure(ouvrableAvant(1), '14:40'), () => eco.post('/finances/reductions', { ligneEcheanceId: mbarga.lignes!.find((l) => l.ordre === 3)!.id, montant: 10000, motif: 'Fratrie de trois enfants' }));
  const talla = ctx.parNom('TALLA Boris');
  await horloge.a(aLHeure(talla.inscritLe!, '11:20'), () => sec.post('/finances/derogations', { inscriptionId: passageDe(talla, a).inscriptionId, motif: `Versement bancaire annoncé pour le ${fr(plusJours(AUJ, 2))}` }));
}

// ---------------------------------------------------------------- affectations et emploi du temps
export async function affectations(ctx: Contexte, a: Annee) {
  await ctx.horloge.a(aLHeure(plusJours(a.rentree, -4), '11:00'), async () => {
    for (const c of CLASSES) await ctx.pre.put('/pedagogie/affectations', { classeId: a.classes[c.nom], matiereId: null, personnelId: ctx.personnel[c.principal[0]] });
    for (const [nom, matiere, classes] of matieresPar(a.debut)) {
      for (const c of classes) await ctx.pre.put('/pedagogie/affectations', { classeId: a.classes[c], matiereId: ctx.matieres[matiere], personnelId: ctx.personnel[nom] });
    }
  });
}

const HEURES = ['07:30', '08:30', '10:00', '11:00', '13:00', '14:00'];
type GrilleEdt = (string | null)[][]; // [heure][jour 0..5]
const MODELE: GrilleEdt = [
  ['Maths', 'Français', 'Maths', 'Français', 'Maths', 'Révisions'],
  ['Français', 'Maths', 'Français', 'Maths', 'Français', 'Révisions'],
  ['Sciences', 'Anglais', 'Histoire-géo.', 'Sciences', 'Anglais', 'Arts'],
  ['Histoire-géo.', 'Éd. civique', 'EPS', 'Anglais', 'Histoire-géo.', 'EPS'],
  ['Français', 'Sciences', null, 'Maths', 'Arts', null],
  ['EPS', 'Maths', null, 'Français', 'Révisions', null],
];
const MODELE_MATERNELLE: GrilleEdt = [
  ['Langage', 'Pré-maths', 'Langage', 'Pré-maths', 'Langage', 'Jeux libres'],
  ['Graphisme', 'Langage', 'Graphisme', 'Langage', 'Graphisme', 'Comptines'],
  ['Motricité', 'Éveil', 'Arts plast.', 'Motricité', 'Éveil', 'Arts plast.'],
  ['Comptines', 'Arts plast.', 'Jeux libres', 'Comptines', 'Pré-maths', null],
  ['Sieste', 'Sieste', null, 'Sieste', 'Sieste', null],
  ['Jeux libres', 'Éveil', null, 'Langage', 'Jeux libres', null],
];
const J: Record<string, number> = { Lun: 0, Mar: 1, Mer: 2, Jeu: 3, Ven: 4, Sam: 5 };
const cellule = (c: string): [number, number] => { const [j, h] = c.split(' '); return [HEURES.indexOf(h!), J[j!]!]; };
const ECHANGES: Record<string, [string, string][]> = {
  'CM1 A': [['Lun 14:00', 'Lun 13:00'], ['Sam 11:00', 'Sam 10:00'], ['Mar 10:00', 'Mar 11:00'], ['Jeu 11:00', 'Jeu 10:00'], ['Ven 10:00', 'Ven 11:00']],
  'CE2 B': [['Lun 14:00', 'Mar 13:00'], ['Mer 11:00', 'Jeu 13:00'], ['Sam 11:00', 'Sam 08:30']],
  'CE2 A': [['Lun 14:00', 'Mar 14:00'], ['Mer 11:00', 'Ven 11:00'], ['Sam 11:00', 'Sam 07:30']],
  'CE1 A': [['Lun 14:00', 'Jeu 14:00'], ['Mer 11:00', 'Ven 13:00'], ['Sam 11:00', 'Mer 10:00']],
  'Class 4': [['Lun 14:00', 'Mar 14:00'], ['Mer 11:00', 'Jeu 13:00'], ['Sam 11:00', 'Sam 10:00']],
  'Class 5': [['Lun 14:00', 'Lun 13:00'], ['Mer 11:00', 'Mer 10:00'], ['Sam 11:00', 'Ven 14:00']],
  'Class 6': [['Lun 14:00', 'Mar 13:00'], ['Mer 11:00', 'Jeu 14:00'], ['Sam 11:00', 'Ven 13:00']],
};
const INFO: Record<string, string> = { 'CM1 A': 'Jeu 14:00', 'CE2 B': 'Ven 13:00', 'CE2 A': 'Mar 13:00' };

export function grilleEdt(classe: string, a: Annee, avantModification = false): GrilleEdt {
  const niveau = classeDe(classe).niveau;
  const g = (maternelle(niveau) ? MODELE_MATERNELLE : MODELE).map((l) => [...l]);
  if (anglophone(niveau)) for (const l of g) for (let j = 0; j < 6; j++) l[j] = l[j] === 'Français' ? 'Anglais' : l[j] === 'Anglais' ? 'Français' : l[j]!;
  for (const [x, y] of ECHANGES[classe] ?? []) {
    const [h1, j1] = cellule(x), [h2, j2] = cellule(y);
    [g[h1]![j1], g[h2]![j2]] = [g[h2]![j2]!, g[h1]![j1]!];
  }
  if (INFO[classe] && matieresPar(a.debut).some(([, m, cl]) => m === 'Informatique' && cl.includes(classe))) { const [h, j] = cellule(INFO[classe]!); g[h]![j] = 'Informatique'; }
  // CM2 A, année en cours : le vendredi 14:00 passe de « Maths » à « Révisions » le 06/11 ; la modification attend la validation du préfet.
  if (classe === 'CM2 A' && a.courante && avantModification) g[5]![4] = 'Maths';
  return g;
}

export async function emploiDuTemps(ctx: Contexte, a: Annee, concurrence = 1) {
  const { pre, horloge } = ctx;
  const edt = await pre.get<{ creneaux: { id: string; debut: string; type: string }[] }>(`/pedagogie/edt?classeId=${a.classes['CM2 A']}`);
  const creneau = (h: string) => edt.creneaux.find((c) => c.debut === h && c.type === 'cours')!.id;
  const placer = async (cl: Client, classe: string, h: number, j: number, v: string | null) => {
    if (!v) return;
    const matiere = ABREGES[v];
    await cl.put('/pedagogie/edt/cours', { classeId: a.classes[classe], jour: j + 1, creneauId: creneau(HEURES[h]!), matiereId: matiere ? ctx.matieres[matiere] : null, libelle: matiere ? null : v });
  };
  const classe = async ([i, c]: [number, (typeof CLASSES)[number]]) => {
    const cl = principalDe(ctx, c.nom);
    const g = grilleEdt(c.nom, a, true);
    await horloge.a(aLHeure(plusJours(a.rentree, -3), hhmm(9 * 60 + i * 5)), async () => {
      for (let h = 0; h < HEURES.length; h++) for (let j = 0; j < 6; j++) await placer(cl, c.nom, h, j, g[h]![j]!);
      await cl.post(`/pedagogie/edt/${a.classes[c.nom]}/soumission`);
    });
    await horloge.a(aLHeure(plusJours(a.rentree, -2), hhmm(10 * 60 + i * 3)), () => pre.post(`/pedagogie/edt/${a.classes[c.nom]}/publication`, {}));
  };
  // Classes en parallèle seulement sans horloge réelle (générateur rapide) : l'horloge décale les dates opération par opération.
  const liste = [...CLASSES.entries()];
  let k = 0;
  await Promise.all(Array.from({ length: concurrence }, async () => { while (k < liste.length) await classe(liste[k++]!); }));
  if (a.courante) {
    // Modification de CM2 A par M. ONANA, soumise au préfet (maquette : étape « Validation »).
    const onana = ctx.comptes['onana.b']!;
    await horloge.a(aLHeure(ouvrableAvant(4), '16:20'), async () => {
      await placer(onana, 'CM2 A', 5, 4, 'Révisions');
      await onana.post(`/pedagogie/edt/${a.classes['CM2 A']}/soumission`);
    });
  }
}

// ---------------------------------------------------------------- notes, bulletins, conseils
const arrondiNote = (x: number) => Math.max(1, Math.min(19.5, Math.round(x * 2) / 2));
const decalageMatiere = new Map<string, number>();
const noteDe = (e: Eleve, matiere: string, a: Annee) => {
  const k = `${nomDe(e)}|${matiere}`;
  if (!decalageMatiere.has(k)) decalageMatiere.set(k, (hasard() - 0.5) * 5);
  const derive = (a.debut - DEBUT) * 0.4 * (hasard() - 0.5);
  return arrondiNote(e.niveauScolaire + decalageMatiere.get(k)! + derive + (hasard() - 0.5) * 3);
};
// Séquence 2 · mathématiques en CM2 A, telle que la maquette Notes la montre (10 notes sur 12).
const MATHS_S2: Record<string, number | null | 'absent'> = { 'ABENA Christelle': 15, 'BELLO Aminatou': 12.5, 'DJOMO Josiane': 14, 'ESSOMBA Ruth': 9,
  'FOKOU Marc': 11, 'FOTSO Junior': null, 'NDI Emmanuel': 8.5, 'NGUEMO Carine': 16, 'TAMO Gisèle': 17, 'TCHOUA Ivan': 'absent', 'WAMBA Estelle': 13, 'ZANG Didier': null };
const APPRECIATIONS = ['Bon trimestre, élève sérieux et appliqué.', 'Travail régulier, bonne participation.', 'Ensemble satisfaisant ; peut mieux faire.', 'Des efforts, à poursuivre.',
  'Résultats fragiles : plus de travail à la maison.', 'Très bon trimestre, continuez ainsi.', 'Élève attentif, résultats encourageants.', 'Trimestre insuffisant ; un soutien est nécessaire.'];
const appreciationPour = (e: Eleve, moyenne: number) => moyenne >= 15 ? choisir(['Excellent trimestre, élève sérieux et appliqué.', 'Très bon trimestre, continuez ainsi.'])
  : moyenne >= 12 ? choisir(['Bon trimestre, travail régulier.', 'Travail régulier, bonne participation.', 'Élève attentif, résultats encourageants.'])
    : moyenne >= 10 ? choisir(['Ensemble satisfaisant ; peut mieux faire.', 'Des efforts, à poursuivre.']) : choisir(['Résultats fragiles : plus de travail à la maison.', 'Trimestre insuffisant ; un soutien est nécessaire.', e.sexe === 'F' ? 'Doit se ressaisir au prochain trimestre.' : 'Doit se ressaisir au prochain trimestre.']);

/** Saisit une séquence pour une classe : toutes les matières, par leur titulaire, le même soir. */
async function saisirSequence(ctx: Contexte, a: Annee, classe: string, sequenceId: string, jour: string, choix: (e: Eleve, matiere: string) => { valeur: number | null; statut: string; remarque?: string } | null) {
  const niveau = classeDe(classe).niveau;
  const eleves = elevesClasse(ctx, a, classe);
  if (!eleves.length) return;
  await ctx.horloge.a(aLHeure(jour, hhmm(entier(12 * 60, 18 * 60))), async () => {
    for (const m of matieresDuNiveau(niveau)) {
      const cl = titulaire(ctx, a, classe, m.libelle);
      if (!cl) continue; // Mrs TANYI Rose n'a pas de compte : ses notes ne sont pas saisies (maquette Personnel).
      const lignes = eleves.map((e) => ({ e, n: choix(e, m.libelle) })).filter((x) => x.n).map((x) => ({ inscriptionId: passageDe(x.e, a).inscriptionId, valeur: x.n!.valeur, statut: x.n!.statut, remarque: x.n!.remarque ?? null }));
      if (!lignes.length) continue;
      await cl.put('/pedagogie/saisie', { classeId: a.classes[classe], matiereId: ctx.matieres[m.libelle], sequenceId, faitLe: jour, bareme: 20, notes: lignes });
    }
  });
}

/** Année passée : six séquences, trois bulletins trimestriels, conseils de classe, bulletin annuel et décisions de fin d'année. */
export async function pedagogieAnneePassee(ctx: Contexte, a: Annee) {
  const { pre, dir, horloge } = ctx;
  const jusqua = plusJours(AUJ, 9);
  const moyennes = new Map<string, number[]>();
  for (const p of a.periodes) {
    for (const s of p.sequences) {
      const [du, au] = fenetreSequence(a, s.numero);
      await horloge.a(aLHeure(ouvrableApres(plusJours(du, -7)), '08:00'), () => pre.post(`/pedagogie/sequences/${s.id}/ouverture`, { jusqua }));
      for (const c of CLASSES) {
        await saisirSequence(ctx, a, c.nom, s.id, jourEntre(du, au) ?? du, (e, m) => {
          if (hasard() < 0.02) return { valeur: null, statut: 'absent_justifie' };
          const v = noteDe(e, m, a);
          const k = `${nomDe(e)}|${p.ordre}`;
          moyennes.set(k, [...(moyennes.get(k) ?? []), v]);
          return { valeur: v, statut: 'present' };
        });
      }
      await horloge.a(aLHeure(ouvrableApres(plusJours(au, 3)), '18:00'), () => pre.post(`/pedagogie/sequences/${s.id}/fermeture`, {}));
    }
    // Fusion par le principal (appréciations générales), publication par le préfet.
    const finSaisie = ouvrableApres(plusJours(fenetreSequence(a, p.sequences.at(-1)!.numero)[1], 4));
    for (const [i, c] of CLASSES.entries()) {
      const principal = principalDe(ctx, c.nom);
      const eleves = elevesClasse(ctx, a, c.nom);
      await horloge.a(aLHeure(ouvrableApres(plusJours(finSaisie, Math.floor(i / 8))), hhmm(14 * 60 + (i % 8) * 20)), async () => {
        await principal.post('/pedagogie/fusion/calcul', { classeId: a.classes[c.nom], periodeId: p.id });
        for (const e of eleves) {
          if (hasard() < 0.35) continue;
          const notes = moyennes.get(`${nomDe(e)}|${p.ordre}`) ?? [12];
          await principal.put('/pedagogie/appreciations', { periodeId: p.id, inscriptionId: passageDe(e, a).inscriptionId, matiereId: null, texte: appreciationPour(e, notes.reduce((x, y) => x + y, 0) / notes.length) });
        }
        await principal.post('/pedagogie/fusion/transmission', { classeId: a.classes[c.nom], periodeId: p.id });
      });
    }
    const jourPublication = ouvrableApres(plusJours(finSaisie, 5));
    await horloge.a(aLHeure(jourPublication, '10:00'), async () => {
      for (const c of CLASSES) await pre.post('/pedagogie/bulletins/publication', { classeId: a.classes[c.nom], periodeId: p.id });
    });
    // Conseil de classe : distinctions ; en fin d'année, décisions de passage.
    const dernier = p.ordre === a.periodes.length;
    await horloge.a(aLHeure(ouvrableApres(plusJours(jourPublication, 1)), '15:00'), async () => {
      for (const c of CLASSES) {
        const eleves = elevesClasse(ctx, a, c.nom);
        const items = eleves.map((e) => {
          const notes = moyennes.get(`${nomDe(e)}|${p.ordre}`) ?? [12];
          const m = notes.reduce((x, y) => x + y, 0) / notes.length;
          return { inscriptionId: passageDe(e, a).inscriptionId!, distinction: m >= 14 ? 'tableau_honneur' : m >= 12 ? 'encouragements' : m < 8 ? 'avertissement_travail' : 'aucune' };
        });
        await pre.put('/pedagogie/conseil/distinctions', { classeId: a.classes[c.nom], periodeId: p.id, items });
        if (dernier) {
          const decisions = eleves.map((e) => ({ inscriptionId: passageDe(e, a).inscriptionId!, finAnnee: passageDe(e, a).fin === 'redouble' ? 'redouble' : passageDe(e, a).fin === 'exclu' ? 'exclu' : 'admis' }));
          await dir.put('/pedagogie/conseil/decisions', { classeId: a.classes[c.nom], periodeId: p.id, items: decisions });
        }
      }
    });
  }
  // Bulletin annuel : calcul et publication par le préfet, après le dernier conseil.
  await horloge.a(aLHeure(ouvrableApres(plusJours(a.fin, -2)), '11:00'), async () => {
    for (const c of CLASSES) {
      await pre.post('/pedagogie/bulletins/calcul', { classeId: a.classes[c.nom], periodeId: null });
      await pre.post('/pedagogie/bulletins/publication', { classeId: a.classes[c.nom], periodeId: null });
    }
  });
}

/** Année en cours : séquence 1 fermée, séquence 2 ouverte et en cours de saisie (maquettes Notes, Fusion). */
export async function pedagogieAnneeCourante(ctx: Contexte, a: Annee) {
  const { pre, horloge } = ctx;
  const t1 = a.periodes.find((p) => p.ordre === 1)!;
  const s1 = t1.sequences.find((s) => s.numero === 1)!.id;
  const s2 = t1.sequences.find((s) => s.numero === 2)!.id;
  const jusqua = plusJours(AUJ, 9);
  await horloge.a(aLHeure(ouvrableAuPlus(`${a.debut}-09-28`), '08:00'), () => pre.post(`/pedagogie/sequences/${s1}/ouverture`, { jusqua }));
  for (const c of CLASSES) {
    await saisirSequence(ctx, a, c.nom, s1, ouvrableAuPlus(`${a.debut}-10-${jj(entier(5, 16))}`),
      (e, m) => hasard() < 0.03 ? { valeur: null, statut: 'absent_justifie' } : { valeur: noteDe(e, m, a), statut: 'present' });
  }
  await horloge.a(aLHeure(ouvrableAuPlus(`${a.debut}-10-24`), '18:00'), () => pre.post(`/pedagogie/sequences/${s1}/fermeture`, {}));
  await horloge.a(aLHeure(ouvrableAvant(8), '07:45'), () => pre.post(`/pedagogie/sequences/${s2}/ouverture`, { jusqua }));
  const devoir = ouvrableAvant(4);
  for (const c of CLASSES) {
    if (c.nom === 'CM2 A') {
      let n = 0;
      await saisirSequence(ctx, a, c.nom, s2, devoir, (e, m) => {
        if (m === 'Mathématiques') {
          const v = MATHS_S2[nomDe(e)];
          if (v === 'absent') return { valeur: null, statut: 'absent', remarque: `À rattraper le ${fr(plusJours(AUJ, 1)).slice(0, 5)}` };
          if (v === null) return null;
          return { valeur: v ?? noteDe(e, m, a), statut: 'present' };
        }
        if (m === 'Arts et travaux manuels') return n++ < 8 * 3 && hasard() < 0.7 ? { valeur: noteDe(e, m, a), statut: 'present' } : null;
        return { valeur: noteDe(e, m, a), statut: 'present' };
      });
      continue;
    }
    if (hasard() < 0.35) continue;
    const part = hasard() < 0.5 ? 1 : 0.85;
    await saisirSequence(ctx, a, c.nom, s2, ouvrableAvant(entier(2, 7)), (e, m) => (hasard() < part ? { valeur: noteDe(e, m, a), statut: 'present' } : null));
  }
  // Appréciations générales du principal de CM2 A (bulletin).
  const onana = ctx.comptes['onana.b']!;
  const textes: Record<string, string> = {
    'TAMO Gisèle': 'Excellent trimestre, élève sérieuse et appliquée.', 'NGUEMO Carine': 'Très bon travail, continuez ainsi.',
    'ABENA Christelle': 'Bon trimestre ; soigner davantage l’écriture.', 'DJOMO Josiane': 'Travail régulier, bonne participation.',
    'BELLO Aminatou': 'Bon trimestre. Exposé de sciences remarquable.', 'WAMBA Estelle': 'Ensemble satisfaisant ; peut mieux faire en calcul.',
    'ESSOMBA Ruth': 'Des efforts, mais les bases en calcul restent fragiles.', 'NDI Emmanuel': 'Trimestre insuffisant ; plus de travail à la maison.',
  };
  await horloge.a(aLHeure(ouvrableAvant(2), '17:30'), async () => {
    for (const [nom, texte] of Object.entries(textes)) await onana.put('/pedagogie/appreciations', { periodeId: t1.id, inscriptionId: passageDe(ctx.parNom(nom), a).inscriptionId, matiereId: null, texte });
  });
  await cahier(ctx, a);
}

// ---------------------------------------------------------------- cahier de textes (maquettes Emploi-du-temps, Mobile-parent-agenda)
const SEANCES: Record<string, { contenu: string; devoir?: string }[]> = {
  Maths: [{ contenu: 'Fractions : addition de fractions de même dénominateur.', devoir: 'Exercices 4 à 7, page 52.' },
    { contenu: 'Problèmes de partage et de proportionnalité.', devoir: 'Problème 3, page 61.' }, { contenu: 'Mesures de longueur : conversions.' }],
  Français: [{ contenu: 'Dictée préparée et accord du participe passé.', devoir: 'Apprendre la liste de mots, page 40.' },
    { contenu: 'Lecture : « Le petit marchand de Douala ».', devoir: 'Répondre aux questions 1 à 4.' }, { contenu: 'Conjugaison : le passé composé.' }],
  Anglais: [{ contenu: 'Vocabulary: the market and food.', devoir: 'Learn the ten new words.' }],
  Sciences: [{ contenu: 'Le cycle de l’eau.', devoir: 'Schéma du cycle de l’eau à recopier.' }, { contenu: 'Les parties de la plante.' }],
  'Histoire-géo.': [{ contenu: 'Les régions du Cameroun et leurs chefs-lieux.', devoir: 'Situer les dix chefs-lieux sur la carte.' }],
  'Éd. civique': [{ contenu: 'Les symboles de la République.' }],
  EPS: [{ contenu: 'Course de relais par équipes de quatre.', devoir: 'Tenue de sport lundi.' }],
  Arts: [{ contenu: 'Dessin d’observation : une feuille de manguier.' }],
  Révisions: [{ contenu: 'Fractions : addition de fractions de même dénominateur.', devoir: 'Exercices 4 à 7, page 52, pour lundi.' }],
  Informatique: [{ contenu: 'Découverte du clavier et de la souris.' }],
};
async function cahier(ctx: Contexte, a: Annee) {
  const jours = [ouvrableAvant(2), ouvrableAvant(1), ...(ouvrable(AUJ) ? [AUJ] : [])];
  for (const classe of ['CM2 A', 'CE2 B']) {
    const g = grilleEdt(classe, a);
    for (const jour of jours) {
      const j = jourSemaine(jour) - 1;
      if (j < 0 || j > 5) continue;
      const lendemain = ouvrableApres(plusJours(jour, 1));
      for (let h = 0; h < HEURES.length; h++) {
        const v = g[h]![j];
        if (!v || (h > 0 && g[h - 1]![j] === v)) continue;
        const matiere = ABREGES[v] ?? null;
        const cl = matiere ? titulaire(ctx, a, classe, matiere) : principalDe(ctx, classe);
        if (!cl) continue;
        const s = choisir(SEANCES[v] ?? [{ contenu: `${v} : reprise de la leçon.` }]);
        const debutMin = Number(HEURES[h]!.slice(0, 2)) * 60 + Number(HEURES[h]!.slice(3));
        if (jour === AUJ && debutMin > minuteActuelle()) continue;
        await ctx.horloge.a(aLHeure(jour, hhmm(debutMin + 50)), () => cl.post('/pedagogie/seances', { classeId: a.classes[classe], faitLe: jour, heure: HEURES[h],
          matiereId: matiere ? ctx.matieres[matiere] : null, libelle: v, contenu: s.contenu, devoir: s.devoir ?? null, devoirPour: s.devoir ? lendemain : null }));
      }
    }
  }
}

// ---------------------------------------------------------------- appels, absences, observations (maquettes Appel, Discipline)
export async function parent(ctx: Contexte, e: Eleve): Promise<Client> {
  const tel = e.famille.telephone.replace(/\D/g, '');
  if (ctx.parents[tel]) return ctx.parents[tel]!;
  const mdp = `demo-${e.famille.nom.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')}`;
  await ctx.proprio.query(`UPDATE core.compte SET mot_de_passe = $1 WHERE type = 'famille' AND identifiant = $2`, [await hacher(mdp), tel]);
  const r = await ctx.app.inject({ method: 'POST', url: '/api/v1/auth/connexion-parent', payload: { telephone: tel, motDePasse: mdp, client: 'application' } });
  if (r.statusCode !== 200) throw new Error(`Connexion du parent ${tel} refusée : ${r.body}`);
  return (ctx.parents[tel] = new Client(ctx.app, r.json().jeton, `famille ${e.famille.nom}`));
}

type PlanAbsence = { jour: string; moment: 'matin' | 'apres_midi' | 'journee' | 'retard'; minutes?: number };
function avecApresMidi(n: number): string {
  let k = n;
  while ([3, 6].includes(jourSemaine(ouvrableAvant(k)))) k++;
  return ouvrableAvant(k);
}

/** Fait l'appel d'une classe pour une journée : toutes les fiches du jour, par l'instituteur de chaque cours. */
async function appelDuJour(ctx: Contexte, a: Annee, classe: string, jour: string, plans: Record<string, PlanAbsence[]>, tauxAbsence: number) {
  const principal = principalDe(ctx, classe);
  const liste = await principal.get<{ fiches: { id: string; debut: string; fin: string; personnel: string | null; statut: string }[] }>(`/vie-scolaire/appel?classeId=${a.classes[classe]}&jour=${jour}`);
  const fiches = liste.fiches.filter((f) => f.statut !== 'faite' && !(jour === AUJ && Number(f.fin.slice(0, 2)) * 60 + Number(f.fin.slice(3)) > minuteActuelle() - 5));
  if (!fiches.length) return;
  const absentsDuJour = new Map<string, { statut: string; retardMinutes?: number }>();
  await ctx.horloge.a(aLHeure(jour, hhmm(Number(fiches[0]!.debut.slice(0, 2)) * 60 + Number(fiches[0]!.debut.slice(3)) + entier(3, 12))), async () => {
    for (const f of fiches) {
      const cl = f.personnel ? ctx.clientDe(f.personnel) : undefined;
      if (!cl) continue; // Mrs TANYI Rose, sans compte : la fiche reste à faire.
      const d = await cl.get<{ fiche: { eleves: { inscriptionId: string; nom: string }[] } }>(`/vie-scolaire/appel?classeId=${a.classes[classe]}&jour=${jour}&ficheId=${f.id}`);
      const matin = f.debut < '12:00';
      const presences = d.fiche.eleves.map((x) => {
        const p = (plans[x.nom] ?? []).find((y) => y.jour === jour);
        if (p?.moment === 'journee' || (p?.moment === 'matin' && matin) || (p?.moment === 'apres_midi' && !matin)) return { inscriptionId: x.inscriptionId, statut: 'absent' };
        if (p?.moment === 'retard' && f.debut === '07:30') return { inscriptionId: x.inscriptionId, statut: 'retard', retardMinutes: p.minutes };
        if (!plans[x.nom]) {
          const deja = absentsDuJour.get(x.inscriptionId);
          if (deja) return { inscriptionId: x.inscriptionId, ...(deja.statut === 'absent' ? { statut: 'absent' } : { statut: 'present' }) };
          if (hasard() < tauxAbsence) { const s = { statut: hasard() < 0.7 ? 'absent' : 'retard', retardMinutes: entier(5, 25) }; absentsDuJour.set(x.inscriptionId, s); return { inscriptionId: x.inscriptionId, ...s }; }
        }
        return { inscriptionId: x.inscriptionId, statut: 'present' };
      });
      await cl.put(`/vie-scolaire/appel/${f.id}`, { presences });
    }
  });
}

export async function vieScolaireAnnee(ctx: Contexte, a: Annee) {
  if (!a.courante) {
    // Années passées : quatre journées d'appel par trimestre pour chaque classe, avec quelques absences et justifications.
    for (const p of a.periodes) {
      const jours = [1, 2, 3, 4].map((k) => jourEntre(plusJours(p.dateDebut, 7 + (k - 1) * 20), plusJours(p.dateDebut, 7 + k * 20 - 1))).filter((x): x is string => !!x);
      for (const jour of jours) for (const c of CLASSES) await appelDuJour(ctx, a, c.nom, jour, {}, 0.025);
      const justifiables = await ctx.proprio.query<{ id: string; jour: string }>(`
        SELECT a.inscription_id AS id, a.jour::text AS jour FROM vie_scolaire.absence a JOIN scolarite.inscription i ON i.id = a.inscription_id
         WHERE i.annee_id = $1 AND a.statut = 'non_justifiee' AND a.jour BETWEEN $2 AND $3 ORDER BY random() LIMIT 12`, [a.id, p.dateDebut, p.dateFin]);
      for (const j of justifiables.rows) {
        await ctx.horloge.a(aLHeure(ouvrableApres(plusJours(j.jour, 1)), '16:10'), () => ctx.sec.post('/vie-scolaire/absences/justification',
          { inscriptionId: j.id, jour: j.jour, motif: choisir(['Certificat médical remis', 'Mot des parents', 'Raison familiale', 'Convocation administrative']) }).catch(() => null));
      }
    }
    // Quelques observations et sanctions dans l'année.
    for (let k = 0; k < 6; k++) {
      const c = choisir(CLASSES.filter((x) => !maternelle(x.niveau)));
      const eleves = elevesClasse(ctx, a, c.nom);
      if (!eleves.length) continue;
      const e = choisir(eleves);
      const jour = jourEntre(plusJours(a.rentree, 20), plusJours(a.fin, -20));
      if (!jour) continue;
      const [type, description, sanction] = choisir([['retard', 'Retards répétés', 'Avertissement écrit aux parents'], ['travail_non_fait', 'Devoirs non rendus deux fois', null],
        ['comportement', 'Bagarre dans la cour', 'Retenue de 2 h'], ['felicitations', 'Exposé remarquable', null], ['tenue', 'Tenue incomplète', null]] as [string, string, string | null][]);
      await ctx.horloge.a(aLHeure(jour, hhmm(entier(10 * 60, 16 * 60))), () => principalDe(ctx, c.nom).post('/vie-scolaire/observations',
        { inscriptionId: passageDe(e, a).inscriptionId, type, description, sanction, matiereId: null, survenuLe: jour }));
    }
    return;
  }
  const plans: Record<string, PlanAbsence[]> = {
    'FOKOU Marc': [{ jour: avecApresMidi(4), moment: 'journee' }, { jour: avecApresMidi(9), moment: 'journee' }],
    'NDI Emmanuel': [{ jour: ouvrableAvant(6), moment: 'matin' }, { jour: ouvrableAvant(8), moment: 'matin' }],
    'KAMGA Arthur': [{ jour: ouvrableAvant(1), moment: 'matin' }, { jour: ouvrableAvant(7), moment: 'matin' }, ...[10, 8, 5, 3].map((n) => ({ jour: ouvrableAvant(n), moment: 'retard' as const, minutes: entier(10, 20) }))],
    'NGONO Mireille': [{ jour: ouvrableAvant(5), moment: 'matin' }],
    'ACHU Blessing': [{ jour: avecApresMidi(6), moment: 'apres_midi' }],
    'KENFACK Steve': [{ jour: ouvrableAvant(2), moment: 'matin' }],
  };
  // Depuis la rentrée : deux journées d'appel par semaine pour toutes les classes ; chaque jour sur les dix derniers.
  const depuisRentree = joursOuvrables(plusJours(a.rentree, 1), ouvrableAvant(11)).filter((j) => [1, 4].includes(jourSemaine(j)));
  for (const jour of depuisRentree) for (const c of CLASSES) await appelDuJour(ctx, a, c.nom, jour, plans, 0.02);
  const jours = Array.from({ length: 10 }, (_, i) => ouvrableAvant(10 - i));
  for (const jour of [...jours, ...(ouvrable(AUJ) ? [AUJ] : [])]) {
    for (const c of CLASSES) {
      if (jour === AUJ && c.nom === 'CE2 B') continue; // l'appel du jour de CE2 B reste à faire pendant la démonstration
      await appelDuJour(ctx, a, c.nom, jour, plans, 0.012);
    }
  }
  // Justifications (RG-39) : la secrétaire, sur pièce ou mot des parents.
  const justifier = (nom: string, jour: string, motif: string) => ctx.horloge.a(aLHeure(jour, '16:10'), () =>
    ctx.sec.post('/vie-scolaire/absences/justification', { inscriptionId: passageDe(ctx.parNom(nom), a).inscriptionId, jour, motif }));
  await justifier('NDI Emmanuel', plans['NDI Emmanuel']![0]!.jour, 'Consultation médicale, certificat remis');
  await justifier('KAMGA Arthur', plans['KAMGA Arthur']![1]!.jour, 'Rendez-vous chez le dentiste');
  await justifier('NGONO Mireille', plans['NGONO Mireille']![0]!.jour, 'Raison familiale, mot des parents');
  await justifier('ACHU Blessing', plans['ACHU Blessing']![0]!.jour, 'Rendez-vous administratif');
  // Demandes des parents depuis leur application (maquettes Discipline et Messagerie).
  const kamga = ctx.parNom('KAMGA Arthur');
  await ctx.horloge.a(aLHeure(plans['KAMGA Arthur']![0]!.jour, '19:40'), async () => (await parent(ctx, kamga)).post('/portail/absences/justification',
    { inscriptionId: passageDe(kamga, a).inscriptionId, jour: plans['KAMGA Arthur']![0]!.jour, texte: 'malade, certificat à suivre' }));
  const steve = ctx.parNom('KENFACK Steve');
  await ctx.horloge.a(aLHeure(plans['KENFACK Steve']![0]!.jour, '19:02'), async () => (await parent(ctx, steve)).post('/portail/absences/justification',
    { inscriptionId: passageDe(steve, a).inscriptionId, jour: plans['KENFACK Steve']![0]!.jour, texte: 'Bonjour, Steve était malade ce matin. Le certificat médical suivra lundi. Pouvez-vous justifier son absence ?' }));
  // Observations et sanctions.
  const observer = (qui: Client, nom: string, jour: string, type: string, description: string, sanction?: string, matiere?: string) =>
    ctx.horloge.a(aLHeure(jour, hhmm(entier(10 * 60, 16 * 60))), () => qui.post('/vie-scolaire/observations', {
      inscriptionId: passageDe(ctx.parNom(nom), a).inscriptionId, type, description, sanction: sanction ?? null, matiereId: matiere ? ctx.matieres[matiere] : null, survenuLe: jour }));
  await observer(ctx.comptes['bih.m']!, 'MBAH Kevin', ouvrableAvant(22), 'tenue', 'Tenue incomplète, troisième fois');
  await observer(ctx.comptes['eyenga.s']!, 'KAMGA Arthur', ouvrableAvant(10), 'retard', 'Quatre retards en deux semaines', 'Avertissement écrit aux parents');
  await observer(ctx.comptes['onana.b']!, 'NDI Emmanuel', ouvrableAvant(7), 'travail_non_fait', 'Devoir de mathématiques non rendu');
  await observer(ctx.comptes['onana.b']!, 'BELLO Aminatou', ouvrableAvant(5), 'felicitations', 'Exposé remarquable en sciences');
  await observer(ctx.comptes['essama.l']!, 'TCHOUA Ivan', ouvrableAvant(4), 'comportement', 'Bagarre dans la cour', 'Retenue de 2 h', 'Éducation physique et sportive');
}

// ---------------------------------------------------------------- annonces et messagerie
export async function communicationAnnee(ctx: Contexte, a: Annee) {
  const { horloge } = ctx;
  const t1 = a.periodes.find((p) => p.ordre === 1)!;
  const composition = fr(plusJours(t1.dateFin, -4)).slice(0, 5);
  const D = a.debut;
  const annonce = (jour: string | null, qui: Client, corps: Record<string, unknown>) => jour ? horloge.a(aLHeure(jour, hhmm(entier(8 * 60, 12 * 60))), () => qui.post('/communication/annonces', { ...corps, publier: true })) : Promise.resolve();
  await annonce(ouvrableApres(plusJours(a.rentree, -6)), ctx.sec, { titre: `Rentrée des classes le ${fr(a.rentree).slice(0, 5)}`, texteFr: `La rentrée a lieu le ${fr(a.rentree)} à 7 h 30. Tenue complète et fournitures de la liste remise à l’inscription.`,
    texteEn: `School resumes on ${fr(a.rentree)} at 7:30 a.m. Full uniform and the supplies listed at registration.`, cible: 'ecole' });
  await annonce(jourEntre(`${D}-10-01`, `${D}-10-08`), ctx.sec, { titre: 'Réunion des parents de rentrée', texteFr: 'Les parents sont invités à la réunion de rentrée, samedi à 10 h, dans la grande salle.',
    texteEn: 'Parents are invited to the first meeting of the year, on Saturday at 10 a.m., in the main hall.', cible: 'ecole' });
  if (!a.courante) {
    await annonce(jourEntre(`${D}-11-20`, `${D}-11-25`), ctx.pre, { titre: `Compositions du 1er trimestre à partir du ${composition}`, texteFr: `Les compositions du 1er trimestre commencent le ${composition}.`, texteEn: `First-term examinations start on ${composition}.`, cible: 'ecole' });
    await annonce(jourEntre(`${D}-12-10`, `${D}-12-16`), ctx.sec, { titre: 'Fête de Noël des maternelles', texteFr: 'Les enfants de maternelle présentent leur spectacle de Noël vendredi à 15 h.', texteEn: 'Nursery pupils present their Christmas show on Friday at 3 p.m.', cible: 'ecole' });
    await annonce(jourEntre(`${D + 1}-01-20`, `${D + 1}-01-26`), ctx.eco, { titre: 'Rappel : tranche 3 avant le 31 janvier', texteFr: 'La tranche 3 des frais de scolarité est à régler avant le 31 janvier.', texteEn: 'The third instalment of school fees is due before 31 January.', cible: 'debiteurs' });
    await annonce(jourEntre(`${D + 1}-03-02`, `${D + 1}-03-10`), ctx.pre, { titre: 'Remise des bulletins du 2e trimestre', texteFr: 'Les bulletins du 2e trimestre sont remis aux parents samedi, de 9 h à 12 h.', texteEn: 'Second-term report cards are handed to parents on Saturday, 9 a.m. to noon.', cible: 'ecole' });
    await annonce(jourEntre(`${D + 1}-05-25`, `${D + 1}-06-02`), ctx.sec, { titre: 'Fête de fin d’année', texteFr: 'La fête de fin d’année a lieu le dernier samedi de juin, à partir de 9 h.', texteEn: 'The end-of-year celebration takes place on the last Saturday of June, from 9 a.m.', cible: 'ecole' });
    // Quelques messages de parents, avec réponse.
    for (let k = 0; k < 4; k++) {
      const e = choisir(elevesDe(ctx.eleves, a.debut).filter((x) => passageDe(x, a).inscriptionId));
      const jour = jourEntre(plusJours(a.rentree, 15), plusJours(a.fin, -30));
      if (!jour) continue;
      const [dest, texte, reponse, qui] = choisir([
        ['secretaire', 'Bonjour, pouvez-vous me confirmer la date de la réunion des parents ?', 'Bonjour, la réunion a lieu samedi à 10 h. Bonne journée.', ctx.sec],
        ['econome', 'Bonjour, puis-je régler la tranche en deux fois ?', 'Bonjour, oui : chaque versement reçoit son reçu. Passez à la caisse quand vous le souhaitez.', ctx.eco],
        ['instituteur_principal', 'Bonsoir, mon enfant a-t-il bien rendu son cahier ?', 'Bonsoir, oui, tout est en ordre. Bonne soirée.', principalDe(ctx, passageDe(e, a).classe)],
      ] as [string, string, string, Client][]);
      const m = await horloge.a(aLHeure(jour, hhmm(entier(18 * 60, 21 * 60))), async () => (await parent(ctx, e)).post<{ conversationId: string }>('/portail/messages', { destinataire: dest, eleveId: e.eleveId, texte }));
      await horloge.a(aLHeure(ouvrableApres(plusJours(jour, 1)), hhmm(entier(8 * 60, 11 * 60))), () => qui.post(`/communication/conversations/${m.conversationId}/messages`, { texte: reponse }));
    }
    return;
  }
  await horloge.a(aLHeure(ouvrableAvant(4), '12:30'), () => ctx.comptes['onana.b']!.post('/communication/annonces', { titre: 'Tenue de sport obligatoire le lundi',
    texteFr: 'À partir de lundi, la tenue de sport est obligatoire pour les séances d’EPS.', texteEn: 'From Monday, the sports kit is compulsory for PE lessons.', cible: 'classe', cibleId: a.classes['CM2 A'], publier: true }));
  await horloge.a(aLHeure(ouvrableAvant(3), '10:00'), () => ctx.pre.post('/communication/annonces', { titre: `Composition du 1er trimestre à partir du ${composition}`,
    texteFr: `Les compositions du 1er trimestre commencent le ${composition}. Les élèves révisent toutes les leçons depuis la rentrée.`,
    texteEn: `First-term examinations start on ${composition}. Pupils should revise all lessons since the start of the year.`, cible: 'niveau', cibleId: ctx.niveaux['CM2'], publier: true }));
  await horloge.a(aLHeure(ouvrableAvant(2), '09:30'), () => ctx.eco.post('/communication/annonces', { titre: `Rappel : tranche 2 avant le ${fr(`${D}-11-30`).slice(0, 5)}`,
    texteFr: 'La tranche 2 des frais de scolarité est à régler avant le 30 novembre, à la caisse ou à la banque.',
    texteEn: 'The second instalment of school fees is due before 30 November, at the cashier’s office or at the bank.', cible: 'debiteurs', publier: true }));
  await horloge.a(aLHeure(ouvrableAvant(1), '08:30'), () => ctx.sec.post('/communication/annonces', { titre: `Réunion des parents le ${fr(plusJours(AUJ, 3)).slice(0, 5)} à 10:00`,
    texteFr: 'Les parents sont invités à la réunion de rentrée, dans la grande salle. Ordre du jour : résultats de la séquence 1, vie de l’école.',
    texteEn: 'Parents are invited to the first meeting of the year, in the main hall. Agenda: first sequence results, school life.', cible: 'ecole', publier: true }));
  const ecrire = async (nom: string, destinataire: string, jour: string, heure: string, texte: string) => {
    const e = ctx.parNom(nom);
    return horloge.a(aLHeure(jour, heure), async () => (await parent(ctx, e)).post<{ conversationId: string }>('/portail/messages', { destinataire, eleveId: e.eleveId, texte }));
  };
  const bello = await ecrire('BELLO Aminatou', 'secretaire', ouvrableAvant(3), '18:40', 'Merci pour l’exposé de sciences !');
  await horloge.a(aLHeure(ouvrableAvant(2), '08:10'), async () => {
    await ctx.sec.get(`/communication/conversations/${bello.conversationId}`);
    await ctx.sec.post(`/communication/conversations/${bello.conversationId}/messages`, { texte: 'Merci à vous, Monsieur. Nous transmettons vos remerciements à M. ONANA.' });
  });
  const eco = await ecrire('KENFACK Steve', 'econome', ouvrableAvant(6), '19:30', 'Bonjour, puis-je payer la tranche 2 en deux fois ?');
  await horloge.a(aLHeure(ouvrableAvant(5), '09:05'), () => ctx.eco.post(`/communication/conversations/${eco.conversationId}/messages`, { texte: 'Bonjour Madame, oui : passez à la caisse quand vous le souhaitez ; chaque versement reçoit son reçu par SMS.' }));
  await ecrire('KENFACK Steve', 'instituteur_principal', ouvrableAvant(3), '20:05', 'Bonsoir Madame, Steve a-t-il bien rendu son exposé sur le cycle de l’eau ?');
  await horloge.a(aLHeure(ouvrableAvant(2), '12:45'), async () => {
    const c = await ctx.comptes['eyenga.s']!.get<{ conversations: { id: string }[] }>('/communication/conversations');
    if (c.conversations[0]) await ctx.comptes['eyenga.s']!.post(`/communication/conversations/${c.conversations[0].id}/messages`, { texte: 'Bonjour Madame, oui, et il a eu une bonne note.' });
  });
  await ecrire('ATANGANA Paul', 'secretaire', ouvrableAvant(1), '20:15', 'Peut-on payer la tranche 2 en deux fois ?');
  const conv = await ctx.sec.get<{ conversations: { id: string; famille: string; sujet: string | null }[] }>('/communication/conversations');
  const kenfack = conv.conversations.find((c) => c.famille === 'KENFACK' && c.sujet);
  if (kenfack) await ctx.sec.post(`/communication/conversations/${kenfack.id}/messages`, { texte: 'Bonjour Madame, c’est noté. L’absence sera justifiée à réception du certificat. Bon rétablissement à Steve.', brouillon: true });
}

// ---------------------------------------------------------------- départs, année suivante, clôture
export async function departs(ctx: Contexte, a: Annee) {
  for (const e of elevesDe(ctx.eleves, a.debut).filter((x) => passageDe(x, a).fin === 'depart' && passageDe(x, a).inscriptionId)) {
    const jour = hasard() < 0.3 ? jourEntre(`${a.debut + 1}-01-10`, `${a.debut + 1}-03-25`) : jourEntre(`${a.debut + 1}-06-02`, plusJours(a.fin, -1));
    if (!jour) continue;
    await ctx.horloge.a(aLHeure(jour, hhmm(entier(9 * 60, 15 * 60))), () => ctx.sec.post(`/scolarite/inscriptions/${passageDe(e, a).inscriptionId}/depart`,
      { type: 'transfert', motif: choisir(['Déménagement de la famille', 'Mutation du père', 'Rapprochement du domicile', 'Changement d’école à la demande des parents']) }));
  }
}

/** Prépare l'année suivante (en mai), puis clôture l'année : passage des élèves, report des arriérés, ouverture (en juillet). */
export async function cloture(ctx: Contexte, a: Annee, suivante: Annee) {
  await creerAnnee(ctx, suivante, aLHeure(ouvrableApres(`${a.debut + 1}-05-12`), '10:00'), false);
  await ctx.horloge.a(aLHeure(ouvrableApres(`${a.debut + 1}-05-14`), '11:00'), () => ctx.eco.post('/finances/grille/copie', { deAnneeId: a.id, versAnneeId: suivante.id }));
  await grille(ctx, suivante, aLHeure(ouvrableApres(`${a.debut + 1}-05-15`), '09:30'));
  const passages = CLASSES.map((c) => ({ classeId: a.classes[c.nom]!, accueilClasseIds: classesSuivantes(c.nom).map((n) => suivante.classes[n]!) }));
  const r = await ctx.horloge.a(aLHeure(ouvrableApres(`${a.debut + 1}-07-08`), '09:00'), () => ctx.sec.post<{ reinscrits: number; reportes: number }>('/scolarite/cloture', { passages }));
  console.log(`  clôture de ${a.libelle} : ${r.reinscrits} réinscrits, ${r.reportes} arriérés reportés`);
}

// ---------------------------------------------------------------- la journée d'aujourd'hui (maquette Caisse) et les finitions
export async function aujourdhui(ctx: Contexte, a: Annee) {
  const { eco, sec, horloge } = ctx;
  if (ouvrable(AUJ)) {
    const maintenant = minuteActuelle() - 5;
    const heures = [7 * 60 + 42, 8 * 60 + 5, 10 * 60 + 8, 10 * 60 + 55, 11 * 60 + 30, 13 * 60 + 15, 15 * 60 + 7, 15 * 60 + 35];
    const echelle = maintenant >= heures.at(-1)! ? 1 : Math.max(0.02, (maintenant - 6 * 60) / (heures.at(-1)! - 6 * 60));
    const h = (i: number) => aLHeure(AUJ, hhmm(Math.round(6 * 60 + (heures[i]! - 6 * 60) * echelle)));
    await horloge.a(h(0), () => eco.post('/caisse/sessions', { caisse: 'principale', fondsInitial: 20000 }));
    const categories = (await ctx.proprio.query<{ id: string; libelle: string }>('SELECT id, libelle FROM caisse.categorie')).rows;
    const cat = (l: string) => categories.find((c) => c.libelle === l)!.id;
    await horloge.a(h(1), () => sec.post('/caisse/sorties', { objet: 'Réparation du photocopieur', categorieId: cat('Entretien'), montant: 35000, motif: 'Panne depuis la semaine dernière' }));
    const verser = async (i: number, nom: string, montant: number, mode = 'especes', bv?: string) => {
      const insc = passageDe(ctx.parNom(nom), a).inscriptionId;
      await horloge.a(h(i), () => eco.post('/finances/versements', { inscriptionId: insc, montant, mode, ...(bv ? { banque: BANQUE, bordereau: bv, dateBordereau: AUJ } : {}) }, { 'idempotency-key': `fictif-jour-${nom}` }));
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
    SELECT to_char(v.date_bordereau, 'DD/MM/YYYY') AS jour, v.montant::int AS montant, v.bordereau, e.nom || ' ' || left(split_part(rs.nom, ' ', 2), 1) AS nom
      FROM finances.versement v JOIN scolarite.inscription i ON i.id = v.inscription_id JOIN scolarite.eleve e ON e.id = i.eleve_id
      JOIN scolarite.eleve_responsable er ON er.eleve_id = e.id AND er.payeur JOIN scolarite.responsable rs ON rs.id = er.responsable_id
     WHERE v.mode = 'versement_bancaire' AND v.statut = 'valide' AND to_char(v.date_bordereau, 'YYYY-MM') = $1 AND v.date_bordereau < $2::date
     ORDER BY v.date_bordereau, v.numero_recu`, [mois, AUJ]);
  const lignes = v.rows.map((x) => ({ date: x.jour, texte: `${x.jour};VERST ESP ${x.nom};${x.bordereau === 'BV-004503' ? x.montant - 2000 : x.montant};${x.bordereau}` }));
  const d = await ctx.proprio.query<{ jour: string }>(`SELECT to_char(depose_le, 'DD/MM/YYYY') AS jour FROM caisse.depot_banque WHERE bordereau = 'BV-004471' AND to_char(depose_le, 'YYYY-MM') = $1`, [mois]);
  if (d.rows[0]) lignes.push({ date: d.rows[0].jour, texte: `${d.rows[0].jour};VERST CAISSE ECOLE;150000;BV-004471` });
  const vir = fr(joursOuvrables(`${mois}-01`, plusJours(AUJ, -1)).at(-3) ?? ouvrableAvant(1));
  lignes.push({ date: vir, texte: `${vir};VIR MBARGA PAUL;${aPayer(ctx.parNom('MBARGA Aïcha'), a, 2)};` });
  const cle = (x: string) => x.split('/').reverse().join('');
  lignes.sort((x, y) => cle(x.date).localeCompare(cle(y.date)));
  await horloge.a(aLHeure(AUJ, hhmm(Math.max(7 * 60, minuteActuelle() - 20))), () => eco.post('/finances/releve', { mois, csv: ['date;libellé;montant;référence', ...lignes.map((l) => l.texte)].join('\n') }));
}

export async function finaliser(ctx: Contexte) {
  const { proprio } = ctx;
  await proprio.query(`UPDATE core.compte SET mot_de_passe = $1 WHERE type = 'famille' AND identifiant = '600000055'`, [await hacher('demo-kenfack')]);
  await proprio.query(`UPDATE core.compte SET derniere_activite = now() - (random() * interval '30 hours') WHERE type = 'personnel'`);
  await proprio.query(`UPDATE core.compte SET derniere_activite = now() - (random() * interval '6 days') WHERE type = 'famille' AND random() < 0.4`);
  // Heures de vacation des vacataires (affichage seul, E-26).
  for (const [, nom] of MATIERE_SEULE) {
    if (!ctx.personnel[nom]) continue;
    for (const [k, prevues, faites] of [[-1, 24, entier(18, 24)], [0, 24, entier(4, 10)]] as const) {
      const dt = new Date(`${AUJ}T12:00:00Z`);
      dt.setUTCMonth(dt.getUTCMonth() + k, 1);
      await proprio.query(`INSERT INTO personnel.vacation (etablissement_id, personnel_id, mois, heures_prevues, heures_effectuees)
                           SELECT etablissement_id, id, $2::date, $3, $4 FROM personnel.fiche WHERE id = $1 ON CONFLICT DO NOTHING`, [ctx.personnel[nom], dt.toISOString().slice(0, 10), prevues, faites]);
    }
  }
}
