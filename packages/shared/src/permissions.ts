// Catalogue des permissions et rôles prêts à l'emploi (MATRICE.md, ADR-12).
// Une permission est nommée module.ressource.action (conception § 8).
// Les libellés marqués « maquette » sont repris mot pour mot de l'écran
// Paramètres · Utilisateurs et rôles ; les autres ont été validés avec la matrice (E-15).

export type GroupePermission =
  | 'Tableau de bord' | 'Élèves' | 'Frais et caisse' | 'Notes et bulletins' | 'Emploi du temps'
  | 'Vie scolaire' | 'Messages' | 'Personnel' | 'Pilotage' | 'Assistant' | 'Paramètres' | 'Espace parent';

export interface DefinitionPermission {
  code: string;
  groupe: GroupePermission;
  libelleFr: string;
  libelleEn: string;
}

const p = (code: string, groupe: GroupePermission, libelleFr: string, libelleEn: string): DefinitionPermission =>
  ({ code, groupe, libelleFr, libelleEn });

export const PERMISSIONS: readonly DefinitionPermission[] = [
  // Frais et caisse : les sept premières dans l'ordre de la maquette.
  p('finances.versement.encaisser', 'Frais et caisse', 'Encaisser un versement', 'Receive a payment'),
  p('finances.recu.imprimer', 'Frais et caisse', 'Imprimer et réimprimer un reçu', 'Print and reprint a receipt'),
  p('caisse.session.gerer', 'Frais et caisse', 'Ouvrir et clôturer sa session de caisse', 'Open and close one\'s till session'),
  p('finances.annulation.valider', 'Frais et caisse', 'Valider une annulation', 'Approve a cancellation'),
  p('finances.reduction.accorder', 'Frais et caisse', 'Accorder une réduction sous le seuil', 'Grant a discount below the threshold'),
  p('finances.reduction.valider', 'Frais et caisse', 'Valider une réduction au-delà du seuil', 'Approve a discount above the threshold'),
  p('caisse.sortie.valider', 'Frais et caisse', 'Valider une sortie de caisse', 'Approve a cash withdrawal'),
  p('finances.grille.consulter', 'Frais et caisse', 'Consulter la grille des frais', 'View the fee schedule'),
  p('finances.grille.modifier', 'Frais et caisse', 'Modifier la grille des frais', 'Edit the fee schedule'),
  p('finances.reduction.demander', 'Frais et caisse', 'Demander une réduction au-delà du seuil', 'Request a discount above the threshold'),
  p('finances.recu.consulter', 'Frais et caisse', 'Consulter les reçus', 'View receipts'),
  p('finances.versement.annuler', 'Frais et caisse', 'Demander une annulation', 'Request a cancellation'),
  p('finances.avis.emettre', 'Frais et caisse', 'Émettre un avis de paiement', 'Issue a payment notice'),
  p('finances.impaye.consulter', 'Frais et caisse', 'Consulter les impayés', 'View unpaid fees'),
  p('finances.comptes.consulter', 'Frais et caisse', 'Consulter l\'état des comptes', 'View the accounts'),
  p('finances.releve.gerer', 'Frais et caisse', 'Rapprocher le relevé bancaire', 'Reconcile the bank statement'),
  p('caisse.consulter', 'Frais et caisse', 'Consulter les caisses', 'View the tills'),
  p('caisse.session.forcer', 'Frais et caisse', 'Forcer la clôture d\'une session', 'Force-close a session'),
  p('caisse.entree.enregistrer', 'Frais et caisse', 'Enregistrer une entrée diverse', 'Record other income'),
  p('caisse.banque.verser', 'Frais et caisse', 'Verser à la banque', 'Deposit at the bank'),
  p('caisse.sortie.demander', 'Frais et caisse', 'Demander une sortie de caisse', 'Request a cash withdrawal'),
  p('caisse.sortie.decaisser', 'Frais et caisse', 'Décaisser une sortie', 'Pay out a withdrawal'),
  p('caisse.categorie.gerer', 'Frais et caisse', 'Gérer les catégories de dépenses', 'Manage expense categories'),

  // Élèves : les deux premières dans l'ordre de la maquette.
  p('scolarite.eleve.consulter', 'Élèves', 'Consulter les fiches', 'View student records'),
  p('scolarite.inscription.creer', 'Élèves', 'Inscrire un élève', 'Enrol a student'),
  p('scolarite.eleve.exporter', 'Élèves', 'Exporter les listes d\'élèves', 'Export student lists'),
  p('scolarite.responsable.gerer', 'Élèves', 'Gérer les responsables', 'Manage guardians'),
  p('scolarite.inscription.changer_classe', 'Élèves', 'Changer de classe', 'Change class'),
  p('scolarite.inscription.radier', 'Élèves', 'Enregistrer un départ', 'Record a departure'),
  p('scolarite.document.imprimer', 'Élèves', 'Imprimer listes et certificats', 'Print lists and certificates'),
  p('scolarite.derogation.demander', 'Élèves', 'Demander une dérogation', 'Request an exemption'),
  p('scolarite.derogation.valider', 'Élèves', 'Valider une dérogation', 'Approve an exemption'),

  // Messages : la première est celle de la maquette.
  p('communication.annonce.publier', 'Messages', 'Publier une annonce', 'Publish an announcement'),
  p('communication.sms.envoyer', 'Messages', 'Envoyer des SMS', 'Send text messages'),
  p('communication.sms.parametrer', 'Messages', 'Régler les notifications', 'Set up notifications'),
  p('communication.messagerie.repondre', 'Messages', 'Répondre aux parents', 'Reply to parents'),

  p('pilotage.tableau.consulter', 'Tableau de bord', 'Consulter le tableau de bord', 'View the dashboard'),

  p('pedagogie.programme.consulter', 'Notes et bulletins', 'Consulter les matières', 'View subjects'),
  p('pedagogie.programme.modifier', 'Notes et bulletins', 'Paramétrer les matières', 'Set up subjects'),
  p('pedagogie.affectation.gerer', 'Notes et bulletins', 'Affecter les instituteurs', 'Assign teachers'),
  p('pedagogie.periode.ouvrir', 'Notes et bulletins', 'Ouvrir et fermer la saisie', 'Open and close mark entry'),
  p('pedagogie.periode.deverrouiller', 'Notes et bulletins', 'Déverrouiller la saisie', 'Unlock mark entry'),
  p('pedagogie.evaluation.creer', 'Notes et bulletins', 'Créer une évaluation', 'Create an assessment'),
  p('pedagogie.note.saisir', 'Notes et bulletins', 'Saisir les notes', 'Enter marks'),
  p('pedagogie.note.lire', 'Notes et bulletins', 'Lire les notes', 'Read marks'),
  p('pedagogie.note.signaler', 'Notes et bulletins', 'Signaler une erreur', 'Report an error'),
  p('pedagogie.fusion.transmettre', 'Notes et bulletins', 'Fusionner les notes', 'Merge marks'),
  p('pedagogie.fusion.valider', 'Notes et bulletins', 'Valider la fusion', 'Approve the merge'),
  p('pedagogie.bulletin.calculer', 'Notes et bulletins', 'Calculer les bulletins', 'Compute report cards'),
  p('pedagogie.bulletin.publier', 'Notes et bulletins', 'Publier les bulletins', 'Publish report cards'),
  p('pedagogie.bulletin.apprecier', 'Notes et bulletins', 'Rédiger les appréciations', 'Write comments'),
  p('pedagogie.bulletin.lever_blocage', 'Notes et bulletins', 'Lever le blocage d\'un bulletin', 'Release a report card'),
  p('pedagogie.conseil.gerer', 'Notes et bulletins', 'Tenir le conseil de classe', 'Run the class council'),
  p('pedagogie.conseil.decider', 'Notes et bulletins', 'Décider du passage', 'Decide on promotion'),

  p('pedagogie.edt.consulter', 'Emploi du temps', 'Consulter l\'emploi du temps', 'View the timetable'),
  p('pedagogie.edt.grille', 'Emploi du temps', 'Fixer la grille horaire', 'Set the school timetable grid'),
  p('pedagogie.edt.placer', 'Emploi du temps', 'Placer les cours de sa classe', 'Place one\'s class lessons'),
  p('pedagogie.edt.valider', 'Emploi du temps', 'Valider l\'emploi du temps', 'Approve the timetable'),
  p('pedagogie.cahier.ecrire', 'Emploi du temps', 'Tenir le cahier de textes', 'Keep the lesson log'),

  p('vie_scolaire.appel.faire', 'Vie scolaire', 'Faire l\'appel', 'Take the register'),
  p('vie_scolaire.absence.justifier', 'Vie scolaire', 'Justifier une absence', 'Excuse an absence'),
  p('vie_scolaire.observation.creer', 'Vie scolaire', 'Noter une observation', 'Record an observation'),
  p('vie_scolaire.sanction.decider', 'Vie scolaire', 'Décider une sanction', 'Decide on a sanction'),
  p('vie_scolaire.dossier.consulter', 'Vie scolaire', 'Consulter la vie scolaire', 'View attendance and discipline'),

  p('personnel.fiche.consulter', 'Personnel', 'Consulter le personnel', 'View staff'),
  p('personnel.fiche.gerer', 'Personnel', 'Gérer le personnel', 'Manage staff'),

  p('pilotage.statistiques.consulter', 'Pilotage', 'Consulter le pilotage', 'View statistics'),

  p('assistant.question.poser', 'Assistant', 'Interroger l\'assistant', 'Ask the assistant'),
  p('assistant.reglage.gerer', 'Assistant', 'Régler l\'assistant (fournisseur, modèle, clé)', 'Configure the assistant'),
  p('assistant.proposition.traduction', 'Assistant', 'Valider une traduction proposée', 'Approve a proposed translation'),
  p('assistant.proposition.relance', 'Assistant', 'Valider des relances proposées', 'Approve proposed reminders'),
  p('assistant.proposition.bordereau', 'Assistant', 'Valider un bordereau lu par l\'assistant', 'Approve a slip read by the assistant'),
  p('assistant.proposition.import', 'Assistant', 'Valider un import préparé par l\'assistant', 'Approve an import prepared by the assistant'),
  p('assistant.proposition.appreciation', 'Assistant', 'Valider des brouillons d\'appréciation', 'Approve draft comments'),
  p('assistant.proposition.synthese', 'Assistant', 'Valider une synthèse pour le conseil', 'Approve a council summary'),

  p('structure.consulter', 'Paramètres', 'Consulter le paramétrage', 'View settings'),
  p('structure.etablissement.modifier', 'Paramètres', 'Modifier l\'établissement', 'Edit school details'),
  p('structure.annee.gerer', 'Paramètres', 'Gérer les années scolaires', 'Manage school years'),
  p('structure.periode.modifier', 'Paramètres', 'Modifier les périodes', 'Edit terms'),
  p('structure.classe.gerer', 'Paramètres', 'Gérer les cycles et les classes', 'Manage cycles and classes'),
  p('structure.annee.cloturer', 'Paramètres', 'Clôturer l\'année', 'Close the school year'),
  p('core.modele.modifier', 'Paramètres', 'Modifier les modèles de documents', 'Edit document templates'),
  p('core.compte.consulter', 'Paramètres', 'Consulter les comptes', 'View accounts'),
  p('core.compte.gerer', 'Paramètres', 'Gérer les comptes', 'Manage accounts'),
  p('core.compte.reinitialiser', 'Paramètres', 'Réinitialiser un mot de passe', 'Reset a password'),
  p('core.compte.desactiver', 'Paramètres', 'Désactiver un compte', 'Deactivate an account'),
  p('core.role.gerer', 'Paramètres', 'Créer un rôle', 'Create a role'),
  p('core.audit.consulter', 'Paramètres', 'Consulter le journal d\'audit', 'View the audit log'),
  p('core.audit.exporter', 'Paramètres', 'Exporter le journal d\'audit', 'Export the audit log'),
  p('core.sauvegarde.lancer', 'Paramètres', 'Sauvegarder la base', 'Back up the database'),
  p('core.sauvegarde.restaurer', 'Paramètres', 'Restaurer la base', 'Restore the database'),
  p('scolarite.import.executer', 'Paramètres', 'Importer des données', 'Import data'),

  p('portail.famille.consulter', 'Espace parent', 'Consulter l\'espace famille', 'View the family space'),
  p('communication.messagerie.ecrire', 'Espace parent', 'Écrire à l\'école', 'Write to the school'),
  p('vie_scolaire.absence.demander', 'Espace parent', 'Demander une justification', 'Ask for an absence to be excused'),
];

