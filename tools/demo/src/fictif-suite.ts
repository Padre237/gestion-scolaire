// demo:fictif, suite : matières, emploi du temps, notes, cahier de textes, appels, observations, annonces, messagerie.
// Même principe que fictif.ts : tout passe par l'API, l'horloge date chaque opération.
import { hacher } from '@gs/api/src/core/motdepasse.ts';
import { Client } from './client.ts';
import {
  AUJ, CLASSES, DEBUT, aLHeure, choisir, entier, fr, hasard, hhmm, jourSemaine, minuteActuelle, ouvrable, ouvrableAuPlus, ouvrableAvant, plusJours,
  type Contexte, type Eleve,
} from './fictif-outils.ts';

// ---------------------------------------------------------------- matières (maquette Matieres)
const GROUPES: [string, string][] = [['Langues', 'Languages'], ['Sciences', 'Sciences'], ['Sciences humaines', 'Humanities'], ['Activités', 'Activities']];
// libellé, libellé anglais, abrégé, abrégé anglais, groupe, coefficient (francophone), coefficient (anglophone)
const MATIERES: [string, string, string | null, string | null, string, number, number][] = [
  ['Français', 'French', null, null, 'Langues', 4, 2],
  ['Mathématiques', 'Mathematics', 'Maths', 'Maths', 'Sciences', 4, 4],
  ['Anglais', 'English', null, null, 'Langues', 2, 4],
  ['Sciences et technologie', 'Science and Technology', 'Sciences', 'Science', 'Sciences', 2, 2],
  ['Histoire et géographie', 'History and Geography', 'Histoire-géo.', 'History-Geo.', 'Sciences humaines', 2, 2],
  ['Éducation civique et morale', 'Civics and Moral Education', 'Éd. civique', 'Civics', 'Sciences humaines', 1, 1],
  ['Éducation physique et sportive', 'Physical Education', 'EPS', 'PE', 'Activités', 1, 1],
  ['Arts et travaux manuels', 'Arts and Crafts', 'Arts', 'Arts', 'Activités', 1, 1],
];
const INFORMATIQUE: (typeof MATIERES)[number] = ['Informatique', 'Computer Science', null, null, 'Sciences', 1, 1];
const AVEC_INFORMATIQUE = ['CE2', 'CM1'];
const ABREGES: Record<string, string> = { Maths: 'Mathématiques', Français: 'Français', Anglais: 'Anglais', Sciences: 'Sciences et technologie',
  'Histoire-géo.': 'Histoire et géographie', 'Éd. civique': 'Éducation civique et morale', EPS: 'Éducation physique et sportive', Arts: 'Arts et travaux manuels',
  Informatique: 'Informatique' };
// Instituteurs de matière (maquettes Personnel et Matieres).
const MATIERE_PAR: [string, string, string[]][] = [
  ['Mrs TANYI Rose', 'Anglais', ['CM1 A', 'CM2 A']],
  ['M. ESSAMA Luc', 'Éducation physique et sportive', ['CE1 A', 'CE2 A', 'CE2 B', 'CM1 A', 'CM2 A']],
  ['M. FOUDA Serge', 'Informatique', ['CE2 A', 'CE2 B', 'CM1 A']],
  ['Mr FON Desmond', 'Éducation physique et sportive', ['Class 3', 'Class 4', 'Class 5', 'Class 6']],
];

const matieresDuNiveau = (niveau: string) => {
  const anglo = niveau.startsWith('Class');
  const base = anglo ? [MATIERES[2]!, MATIERES[1]!, MATIERES[0]!, ...MATIERES.slice(3)] : [...MATIERES];
  if (AVEC_INFORMATIQUE.includes(niveau)) base.push(INFORMATIQUE);
  return base.map((m) => ({ libelle: m[0], en: m[1], abrege: m[2], abregeEn: m[3], groupe: m[4], coefficient: anglo ? m[6] : m[5] }));
};

