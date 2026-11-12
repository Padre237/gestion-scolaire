// Correspondance écran de maquette → route de l'application, compte de démonstration, PNG de référence.
// Les comptes sont ceux de demo:donnees (mots de passe de répétition, jamais ceux de la démo réelle).
import type { Page } from 'puppeteer';

export interface Ecran {
  nom: string;            // fichier de maquette sans « .dc.html »
  image: string;          // PNG de référence, relatif à maquettes/images
  route: string;
  compte?: string;        // identifiant:mot de passe (ou téléphone:mot de passe pour un parent)
  parent?: boolean;
  mobile?: boolean;
  nuit?: boolean;
  attente?: number;
  actions?: ((p: Page) => Promise<void>)[];
}

const D = 'directrice:demo-directrice';
const S = 'secretaire:demo-secretaire';
const E = 'econome:demo-econome';
const P = 'prefet:demo-prefet';
const IP = 'onana.b:demo-onana';
const IP2 = 'eyenga.s:demo-eyenga';
const IM = 'essama.l:demo-essama';
const PAR = '600000055:demo-kenfack';

export const ECRANS: Ecran[] = [
  { nom: 'Main', image: '1-Accueil-et-pilotage/01-Tableau-de-bord.png', route: '/tableau-de-bord', compte: D },
  { nom: 'Connexion', image: '1-Accueil-et-pilotage/02-Connexion.png', route: '/connexion' },
  { nom: 'Statistiques', image: '1-Accueil-et-pilotage/03-Pilotage-statistiques.png', route: '/pilotage/statistiques', compte: D },
  { nom: 'Assistant', image: '1-Accueil-et-pilotage/04-Assistant.png', route: '/assistant', compte: D },
  { nom: 'Eleves', image: '2-Eleves/01-Eleves-liste.png', route: '/scolarite/eleves', compte: S },
  { nom: 'Fiche-eleve', image: '2-Eleves/02-Fiche-eleve.png', route: '/scolarite/eleves/kenfack-steve', compte: E },
  { nom: 'Inscription', image: '2-Eleves/03-Eleves-nouvelle-inscription.png', route: '/scolarite/inscription', compte: S },
  { nom: 'Classes', image: '2-Eleves/04-Eleves-classes.png', route: '/scolarite/classes', compte: S },
  { nom: 'Caisse', image: '3-Frais-et-caisse/01-Frais-et-caisse-caisse-du-jour.png', route: '/finances/caisse', compte: E },
  { nom: 'Encaissement', image: '3-Frais-et-caisse/02-Encaissement.png', route: '/finances/encaissement/kenfack-steve', compte: E },
  { nom: 'Recu', image: '3-Frais-et-caisse/03-Recu-bilingue-240-140-mm.png', route: '/finances/recus/dernier', compte: E },
  { nom: 'Impayes', image: '3-Frais-et-caisse/04-Frais-et-caisse-impayes.png', route: '/finances/impayes', compte: E },
  { nom: 'Depenses', image: '3-Frais-et-caisse/05-Frais-et-caisse-depenses.png', route: '/finances/depenses', compte: E },
  { nom: 'Comptes', image: '3-Frais-et-caisse/06-Frais-et-caisse-etat-des-comptes.png', route: '/finances/comptes', compte: E },
  { nom: 'Frais', image: '3-Frais-et-caisse/07-Frais-et-caisse-grille-des-frais.png', route: '/finances/grille', compte: E },
  { nom: 'Validations', image: '3-Frais-et-caisse/08-Frais-et-caisse-a-valider.png', route: '/finances/validations', compte: D },
  { nom: 'Releve', image: '3-Frais-et-caisse/09-Frais-et-caisse-releve-bancaire.png', route: '/finances/releve', compte: E },
  { nom: 'Matieres', image: '4-Notes-emploi-du-temps-vie-scolaire/01-Notes-et-bulletins-matieres.png', route: '/pedagogie/matieres', compte: P },
  { nom: 'Notes', image: '4-Notes-emploi-du-temps-vie-scolaire/02-Notes-et-bulletins-saisie-des-notes.png', route: '/pedagogie/notes', compte: IP },
  { nom: 'Bulletins', image: '4-Notes-emploi-du-temps-vie-scolaire/03-Notes-et-bulletins-bulletin.png', route: '/pedagogie/bulletins', compte: P },
  { nom: 'Conseil', image: '4-Notes-emploi-du-temps-vie-scolaire/04-Notes-et-bulletins-conseil-de-classe.png', route: '/pedagogie/conseil', compte: P },
  { nom: 'Emploi-du-temps', image: '4-Notes-emploi-du-temps-vie-scolaire/05-Emploi-du-temps-et-cahier-de-textes.png', route: '/emploi-du-temps', compte: P },
  { nom: 'Appel', image: '4-Notes-emploi-du-temps-vie-scolaire/06-Vie-scolaire-appel.png', route: '/vie-scolaire/appel', compte: IP2 },
  { nom: 'Discipline', image: '4-Notes-emploi-du-temps-vie-scolaire/07-Vie-scolaire-absences-et-discipline.png', route: '/vie-scolaire/discipline', compte: D },
  { nom: 'Fusion', image: '4-Notes-emploi-du-temps-vie-scolaire/08-Notes-et-bulletins-fusion-des-notes.png', route: '/pedagogie/fusion', compte: IP },
  { nom: 'Instituteur-matiere', image: '4-Notes-emploi-du-temps-vie-scolaire/09-Notes-et-bulletins-instituteur-de-matiere.png', route: '/pedagogie/notes', compte: IM },
  { nom: 'Annonces', image: '5-Messages-personnel-parametres/01-Messages-annonces.png', route: '/messages/annonces', compte: IP },
  { nom: 'Messagerie', image: '5-Messages-personnel-parametres/02-Messages-messagerie-des-parents.png', route: '/messages/messagerie', compte: S },
  { nom: 'Messages', image: '5-Messages-personnel-parametres/03-Messages-SMS.png', route: '/messages/sms', compte: S },
  { nom: 'Personnel', image: '5-Messages-personnel-parametres/04-Personnel.png', route: '/personnel', compte: S },
  { nom: 'Etablissement', image: '5-Messages-personnel-parametres/05-Parametres-etablissement.png', route: '/parametres/etablissement', compte: S },
  { nom: 'Utilisateurs', image: '5-Messages-personnel-parametres/06-Parametres-utilisateurs-et-roles.png', route: '/parametres/utilisateurs', compte: S },
  { nom: 'Audit', image: '5-Messages-personnel-parametres/07-Parametres-journal-d-audit.png', route: '/parametres/audit', compte: S },
  { nom: 'Donnees', image: '5-Messages-personnel-parametres/08-Parametres-donnees.png', route: '/parametres/donnees', compte: S },
  { nom: 'Cloture', image: '5-Messages-personnel-parametres/09-Parametres-cloture-d-annee.png', route: '/parametres/cloture', compte: S },
  { nom: 'Mobile-enseignant-notes', image: '6-Applications-mobiles/01-Instituteur-saisie-des-notes.png', route: '/instituteur/notes', compte: IP, mobile: true },
  { nom: 'Mobile-enseignant-appel', image: '6-Applications-mobiles/02-Instituteur-appel.png', route: '/instituteur/appel', compte: IP2, mobile: true },
  { nom: 'Mobile-parent-connexion', image: '6-Applications-mobiles/03-Parent-connexion.png', route: '/parent/connexion', mobile: true },
  { nom: 'Mobile-parent-accueil', image: '6-Applications-mobiles/04-Parent-accueil.png', route: '/parent/accueil', compte: PAR, parent: true, mobile: true },
  { nom: 'Mobile-parent-notes', image: '6-Applications-mobiles/05-Parent-notes-et-bulletin.png', route: '/parent/notes', compte: PAR, parent: true, mobile: true },
  { nom: 'Mobile-parent-paiements', image: '6-Applications-mobiles/06-Parent-paiements.png', route: '/parent/paiements', compte: PAR, parent: true, mobile: true },
  { nom: 'Mobile-parent-agenda', image: '6-Applications-mobiles/07-Parent-emploi-du-temps-et-devoirs.png', route: '/parent/agenda', compte: PAR, parent: true, mobile: true },
  { nom: 'Mobile-parent-messages', image: '6-Applications-mobiles/08-Parent-annonces-et-messages.png', route: '/parent/messages', compte: PAR, parent: true, mobile: true },
  { nom: 'Mobile-parent-ecrire', image: '6-Applications-mobiles/09-Parent-ecrire-a-lecole.png', route: '/parent/ecrire', compte: PAR, parent: true, mobile: true },
  { nom: 'Nuit-Tableau-de-bord', image: '7-Mode-Nuit-au-choix-du-poste/01-Tableau-de-bord-Nuit.png', route: '/tableau-de-bord', compte: D, nuit: true },
  { nom: 'Nuit-Connexion', image: '7-Mode-Nuit-au-choix-du-poste/02-Connexion-Nuit.png', route: '/connexion', nuit: true },
  { nom: 'Nuit-Eleves', image: '7-Mode-Nuit-au-choix-du-poste/03-Eleves-Nuit.png', route: '/scolarite/eleves', compte: S, nuit: true },
  { nom: 'Nuit-Fiche-eleve', image: '7-Mode-Nuit-au-choix-du-poste/04-Fiche-eleve-Nuit.png', route: '/scolarite/eleves/kenfack-steve', compte: E, nuit: true },
  { nom: 'Nuit-Encaissement', image: '7-Mode-Nuit-au-choix-du-poste/05-Encaissement-Nuit.png', route: '/finances/encaissement/kenfack-steve', compte: E, nuit: true },
  { nom: 'Nuit-Impayes', image: '7-Mode-Nuit-au-choix-du-poste/06-Frais-et-caisse-Nuit.png', route: '/finances/impayes', compte: E, nuit: true },
];
