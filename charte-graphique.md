# Charte graphique — « Aurore, édition scolaire »

Version 1.4 du 12 novembre 2026 (mode Jour par défaut ; mode Nuit sur un fond presque neutre, à peine bleuté). Statut : adoptée pour le lot 0 et la démonstration du 11 novembre. Nom du produit : Sekou. Logo adopté le 12 novembre 2026 (section 5).

Spécification complète, valeur par valeur, pour reproduire la charte à l'identique (couleurs dérivées, échelle typographique, composants mesurés, gabarits d'écran, tracés des icônes, SVG du logo, jetons CSS et JSON) : doc « Charte graphique Sekou — spécification complète de reproduction », <https://claude.ai/artifact/K1P8YNAtSHwZtHFsTZCHQU>. En cas d'écart, ce doc fait foi pour les valeurs de détail.

Cette charte remplace la palette cyan de la première direction « Aurore ». Elle en garde la structure (un seul accent, chiffres tabulaires, modes Nuit et Jour) et l'oriente vers l'enseignement. Les valeurs ci-dessous sont celles du code : `apps/client/lib/core/theme.dart`.

## 1. Idée directrice

Trois images de l'école, et rien d'autre :

| Image | Couleur | Ce qu'elle dit |
|---|---|---|
| L'encre du stylo | Bleu encre `#0B1F4B` | Sérieux, confiance : un parent confie son enfant et son argent |
| Le tableau, le savoir | Bleu savoir `#1D4ED8` | Clarté, action : c'est la couleur de ce qu'on peut faire |
| La craie, la lumière | Jaune craie `#FACC15` | Optimisme, énergie : une touche, jamais une surface |

L'orange signale ce qui est en retard, le rouge ce qui est bloquant, le vert ce qui est réglé. Ces trois couleurs ne servent qu'à dire un état.

## 2. Couleurs

### Mode Jour (par défaut)

| Jeton | Hex | Rôle |
|---|---|---|
| `fond` | `#F6F8FC` | Fond de l'application |
| `panneau` | `#FFFFFF` | Cartes, tableaux, dialogues |
| `champ` | `#F1F4FA` | Champs de saisie, lignes survolées |
| `texte` | `#0B1F4B` | Texte principal (bleu encre) |
| `texteDoux` | `#4B5B7A` | Libellés, texte secondaire |
| `accent` | `#1D4ED8` | Bouton principal, page active, liens |
| `surAccent` | `#FFFFFF` | Texte posé sur l'accent |
| `eclat` | `#FACC15` | Point du logo, valeur du jour |
| `attention` | `#A8360A` | En retard, à surveiller |
| `danger` | `#B91C1C` | Erreur, annulation, impayé bloquant |
| `succes` | `#15703A` | Soldé, enregistré |

### Mode Nuit (au choix de chaque poste)

| Jeton | Hex | Rôle |
|---|---|---|
| `fond` | `#101318` | Fond de l'application : gris très sombre, à peine bleuté |
| `panneau` | `#171B23` | Cartes, tableaux, dialogues |
| `champ` | `#1F242E` | Champs de saisie |
| `texte` | `#E8ECF3` | Texte principal |
| `texteDoux` | `#A9B2C2` | Libellés, texte secondaire |
| `accent` | `#A3C1FF` | Bouton principal, page active, liens |
| `surAccent` | `#0E1320` | Texte posé sur l'accent |
| `eclat` | `#FACC15` | Point du logo, valeur du jour |
| `attention` | `#FDBA74` | En retard, à surveiller |
| `danger` | `#FCA5A5` | Erreur, annulation |
| `succes` | `#6EE7A0` | Soldé, enregistré |

### Règles d'emploi

- **Un seul accent par écran** : le bleu savoir désigne l'action principale et la page active. Deux boutons pleins côte à côte, c'est une erreur.
- **Le jaune ne porte jamais de texte sur fond clair** (contraste de 1,5 pour 1). Il fait le point du logo, posé sur le bleu encre (10,5 pour 1), et marque la valeur du jour dans les graphiques.
- **La couleur ne dit jamais seule un état** : une pastille « En retard » porte toujours son libellé, et si possible une icône.
- **Contraste** : tout texte atteint au moins 4,5 pour 1 sur son fond (WCAG AA). Vérifié par calcul le 10 novembre 2026 sur les trois fonds et sur les pastilles : pire cas 6,1 en Nuit, 4,87 en Jour. Le test `test/theme_test.dart` refait ce contrôle.

## 3. Typographie

| Usage | Police | Graisse |
|---|---|---|
| Titres, grands chiffres | Inter Display | SemiBold, Bold |
| Texte, tableaux, formulaires | Inter | Regular, Medium, SemiBold |

