// demo:fictif — l'école fictive : classes, personnel, matières, grille des frais, et la génération des élèves
// sur trois années scolaires (les deux dernières complètes, l'année en cours jusqu'à aujourd'hui).
// Rien ici ne touche à la base : ce sont des données en mémoire, que fictif-annee.ts fait entrer par l'API.
import { DEBUT, choisir, entier, hasard, jj, melanger, type Eleve, type Famille, type Passage, type Profil } from './fictif-outils.ts';

// ---------------------------------------------------------------- noms (inventés, plausibles au Cameroun)
export const NOMS_FR = ['ABENA', 'AMOUGOU', 'ATANGANA', 'BELINGA', 'EBODE', 'EKANI', 'ESSOMBA', 'ETOUNDI', 'EWANE', 'KAMDEM', 'KENMOGNE', 'MBALLA',
  'MENDO', 'MOUKOKO', 'MVOGO', 'NANA', 'NDJOCK', 'NGONO', 'NKOA', 'NOAH', 'NTAMACK', 'OWONA', 'POUOKAM', 'SIMO', 'TAMO', 'TCHAMBA', 'WAFO',
  'YOUMBI', 'ZAMBO', 'NJOYA', 'EKWALLA', 'MANGA', 'ONDOA', 'NGUEMA', 'FOTSO', 'TAGNE', 'BIKOÏ', 'YONGA', 'WAMBA', 'ZANG', 'NGUEMO', 'BELLO',
  'ABOMO', 'ANDELA', 'ASSIGA', 'AYISSI', 'BILOA', 'DJOUMESSI', 'EBOGO', 'ELOUNDOU', 'ESSAMA', 'FOUDA', 'KAMENI', 'KOUAM', 'MBOUDA', 'MEKA',
  'MEYONG', 'MFEGUE', 'NDONGO', 'NGANDO', 'NJIKAM', 'NKODO', 'OLINGA', 'ONANA', 'SOH', 'TCHINDA', 'TSAFACK', 'YEMELI', 'ZEH', 'ESSIANE', 'AKONO'];
export const NOMS_EN = ['ACHU', 'MBAH', 'NGWA', 'NJI', 'TABI', 'AWAH', 'NFOR', 'BIH', 'NKWAIN', 'CHE', 'AKO', 'NDIP', 'EBAI', 'TAMBE', 'ASHU', 'AYUK',
  'EGBE', 'ENOW', 'MUKETE', 'NJIE', 'FONDONG', 'NGANG', 'FONGANG', 'AKUM', 'NEBA', 'TITA', 'BAME', 'MOFOR', 'NGOH', 'ABUNAW',
  'ANYE', 'ATEM', 'BESONG', 'CHIA', 'EYONG', 'FOMBA', 'KUM', 'LIMUNGA', 'MBI', 'NDI', 'NGUM', 'NSOM', 'OBEN', 'SAMA', 'TAKU', 'YUH'];
const PRENOMS = {
  fr: { M: ['Paul', 'Marc', 'Emmanuel', 'Ivan', 'Patrick', 'Junior', 'Arnaud', 'Yannick', 'Franck', 'Hervé', 'Cédric', 'Brice', 'Landry', 'Ulrich',
    'Christian', 'Rodrigue', 'Serge', 'Kevin', 'Joël', 'Willy', 'Romuald', 'Bruno', 'Thierry', 'Gaël', 'Stéphane', 'Didier', 'Fabrice', 'Arthur',
    'Loïc', 'Steve', 'Boris', 'Dylan', 'Axel', 'Ryan', 'Nathan', 'Jordan', 'Wilfried', 'Armel', 'Hugues', 'Lionel', 'Aristide', 'Donald'],
    F: ['Ruth', 'Sandra', 'Gisèle', 'Mireille', 'Rose', 'Carine', 'Brenda', 'Laure', 'Sylvie', 'Nadège', 'Linda', 'Prisca', 'Danielle', 'Estelle',
      'Murielle', 'Vanessa', 'Chantal', 'Ornella', 'Larissa', 'Inès', 'Flore', 'Raïssa', 'Audrey', 'Joëlle', 'Christelle', 'Aminatou',
      'Grâce', 'Laetitia', 'Cynthia', 'Marthe', 'Nina', 'Anaïs', 'Léa', 'Marie-Noëlle', 'Pélagie', 'Sonia', 'Clarisse', 'Olive', 'Josiane'] },
  en: { M: ['Collins', 'Brandon', 'Peter', 'Divine', 'Clinton', 'Godwill', 'Prince', 'Bryan', 'Nelson', 'Elvis', 'Derick', 'Wilson', 'Kelvin',
    'Ronald', 'Bertrand', 'Eric', 'Desmond', 'Leonel', 'Valery', 'Kingsley', 'Terence', 'Lucas', 'Marvin', 'Gilbert', 'Emmanuel', 'Daniel'],
    F: ['Grace', 'Precious', 'Mercy', 'Faith', 'Gladys', 'Belinda', 'Mary', 'Joy', 'Sharon', 'Doris', 'Vivian', 'Lilian', 'Nancy', 'Esther',
      'Hilda', 'Comfort', 'Patience', 'Ashley', 'Bridget', 'Blessing', 'Favour', 'Claudia', 'Delphine', 'Rita', 'Sylvia', 'Winnie'] },
};
const ADULTES = { M: ['Albert', 'Jean', 'Pierre', 'Martin', 'Luc', 'Alain', 'Bernard', 'Daniel', 'Joseph', 'François', 'Thomas', 'Samuel', 'Ibrahim', 'Gaston', 'Roger', 'Émile'],
  F: ['Pauline', 'Marie', 'Lucie', 'Denise', 'Judith', 'Thérèse', 'Martha', 'Agnès', 'Odile', 'Hélène', 'Monique', 'Esther', 'Rose', 'Juliette', 'Solange', 'Brigitte'] };
