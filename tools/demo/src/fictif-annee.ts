// Structure d'une année par l'API (pour demo:donnees) : établissement, personnel, matières, année et classes,
// grilles de frais, affectations, emplois du temps.
import { Client, connecter } from './client.ts';
import {
  ABREGES, ADMIN, CLASSES, GROUPES, MATIERE_SEULE, anglophone, classeDe, grilleDe, maternelle, matieresDuNiveau, matieresPar,
} from './fictif-ecole.ts';
import { aLHeure, hhmm, motDePasseDemo, ouvrableAvant, plusJours, type Annee, type Contexte } from './fictif-outils.ts';

export const ECOLE = { nomFr: 'Groupe scolaire bilingue La Ruche d’Or', nomEn: 'La Ruche d’Or Bilingual School' };
const BANQUE = 'Banque de Yaoundé';
export const bornesPeriodes = (a: Annee): [string, string][] => [[a.rentree, `${a.debut}-12-04`], [`${a.debut}-12-05`, `${a.debut + 1}-03-19`], [`${a.debut + 1}-03-20`, a.fin]];
export const datesGrille = (a: Annee) => [a.rentree, `${a.debut}-09-30`, `${a.debut}-11-30`, `${a.debut + 1}-01-31`];
const principalDe = (ctx: Contexte, classe: string) => ctx.comptes[classeDe(classe).principal[0]]!;
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