async function parametrage(ctx: Contexte) {
  const { pre, horloge } = ctx;
  const groupes: Record<string, string> = {};
  await horloge.a(aLHeure(`${DEBUT}-08-25`, '10:30'), async () => {
    for (const [f, e] of GROUPES) groupes[f] = (await pre.post<{ id: string }>('/pedagogie/groupes', { libelleFr: f, libelleEn: e })).id;
    for (const niveau of [...new Set(CLASSES.map((c) => c.niveau))]) {
      for (const m of matieresDuNiveau(niveau)) {
        const r = await pre.post<{ id: string }>('/pedagogie/matieres', { libelleFr: m.libelle, libelleEn: m.en, abregeFr: m.abrege, abregeEn: m.abregeEn,
          groupeId: groupes[m.groupe], niveauId: ctx.niveaux[niveau], coefficient: m.coefficient, bareme: 20 });
        ctx.matieres[m.libelle] = r.id;
      }
    }
  });
  await horloge.a(aLHeure(`${DEBUT}-08-28`, '11:00'), async () => {
    for (const c of CLASSES) await pre.put('/pedagogie/affectations', { classeId: ctx.classes[c.nom], matiereId: null, personnelId: ctx.personnel[c.principal[0]] });
    for (const [nom, matiere, classes] of MATIERE_PAR) {
      for (const c of classes) await pre.put('/pedagogie/affectations', { classeId: ctx.classes[c], matiereId: ctx.matieres[matiere], personnelId: ctx.personnel[nom] });
    }
  });
}

// ---------------------------------------------------------------- emploi du temps (maquette Emploi-du-temps : CM2 A)
const HEURES = ['07:30', '08:30', '10:00', '11:00', '13:00', '14:00'];
type Grille = (string | null)[][]; // [heure][jour 0..5]
const MODELE: Grille = [
  ['Maths', 'Français', 'Maths', 'Français', 'Maths', 'Révisions'],
  ['Français', 'Maths', 'Français', 'Maths', 'Français', 'Révisions'],
  ['Sciences', 'Anglais', 'Histoire-géo.', 'Sciences', 'Anglais', 'Arts'],
  ['Histoire-géo.', 'Éd. civique', 'EPS', 'Anglais', 'Histoire-géo.', 'EPS'],
  ['Français', 'Sciences', null, 'Maths', 'Arts', null],
  ['EPS', 'Maths', null, 'Français', 'Révisions', null],
];
const J: Record<string, number> = { Lun: 0, Mar: 1, Mer: 2, Jeu: 3, Ven: 4, Sam: 5 };
const cellule = (c: string): [number, number] => { const [j, h] = c.split(' '); return [HEURES.indexOf(h!), J[j!]!]; };
// Échanges de créneaux par classe : l'EPS, l'anglais et l'informatique des vacataires ne se chevauchent pas,
// sauf le mercredi 11:00, cours commun d'EPS de CM2 A et CM1 A (maquette).
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

export function grilleDe(classe: string, avantModification = false): Grille {
  const g = MODELE.map((l) => [...l]);
  if (classe.startsWith('Class')) for (const l of g) for (let j = 0; j < 6; j++) l[j] = l[j] === 'Français' ? 'Anglais' : l[j] === 'Anglais' ? 'Français' : l[j]!;
  for (const [a, b] of ECHANGES[classe] ?? []) {
    const [h1, j1] = cellule(a), [h2, j2] = cellule(b);
    [g[h1]![j1], g[h2]![j2]] = [g[h2]![j2]!, g[h1]![j1]!];
  }
  if (INFO[classe]) { const [h, j] = cellule(INFO[classe]!); g[h]![j] = 'Informatique'; }
  // CM2 A : le vendredi 14:00 passe de « Maths » à « Révisions » le 06/11 ; la modification attend la validation du préfet.
  if (classe === 'CM2 A' && avantModification) g[5]![4] = 'Maths';
  return g;
}