const ADULTES_EN = { M: ['Peter', 'John', 'Samuel', 'Emmanuel', 'George', 'Joseph', 'Francis', 'Martin', 'Thomas', 'Paul'], F: ['Martha', 'Judith', 'Florence', 'Comfort', 'Grace', 'Mary', 'Agnes', 'Beatrice', 'Rose', 'Alice'] };
export const VILLES = ['Yaoundé', 'Douala', 'Bafoussam', 'Bamenda', 'Buea', 'Ebolowa', 'Mbalmayo', 'Kribi', 'Limbé', 'Dschang', 'Bertoua', 'Nkongsamba', 'Obala', 'Sangmélima', 'Kumba'];

// ---------------------------------------------------------------- structure : niveaux, classes, personnel
/** Niveau précédent dans le parcours d'un élève (maternelle puis primaire, dans chaque sous-système). */
export const CHAINE_FR = ['PS', 'MS', 'GS', 'SIL', 'CP', 'CE1', 'CE2', 'CM1', 'CM2'];
export const CHAINE_EN = ['Nursery 1', 'Nursery 2', 'Class 1', 'Class 2', 'Class 3', 'Class 4', 'Class 5', 'Class 6'];
export const anglophone = (niveau: string) => CHAINE_EN.includes(niveau);
export const maternelle = (niveau: string) => ['PS', 'MS', 'GS', 'Nursery 1', 'Nursery 2'].includes(niveau);
export const niveauPrecedent = (niveau: string): string | null => {
  const c = anglophone(niveau) ? CHAINE_EN : CHAINE_FR;
  const i = c.indexOf(niveau);
  return i > 0 ? c[i - 1]! : null;
};
export const niveauSuivant = (niveau: string): string | null => {
  const c = anglophone(niveau) ? CHAINE_EN : CHAINE_FR;
  const i = c.indexOf(niveau);
  return i >= 0 && i < c.length - 1 ? c[i + 1]! : null;
};
/** Année de naissance usuelle d'un élève de ce niveau pendant l'année scolaire 2026/2027. */
const NAISSANCE: Record<string, number> = { PS: 2023, MS: 2022, GS: 2021, SIL: 2020, CP: 2019, CE1: 2018, CE2: 2017, CM1: 2016, CM2: 2015,
  'Nursery 1': 2022, 'Nursery 2': 2021, 'Class 1': 2020, 'Class 2': 2019, 'Class 3': 2018, 'Class 4': 2017, 'Class 5': 2016, 'Class 6': 2015 };

