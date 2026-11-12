// Programme préinstallé (lot 1) : groupes de matières et matières de chaque niveau, avec leurs coefficients,
// dans les deux sous-systèmes. L'établissement le reçoit à sa première année scolaire ; il reste modifiable ensuite.

export const GROUPES_MATIERES: [string, string][] = [['Langues', 'Languages'], ['Sciences', 'Sciences'], ['Sciences humaines', 'Humanities'], ['Activités', 'Activities']];

export interface MatiereProgramme {
  libelleFr: string; libelleEn: string; abregeFr: string | null; abregeEn: string | null; groupe: string; coefficient: number;
}

// libellé, libellé anglais, abrégé, abrégé anglais, groupe, coefficient (francophone), coefficient (anglophone)
type Def = [string, string, string | null, string | null, string, number, number];
const PRIMAIRE: Def[] = [
  ['Français', 'French', null, null, 'Langues', 4, 2],
  ['Mathématiques', 'Mathematics', 'Maths', 'Maths', 'Sciences', 4, 4],
  ['Anglais', 'English', null, null, 'Langues', 2, 4],
  ['Sciences et technologie', 'Science and Technology', 'Sciences', 'Science', 'Sciences', 2, 2],
  ['Histoire et géographie', 'History and Geography', 'Histoire-géo.', 'History-Geo.', 'Sciences humaines', 2, 2],
  ['Éducation civique et morale', 'Civics and Moral Education', 'Éd. civique', 'Civics', 'Sciences humaines', 1, 1],
  ['Éducation physique et sportive', 'Physical Education', 'EPS', 'PE', 'Activités', 1, 1],
  ['Arts et travaux manuels', 'Arts and Crafts', 'Arts', 'Arts', 'Activités', 1, 1],
];
const INFORMATIQUE: Def = ['Informatique', 'Computer Science', null, null, 'Sciences', 1, 1];
const MATERNELLE: Def[] = [
  ['Langage', 'Language', null, null, 'Langues', 2, 2],
  ['Graphisme et écriture', 'Pre-writing', 'Graphisme', 'Writing', 'Langues', 1, 1],
  ['Pré-mathématiques', 'Pre-mathematics', 'Pré-maths', 'Pre-maths', 'Sciences', 2, 2],
  ['Éveil au milieu', 'Discovery of the Environment', 'Éveil', 'Discovery', 'Sciences humaines', 1, 1],
  ['Motricité', 'Motor Skills', null, null, 'Activités', 1, 1],
  ['Arts plastiques', 'Arts', 'Arts plast.', 'Arts', 'Activités', 1, 1],
];
const AVEC_INFORMATIQUE = ['CE2', 'CM1'];

/** Matières d'un niveau, dans l'ordre du bulletin (l'anglais en tête dans le sous-système anglophone). */
export function programmeDuNiveau(code: string, sousSysteme: 'francophone' | 'anglophone', ordre: string): MatiereProgramme[] {
  const anglo = sousSysteme === 'anglophone';
  const base = ordre === 'maternelle' ? [...MATERNELLE] : ordre === 'primaire' ? (anglo ? [PRIMAIRE[2]!, PRIMAIRE[1]!, PRIMAIRE[0]!, ...PRIMAIRE.slice(3)] : [...PRIMAIRE]) : [];
  if (AVEC_INFORMATIQUE.includes(code)) base.push(INFORMATIQUE);
  return base.map((m) => ({ libelleFr: m[0], libelleEn: m[1], abregeFr: m[2], abregeEn: m[3], groupe: m[4], coefficient: anglo ? m[6] : m[5] }));
}

/** Code d'une matière, tiré de son libellé (même règle que la création d'une matière à l'écran). */
export const codeMatiere = (libelleFr: string) => libelleFr.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, '_').slice(0, 20);