async function emploiDuTemps(ctx: Contexte) {
  const { pre, horloge } = ctx;
  const edt = await pre.get<{ creneaux: { id: string; debut: string; type: string }[] }>(`/pedagogie/edt?classeId=${ctx.classes['CM2 A']}`);
  const creneau = (h: string) => edt.creneaux.find((c) => c.debut === h && c.type === 'cours')!.id;
  const placer = async (cl: Client, classe: string, h: number, j: number, v: string | null) => {
    if (!v) return;
    const matiere = ABREGES[v];
    await cl.put('/pedagogie/edt/cours', { classeId: ctx.classes[classe], jour: j + 1, creneauId: creneau(HEURES[h]!), matiereId: matiere ? ctx.matieres[matiere] : null, libelle: matiere ? null : v });
  };
  for (const c of CLASSES) {
    const cl = ctx.comptes[c.principal[0]]!;
    const g = grilleDe(c.nom, true);
    await horloge.a(aLHeure(`${DEBUT}-09-03`, hhmm(9 * 60 + CLASSES.indexOf(c) * 7)), async () => {
      for (let h = 0; h < HEURES.length; h++) for (let j = 0; j < 6; j++) await placer(cl, c.nom, h, j, g[h]![j]!);
      await cl.post(`/pedagogie/edt/${ctx.classes[c.nom]}/soumission`);
    });
    await horloge.a(aLHeure(`${DEBUT}-09-04`, hhmm(10 * 60 + CLASSES.indexOf(c) * 5)), () => pre.post(`/pedagogie/edt/${ctx.classes[c.nom]}/publication`, {}));
  }
  // Modification de CM2 A par M. ONANA, soumise au préfet (maquette : étape « Validation »).
  const onana = ctx.comptes['onana.b']!;
  await horloge.a(aLHeure(ouvrableAvant(4), '16:20'), async () => {
    await placer(onana, 'CM2 A', 5, 4, 'Révisions');
    await onana.post(`/pedagogie/edt/${ctx.classes['CM2 A']}/soumission`);
  });
}

// ---------------------------------------------------------------- notes (maquettes Notes, Fusion, Bulletins)
const arrondi = (x: number) => Math.max(1, Math.min(19.5, Math.round(x * 2) / 2));
const decalageMatiere = new Map<string, number>();
const noteDe = (e: Eleve, matiere: string) => {
  const k = `${e.nom} ${e.prenoms}|${matiere}`;
  if (!decalageMatiere.has(k)) decalageMatiere.set(k, (hasard() - 0.5) * 5);
  return arrondi(e.niveauScolaire + decalageMatiere.get(k)! + (hasard() - 0.5) * 3);
};
// Séquence 2 · mathématiques en CM2 A, telle que la maquette Notes la montre (10 notes sur 12).
const MATHS_S2: Record<string, number | null | 'absent'> = { 'ABENA Christelle': 15, 'BELLO Aminatou': 12.5, 'DJOMO Josiane': 14, 'ESSOMBA Ruth': 9,
  'FOKOU Marc': 11, 'FOTSO Junior': null, 'NDI Emmanuel': 8.5, 'NGUEMO Carine': 16, 'TAMO Gisèle': 17, 'TCHOUA Ivan': 'absent', 'WAMBA Estelle': 13, 'ZANG Didier': null };