export interface DefClasse { nom: string; niveau: string; principal: [string, string, string] }
export const CLASSES: DefClasse[] = [
  { nom: 'PS A', niveau: 'PS', principal: ['mbarga.c', 'Mme MBARGA Clémentine', '600 000 251'] },
  { nom: 'MS A', niveau: 'MS', principal: ['ngah.p', 'Mme NGAH Pélagie', '600 000 252'] },
  { nom: 'GS A', niveau: 'GS', principal: ['essono.v', 'Mme ESSONO Véronique', '600 000 253'] },
  { nom: 'SIL A', niveau: 'SIL', principal: ['nana.o', 'Mme NANA Odile', '600 000 214'] },
  { nom: 'SIL B', niveau: 'SIL', principal: ['owona.l', 'Mme OWONA Lydie', '600 000 254'] },
  { nom: 'CP A', niveau: 'CP', principal: ['belinga.a', 'Mme BELINGA Agnès', '600 000 215'] },
  { nom: 'CP B', niveau: 'CP', principal: ['atangana.r', 'M. ATANGANA Robert', '600 000 255'] },
  { nom: 'CE1 A', niveau: 'CE1', principal: ['mvogo.d', 'M. MVOGO Daniel', '600 000 216'] },
  { nom: 'CE1 B', niveau: 'CE1', principal: ['mengue.j', 'Mme MENGUE Joséphine', '600 000 256'] },
  { nom: 'CE2 A', niveau: 'CE2', principal: ['ngono.c', 'Mme NGONO Chantal', '600 000 217'] },
  { nom: 'CE2 B', niveau: 'CE2', principal: ['eyenga.s', 'Mme EYENGA Solange', '600 000 212'] },
  { nom: 'CM1 A', niveau: 'CM1', principal: ['kamga.h', 'M. KAMGA Hervé', '600 000 218'] },
  { nom: 'CM1 B', niveau: 'CM1', principal: ['ebogo.p', 'M. EBOGO Pascal', '600 000 257'] },
  { nom: 'CM2 A', niveau: 'CM2', principal: ['onana.b', 'M. ONANA Bertrand', '600 000 211'] },
  { nom: 'CM2 B', niveau: 'CM2', principal: ['nkolo.f', 'Mme NKOLO Félicité', '600 000 258'] },
  { nom: 'Nursery 1', niveau: 'Nursery 1', principal: ['ayuk.l', 'Mrs AYUK Lilian', '600 000 261'] },
  { nom: 'Nursery 2', niveau: 'Nursery 2', principal: ['enow.p', 'Mrs ENOW Patience', '600 000 262'] },
  { nom: 'Class 1', niveau: 'Class 1', principal: ['nfor.g', 'Mrs NFOR Gladys', '600 000 231'] },
  { nom: 'Class 2', niveau: 'Class 2', principal: ['awah.d', 'Mr AWAH Divine', '600 000 232'] },
  { nom: 'Class 3', niveau: 'Class 3', principal: ['bih.m', 'Mrs BIH Mercy', '600 000 233'] },
  { nom: 'Class 4', niveau: 'Class 4', principal: ['che.e', 'Mr CHE Emmanuel', '600 000 234'] },
  { nom: 'Class 5', niveau: 'Class 5', principal: ['ebai.f', 'Mrs EBAI Florence', '600 000 235'] },
  { nom: 'Class 6', niveau: 'Class 6', principal: ['tanyi.p', 'Mr TANYI Peter', '600 000 213'] },
];
export const classeDe = (nom: string) => CLASSES.find((c) => c.nom === nom)!;
export const classesDuNiveau = (niveau: string) => CLASSES.filter((c) => c.niveau === niveau);
/** Classe de l'année précédente pour un élève qui monte : même lettre quand le niveau précédent est dédoublé. */
export function classePrecedente(classe: string): string | null {
  const c = classeDe(classe);
  const np = niveauPrecedent(c.niveau);
  if (!np) return null;
  const candidates = classesDuNiveau(np);
  const lettre = c.nom.slice(-1);
  return (candidates.find((x) => x.nom.endsWith(` ${lettre}`)) ?? candidates[0])!.nom;
}
/** Classes d'accueil l'année suivante (toutes les classes du niveau suivant ; vide en fin de parcours). */
export const classesSuivantes = (classe: string): string[] => {
  const ns = niveauSuivant(classeDe(classe).niveau);
  if (!ns) return [];
  const lettre = classe.slice(-1);
  const toutes = classesDuNiveau(ns);
  const meme = toutes.find((x) => x.nom.endsWith(` ${lettre}`) && toutes.length > 1 && classesDuNiveau(classeDe(classe).niveau).length > 1);
  return meme ? [meme.nom] : toutes.map((x) => x.nom);
};

export const ADMIN: [string, string, string, string, string][] = [
  ['directrice', 'Mme ATEBA Marie-Claire', 'directeur', 'directeur', '600 000 201'],
  ['econome', 'M. MBIDA Paul', 'econome', 'econome', '600 000 202'],
  ['prefet', 'M. NKOULOU Gérard', 'prefet', 'prefet', '600 000 204'],
];
/** Instituteurs de matière : identifiant (null : sans compte, maquette Personnel), nom, téléphone, diplôme, première année. */
export const MATIERE_SEULE: [string | null, string, string, string, number][] = [
  [null, 'Mrs TANYI Rose', '600 000 221', 'Licence en lettres bilingues', DEBUT],
  ['essama.l', 'M. ESSAMA Luc', '600 000 222', 'Brevet de professeur d’EPS', DEBUT - 2],
  ['fouda.s', 'M. FOUDA Serge', '600 000 223', 'Licence d’informatique', DEBUT - 1],
  ['fon.d', 'Mr FON Desmond', '600 000 225', 'Physical Education Certificate', DEBUT - 2],
];
/** Matières confiées à un instituteur de matière, par année (Mrs TANYI arrive cette année). */
export const matieresPar = (debut: number): [string, string, string[]][] => [
  ...(debut >= DEBUT ? [['Mrs TANYI Rose', 'Anglais', ['CM1 A', 'CM1 B', 'CM2 A', 'CM2 B']] as [string, string, string[]]] : []),
  ['M. ESSAMA Luc', 'Éducation physique et sportive', ['CE1 A', 'CE2 A', 'CE2 B', 'CM1 A', 'CM2 A']],
  ...(debut >= DEBUT - 1 ? [['M. FOUDA Serge', 'Informatique', ['CE2 A', 'CE2 B', 'CM1 A']] as [string, string, string[]]] : []),
  ['Mr FON Desmond', 'Éducation physique et sportive', ['Class 3', 'Class 4', 'Class 5', 'Class 6']],
];

