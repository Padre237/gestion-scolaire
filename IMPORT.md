# Importer les élèves et leurs responsables

L'import fait entrer, en une fois, les élèves d'une liste existante : élèves, familles, responsables et inscription dans leur classe. Il passe par les mêmes contrôles qu'une inscription au guichet.

Le fichier reste sur le poste de l'école. La commande le lit et l'envoie au serveur local ; rien ne sort du poste.

## Avant de commencer

1. **Le serveur et la base tournent.** Lancez `pnpm demo:lancer` dans un autre terminal, ou au moins `docker compose up -d base`.
2. **Les classes de l'année sont créées** (Paramètres › Établissement), avec leur nom exact : « CE2 A », « Class 3 »… Un élève ne s'importe que dans une classe qui existe.
3. **La grille des frais est saisie** (Frais et caisse › Grille des frais). Sinon, les élèves sont importés sans échéancier, et leur inscription est validée sans attendre de versement.
4. **Vous avez un compte qui peut importer.** Par défaut, c'est le compte de la secrétaire.

## Préparer le fichier

- **Format** : CSV en UTF-8. Dans Excel : *Fichier › Enregistrer sous › CSV UTF-8 (délimité par des points-virgules)*.
- **Séparateur** : point-virgule, virgule ou tabulation. Il est reconnu tout seul.
- **Première ligne** : l'en-tête, avec un intitulé par colonne. L'ordre des colonnes est libre. Les majuscules, les accents et la ponctuation des intitulés ne comptent pas.
- **Lignes vides** : elles sont ignorées.
- **Taille** : 3 000 lignes au plus par fichier. Au-delà, découpez le fichier par section ou par classe.
- **Colonnes ignorées** : une colonne dont l'intitulé n'est pas reconnu est ignorée. La commande vous dit lesquelles.

### Colonnes reconnues

| Donnée | Intitulés reconnus (exemples) | Obligatoire | Format attendu |
|---|---|---|---|
| Nom | Nom, Names, Name, Nom et prénoms, Élève, Student | oui | Si la colonne Prénoms manque, le premier mot est le nom et le reste les prénoms : « ABENA Grâce ». |
| Prénoms | Prénoms, Prénom, First name, Given names | oui, sauf si le nom les contient | — |
| Sexe | Sexe, Genre, Sex, Gender | oui | M ou F. Garçon, Fille, Male et Female sont aussi acceptés. |
| Date de naissance | Date de naissance, Né le, DOB, Date of birth | oui | JJ/MM/AAAA (12/03/2018) ou AAAA-MM-JJ |
| Lieu de naissance | Lieu de naissance, Né à, Place of birth | non | — |
| Classe | Classe, Class, Niveau | oui | Nom exact d'une classe de l'année en cours |
| Type d'inscription | Type, Statut, Admission | non | Nouvelle, Réinscription ou Redoublement. Si la colonne est vide : Réinscription quand le matricule est donné, sinon Nouvelle. |
| Matricule | Matricule, Registration number, Student ID | non | Deux chiffres, deux à quatre lettres, quatre chiffres : 25FR0012. S'il manque, le matricule est attribué automatiquement. |
| Responsable | Responsable, Parent, Nom du parent, Guardian, Tuteur | oui | Personne qui paie et reçoit les SMS |
| Lien | Lien, Lien de parenté, Relation | non | Père, Mère, ou autre valeur (tuteur). Si la colonne est vide : Mère. |
| Téléphone | Téléphone, Tél., Parent phone, Phone, Mobile, Contact | oui | 8 à 12 chiffres, espaces et « + » admis : 600 000 901, +237 6 99 12 34 56 |
| Langue | Langue, Language | non | fr ou en (langue des SMS). Si la colonne est vide : fr. |
| Responsable 2 | Responsable 2, Second parent, Parent 2 | non | Second responsable. Il ne paie pas et ne reçoit pas de SMS. |
| Lien 2 | Lien 2, Relation 2 | non | Comme Lien |
| Téléphone 2 | Téléphone 2, Tél. 2, Phone 2 | non | Comme Téléphone |

Exemple :