async function notes(ctx: Contexte) {
  const { pre, horloge } = ctx;
  const seq = await pre.get<{ id: string; ordre: number; sequences: { id: string; numero: number; type: string }[] }[]>('/pedagogie/sequences');
  const t1 = seq.find((p) => p.ordre === 1)!;
  const s1 = t1.sequences.find((s) => s.numero === 1)!.id;
  const s2 = t1.sequences.find((s) => s.numero === 2)!.id;
  const jusqua = plusJours(AUJ, 9);
  await horloge.a(aLHeure(ouvrableAuPlus(`${DEBUT}-09-28`), '08:00'), () => pre.post(`/pedagogie/sequences/${s1}/ouverture`, { jusqua }));
  const titulaire = (classe: string, matiere: string): Client | undefined => {
    const ex = MATIERE_PAR.find(([, m, cl]) => m === matiere && cl.includes(classe));
    if (ex) return ctx.clientDe(ex[0]);
    return ctx.comptes[CLASSES.find((c) => c.nom === classe)!.principal[0]];
  };
  const eleves = (classe: string) => ctx.eleves.filter((e) => e.classe === classe && e.inscriptionId);
  const saisir = async (classe: string, matiere: string, sequenceId: string, jour: string, choix: (e: Eleve) => { valeur: number | null; statut: string; remarque?: string } | null) => {
    const cl = titulaire(classe, matiere);
    if (!cl) return; // Mrs TANYI Rose n'a pas de compte : ses notes ne sont pas saisies (maquette Personnel).
    const lignes = eleves(classe).map((e) => ({ e, n: choix(e) })).filter((x) => x.n).map((x) => ({ inscriptionId: x.e.inscriptionId, valeur: x.n!.valeur,
      statut: x.n!.statut, remarque: x.n!.remarque ?? null }));
    if (!lignes.length) return;
    await horloge.a(aLHeure(jour, hhmm(entier(12 * 60, 18 * 60))), () => cl.put('/pedagogie/saisie', { classeId: ctx.classes[classe], matiereId: ctx.matieres[matiere],
      sequenceId, faitLe: jour, bareme: 20, notes: lignes }));
  };
  // Séquence 1 : toutes les classes, toutes les matières (sauf l'anglais de Mrs TANYI).
  for (const c of CLASSES) {
    for (const m of matieresDuNiveau(c.niveau)) {
      await saisir(c.nom, m.libelle, s1, ouvrableAuPlus(`${DEBUT}-10-${String(entier(5, 16)).padStart(2, '0')}`),
        (e) => hasard() < 0.03 ? { valeur: null, statut: 'absent_justifie' } : { valeur: noteDe(e, m.libelle), statut: 'present' });
    }
  }
  await horloge.a(aLHeure(ouvrableAuPlus(`${DEBUT}-10-24`), '18:00'), () => pre.post(`/pedagogie/sequences/${s1}/fermeture`, {}));
  // Séquence 2 : ouverte jusqu'à dans neuf jours ; saisie en cours.
  await horloge.a(aLHeure(ouvrableAvant(8), '07:45'), () => pre.post(`/pedagogie/sequences/${s2}/ouverture`, { jusqua }));
  const devoir = ouvrableAvant(4);
  for (const c of CLASSES) {
    for (const m of matieresDuNiveau(c.niveau)) {
      if (c.nom === 'CM2 A') {
        if (m.libelle === 'Mathématiques') {
          await saisir(c.nom, m.libelle, s2, devoir, (e) => {
            const v = MATHS_S2[`${e.nom} ${e.prenoms}`];
            if (v === 'absent') return { valeur: null, statut: 'absent', remarque: `À rattraper le ${fr(plusJours(AUJ, 1)).slice(0, 5)}` };
            return v === null || v === undefined ? null : { valeur: v, statut: 'present' };
          });
        } else if (m.libelle === 'Arts et travaux manuels') {
          let n = 0;
          await saisir(c.nom, m.libelle, s2, ouvrableAvant(3), (e) => (n++ < 8 ? { valeur: noteDe(e, m.libelle), statut: 'present' } : null));
        } else {
          await saisir(c.nom, m.libelle, s2, ouvrableAvant(entier(3, 6)), (e) => ({ valeur: noteDe(e, m.libelle), statut: 'present' }));
        }
        continue;
      }
      if (hasard() < 0.35) continue;
      const part = hasard() < 0.5 ? 1 : 0.85;
      await saisir(c.nom, m.libelle, s2, ouvrableAvant(entier(2, 7)), (e) => (hasard() < part ? { valeur: noteDe(e, m.libelle), statut: 'present' } : null));
    }
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
    for (const [nom, texte] of Object.entries(textes)) {
      await onana.put('/pedagogie/appreciations', { periodeId: t1.id, inscriptionId: ctx.parNom(nom).inscriptionId, matiereId: null, texte });
    }
  });
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

