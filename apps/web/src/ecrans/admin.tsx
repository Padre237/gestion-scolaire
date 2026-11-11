// Écrans du module admin : Personnel ; Paramètres (Établissement, Utilisateurs et rôles, Journal d'audit, Données,
// Clôture d'année) ; Pilotage (statistiques) ; Assistant. Chaque écran vit dans son fichier admin-*.tsx.
import type { RouteEcran } from '../App.tsx';
import { EcranPersonnel } from './admin-personnel.tsx';
import { EcranEtablissement } from './admin-etablissement.tsx';
import { EcranAudit, EcranUtilisateurs } from './admin-utilisateurs.tsx';
import { EcranDonnees } from './admin-donnees.tsx';
import { EcranCloture } from './admin-cloture.tsx';
import { EcranAssistant, EcranStatistiques } from './admin-pilotage.tsx';

export const routes: RouteEcran[] = [
  { path: '/personnel', element: <EcranPersonnel /> },
  { path: '/parametres/etablissement', element: <EcranEtablissement /> },
  { path: '/parametres/utilisateurs', element: <EcranUtilisateurs /> },
  { path: '/parametres/audit', element: <EcranAudit /> },
  { path: '/parametres/donnees', element: <EcranDonnees /> },
  { path: '/parametres/cloture', element: <EcranCloture /> },
  { path: '/pilotage/statistiques', element: <EcranStatistiques /> },
  { path: '/assistant', element: <EcranAssistant /> },
];