export type CodePermission = (typeof PERMISSIONS)[number]['code'];
const CODES = new Set(PERMISSIONS.map((x) => x.code));
export const estPermission = (code: string): boolean => CODES.has(code);

export type PerimetreType = 'etablissement' | 'affectations' | 'famille';

export interface DefinitionRole {
  code: string;
  libelleFr: string;
  libelleEn: string;
  perimetre: PerimetreType;
  permissions: string[];
}

const LECTURE_COMMUNE = ['scolarite.eleve.consulter', 'pedagogie.edt.consulter'];

export const ROLES_SYSTEME: readonly DefinitionRole[] = [
  {
    code: 'directeur', libelleFr: 'Directeur', libelleEn: 'Head teacher', perimetre: 'etablissement',
    permissions: [
      ...LECTURE_COMMUNE, 'structure.consulter', 'core.compte.consulter', 'core.compte.gerer', 'core.compte.reinitialiser', 'core.compte.desactiver',
      'core.role.gerer', 'core.audit.consulter', 'core.audit.exporter',
      'pilotage.tableau.consulter', 'pilotage.statistiques.consulter', 'assistant.question.poser', 'assistant.reglage.gerer',
      'scolarite.eleve.exporter', 'scolarite.derogation.valider',
      'finances.grille.consulter', 'finances.reduction.valider', 'finances.recu.consulter', 'finances.impaye.consulter',
      'finances.comptes.consulter', 'caisse.consulter', 'caisse.session.forcer', 'caisse.sortie.valider',
      'pedagogie.programme.consulter', 'pedagogie.note.lire', 'pedagogie.bulletin.lever_blocage', 'pedagogie.conseil.decider',
      'vie_scolaire.absence.justifier', 'vie_scolaire.observation.creer', 'vie_scolaire.sanction.decider',
      'vie_scolaire.dossier.consulter', 'communication.messagerie.repondre', 'personnel.fiche.consulter',
    ],
  },
  {
    code: 'secretaire', libelleFr: 'Secrétaire', libelleEn: 'Secretary', perimetre: 'etablissement',
    permissions: [
      ...LECTURE_COMMUNE, 'structure.consulter', 'structure.etablissement.modifier', 'structure.annee.gerer',
      'structure.periode.modifier', 'structure.classe.gerer', 'structure.annee.cloturer', 'core.modele.modifier',
      'core.compte.reinitialiser',
      'core.audit.consulter', 'core.audit.exporter', 'core.sauvegarde.lancer', 'core.sauvegarde.restaurer',
      'scolarite.import.executer', 'assistant.proposition.traduction', 'assistant.proposition.import',
      'scolarite.eleve.exporter', 'scolarite.inscription.creer', 'scolarite.responsable.gerer',
      'scolarite.inscription.changer_classe', 'scolarite.inscription.radier', 'scolarite.document.imprimer',
      'scolarite.derogation.demander', 'finances.grille.consulter', 'caisse.sortie.demander',
      'vie_scolaire.absence.justifier', 'vie_scolaire.dossier.consulter', 'communication.annonce.publier',
      'communication.sms.envoyer', 'communication.sms.parametrer', 'communication.messagerie.repondre',
      'personnel.fiche.gerer', 'personnel.fiche.consulter',
    ],
  },
  {
    code: 'econome', libelleFr: 'Économe', libelleEn: 'Bursar', perimetre: 'etablissement',
    permissions: [
      ...LECTURE_COMMUNE, 'finances.versement.encaisser', 'finances.recu.imprimer', 'caisse.session.gerer',
      'finances.annulation.valider', 'finances.reduction.accorder', 'finances.grille.consulter', 'finances.grille.modifier',
      'finances.reduction.demander', 'finances.recu.consulter', 'finances.versement.annuler', 'finances.avis.emettre',
      'finances.impaye.consulter', 'finances.comptes.consulter', 'finances.releve.gerer', 'caisse.consulter',
      'caisse.entree.enregistrer', 'caisse.banque.verser', 'caisse.sortie.demander', 'caisse.sortie.decaisser',
      'caisse.categorie.gerer', 'assistant.proposition.traduction', 'assistant.proposition.relance',
      'assistant.proposition.bordereau', 'communication.annonce.publier', 'communication.sms.envoyer',
      'communication.messagerie.repondre',
    ],
  },
  {
    code: 'prefet', libelleFr: 'Préfet des études', libelleEn: 'Director of studies', perimetre: 'etablissement',
    permissions: [
      ...LECTURE_COMMUNE, 'structure.consulter', 'personnel.fiche.consulter', 'assistant.proposition.traduction',
      'assistant.proposition.synthese', 'pedagogie.programme.consulter', 'pedagogie.programme.modifier',
      'pedagogie.affectation.gerer', 'pedagogie.periode.ouvrir', 'pedagogie.periode.deverrouiller', 'pedagogie.note.lire',
      'pedagogie.fusion.valider', 'pedagogie.bulletin.calculer', 'pedagogie.bulletin.publier', 'pedagogie.conseil.gerer',
      'pedagogie.edt.grille', 'pedagogie.edt.valider', 'vie_scolaire.dossier.consulter', 'communication.annonce.publier',
    ],
  },
  {
    code: 'instituteur_principal', libelleFr: 'Instituteur principal', libelleEn: 'Class teacher', perimetre: 'affectations',
    permissions: [
      ...LECTURE_COMMUNE, 'pedagogie.programme.consulter', 'pedagogie.evaluation.creer', 'pedagogie.note.saisir',
      'pedagogie.note.lire', 'pedagogie.note.signaler', 'pedagogie.fusion.transmettre', 'pedagogie.bulletin.apprecier',
      'pedagogie.edt.placer', 'pedagogie.cahier.ecrire', 'vie_scolaire.appel.faire', 'vie_scolaire.absence.justifier',
      'vie_scolaire.observation.creer', 'vie_scolaire.sanction.decider', 'vie_scolaire.dossier.consulter',
      'communication.annonce.publier', 'communication.messagerie.repondre', 'assistant.proposition.traduction',
      'assistant.proposition.appreciation',
    ],
  },
  {
    code: 'instituteur_matiere', libelleFr: 'Instituteur de matière', libelleEn: 'Subject teacher', perimetre: 'affectations',
    permissions: [
      ...LECTURE_COMMUNE, 'pedagogie.evaluation.creer', 'pedagogie.note.saisir', 'pedagogie.note.lire',
      'pedagogie.cahier.ecrire', 'vie_scolaire.appel.faire', 'vie_scolaire.observation.creer',
      'vie_scolaire.sanction.decider', 'vie_scolaire.dossier.consulter',
    ],
  },
  {
    code: 'parent', libelleFr: 'Parent', libelleEn: 'Parent', perimetre: 'famille',
    permissions: ['portail.famille.consulter', 'communication.messagerie.ecrire', 'vie_scolaire.absence.demander'],
  },
];

// Contrôle à l'import du module : chaque rôle ne cite que des permissions du catalogue.
for (const r of ROLES_SYSTEME) {
  for (const code of r.permissions) {
    if (!CODES.has(code)) throw new Error(`Permission inconnue dans le rôle ${r.code} : ${code}`);
  }
}