```
Nom;Prénoms;Sexe;Date de naissance;Classe;Responsable;Lien;Téléphone;Langue
ABENA;Grâce;F;12/03/2018;CE2 A;MBALLA Christine;Mère;600 000 901;fr
TABE;Mary-Jane;F;22/01/2016;Class 5;TABE Agnes;Mother;600 000 905;en
```

## Lancer l'import

Depuis le dossier du projet, procédez en deux temps.

**1. Essai.** La commande contrôle tout et n'enregistre rien :

```
pnpm import:csv chemin/vers/liste.csv --essai
```

**2. Import.** La commande enregistre les lignes valides :

```
pnpm import:csv chemin/vers/liste.csv
```

La commande demande l'identifiant (par défaut `secretaire`) et le mot de passe, qui ne s'affiche pas pendant la frappe. L'identifiant peut aussi se donner avec `--identifiant secretaire`.

Elle affiche ensuite :
- les colonnes reconnues, par exemple « Names » → nom et « Parent phone » → téléphone ;
- le nombre de lignes lues, valides et en erreur ;
- les vingt premières erreurs.

Le **rapport des lignes rejetées** est écrit à côté du fichier, sous le nom `liste.rejets.csv`. Il compte quatre colonnes : Ligne, Champ, Valeur et Problème. Il s'ouvre dans Excel. Le numéro de ligne est celui du fichier, en-tête compté. Corrigez ces lignes dans le fichier d'origine et relancez la commande : les élèves déjà importés seront reconnus comme doublons et ne seront pas importés deux fois.

## Ce qui est contrôlé

Une ligne est rejetée, avec la raison affichée, si :
- **Nom et prénoms** : le nom ou les prénoms manquent ;
- **Sexe** : il n'est pas reconnu ;
- **Date de naissance** : elle manque ou elle est impossible (31/02/2018) ;
- **Classe** : la classe n'existe pas dans l'année en cours ;
- **Téléphone** : il compte moins de 8 ou plus de 12 chiffres ;
- **Responsable** : son nom manque ;
- **Matricule** : il est mal formé, ou déjà attribué à un autre élève ;
- **Doublon dans la base** : un élève de même nom, mêmes prénoms et même date de naissance existe déjà. Le rapport donne son matricule ;
- **Doublon dans le fichier** : la même personne apparaît deux fois. Le rapport donne la première ligne.

Les lignes valides sont importées même si d'autres sont rejetées.

## Ce que l'import crée

Pour chaque ligne valide :
- l'élève, avec son matricule, donné ou attribué ;
- la famille et ses responsables ;
- l'inscription dans la classe, et l'échéancier tiré de la grille des frais : tarif « nouveau » pour une nouvelle inscription, « ancien » sinon ;
- le **compte famille**, si le téléphone du responsable qui paie n'en a pas encore. L'identifiant de connexion est ce téléphone.

Pour donner son mot de passe à une famille importée, ouvrez Paramètres › Utilisateurs et rôles, choisissez le compte de la famille, puis « Réinitialiser le mot de passe ». Le nouveau mot de passe s'affiche une seule fois, pour être remis au parent. Il n'est stocké que haché.

Si une classe est pleine, l'élève est tout de même inscrit et une demande de dérogation part à la directrice, comme au guichet.

Chaque import est inscrit au journal d'audit (Paramètres › Journal d'audit) : qui, quand, combien de lignes lues, importées et rejetées.

## En cas de problème

| Message | Que faire |
|---|---|
| Colonnes obligatoires absentes | Renommez l'en-tête avec un des intitulés du tableau ci-dessus. |
| Le compte n'a pas le droit d'importer des élèves | Utilisez le compte de la secrétaire, ou donnez la permission « Importer des données » au rôle (Paramètres › Utilisateurs et rôles). |
| Identifiant ou mot de passe incorrect | Vérifiez l'identifiant. Après plusieurs échecs, le compte se verrouille quelques minutes. |
| Aucune année scolaire n'est ouverte | Ouvrez l'année dans Paramètres › Établissement. |
| Fichier .xlsx refusé | Enregistrez-le d'abord en CSV UTF-8, ou importez-le depuis Paramètres › Données. |
