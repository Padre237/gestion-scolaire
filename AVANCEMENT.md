# Avancement

Fichier de travail : il dit ce qui est fait et ce qui reste, pour reprendre sans rien perdre.

## Fait

- **Base** : PostgreSQL 16 dans Docker (port 5442), migrations 0001 à 0008, rôles et droits, audit par déclencheur, vues `reporting`.
- **Serveur** : Node.js et Fastify, 11 modules. 90 tests verts (`pnpm --filter @gs/api test`), dont le scénario de démonstration de bout en bout et les refus 403 des nouvelles routes.
- **Application web installable** (`apps/web`, React) :
  - toutes les maquettes de bureau, en mode Jour et Nuit ;
  - l'application de l'instituteur, avec notes et appel hors connexion ;
  - l'application du parent.
  Le passage automatique (`tools/controle/src/parcourir.ts`) ouvre 115 écrans sous les huit comptes de répétition, sans erreur ni mot interdit.
- **Documents** : reçu bilingue (PDF et ESC/P), avis, listes, certificats, cartes scolaires, fiche d'inscription, bulletins, procès-verbal, rapports pour la tutelle, export comptable. En-tête et mentions se règlent par modèle.
- **Commandes** : `demo:vide`, `demo:fictif`, `import:csv` (`--essai`, rapport des rejets), `demo:sauvegarde`, `demo:restaurer`, `demo:lancer` (certificat local et adresses du réseau).
- **Documents de suivi** : `DEMO.md`, `IMPORT.md`, `../DECISIONS.md` (D-01 à D-31), `../ECARTS.md` (E-01 à E-43).

## Reste

- Traduction anglaise de l'interface hors connexion et documents (D-02).
- Évaluation par compétences (E-26 : aucune règle dans le cahier).
- Assistant : l'appel au service d'IA reste désactivé (E-37).
- Contrôle de fidélité image par image (`tools/controle/src/capturer.ts`), à relancer sur l'application React.