async function cahier(ctx: Contexte) {
  const jours = [ouvrableAvant(2), ouvrableAvant(1), ...(ouvrable(AUJ) ? [AUJ] : [])];
  for (const classe of ['CM2 A', 'CE2 B']) {
    const g = grilleDe(classe);
    for (const jour of jours) {
      const j = jourSemaine(jour) - 1;
      if (j < 0 || j > 5) continue;
      const lendemain = (() => { let x = plusJours(jour, 1); while (!ouvrable(x)) x = plusJours(x, 1); return x; })();
      for (let h = 0; h < HEURES.length; h++) {
        const v = g[h]![j];
        if (!v || (h > 0 && g[h - 1]![j] === v)) continue;
        const matiere = ABREGES[v] ?? null;
        const ex = matiere ? MATIERE_PAR.find(([, m, cl]) => m === matiere && cl.includes(classe)) : undefined;
        const cl = ex ? ctx.clientDe(ex[0]) : ctx.comptes[CLASSES.find((c) => c.nom === classe)!.principal[0]];
        if (!cl) continue;
        const s = choisir(SEANCES[v] ?? [{ contenu: `${v} : reprise de la leçon.` }]);
        const fin = minuteActuelle();
        const debutMin = Number(HEURES[h]!.slice(0, 2)) * 60 + Number(HEURES[h]!.slice(3));
        if (jour === AUJ && debutMin > fin) continue;
        await ctx.horloge.a(aLHeure(jour, hhmm(debutMin + 50)), () => cl.post('/pedagogie/seances', { classeId: ctx.classes[classe], faitLe: jour, heure: HEURES[h],
          matiereId: matiere ? ctx.matieres[matiere] : null, libelle: v, contenu: s.contenu, devoir: s.devoir ?? null, devoirPour: s.devoir ? lendemain : null }));
      }
    }
  }
}

export const pedagogie = {
  parametrage,
  async suite(ctx: Contexte) {
    await emploiDuTemps(ctx);
    await notes(ctx);
    await cahier(ctx);
  },
};

// ---------------------------------------------------------------- appels, absences, observations (maquettes Appel, Discipline)
async function parent(ctx: Contexte, e: Eleve): Promise<Client> {
  const tel = e.famille.telephone.replace(/\D/g, '');
  if (ctx.parents[tel]) return ctx.parents[tel]!;
  const mdp = `demo-${e.famille.nom.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')}`;
  await ctx.proprio.query(`UPDATE core.compte SET mot_de_passe = $1 WHERE type = 'famille' AND identifiant = $2`, [await hacher(mdp), tel]);
  const r = await ctx.app.inject({ method: 'POST', url: '/api/v1/auth/connexion-parent', payload: { telephone: tel, motDePasse: mdp, client: 'application' } });
  if (r.statusCode !== 200) throw new Error(`Connexion du parent ${tel} refusée : ${r.body}`);
  return (ctx.parents[tel] = new Client(ctx.app, r.json().jeton, `famille ${e.famille.nom}`));
}

type Plan = { jour: string; moment: 'matin' | 'apres_midi' | 'journee' | 'retard'; minutes?: number };

/** n-ième jour ouvrable avant aujourd'hui qui a des cours l'après-midi (ni mercredi ni samedi). */
function avecApresMidi(n: number): string {
  let k = n;
  while ([3, 6].includes(jourSemaine(ouvrableAvant(k)))) k++;
  return ouvrableAvant(k);
}