- Les polices sont embarquées dans l'application : aucun téléchargement, l'école peut travailler hors ligne.
- Inter couvre les lettres ɛ, ɔ, ŋ des noms camerounais et l'espace fine des montants (« 150 000 FCFA »). Poppins a été écartée pour cette raison.
- Montants et matricules : chiffres tabulaires à zéro barré, alignés à droite dans les tableaux.
- Petites étiquettes de section en capitales espacées ; jamais de phrase entière en capitales.
- Corps minimal : 13 px sur poste de travail, 14 px sur téléphone.

## 4. Composants et iconographie (le système UI)

Une application scolaire repose sur des composants graphiques réutilisables. Ils sont tous dans `apps/client/lib/core/widgets.dart` ; un écran n'invente pas les siens.

### Icônes

Bibliothèque retenue : **Google Material Symbols, style contour** (« outlined »). Elle est livrée avec Flutter, donc sans dépendance ni poids supplémentaire, et son trait est uniforme. Lucide et Phosphor sont des équivalents acceptables si la charte définitive les préfère ; on ne mélange jamais deux bibliothèques.

Chaque module a son icône dédiée, la même dans le menu, les titres et les applications mobiles :

| Module (entrée du menu) | Icône | Symbole Material | Lot |
|---|---|---|---|
| Tableau de bord | Tableau de bord | `space_dashboard` | 0 |
| Élèves : liste, inscription, classes | 👥 Silhouettes | `groups` | 0 |
| Frais et caisse : scolarité, facturation | 💳 Carte bancaire | `credit_card` | 0 |
| Notes et bulletins : devoirs, notes | 📝 Cahier et stylo | `edit_note` | 2 |
| Emploi du temps | 📅 Calendrier | `calendar_month` | 3 |
| Vie scolaire : appel, discipline | Liste cochée | `fact_check` | 2 |
| Messages | Bulle | `forum` | 2 |
| Personnel | Badge | `badge` | 1 |
| Pilotage | Graphique en barres | `bar_chart` | 1 |
| Assistant | Étincelles | `auto_awesome` | 2 |
| Paramètres | Réglages | `tune` | 0 |

Règles : taille 20 px dans le menu et 18 px dans les boutons ; l'icône prend la couleur du texte qui l'accompagne ; une icône seule (sans libellé) porte toujours une infobulle.

### Navigation

- Le menu latéral liste les modules, chacun avec son icône ; un module absent des droits de l'utilisateur n'apparaît pas.
- Les écrans d'un même module sont des onglets en haut de page : par exemple Caisse du jour, Impayés, Dépenses, Comptes, Grille des frais, À valider.
- La recherche d'un élève (Ctrl+K), la bascule Jour ou Nuit et le compte restent en haut à droite de chaque écran.
- Sur téléphone, la navigation passe en bas de l'écran, avec quatre entrées au plus.

### Cartes et tableaux

- Les informations sont compartimentées dans des **blocs blancs aux bords légèrement arrondis** : rayon de **12 px** pour les cartes et les tableaux, 8 px pour les champs, les boutons et les pastilles.
- **Ombre très légère** en mode Jour, pour donner du relief (élévation 1,5, ombre bleu encre à 25 %). En mode Nuit, pas d'ombre : le relief vient de la différence entre `fond` et `panneau`, et d'un filet d'un pixel.
- Une carte = un sujet (un élève, un état de compte, un indicateur). Marge intérieure de 20 px ; 16 px entre deux cartes.
- Tableaux : en-têtes en petites capitales `texteDoux`, lignes de 44 px au moins, filets horizontaux seulement, montants à droite, ligne survolée en `champ`. L'état (soldé, en retard) est une pastille, pas une ligne colorée.

### Autres composants

| Composant | Règle |
|---|---|
| Bouton principal | Plein, couleur `accent`, un seul par écran ou par dialogue |
| Bouton secondaire | Contour ou texte seul |
| Pastille d'état | Fond teinté de la couleur d'état, libellé de la même couleur, icône facultative |
| Jauge segmentée | Avancement d'un paiement par tranche : un segment par tranche |
| Champ de saisie | Fond `champ`, libellé au-dessus, message d'erreur dessous en `danger` |
| Touche de raccourci | Affichée à côté de l'action (Ctrl+K pour la recherche) |
| Cible tactile | 44 px au moins |

## 5. Logo et nom