// ---------------------------------------------------------------- matières (maquette Matieres)
export const GROUPES: [string, string][] = [['Langues', 'Languages'], ['Sciences', 'Sciences'], ['Sciences humaines', 'Humanities'], ['Activités', 'Activities']];
// libellé, libellé anglais, abrégé, abrégé anglais, groupe, coefficient (francophone), coefficient (anglophone)
type DefMatiere = [string, string, string | null, string | null, string, number, number];
const MATIERES: DefMatiere[] = [
  ['Français', 'French', null, null, 'Langues', 4, 2],
  ['Mathématiques', 'Mathematics', 'Maths', 'Maths', 'Sciences', 4, 4],
  ['Anglais', 'English', null, null, 'Langues', 2, 4],
  ['Sciences et technologie', 'Science and Technology', 'Sciences', 'Science', 'Sciences', 2, 2],
  ['Histoire et géographie', 'History and Geography', 'Histoire-géo.', 'History-Geo.', 'Sciences humaines', 2, 2],
  ['Éducation civique et morale', 'Civics and Moral Education', 'Éd. civique', 'Civics', 'Sciences humaines', 1, 1],
  ['Éducation physique et sportive', 'Physical Education', 'EPS', 'PE', 'Activités', 1, 1],
  ['Arts et travaux manuels', 'Arts and Crafts', 'Arts', 'Arts', 'Activités', 1, 1],
];
const INFORMATIQUE: DefMatiere = ['Informatique', 'Computer Science', null, null, 'Sciences', 1, 1];
const MATERNELLE: DefMatiere[] = [
  ['Langage', 'Language', null, null, 'Langues', 2, 2],
  ['Graphisme et écriture', 'Pre-writing', 'Graphisme', 'Writing', 'Langues', 1, 1],
  ['Pré-mathématiques', 'Pre-mathematics', 'Pré-maths', 'Pre-maths', 'Sciences', 2, 2],
  ['Éveil au milieu', 'Discovery of the Environment', 'Éveil', 'Discovery', 'Sciences humaines', 1, 1],
  ['Motricité', 'Motor Skills', null, null, 'Activités', 1, 1],
  ['Arts plastiques', 'Arts', 'Arts plast.', 'Arts', 'Activités', 1, 1],
];
const AVEC_INFORMATIQUE = ['CE2', 'CM1'];
export const ABREGES: Record<string, string> = { Maths: 'Mathématiques', Français: 'Français', Anglais: 'Anglais', Sciences: 'Sciences et technologie',
  'Histoire-géo.': 'Histoire et géographie', 'Éd. civique': 'Éducation civique et morale', EPS: 'Éducation physique et sportive', Arts: 'Arts et travaux manuels',
  Informatique: 'Informatique', Langage: 'Langage', Graphisme: 'Graphisme et écriture', 'Pré-maths': 'Pré-mathématiques', Éveil: 'Éveil au milieu',
  Motricité: 'Motricité', 'Arts plast.': 'Arts plastiques' };

export const matieresDuNiveau = (niveau: string) => {
  const anglo = anglophone(niveau);
  const base = maternelle(niveau) ? [...MATERNELLE] : anglo ? [MATIERES[2]!, MATIERES[1]!, MATIERES[0]!, ...MATIERES.slice(3)] : [...MATIERES];
  if (AVEC_INFORMATIQUE.includes(niveau)) base.push(INFORMATIQUE);
  return base.map((m) => ({ libelle: m[0], en: m[1], abrege: m[2], abregeEn: m[3], groupe: m[4], coefficient: anglo ? m[6] : m[5] }));
};

// ---------------------------------------------------------------- grille des frais (inscription, tranches 1 à 3), par niveau et par année
const GRILLE_BASE: Record<string, number[]> = {
  PS: [15000, 25000, 20000, 15000], MS: [15000, 25000, 20000, 15000], GS: [15000, 25000, 20000, 15000],
  SIL: [10000, 20000, 18000, 12000], CP: [10000, 20000, 18000, 12000], CE1: [10000, 25000, 20000, 15000], CE2: [10000, 25000, 20000, 15000],
  CM1: [10000, 28000, 22000, 15000], CM2: [12000, 30000, 25000, 18000],
  'Nursery 1': [15000, 25000, 20000, 15000], 'Nursery 2': [15000, 25000, 20000, 15000],
  'Class 1': [10000, 20000, 18000, 12000], 'Class 2': [10000, 20000, 18000, 12000], 'Class 3': [10000, 25000, 20000, 15000],
  'Class 4': [10000, 25000, 20000, 15000], 'Class 5': [10000, 28000, 22000, 15000], 'Class 6': [12000, 30000, 25000, 18000],
};
/** Les frais montent de 1 000 FCFA sur la tranche 1 à chaque rentrée. */
export const grilleDe = (debut: number): Record<string, number[]> => Object.fromEntries(Object.entries(GRILLE_BASE).map(([k, m]) =>
  [k, [m[0]!, m[1]! - 1000 * (DEBUT - debut), m[2]!, m[3]!]]));

