// Formulaire d'inscription configurable (lot 2, D-42) : blocs, types de champ et questions prêtes à l'emploi.
// Les champs de base (nom, prénoms, sexe, date de naissance, responsables, classe) sont toujours demandés et ne figurent pas ici.

export type TypeChamp = 'texte' | 'choix_unique' | 'choix_multiple' | 'photo' | 'date' | 'nombre';
export type Bloc = 'identite' | 'famille' | 'scolarite' | 'sante' | 'vie' | 'pieces';

export const BLOCS: [Bloc, string][] = [
  ['identite', 'Identité de l’élève'], ['famille', 'Famille et responsables'], ['scolarite', 'Scolarité antérieure'],
  ['sante', 'Santé'], ['vie', 'Vie à l’école'], ['pieces', 'Pièces du dossier'],
];
export const TYPES_CHAMP: [TypeChamp, string][] = [
  ['texte', 'Texte'], ['choix_unique', 'Choix unique'], ['choix_multiple', 'Choix multiples'], ['photo', 'Photo (5 Mo au plus)'], ['date', 'Date'], ['nombre', 'Nombre'],
];
/** Taille maximale d'une photo jointe au dossier. */
export const PHOTO_MAX_OCTETS = 5 * 1024 * 1024;

export interface ChampInscription {
  code: string; bloc: Bloc; libelle: string; type: TypeChamp; options: string[]; obligatoire: boolean; actif: boolean; ordre: number;
  /** Code de la question prête d'où vient le champ ; null pour une question créée par l'école. */
  modele: string | null;
}

type Q = [code: string, bloc: Bloc, libelle: string, type: TypeChamp, options: string[], parDefaut: boolean, obligatoire: boolean];
const QUESTIONS: Q[] = [
  ['nationalite', 'identite', 'Nationalité', 'choix_unique', ['Camerounaise', 'Autre'], true, false],
  ['langue_maison', 'identite', 'Langue parlée à la maison', 'choix_unique', ['Français', 'Anglais', 'Français et anglais', 'Langue nationale'], true, false],
  ['religion', 'identite', 'Religion', 'choix_unique', ['Catholique', 'Protestante', 'Musulmane', 'Autre', 'Non précisée'], false, false],
  ['rang_fratrie', 'identite', 'Rang dans la fratrie', 'nombre', [], false, false],
  ['quartier', 'famille', 'Quartier d’habitation', 'texte', [], true, false],
  ['profession_pere', 'famille', 'Profession du père', 'texte', [], true, false],
  ['profession_mere', 'famille', 'Profession de la mère', 'texte', [], true, false],
  ['situation_familiale', 'famille', 'Situation familiale', 'choix_unique', ['Parents ensemble', 'Parents séparés', 'Élève confié à un tuteur', 'Orphelin'], false, false],
  ['email_parent', 'famille', 'Adresse électronique d’un parent', 'texte', [], false, false],
  ['ecole_precedente', 'scolarite', 'École précédente', 'texte', [], true, false],
  ['derniere_classe', 'scolarite', 'Dernière classe suivie', 'texte', [], true, false],
  ['moyenne_precedente', 'scolarite', 'Moyenne de l’année précédente', 'nombre', [], false, false],
  ['annees_redoublees', 'scolarite', 'Nombre d’années redoublées', 'nombre', [], false, false],
  ['groupe_sanguin', 'sante', 'Groupe sanguin', 'choix_unique', ['A+', 'A−', 'B+', 'B−', 'AB+', 'AB−', 'O+', 'O−', 'Inconnu'], true, false],
  ['allergies', 'sante', 'Allergies', 'texte', [], true, false],
  ['maladies', 'sante', 'Maladies à signaler', 'choix_multiple', ['Asthme', 'Drépanocytose', 'Diabète', 'Épilepsie', 'Autre'], false, false],
  ['medecin', 'sante', 'Médecin ou centre de santé', 'texte', [], false, false],
  ['contact_urgence', 'sante', 'Personne à prévenir en urgence', 'texte', [], true, false],
  ['telephone_urgence', 'sante', 'Téléphone en cas d’urgence', 'texte', [], true, false],
  ['transport', 'vie', 'Transport scolaire', 'choix_unique', ['Oui', 'Non'], false, false],
  ['cantine', 'vie', 'Cantine', 'choix_unique', ['Oui', 'Non'], false, false],
  ['activites', 'vie', 'Activités souhaitées', 'choix_multiple', ['Football', 'Danse', 'Musique', 'Informatique', 'Arts plastiques', 'Théâtre'], false, false],
  ['acte_naissance', 'pieces', 'Acte de naissance', 'photo', [], true, false],
  ['carnet_vaccination', 'pieces', 'Carnet de vaccination', 'photo', [], true, false],
  ['bulletin_precedent', 'pieces', 'Dernier bulletin', 'photo', [], false, false],
  ['certificat_medical', 'pieces', 'Certificat médical', 'photo', [], false, false],
];

/** Questions prêtes : l'école les active, les rend obligatoires ou facultatives, en change l'ordre. */
export const BIBLIOTHEQUE: ChampInscription[] = QUESTIONS.map(([code, bloc, libelle, type, options, , obligatoire], i) =>
  ({ code, bloc, libelle, type, options, obligatoire, actif: true, ordre: i + 1, modele: code }));

/** Formulaire proposé tant que l'école ne l'a pas réglé. */
export const FORMULAIRE_PAR_DEFAUT: ChampInscription[] = QUESTIONS.filter((q) => q[5])
  .map(([code, bloc, libelle, type, options, , obligatoire], i) => ({ code, bloc, libelle, type, options, obligatoire, actif: true, ordre: i + 1, modele: code }));