Nom du produit : **Sekou**. Logo adopté le 12 novembre 2026 : variante « Deux bleus ». Planches sur le canvas « Sekou — logo » (<https://claude.ai/artifact/JqzPBk3E7Mf7dhWBs8qEQj>) ; fichiers dans l'archive `sekou-logo.zip` (SVG, icônes, LISEZMOI). Il reprend le carré bleu, le point jaune et la signature bleu clair de l'en-tête de la proposition financière, avec le S en deux moitiés de la première piste.

### Construction

- **Symbole** : un carré aux coins arrondis (rayon de 25 % du côté), coupé en biais : moitié gauche bleu savoir, moitié droite bleu encre. La ligne de partage prolonge la coupe du S.
- **Le S** : géométrique, blanc, en deux moitiés identiques séparées par une coupe en biais. Deux moitiés, deux sections, un seul établissement.
- **Le point** : jaune craie, en haut à droite, sur la moitié bleu encre.
- **Le nom** « Sekou » en Inter Display Bold ; **la signature** « Logiciel de gestion scolaire » en Inter Medium. Les textes sont vectorisés dans les fichiers.

### Couleurs du logo

| Couleur | Hex | Rôle |
|---|---|---|
| Bleu savoir | `#1D4ED8` | Moitié gauche du carré ; signature sur fond clair ; filet sur fond sombre |
| Bleu encre | `#0B1F4B` | Moitié droite du carré ; nom sur fond clair |
| Bleu clair | `#C7D6FF` | Signature sur fond bleu encre (couleur du logo, pas un jeton de l'interface) |
| Jaune craie | `#FACC15` | Le point, une seule touche |

### Versions

| Version | Quand | Particularité |
|---|---|---|
| Fond clair | Mode Jour, documents, site | Nom bleu encre, signature bleu savoir |
| Fond sombre | Bleu encre, mode Nuit, tout fond foncé | Un filet bleu savoir entoure la moitié bleu encre, pour que le carré reste entier ; nom blanc, signature bleu clair |
| Une couleur | Tampon, impression noire | Carré plein, S et point en creux ; en noir, ou en blanc sur fond foncé |
| 16 px | Onglet, barre des tâches, tout affichage sous 24 px | Dessiné au pixel : S sans coupe, traits de 2 px, point de 3 px |
| Logo court | En-tête de l'application, place réduite | Sans la signature |

### Règles

- Espace libre autour du logo : au moins un quart de la hauteur du symbole, de chaque côté.
- Tailles minimales : symbole 16 px (version 16 px) ; logo court 24 px de haut ; logo avec signature 40 px de haut.
- Sur un fond sombre, toujours la version fond sombre : la version claire y perd sa moitié bleu encre.
- On ne change ni les couleurs, ni l'angle de la coupe, ni la place du point ; pas de dégradé, d'ombre ni de contour ajouté.
- Le filet jaune sous les titres des documents est un élément de mise en page, pas une partie du logo.
- Le logo de chaque établissement, lui, apparaît sur ses reçus et dans l'en-tête de son espace ; l'emplacement est prévu.

### Icônes

`favicon.ico` (16, 32 et 48 px) ; `favicon.svg`, qui passe seul à la version fond sombre quand le navigateur est en thème sombre ; icônes de 16 à 512 px ; icônes masquables de 192 et 512 px pour la PWA (Android) ; `apple-touch-icon.png` de 180 px pour l'iPhone.

## 6. Documents imprimés

- Reçus sur imprimante matricielle : noir seulement. La charte s'y réduit à la mise en page et au nom de l'établissement.
- Reçus et états PDF : texte bleu encre, filets fins, un bandeau bleu savoir en tête ; pas d'aplat jaune (il s'imprime mal en noir et blanc).

## 7. Ce qu'on ne fait pas

- Pas de dégradé ni de flou : l'application doit rester fluide sur un PC modeste.
- Pas de troisième couleur décorative, pas d'illustration enfantine : le logiciel s'adresse à la direction, à la caisse, aux enseignants et aux parents.
- Pas de rouge pour décorer : le rouge veut dire qu'il y a un problème.

## 8. Reste à faire

- Maquettes : 48 écrans dans cette charte, sur le canvas « Gestion scolaire — maquettes de l'interface » (<https://claude.ai/artifact/Bz1prjgQabtzfUauQdd8kv>). La table qui relie chaque exigence à son écran est dans `docs/maquettes-couverture.md`.
- Le rendu réel n'a pas été vu : le client Flutter n'a pas pu être compilé ici. À contrôler à l'œil au premier lancement, dans les deux modes.
- Logo : à reporter dans le client Flutter (le logo provisoire, carré jaune et livre `auto_stories`, y est encore), dans les maquettes, dans la proposition financière et dans `docs/charte-graphique.md` du dépôt.
- Couleurs propres à chaque établissement (marque blanche) : à décider.