export async function vieScolaire(ctx: Contexte) {
  const plans: Record<string, Plan[]> = {
    'FOKOU Marc': [{ jour: avecApresMidi(4), moment: 'journee' }, { jour: avecApresMidi(9), moment: 'journee' }],
    'NDI Emmanuel': [{ jour: ouvrableAvant(6), moment: 'matin' }, { jour: ouvrableAvant(8), moment: 'matin' }],
    'KAMGA Arthur': [{ jour: ouvrableAvant(1), moment: 'matin' }, { jour: ouvrableAvant(7), moment: 'matin' },
      ...[10, 8, 5, 3].map((n) => ({ jour: ouvrableAvant(n), moment: 'retard' as const, minutes: entier(10, 20) }))],
    'NGONO Mireille': [{ jour: ouvrableAvant(5), moment: 'matin' }],
    'ACHU Blessing': [{ jour: avecApresMidi(6), moment: 'apres_midi' }],
    'KENFACK Steve': [{ jour: ouvrableAvant(2), moment: 'matin' }],
  };
  const jours = Array.from({ length: 10 }, (_, i) => ouvrableAvant(10 - i));
  const suivies = new Set(['CM2 A', 'CE2 B', 'Class 6']);
  for (const jour of [...jours, ...(ouvrable(AUJ) ? [AUJ] : [])]) {
    for (const c of CLASSES) {
      if (!suivies.has(c.nom) && jour < ouvrableAvant(6)) continue;
      if (jour === AUJ && c.nom === 'CE2 B') continue; // l'appel du jour de CE2 B reste à faire pendant la démonstration
      const principal = ctx.comptes[c.principal[0]]!;
      const liste = await principal.get<{ fiches: { id: string; debut: string; fin: string; personnel: string | null; statut: string }[] }>(
        `/vie-scolaire/appel?classeId=${ctx.classes[c.nom]}&jour=${jour}`);
      for (const f of liste.fiches) {
        if (f.statut === 'faite') continue;
        const finMin = Number(f.fin.slice(0, 2)) * 60 + Number(f.fin.slice(3));
        if (jour === AUJ && finMin > minuteActuelle() - 5) continue;
        const cl = f.personnel ? ctx.clientDe(f.personnel) : undefined;
        if (!cl) continue; // Mrs TANYI Rose, sans compte : la fiche reste à faire.
        const d = await cl.get<{ fiche: { eleves: { inscriptionId: string; nom: string }[] } }>(`/vie-scolaire/appel?classeId=${ctx.classes[c.nom]}&jour=${jour}&ficheId=${f.id}`);
        const matin = f.debut < '12:00';
        const presences = d.fiche.eleves.map((x) => {
          const p = (plans[x.nom] ?? []).find((y) => y.jour === jour);
          if (p?.moment === 'journee' || (p?.moment === 'matin' && matin) || (p?.moment === 'apres_midi' && !matin)) return { inscriptionId: x.inscriptionId, statut: 'absent' };
          if (p?.moment === 'retard' && f.debut === '07:30') return { inscriptionId: x.inscriptionId, statut: 'retard', retardMinutes: p.minutes };
          if (!plans[x.nom] && hasard() < 0.012) return { inscriptionId: x.inscriptionId, statut: hasard() < 0.6 ? 'absent' : 'retard', retardMinutes: entier(5, 25) };
          return { inscriptionId: x.inscriptionId, statut: 'present' };
        });
        await ctx.horloge.a(aLHeure(jour, hhmm(Number(f.debut.slice(0, 2)) * 60 + Number(f.debut.slice(3)) + entier(3, 12))), () =>
          cl.put(`/vie-scolaire/appel/${f.id}`, { presences }));
      }
    }
  }
  // Justifications (RG-39) : la secrétaire, sur pièce ou mot des parents.
  const justifier = (nom: string, jour: string, motif: string) => ctx.horloge.a(aLHeure(plusJours(jour, 0), '16:10'), () =>
    ctx.sec.post('/vie-scolaire/absences/justification', { inscriptionId: ctx.parNom(nom).inscriptionId, jour, motif }));
  await justifier('NDI Emmanuel', plans['NDI Emmanuel']![0]!.jour, 'Consultation médicale, certificat remis');
  await justifier('KAMGA Arthur', plans['KAMGA Arthur']![1]!.jour, 'Rendez-vous chez le dentiste');
  await justifier('NGONO Mireille', plans['NGONO Mireille']![0]!.jour, 'Raison familiale, mot des parents');
  await justifier('ACHU Blessing', plans['ACHU Blessing']![0]!.jour, 'Rendez-vous administratif');
  // Demandes des parents depuis leur application (maquettes Discipline et Messagerie).
  const kamga = ctx.parNom('KAMGA Arthur');
  await ctx.horloge.a(aLHeure(plans['KAMGA Arthur']![0]!.jour, '19:40'), async () => (await parent(ctx, kamga)).post('/portail/absences/justification',
    { inscriptionId: kamga.inscriptionId, jour: plans['KAMGA Arthur']![0]!.jour, texte: 'malade, certificat à suivre' }));
  const steve = ctx.parNom('KENFACK Steve');
  await ctx.horloge.a(aLHeure(plans['KENFACK Steve']![0]!.jour, '19:02'), async () => (await parent(ctx, steve)).post('/portail/absences/justification',
    { inscriptionId: steve.inscriptionId, jour: plans['KENFACK Steve']![0]!.jour,
      texte: 'Bonjour, Steve était malade ce matin. Le certificat médical suivra lundi. Pouvez-vous justifier son absence ?' }));
  // Observations et sanctions.
  const observer = (qui: Client, nom: string, jour: string, type: string, description: string, sanction?: string, matiere?: string) =>
    ctx.horloge.a(aLHeure(jour, hhmm(entier(10 * 60, 16 * 60))), () => qui.post('/vie-scolaire/observations', {
      inscriptionId: ctx.parNom(nom).inscriptionId, type, description, sanction: sanction ?? null, matiereId: matiere ? ctx.matieres[matiere] : null, survenuLe: jour }));
  // La maquette attribue ce relevé à Mr TANYI Peter (principal de Class 6) : hors de son périmètre, c'est la principale de Class 3 qui le fait (E-40).
  await observer(ctx.comptes['bih.m']!, 'MBAH Kevin', ouvrableAvant(22), 'tenue', 'Tenue incomplète, troisième fois');
  await observer(ctx.comptes['eyenga.s']!, 'KAMGA Arthur', ouvrableAvant(10), 'retard', 'Quatre retards en deux semaines', 'Avertissement écrit aux parents');
  await observer(ctx.comptes['onana.b']!, 'NDI Emmanuel', ouvrableAvant(7), 'travail_non_fait', 'Devoir de mathématiques non rendu');
  await observer(ctx.comptes['onana.b']!, 'BELLO Aminatou', ouvrableAvant(5), 'felicitations', 'Exposé remarquable en sciences');
  await observer(ctx.comptes['essama.l']!, 'TCHOUA Ivan', ouvrableAvant(4), 'comportement', 'Bagarre dans la cour', 'Retenue de 2 h', 'Éducation physique et sportive');
}