// ---------------------------------------------------------------- familles et élèves
const PRIS = new Set<string>(['008', '012', '020', '031', '047', '055', '056', '063', '071', '084', '090', '102', '117', '125', '133', '141', '150', '158'].map((x) => `600 000 ${x}`));
let telephoneSuivant = 10;
function nouveauTelephone(): string {
  let t: string;
  do { t = `600 000 ${String(telephoneSuivant++).padStart(3, '0')}`; } while (PRIS.has(t));
  PRIS.add(t);
  return t;
}
export function famille(nom: string, langue: 'fr' | 'en', payeur?: string, telephone?: string, lien?: 'mere' | 'pere'): Famille {
  const l = lien ?? (hasard() < 0.7 ? 'mere' : 'pere');
  const noms = langue === 'en' ? ADULTES_EN : ADULTES;
  if (telephone) PRIS.add(telephone);
  const f: Famille = { nom, telephone: telephone ?? nouveauTelephone(), payeur: payeur ?? `${nom} ${choisir(noms[l === 'mere' ? 'F' : 'M'])}`, lien: l, langue };
  if (hasard() < 0.45) f.second = { nom: `${nom} ${choisir(noms[l === 'mere' ? 'M' : 'F'])}`, telephone: nouveauTelephone(), lien: l === 'mere' ? 'pere' : 'mere' };
  return f;
}

const naissance = (niveau: string, annee: number, retard = 0) =>
  `${NAISSANCE[niveau]! - (DEBUT - annee) - retard}-${jj(entier(1, 12))}-${jj(entier(1, 28))}`;
const profilCourant = (): Profil => { const p = hasard(); return p < 0.08 ? 'solde' : p < 0.64 ? 'bon' : p < 0.74 ? 'moyen' : p < 0.82 ? 'retard' : p < 0.96 ? 'tardif' : 'attente'; };
const profilPasse = (): Profil => (hasard() < 0.87 ? 'solde' : 'arriere');
/** Part des élèves qui arrivent de l'extérieur à ce niveau. */
const partNouveaux = (niveau: string) => (['PS', 'Nursery 1'].includes(niveau) ? 1 : niveau === 'SIL' ? 0.45 : niveau === 'Class 1' ? 0.35 : ['MS', 'GS', 'Nursery 2'].includes(niveau) ? 0.15 : 0.1);

export interface Ecole { eleves: Eleve[]; familles: Famille[] }

