# Gestion scolaire — La Ruche d'Or

Application de gestion d'un groupe scolaire bilingue : inscriptions, frais et caisse, notes et bulletins, appels et absences, espace parent.
Application web (React, installable sur téléphone) et serveur Node.js, base PostgreSQL dans Docker. Tout tourne sur un seul poste.

## Prérequis

- **Node.js 22** ou plus récent
- **pnpm** (`npm install -g pnpm`)
- **Docker** avec Docker Compose

## Installation

```bash
git clone https://github.com/Padre237/gestion-scolaire.git
cd gestion-scolaire
pnpm install
```

## Remplir la base avec une école complète

```bash
pnpm demo:donnees --oui
```

Durée : 3 à 4 minutes. La commande démarre PostgreSQL si besoin. Elle **efface puis recrée** la base, avec :

- deux années scolaires : 2025/2026 achevée et clôturée, puis 2026/2027 en cours jusqu'à la veille ;
- 23 classes (maternelle et primaire, sections francophone et anglophone) de 25 à 30 élèves, avec leurs familles ;
- frais, versements, caisse, notes, bulletins et absences.

Pour partir d'une base vide qui ne contient que les comptes de l'administration : `pnpm demo:vide`.

## Lancer l'application

```bash
pnpm demo:lancer
```

- Sur ce poste : http://localhost:8080
- Sur les téléphones du même réseau : l'adresse `https://…:8443` affichée au lancement. Le certificat de l'école s'installe une fois, voir [DEMO.md](DEMO.md).

Arrêt : `Ctrl C`.

## Comptes de démonstration

Ces comptes sont créés par `pnpm demo:donnees`.

| Rôle | Identifiant | Mot de passe |
|---|---|---|
| Directrice | `directrice` | `demo-directrice` |
| Secrétaire | `secretaire` | `demo-secretaire` |
| Économe | `econome` | `demo-econome` |
| Préfet des études | `prefet` | `demo-prefet` |
| Instituteur principal (CM2 A) | `onana.b` | `demo-onana` |
| Institutrice principale (CE2 B) | `eyenga.s` | `demo-eyenga` |
| Parent (famille KENFACK) | `600000055` | `demo-kenfack` |

- Les autres instituteurs suivent la même règle : le mot de passe est `demo-` suivi de la partie de l'identifiant avant le point.
- Les autres parents se connectent avec leur numéro de téléphone et `demo-` suivi du nom de famille en minuscules, sans accents.
- Les parents et les instituteurs ont leur propre page de connexion : `/parent/connexion` et `/instituteur/connexion`.

Ces mots de passe sont publics : ne les utilisez jamais sur une vraie base.

## Autres commandes

| Commande | Rôle |
|---|---|
| `pnpm demo:sauvegarde --nom <nom>` | Sauvegarde la base sous un nom (`--liste` : voir les sauvegardes) |
| `pnpm demo:restaurer <nom>` | Revient à une sauvegarde |
| `pnpm import:csv` | Importe des élèves depuis un fichier CSV (voir [IMPORT.md](IMPORT.md)) |