// ---------------------------------------------------------------- annonces et messagerie (maquettes Annonces, Messagerie, Mobile-parent-messages)
export async function communication(ctx: Contexte) {
  const { horloge } = ctx;
  const t1 = ctx.periodes.find((p) => p.ordre === 1)!;
  const composition = fr(plusJours(t1.dateFin, -4)).slice(0, 5);
  await horloge.a(aLHeure(ouvrableAvant(4), '12:30'), () => ctx.comptes['onana.b']!.post('/communication/annonces', { titre: 'Tenue de sport obligatoire le lundi',
    texteFr: 'À partir de lundi, la tenue de sport est obligatoire pour les séances d’EPS.', texteEn: 'From Monday, the sports kit is compulsory for PE lessons.',
    cible: 'classe', cibleId: ctx.classes['CM2 A'], publier: true }));
  await horloge.a(aLHeure(ouvrableAvant(3), '10:00'), () => ctx.pre.post('/communication/annonces', { titre: `Composition du 1er trimestre à partir du ${composition}`,
    texteFr: `Les compositions du 1er trimestre commencent le ${composition}. Les élèves révisent toutes les leçons depuis la rentrée.`,
    texteEn: `First-term examinations start on ${composition}. Pupils should revise all lessons since the start of the year.`, cible: 'niveau', cibleId: ctx.niveaux['CM2'], publier: true }));
  await horloge.a(aLHeure(ouvrableAvant(2), '09:30'), () => ctx.eco.post('/communication/annonces', { titre: `Rappel : tranche 2 avant le ${fr(`${DEBUT}-11-30`).slice(0, 5)}`,
    texteFr: 'La tranche 2 des frais de scolarité est à régler avant le 30 novembre, à la caisse ou à la banque.',
    texteEn: 'The second instalment of school fees is due before 30 November, at the cashier’s office or at the bank.', cible: 'debiteurs', publier: true }));
  await horloge.a(aLHeure(ouvrableAvant(1), '08:30'), () => ctx.sec.post('/communication/annonces', { titre: `Réunion des parents le ${fr(plusJours(AUJ, 3)).slice(0, 5)} à 10:00`,
    texteFr: 'Les parents sont invités à la réunion de rentrée, dans la grande salle. Ordre du jour : résultats de la séquence 1, vie de l’école.',
    texteEn: 'Parents are invited to the first meeting of the year, in the main hall. Agenda: first sequence results, school life.', cible: 'ecole', publier: true }));
  // Messagerie : le parent choisit son destinataire ; chacun ne voit que ce qui lui est adressé.
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
  await horloge.a(aLHeure(ouvrableAvant(5), '09:05'), () => ctx.eco.post(`/communication/conversations/${eco.conversationId}/messages`,
    { texte: 'Bonjour Madame, oui : passez à la caisse quand vous le souhaitez ; chaque versement reçoit son reçu par SMS.' }));
  await ecrire('KENFACK Steve', 'instituteur_principal', ouvrableAvant(3), '20:05', 'Bonsoir Madame, Steve a-t-il bien rendu son exposé sur le cycle de l’eau ?');
  await horloge.a(aLHeure(ouvrableAvant(2), '12:45'), async () => {
    const c = await ctx.comptes['eyenga.s']!.get<{ conversations: { id: string }[] }>('/communication/conversations');
    if (c.conversations[0]) await ctx.comptes['eyenga.s']!.post(`/communication/conversations/${c.conversations[0].id}/messages`, { texte: 'Bonjour Madame, oui, et il a eu une bonne note.' });
  });
  await ecrire('ATANGANA Paul', 'secretaire', ouvrableAvant(1), '20:15', 'Peut-on payer la tranche 2 en deux fois ?');
  // Brouillon de réponse de la secrétaire à la demande de justification de Mme KENFACK (maquette Messagerie).
  const conv = await ctx.sec.get<{ conversations: { id: string; famille: string; sujet: string | null }[] }>('/communication/conversations');
  const kenfack = conv.conversations.find((c) => c.famille === 'KENFACK' && c.sujet);
  if (kenfack) await ctx.sec.post(`/communication/conversations/${kenfack.id}/messages`,
    { texte: 'Bonjour Madame, c’est noté. L’absence sera justifiée à réception du certificat. Bon rétablissement à Steve.', brouillon: true });
}
