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
- **Charte Sekou (applications du parent et de l'instituteur)** : maquettes « Sekou — logo » appliquées (bandeau bleu encre et trait jaune, logo, connexion, accueil, notes et bulletin par trimestre, paiements par tranche, messagerie en fil par destinataire, mode Nuit) ; logos dans `apps/web/public/marque`, icône de l'application installée au symbole Sekou.
- **Documents** : reçu bilingue (PDF et ESC/P), avis, listes, certificats, cartes scolaires, fiche d'inscription, bulletins, procès-verbal, rapports pour la tutelle, export comptable. En-tête et mentions se règlent par modèle.
- **Commandes** : `demo:vide`, `demo:donnees`, `import:csv` (`--essai`, rapport des rejets), `demo:sauvegarde`, `demo:restaurer`, `demo:lancer` (certificat local et adresses du réseau).
- **Documents de suivi** : `DEMO.md`, `IMPORT.md`, `../DECISIONS.md` (D-01 à D-31), `../ECARTS.md` (E-01 à E-43).

## Reste

- Traduction anglaise de l'interface hors connexion et documents (D-02).
- Évaluation par compétences (E-26 : aucune règle dans le cahier).
- Assistant : l'appel au service d'IA reste désactivé (E-37).
- Contrôle de fidélité image par image (`tools/controle/src/capturer.ts`), à relancer sur l'application React.

## Lots demandés le 12 novembre 2026

- [x] Connexion unique, page de connexion Sekou (D-38, D-39) ; interface du bureau à la charte Sekou (D-39).
- [x] Lot 1 · configuration par rubriques, sections, classes et matières préinstallées, noms de classe attribués (D-40). Le logo de l'école figure déjà sur les cartes scolaires.
- [x] Lot 2 · formulaire d'inscription configurable, sans paiement ; fiche imprimée détaillée (D-42).
- [x] Lot 3 · liste des élèves : fenêtre détail / mise à jour, historique des modifications, recherche avec propositions ; liste 15 fois plus rapide (D-43).
- [x] Lot 4 · trois modèles d'impression par document, logo, QR code de vérification et page publique « Vérifier » (D-44).
- [x] Lot 5 · tableau de bord personnalisable (6 cartes par utilisateur, D-41) ; barre haute fixe au défilement.
- [x] Lot 6 · utilisateurs et rôles au directeur seul ; rôles sur mesure, attributions particulières, périodes (D-46).
- [x] Lot 7 · plus d'accès direct à la base dans Données ; compte en lecture seule sans connexion (D-47, E-45).
- [x] Lot 8 · Assistant relié à OpenRouter (réglage par le directeur), questions nettoyées, chiffres agrégés seulement (D-48).
- [x] Lot 9 · application hybride : poste de l'école et version en ligne synchronisés dans les deux sens, dernière modification gagnante, conflits gardés ; essai local `pnpm synchro:essai` (D-49, E-46).
- [x] Application complètement installable sur téléphone (PWA) : icônes, bouton d'installation, aide iPhone, mise à jour annoncée, saisie hors réseau des messages des parents (D-50).
