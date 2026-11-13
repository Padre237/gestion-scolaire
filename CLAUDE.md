# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Gestion scolaire du groupe scolaire bilingue La Ruche d'Or (Cameroun, maternelle et primaire) : serveur Node.js (Fastify), application web installable (React, PWA), PostgreSQL 16 dans Docker. Tout tourne sur un seul poste, sans internet.

## Langue et références

- Tout le projet est en français : identifiants (`construireApp`, `exiger`, `ErreurMetier`), commentaires, textes d'interface, messages de commit (`web : …`, `demo:donnees : …`, `tests : …`). Garder cette convention.
- Les commentaires citent les sources du projet, rangées dans le dossier parent, hors du dépôt :
  - `RG-xx` (règles de gestion), `CU-xx` (cas d'utilisation), `ENF-xx` : `../Cahier d'analyse — Application de gestion scolaire.pdf` ;
  - `ADR-xx`, « conception § n » : `../Cahier de conception — Application de gestion scolaire.pdf` ;
  - `D-xx` : `../DECISIONS.md` (ambiguïtés tranchées ; y consigner toute nouvelle décision) ;
  - `E-xx` : `../ECARTS.md` (écarts entre les sources, validés) ;
  - `../MATRICE.md` : droits par rôle ;
  - maquettes : `../maquettes-gestion-scolaire/html/*.dc.html` (et `images/`).
- `../gestion-scolaire/` est une version antérieure (client Flutter), à ne pas modifier.
- Ces références ne doivent jamais apparaître à l'écran : `sansReferences()` (`apps/api/src/core/erreurs.ts`) les retire des messages d'erreur, et `tools/controle/src/parcourir.ts` signale tout texte interdit (prototype, démo, démonstration, fictif, `E-xx`, TODO, `undefined`, `NaN`, `null`…).

## Commandes

Prérequis : Node 22, pnpm, Docker. PostgreSQL écoute sur `127.0.0.1:5442` (conteneur `gs-postgres`, `docker compose up -d base`). Les identifiants de la base sont dans `var/config.json` (hors dépôt, créé à la première commande qui en a besoin ; `GS_CONFIG` change le chemin).

| Commande | Rôle |
|---|---|
| `pnpm test` | Tests de tout l'espace de travail (seul `@gs/api` en a). PostgreSQL doit tourner. |
| `pnpm --filter @gs/api exec vitest run test/domaine.test.ts -t "RG-12"` | Un fichier, ou un test par son nom |
| `pnpm verifier` | `tsc --noEmit` dans chaque paquet (pas de linter) |
| `pnpm migrer` | Applique les migrations à la base de `var/config.json` |
| `pnpm --filter @gs/api demarrer` | Serveur seul : HTTPS sur 8443 et HTTP local sur 8080 si `var/tls/` existe, sinon HTTP sur le port de la config (`GS_PORT` pour le changer) |
| `pnpm web:dev` | Vite sur 5173, `/api` relayé vers `localhost:8080` |
| `pnpm web:build` | Construit `apps/web/dist` ; le serveur en marche sert les nouveaux fichiers sans redémarrer |
| `pnpm demo:lancer` | Tout : Docker, migrations, certificat local, construction du web s'il manque, serveur |
| `pnpm demo:donnees --oui` | **Efface** la base et crée une école complète sur deux années (3 à 4 min) |
| `pnpm demo:vide` | **Efface** la base ; comptes de l'administration seuls, mots de passe écrits dans `COMPTES-DEMO.md` |
| `pnpm demo:sauvegarde --nom <nom>` / `pnpm demo:restaurer <nom>` | Sauvegarde nommée / retour à une sauvegarde |
| `pnpm import:csv` | Import d'élèves (`--essai` pour un essai à blanc ; voir `IMPORT.md`) |

Contrôles dans un navigateur (Puppeteer), serveur lancé :
- `pnpm --filter @gs/controle exec tsx src/parcourir.ts --base http://localhost:8080` : ouvre chaque écran sous les huit comptes de `demo:donnees` et relève erreurs, refus d'API, écrans vides, textes interdits ;
- `pnpm --filter @gs/controle exec tsx src/procedure.ts --base http://localhost:8080 --secretaire <mdp>` : joue les neuf étapes de `DEMO.md` sur une base `demo:vide`.

Les scripts `openapi` (`@gs/api`) et `controler` (`@gs/controle`) pointent vers des fichiers absents.

Variables utiles : `GS_SCRYPT_N` (coût du hachage ; 1024 dans les tests), `GS_JOURNAL` (niveau des journaux Fastify), `GS_PORT`, `GS_PORT_LOCAL`.

## Architecture

Monorepo pnpm. Aucune étape de compilation côté serveur : `tsx` exécute le TypeScript, les paquets exportent `./src/index.ts`, les imports portent l'extension `.ts`.

- `apps/api` : Fastify 5, Zod (`fastify-type-provider-zod`), `pg`. Le SQL s'écrit à la main avec le gabarit `sql` de drizzle, sans modèle d'ORM. Un seul processus sert l'API `/api/v1`, l'OpenAPI sur `/api/docs` et l'application web compilée (repli sur `index.html` hors `/api`).
- `apps/web` : React 18, react-router 6, Vite ; service worker écrit à la main (`public/sw.js`). Pas de bibliothèque de composants.
- `packages/db` : configuration, migrations, sauvegardes. `packages/shared` : catalogue des permissions et des rôles. `packages/print` : PDF (pdf-lib) et reçu ESC/P en CP850.
- `tools/demo` : commandes `demo:*` et `import:csv` ; elles importent directement le code du serveur (`@gs/api/src/...`). `tools/controle` : contrôles Puppeteer et `plan.py`.

### Serveur

- **Modules** (`apps/api/src/modules/<module>/`, ADR-01) : `http/` pour les routes, `domain/` pour les fonctions pures (testées dans `test/domaine.test.ts`), `index.ts` pour l'API publique du module, seul point d'entrée pour les autres modules. Chaque module a son schéma PostgreSQL (`vie-scolaire` → `vie_scolaire`).
- **Événements** (`core/evenements.ts`) : `emettre(tx, ctx, 'inscription.creee', …)` exécute les gestionnaires inscrits par `surEvenement` dans la même transaction. C'est ainsi que la scolarité déclenche l'échéancier des finances sans en dépendre. Les gestionnaires sont enregistrés par les imports de `modules/*/index.ts` dans `app.ts` : un nouveau gestionnaire doit y être importé. Le type de chaque événement se déclare dans l'interface `Evenements`.
- Le socle (`core/`) ne lit pas les tables d'un module ; les modules lui fournissent des fonctions au démarrage (`enregistrerFournisseurPerimetre`, `enregistrerFournisseurFamille`).
- **Droits** : chaque route déclare `config: { permission }`, `{ unePermissionParmi: [...] }` ou `{ public: true }` ; le crochet `preValidation` de `core/session.ts` répond 403 sinon. `test/routes.test.ts` échoue si une route n'en déclare pas ou cite un code inconnu ; la liste des routes publiques est figée. Les codes (`module.ressource.action`) et les rôles par défaut (`ROLES_SYSTEME`) sont dans `packages/shared/src/permissions.ts`. `migrer` recopie les permissions dans `core.permission` ; les rôles ne sont créés qu'avec l'établissement (`core/etablissement.ts`), donc une permission ajoutée à un rôle par défaut n'atteint une base existante qu'après `demo:donnees` / `demo:vide` ou une migration.
- **Périmètre** : une permission est accordée avec une portée `etablissement`, `affectations` (instituteur : ses classes et matières) ou `famille` (parent). `ctx.portee(permission)` et `classesAccessibles()` (`core/perimetre.ts`) servent à filtrer ; chaque route filtre elle-même par `ctx.etablissementId` et par ce périmètre.
- **Session** : jeton aléatoire dont seule l'empreinte est en base ; cookie `gs_session` pour le web, `Authorization: Bearer` pour les applications et les tests. `exiger(req)` renvoie le `Contexte`.
- **Base** : lectures par `app.bd.lire` / `lireUn` ; toute écriture passe par `app.bd.transaction(ctx.compteId, async (tx) => …)`, qui pose `app.utilisateur_id` pour le déclencheur d'audit. `journaliser(tx, ctx, {...})` ajoute la ligne « métier » montrée par l'écran Journal d'audit. `tableau([...])` passe un tableau JavaScript comme un seul paramètre PostgreSQL. Les dates SQL restent des chaînes `AAAA-MM-JJ` ; bigint et numeric deviennent des nombres ; les montants sont des entiers en FCFA.
- **Erreurs** : lever `ErreurMetier(code, statut, message, champ?)` ou `interdit` / `introuvable` / `conflit`. La réponse suit RFC 9457 (`application/problem+json`, avec `code`). Le message s'affiche tel quel à l'écran, en français. Doublon PostgreSQL (23505) → 409 `CORE_DOUBLON`.
- L'heure du Cameroun se calcule par `Date.now() + 3600_000` (`jourCm()`, `auj()` dans les tests). Les numéros sans trou (reçus, avis, matricules) passent par `FORMATS` et `cleCompteur` (`modules/structure/index.ts`).

### Base de données

- Migrations : `packages/db/migrations/NNNN_nom.sql`, chacune appliquée une fois, dans l'ordre, dans une transaction (table `public.gs_migration`). Ne jamais modifier une migration appliquée : en ajouter une.
- Trois rôles PostgreSQL : `gs_proprietaire` (migrations), `gs_application` (serveur), `gs_lecture` (schéma `reporting` seul). Le serveur n'a que SELECT, INSERT et UPDATE ; DELETE n'est accordé que sur les tables de `SUPPRESSION_PERMISE` (`packages/db/src/migrer.ts`). Ailleurs, pas de suppression physique : on change un statut. `core.journal_audit` est en insertion seule.
- Conventions (en-tête de `0001_socle.sql`) : un schéma par module, tables au singulier en snake_case, clé `uuid` par `core.uuid_v7()`, `etablissement_id` sur toute table métier, colonnes `modifie_le` et `version` (verrouillage optimiste par `core.fn_suivi`), montants en `bigint`, valeurs fermées en `text` + `CHECK`. Les vues du schéma `reporting` (`reporting.v_inscription`…) servent aux lectures.

### Application web

- Chaque fichier `src/ecrans/*.tsx` exporte `routes: RouteEcran[]`, réunies dans `App.tsx`. Menus, onglets et garde de navigation viennent du tableau des modules de `core/coque.tsx` (onglet → route → permissions) : un nouvel écran y a besoin d'une entrée, sinon `routePermise` le redirige. Le serveur reste seul juge des droits.
- Une seule application, trois usages : le bureau, l'instituteur (`/instituteur/*`) et le parent (`/parent/*`, seul espace ouvert à un compte famille), les deux derniers à 390 px dans `ecrans/mobile.tsx`.
- `core/api.ts` : client `fetch` écrit à la main (D-01), qui lève `ErreurApi(statut, code, message, champ)`. `core/session.tsx` : `useSession()`, puis `moi.a(permission)`. Composants communs dans `core/ui.tsx`, formats (montants, dates `jj/mm/aaaa`) dans `core/format.ts`.
- Fidélité aux maquettes : libellés au mot près, mêmes blocs et colonnes, aucun élément ajouté, même pour la démonstration (les outils passent par la ligne de commande). Seuls les libellés de structure sont fixes ; toute donnée affichée vient de la base. `python3 -I tools/controle/plan.py <maquette.dc.html> [--textes]` résume le texte et la mise en page d'une maquette.
- Couleurs de la charte en variables CSS, thèmes Jour et Nuit (`styles.css`). Sur téléphone : cibles tactiles de 44 px, tableaux affichés en cartes (`Colonne.mobile`), tiroir de navigation sous 900 px. Polices et icônes sont embarquées (`core/icones-traces.ts`, produit par `tools/icones/generer.py`). Interface en français seulement pour l'instant (D-02).

### Tests

- Vitest, dans `apps/api` seulement, contre un vrai PostgreSQL : `preparer()` (`test/aide.ts`) recrée la base `gestion_scolaire_test` pour chaque fichier, et l'application est appelée par `app.inject`. Fichiers exécutés l'un après l'autre.
- `connecter(app, identifiant, motDePasse)` et `connecterParent(app, telephone, motDePasse)` renvoient un `Client` porteur du jeton.
- `scenario.test.ts` est un seul récit dont chaque étape dépend des précédentes : lancer le fichier entier, pas un `it` isolé au milieu.

## Fichiers de suivi et données locales

- `AVANCEMENT.md` : ce qui est fait et ce qui reste ; à tenir à jour après chaque lot.
- `DEMO.md` : procédure de la démonstration en direct ; `IMPORT.md` : import CSV.
- `var/` (configuration et mots de passe de la base, certificats, sauvegardes, journaux) et `COMPTES-DEMO.md` restent locaux, hors dépôt.