/** Élèves que nomment les maquettes (Eleves, Classes, Appel, Notes, Impayés…), tous dans l'année en cours. */
function elevesNommes(familles: Famille[]): Eleve[] {
  const f = (nom: string, payeur: string, tel: string, lien: 'mere' | 'pere', langue: 'fr' | 'en' = 'fr') => { const x = famille(nom, langue, payeur, tel, lien); familles.push(x); return x; };
  const kenfack: Famille = { nom: 'KENFACK', telephone: '600 000 055', payeur: 'KENFACK Pauline', lien: 'mere', langue: 'fr', second: { nom: 'KENFACK Albert', telephone: '600 000 056', lien: 'pere' } };
  familles.push(kenfack);
  const djomo = f('DJOMO', 'DJOMO Albert', '600 000 008', 'pere');
  // Année d'entrée d'après le matricule de la maquette (2025 → année scolaire 2025/2026), ramenée à l'année en cours.
  const an = (mat: string | null) => (mat ? 2000 + Number(mat.slice(0, 2)) + DEBUT - 2026 : DEBUT);
  const y = (d: string) => d.replace(/^(\d{4})/, (x) => String(Number(x) + DEBUT - 2026));
  const e = (nom: string, prenoms: string, sexe: 'M' | 'F', classe: string, fam: Famille, type: Passage['type'], naiss: string | null, mat: string | null = null): Eleve => {
    const niveau = classeDe(classe).niveau;
    return { nom, prenoms, sexe, famille: fam, naissance: naiss ? y(naiss) : naissance(niveau, DEBUT, type === 'redoublement' ? 1 : 0), lieu: choisir(VILLES),
      entree: type === 'nouvelle' ? DEBUT : Math.min(an(mat), DEBUT - 1), parcours: { [DEBUT]: { classe, type, profil: 'fixe' } }, niveauScolaire: 12 };
  };
  const nommes: Eleve[] = [
    // CE2 B (maquettes Classes et Appel)
    e('AMOUGOU', 'Steve', 'M', 'CE2 B', f('AMOUGOU', 'AMOUGOU Jean', '600 000 031', 'pere'), 'reinscription', '2017-08-22', '25FR0038'),
    e('ATANGANA', 'Paul', 'M', 'CE2 B', f('ATANGANA', 'ATANGANA Marie', '600 000 047', 'mere'), 'reinscription', '2016-11-02', '25FR0044'),
    e('BIKOÏ', 'Laure', 'F', 'CE2 B', famille('BIKOÏ', 'fr'), 'nouvelle', null),
    e('EWANE', 'Sandra', 'F', 'CE2 B', f('EWANE', 'EWANE Lucie', '600 000 133', 'mere'), 'reinscription', null, '24FR0027'),
    e('KAMGA', 'Arthur', 'M', 'CE2 B', famille('KAMGA', 'fr'), 'redoublement', null, '25FR0051'),
    e('KENFACK', 'Steve', 'M', 'CE2 B', kenfack, 'nouvelle', '2017-01-05'),
    e('MBALLA', 'Inès', 'F', 'CE2 B', famille('MBALLA', 'fr'), 'nouvelle', null),
    e('NANA', 'Ulrich', 'M', 'CE2 B', famille('NANA', 'fr'), 'reinscription', null, '25FR0060'),
    e('NGONO', 'Mireille', 'F', 'CE2 B', famille('NGONO', 'fr'), 'reinscription', null, '24FR0033'),
    e('OWONA', 'Cédric', 'M', 'CE2 B', famille('OWONA', 'fr'), 'nouvelle', null),
    e('SIMO', 'Vanessa', 'F', 'CE2 B', famille('SIMO', 'fr'), 'reinscription', null, '25FR0066'),
    e('TALLA', 'Boris', 'M', 'CE2 B', famille('TALLA', 'fr'), 'nouvelle', null),
    e('YONGA', 'Fabrice', 'M', 'CE2 B', famille('YONGA', 'fr'), 'reinscription', null, '24FR0041'),
    // CM2 A (maquettes Notes, Bulletins, Conseil)
    e('ABENA', 'Christelle', 'F', 'CM2 A', f('ABENA', 'ABENA Rose', '600 000 012', 'mere'), 'nouvelle', '2015-03-14'),
    e('BELLO', 'Aminatou', 'F', 'CM2 A', f('BELLO', 'BELLO Ibrahim', '600 000 020', 'pere'), 'nouvelle', '2015-06-30'),
    e('DJOMO', 'Josiane', 'F', 'CM2 A', djomo, 'reinscription', '2015-02-09', '24FR0031'),
    e('ESSOMBA', 'Ruth', 'F', 'CM2 A', f('ESSOMBA', 'ESSOMBA Luc', '600 000 150', 'pere'), 'reinscription', null, '24FR0019'),
    e('FOKOU', 'Marc', 'M', 'CM2 A', f('FOKOU', 'FOKOU Denise', '600 000 102', 'mere'), 'nouvelle', null),
    e('FOTSO', 'Junior', 'M', 'CM2 A', famille('FOTSO', 'fr'), 'reinscription', null, '23FR0042'),
    e('NDI', 'Emmanuel', 'M', 'CM2 A', f('NDI', 'NDI Thérèse', '600 000 158', 'mere'), 'reinscription', null, '24FR0036'),
    e('NGUEMO', 'Carine', 'F', 'CM2 A', famille('NGUEMO', 'fr'), 'reinscription', null, '22FR0017'),
    e('TAMO', 'Gisèle', 'F', 'CM2 A', famille('TAMO', 'fr'), 'reinscription', null, '23FR0025'),
    e('TCHOUA', 'Ivan', 'M', 'CM2 A', f('TCHOUA', 'TCHOUA Alain', '600 000 125', 'pere'), 'reinscription', null, '24FR0044'),
    e('WAMBA', 'Estelle', 'F', 'CM2 A', famille('WAMBA', 'fr'), 'reinscription', null, '23FR0031'),
    e('ZANG', 'Didier', 'M', 'CM2 A', famille('ZANG', 'fr'), 'reinscription', null, '24FR0050'),
    // Autres classes (maquettes Eleves, Impayes, Caisse, Releve)
    e('DJOMO', 'Patrick', 'M', 'CM1 A', djomo, 'reinscription', '2016-10-17', '25FR0012'),
    e('MBARGA', 'Aïcha', 'F', 'CM1 A', f('MBARGA', 'MBARGA Paul', '600 000 063', 'pere'), 'nouvelle', '2016-12-25'),
    e('KENFACK', 'Loïc', 'M', 'SIL A', kenfack, 'nouvelle', '2021-04-11'),
    e('ACHU', 'Blessing', 'F', 'Class 6', f('ACHU', 'ACHU Martha', '600 000 090', 'mere', 'en'), 'reinscription', '2014-07-08', '24ANG0002'),
    e('NJI', 'Brandon', 'M', 'Class 2', f('NJI', 'NJI Florence', '600 000 071', 'mere', 'en'), 'nouvelle', '2019-05-03'),
    e('TABI', 'Grace', 'F', 'Class 5', f('TABI', 'TABI Samuel', '600 000 084', 'pere', 'en'), 'reinscription', '2015-09-19', '25ANG0015'),
    e('MBAH', 'Kevin', 'M', 'Class 3', f('MBAH', 'MBAH Judith', '600 000 141', 'mere', 'en'), 'reinscription', null, '25ANG0019'),
    e('NGWA', 'Collins', 'M', 'Class 4', f('NGWA', 'NGWA Peter', '600 000 117', 'pere', 'en'), 'reinscription', null, '24ANG0011'),
  ];
  for (const x of nommes) for (const fam of [x.famille]) if (!familles.includes(fam)) familles.push(fam);
  // Niveaux scolaires : ceux des maquettes Notes et Bulletins pour CM2 A, plausibles ailleurs.
  const niveaux: Record<string, number> = { 'ABENA Christelle': 14.5, 'BELLO Aminatou': 13, 'DJOMO Josiane': 13.5, 'ESSOMBA Ruth': 9.5, 'FOKOU Marc': 10.5,
    'FOTSO Junior': 11, 'NDI Emmanuel': 9, 'NGUEMO Carine': 15.5, 'TAMO Gisèle': 16.5, 'TCHOUA Ivan': 10, 'WAMBA Estelle': 12.5, 'ZANG Didier': 11.5,
    'KENFACK Steve': 13.5, 'KAMGA Arthur': 9.5, 'ATANGANA Paul': 11 };
  for (const x of nommes) x.niveauScolaire = niveaux[`${x.nom} ${x.prenoms}`] ?? Math.round((9 + hasard() * 7) * 2) / 2;
  nommes.find((x) => x.nom === 'NANA')!.classeInitiale = 'CE2 A';
  return nommes;
}

/**
 * Génère l'école sur trois années : l'année en cours d'abord (classes de 25 à 30 élèves), puis les deux années
 * précédentes en remontant le parcours de chacun (niveau précédent, redoublement), complétées par les élèves partis
 * (fin de cycle, transferts) pour que chaque classe passée ait aussi 25 à 30 élèves.
 */
export function genererEcole(petit: boolean, nbAnnees = 3): Ecole {
  const annees = nbAnnees === 2 ? [DEBUT - 1, DEBUT] : [DEBUT - 2, DEBUT - 1, DEBUT];
  const taille = () => (petit ? entier(7, 9) : entier(25, 30));
  const familles: Famille[] = [];
  const pris = new Set<string>();
  const eleves: Eleve[] = [];
  const nommes = elevesNommes(familles);
  for (const n of nommes) { pris.add(`${n.nom} ${n.prenoms}`); eleves.push(n); }

  const personne = (niveau: string): { nom: string; prenoms: string; sexe: 'M' | 'F'; famille: Famille } => {
    const anglo = anglophone(niveau);
    const langue = anglo ? 'en' : 'fr';
    const sexe: 'M' | 'F' = hasard() < 0.5 ? 'M' : 'F';
    let nom: string, prenoms: string;
    // Fratries : une famille déjà connue sur quatre accueille un autre enfant.
    const soeurs = familles.filter((f) => f.langue === langue && !['KENFACK', 'DJOMO'].includes(f.nom) && eleves.filter((e) => e.famille === f).length < 3);
    const fam = soeurs.length && hasard() < 0.25 ? choisir(soeurs) : null;
    do {
      nom = fam ? fam.nom : choisir(anglo ? NOMS_EN : NOMS_FR);
      prenoms = choisir(PRENOMS[langue][sexe]);
      if (hasard() < 0.2) prenoms += ` ${choisir(PRENOMS[langue][sexe])}`;
    } while (pris.has(`${nom} ${prenoms}`) || prenoms.split(' ')[0] === prenoms.split(' ')[1]);
    pris.add(`${nom} ${prenoms}`);
    const f = fam ?? famille(nom, langue);
    if (!familles.includes(f)) familles.push(f);
    return { nom, prenoms, sexe, famille: f };
  };

  /** Complète le parcours d'un élève vers le passé à partir de l'année `annee` où il est en `classe` avec ce type. */
  const remonter = (e: Eleve, annee: number) => {
    let a = annee;
    while (a > annees[0]!) {
      const p = e.parcours[a]!;
      if (p.type === 'nouvelle') { e.entree = a; return; }
      const precedente = p.type === 'redoublement' ? p.classe : classePrecedente(p.classe);
      if (!precedente) { p.type = 'nouvelle'; e.entree = a; return; }
      const niveau = classeDe(precedente).niveau;
      const r = hasard();
      const type: Passage['type'] = ['PS', 'Nursery 1'].includes(niveau) || r < partNouveaux(niveau) ? 'nouvelle' : r < partNouveaux(niveau) + 0.05 ? 'redoublement' : 'reinscription';
      e.parcours[a - 1] = { classe: precedente, type, profil: profilPasse(), fin: p.type === 'redoublement' ? 'redouble' : 'admis' };
      a--;
    }
    // Présent la première année gérée : entré avant, ou nouveau cette année-là.
    const p0 = e.parcours[annees[0]!]!;
    if (p0.type === 'nouvelle') e.entree = annees[0]!;
    else {
      const niveau = classeDe(p0.classe).niveau;
      const chaine = anglophone(niveau) ? CHAINE_EN : CHAINE_FR;
      const profondeur = Math.max(1, Math.min(5, chaine.indexOf(niveau)));
      e.entree = annees[0]! - entier(1, profondeur);
    }
  };

  // 1. Année en cours : chaque classe reçoit ses élèves (les nommés d'abord).
  for (const c of CLASSES) {
    const n = taille();
    const deja = eleves.filter((e) => e.parcours[DEBUT]?.classe === c.nom).length;
    for (let i = deja; i < n; i++) {
      const p = personne(c.niveau);
      const r = hasard();
      const type: Passage['type'] = ['PS', 'Nursery 1'].includes(c.niveau) || r < partNouveaux(c.niveau) ? 'nouvelle' : r < partNouveaux(c.niveau) + 0.06 ? 'redoublement' : 'reinscription';
      const inscritLe = type === 'nouvelle' && hasard() < 0.08 ? `${DEBUT}-09-${jj(entier(8, 26))}` : undefined;
      eleves.push({ ...p, naissance: naissance(c.niveau, DEBUT, type === 'redoublement' ? 1 : 0), lieu: choisir(VILLES), entree: DEBUT,
        parcours: { [DEBUT]: { classe: c.nom, type, profil: profilCourant() } }, niveauScolaire: Math.round((8 + hasard() * 9) * 2) / 2, inscritLe });
    }
  }
  for (const e of eleves) remonter(e, DEBUT);
  // Une classe passée alimentée par plusieurs classes de l'année suivante (GS A → SIL A et B) ne dépasse pas sa taille :
  // les élèves en trop sont arrivés l'année suivante.
  const plafond = petit ? 9 : 30;
  for (const a of annees.slice(0, -1).reverse()) {
    for (const c of CLASSES) {
      const liste = eleves.filter((e) => e.parcours[a]?.classe === c.nom && e.parcours[a + 1] && !nommes.includes(e));
      const total = eleves.filter((e) => e.parcours[a]?.classe === c.nom).length;
      for (let k = 0; k < total - plafond && liste.length; k++) {
        const e = liste.splice(Math.floor(hasard() * liste.length), 1)[0]!;
        for (const x of Object.keys(e.parcours).map(Number)) if (x <= a) delete e.parcours[x];
        e.parcours[a + 1]!.type = 'nouvelle';
        e.entree = a + 1;
      }
    }
  }

  // 2. Années passées : les élèves partis complètent chaque classe jusqu'à sa taille.
  for (const a of annees.slice(0, -1).reverse()) {
    for (const c of CLASSES) {
      const n = taille();
      const deja = eleves.filter((e) => e.parcours[a]?.classe === c.nom).length;
      const finDeCycle = !niveauSuivant(c.niveau);
      for (let i = deja; i < n; i++) {
        const p = personne(c.niveau);
        const r = hasard();
        const type: Passage['type'] = ['PS', 'Nursery 1'].includes(c.niveau) || r < partNouveaux(c.niveau) ? 'nouvelle' : r < partNouveaux(c.niveau) + 0.05 ? 'redoublement' : 'reinscription';
        // Fin de cycle : admis et sorti de l'école ; sinon transfert en cours d'année ou à sa fin, rarement exclusion.
        const fin: Passage['fin'] = finDeCycle ? 'admis' : hasard() < 0.04 ? 'exclu' : 'depart';
        const e: Eleve = { ...p, naissance: naissance(c.niveau, a, type === 'redoublement' ? 1 : 0), lieu: choisir(VILLES), entree: a,
          parcours: { [a]: { classe: c.nom, type, profil: profilPasse(), fin } }, niveauScolaire: Math.round((8 + hasard() * 9) * 2) / 2 };
        eleves.push(e);
        remonter(e, a);
      }
    }
  }

  // 3. Réductions : fratrie (sous le seuil, accordée par l'économe) ; enfant du personnel (au-delà, validée par la directrice).
  for (const e of eleves) {
    const freres = eleves.filter((x) => x.famille === e.famille);
    if (freres.length > 1 && freres.indexOf(e) > 0 && !['DJOMO'].includes(e.nom)) e.reductions = [{ ordre: 2, montant: 5000, motif: 'Fratrie' }];
  }
  eleves.find((e) => e.nom === 'KENFACK' && e.prenoms === 'Steve')!.reductions = [{ ordre: 2, montant: 5000, motif: 'Fratrie' }];
  eleves.find((e) => e.nom === 'KENFACK' && e.prenoms === 'Loïc')!.reductions = undefined;
  for (const e of melanger(eleves.filter((x) => !x.reductions && x.famille.langue === 'fr' && x.parcours[DEBUT])).slice(0, 4)) e.reductions = [{ ordre: 3, montant: 7500, motif: 'Enfant du personnel' }];
  return { eleves, familles };
}

/** Les élèves d'une année, triés par classe puis par nom. */
export const elevesDe = (eleves: Eleve[], annee: number) =>
  eleves.filter((e) => e.parcours[annee]).sort((a, b) => a.parcours[annee]!.classe.localeCompare(b.parcours[annee]!.classe) || `${a.nom} ${a.prenoms}`.localeCompare(`${b.nom} ${b.prenoms}`));
