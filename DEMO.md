# Démonstration en direct

Ce document déroule la démonstration, rôle par rôle, à partir d'une base vierge. Chaque étape s'appuie sur ce que la précédente a saisi. Pour chacune, il donne le compte, l'écran, les gestes et ce qui doit apparaître.

## Avant la démonstration

### Une fois, sur le PC de l'école

1. Installez Docker, Node.js 22 et pnpm, puis, dans ce dossier, lancez `pnpm install`.
2. Préparez la base vierge :

   ```
   pnpm demo:vide
   ```

   La commande demande :
   - le nom de l'établissement, en français et en anglais ;
   - l'identifiant de la secrétaire, puis son mot de passe, deux fois.

   Le mot de passe ne s'affiche pas et n'est écrit nulle part : il est haché.
3. Démarrez l'application :

   ```
   pnpm demo:lancer
   ```

   La commande démarre PostgreSQL dans Docker, met la base à jour, prépare le certificat du réseau local, construit l'application si besoin et lance le serveur. Elle affiche ensuite les adresses à ouvrir :
   - **sur ce PC** : `http://localhost:8080` ;
   - **sur les téléphones et les autres postes du même réseau** : `https://<adresse du PC>:8443`. Pour le parent, ajoutez `/parent/connexion` ; pour l'instituteur, `/instituteur/connexion`.

   Laissez ce terminal ouvert pendant toute la démonstration ; `Ctrl C` arrête tout.

### Répétition et retour à l'état de départ

Pour répéter sur une école déjà remplie, avec un trimestre de notes, de paiements et d'absences, lancez `pnpm demo:fictif`. Les comptes de répétition s'affichent à la fin, avec leurs mots de passe ; ne les utilisez jamais pour la vraie démonstration.

Gardez l'état de départ sous un nom, puis revenez-y entre deux passages :

```
pnpm demo:sauvegarde --nom depart        (une fois, juste après demo:vide)
pnpm demo:restaurer depart --oui         (avant chaque nouveau passage)
```

Une sauvegarde nommée n'est jamais effacée par la rotation automatique. Une restauration commence toujours par sauvegarder l'état actuel ; le serveur peut rester allumé, il se reconnecte seul.

Le fichier `COMPTES-DEMO.md`, à la racine, liste les comptes et mots de passe de chaque état. Il reste sur ce poste et n'entre pas dans le dépôt.

### Le téléphone du parent et celui de l'instituteur

Le téléphone et le PC doivent être sur le même réseau Wi-Fi.

**Voie rapide (navigateur seulement).**
1. Sur le téléphone, ouvrez `https://<adresse du PC>:8443/parent/connexion`.
2. Le navigateur prévient que la connexion n'est pas privée : touchez « Paramètres avancés », puis « Continuer vers le site ».

L'application s'utilise alors dans le navigateur, mais elle ne s'installe pas et ne fonctionne pas sans réseau.

**Voie complète (application installée, hors connexion possible).** À faire une fois par téléphone, la veille.
1. Ouvrez `https://<adresse du PC>:8443/autorite.crt` et acceptez l'avertissement comme ci-dessus. Le fichier `autorite-ecole.crt` se télécharge.
2. Installez-le comme autorité de certification :
   - **Android** : Paramètres › Sécurité › Chiffrement et identifiants › Installer un certificat › Certificat CA. Choisissez `autorite-ecole.crt`.
   - **iPhone** : ouvrez le fichier ; un profil s'ajoute dans Réglages › Général › VPN et gestion de l'appareil ; installez-le. Activez-le ensuite dans Réglages › Général › Informations › Réglages des certificats.
3. Ouvrez de nouveau `https://<adresse du PC>:8443/parent/connexion` : il n'y a plus d'avertissement.
4. Installez l'application :
   - **Android (Chrome)** : menu ⋮ › Installer l'application, ou Ajouter à l'écran d'accueil ;
   - **iPhone (Safari)** : bouton Partager › Sur l'écran d'accueil.

Ce certificat ne garantit que les adresses du réseau local et le nom du PC : il ne peut servir pour aucun autre site. Il se retire à tout moment depuis les mêmes réglages. Si l'adresse du PC change, `demo:lancer` refait le certificat du serveur ; le téléphone n'a rien à refaire.

Sur le PC, `http://localhost:8080` s'installe aussi : bouton d'installation dans la barre d'adresse de Chrome ou d'Edge.

## Les neuf étapes

Les noms, montants et téléphones ci-dessous sont ceux de la répétition jouée le 11/11/2026 : vous pouvez les reprendre tels quels. Les téléphones restent dans la plage factice 600 000 xxx.

### Étape 1 · Paramétrage de l'établissement et création des comptes

La conception confie le paramétrage à la secrétaire, et le directeur valide sans saisir (ECARTS E-07). Cette étape est donc jouée par la secrétaire ; la directrice entre en scène à l'étape 9.

- **Compte** : la secrétaire, créée par `demo:vide`.
- **Gestes** :
  1. **Paramètres › Établissement**, section Identité :
     - devise, ville et boîte postale, téléphone (600 000 200), signataire des documents ;
     - « Réductions sans validation jusqu'à (FCFA) » : **10 000** ;
     - enregistrez (Ctrl S).
  2. **Années scolaires** : « Créer l'année scolaire ». Gardez 2026/2027, saisissez les dates (07/09/2026 et 25/06/2027), puis « Créer l'année ». Ensuite « Ouvrir », et confirmez avec « Ouvrir l'année ». Les trois trimestres sont créés avec elle.
  3. **Cycles, niveaux et classes** : « Ajouter un cycle », Francophone, Primaire, « Ajouter le cycle ». Les niveaux de la SIL au CM2 sont créés avec lui.
  4. **Personnel** : « Nouvelle fiche » pour chacun, avec nom, fonction, statut et téléphone, puis « Créer la fiche ». Sur la fiche, « Créer son compte » : vérifiez l'identifiant, le rôle est déjà coché d'après la fonction, puis « Créer le compte ». Le mot de passe s'affiche une seule fois : notez-le, puis « J'ai noté le mot de passe ».

     | Nom | Fonction | Identifiant |
     |---|---|---|
     | Mme ATEBA Marie-Claire | Directeur | `directrice` |
     | M. MBIDA Paul | Économe | `econome` |
     | M. NKOULOU Gérard | Préfet des études | `prefet` |
     | M. ONANA Bertrand | Instituteur principal | `onana.b` |
     | M. ESSAMA Luc (vacataire) | Instituteur de matière | `essama.l` |

     La classe et la matière des instituteurs viennent de l'affectation par le préfet, à l'étape 4.
- **Ce qui doit apparaître** :
  - le nom de l'établissement dans la barre latérale et sur la page de connexion ;
  - « 2026/2027 » en haut de chaque écran ;
  - les comptes et leurs rôles dans Paramètres › Utilisateurs et rôles ;
  - chaque création au Journal d'audit.

**Préparation des frais** (économe, avant l'étape 2) : Frais et caisse › Grille des frais. Saisissez les dates limites (07/09/2026, 30/09/2026, 30/11/2026, 31/01/2027), puis l'inscription et les trois tranches de chaque niveau. Exemple pour le CM2 : 12 000, 30 000, 25 000, 18 000. Enregistrez, puis faites de même sous « Anciens élèves ». Sans grille, une inscription ne crée pas d'échéancier.

### Étape 2 · Secrétaire : classes, inscriptions, annonce

- **Compte** : la secrétaire.
- **Gestes** :
  1. **Paramètres › Établissement › Ajouter une classe** : choisissez le niveau SIL ; le nom « SIL A » est proposé. Faites de même pour CE2 A et CM2 A.
  2. **Élèves › Nouvelle inscription**, avec le type « Nouvelle inscription » :
     - FOUDA Junior, garçon, né le 14/03/2015 à Yaoundé, en CM2 A ;
     - responsable : Mme FOUDA Brigitte, mère, 600 000 301.

     Puis « Enregistrer l'inscription ».
  3. La fenêtre « Élève inscrit » donne le matricule et le **compte famille** : le téléphone et un mot de passe affiché une seule fois. « Imprimer la fiche d'inscription » produit la fiche à remettre au parent ; elle servira à l'étape 8.
  4. Inscrivez FOUDA Grâce en SIL A, **avec le même téléphone** : la famille est reconnue, et le même compte sert aux deux enfants.
  5. Inscrivez aussi deux élèves en CM2 A :
     - NGONO Esther (M. NGONO Paul, 600 000 302) ;
     - BELINGA Kevin (Mme BELINGA Rose, 600 000 303).
  6. **Messages › Annonces** : titre « Réunion des parents », texte en français et en anglais, puis « Publier ».
- **Ce qui doit apparaître** :
  - le matricule attribué automatiquement (26FR0001…) ;
  - les frais dus copiés de la grille ;
  - l'annonce sous « Annonces publiées ».

### Étape 3 · Économe : encaissement, reçu, réduction, impayés

- **Compte** : l'économe.
- **Gestes** :
  1. **Frais et caisse › Caisse du jour** : fonds initial 20 000, puis « Ouvrir la session ».
  2. « Encaisser un élève » : tapez « FOUDA Junior » et choisissez-le. Saisissez **17 000**, espèces, puis « Valider et imprimer ».
  3. Le **reçu bilingue** s'affiche, avec le montant en lettres en français et en anglais. Le PDF s'ouvre dans un nouvel onglet pour l'impression ; une réimpression porte « Duplicata ».
  4. Encaissez de même :
     - 42 000 pour NGONO Esther (tranche 1 soldée) ;
     - 12 000 pour BELINGA Kevin ;
     - 10 000 pour FOUDA Grâce.
  5. **Élèves › FOUDA Junior › Accorder une réduction** : tranche 1, **15 000** FCFA, motif « Cas social ». Au-delà du seuil de 10 000, elle devient une demande : « Demande envoyée au directeur ».
  6. **Frais et caisse › Impayés** : les restes dus, avec les filtres et l'export.
- **Ce qui doit apparaître** :
  - l'inscription validée dès le premier versement ;
  - « Réduction de 15 000 FCFA demandée au directeur » sur la fiche de Junior ;
  - chaque versement dans l'historique.

### Étape 4 · Préfet des études : matières, affectations, emploi du temps

- **Comptes** : le préfet, puis l'instituteur principal pour placer les cours.
- **Gestes** :
  1. **Préfet › Notes et bulletins › Matières**, niveau CM2 : « Ajouter une matière » pour Mathématiques (coefficient 4), Français (4) et Éducation physique et sportive (abrégé EPS, coefficient 1).
  2. Pour chaque affectation, ouvrez « Affecter un instituteur » :
     - classe CM2 A, « Toutes les matières : instituteur principal », M. ONANA Bertrand ;
     - classe CM2 A, Éducation physique et sportive, M. ESSAMA Luc.
  3. **Saisie des notes**, classe CM2 A : « Ouvrir la saisie » de la séquence 1 (jusqu'au jour proposé), puis confirmez.
  4. **Instituteur principal › Emploi du temps** : la grille horaire de l'école est déjà fixée. Touchez une case, choisissez la matière, puis « Placer ». Placez quelques cours, dont au moins un **aujourd'hui** pour l'appel de l'étape 5, puis « Soumettre au préfet ».
  5. **Préfet › Emploi du temps**, classe CM2 A : « Valider et publier ».
- **Ce qui doit apparaître** :
  - l'équipe de la classe (principal et EPS) ;
  - le circuit Grille horaire, Cours de la classe, Validation, Publication, coché de bout en bout ;
  - l'emploi du temps publié aux parents.

### Étape 5 · Instituteur principal : notes et appel sur le téléphone

- **Compte** : `onana.b`, sur le téléphone, à l'adresse `/instituteur/connexion`.
- **Gestes** :
  1. **Notes** : « Mes classes » montre CM2 A avec ses matières. Choisissez Mathématiques et saisissez les notes au pavé numérique ; Entrée passe à l'élève suivant. Puis « Enregistrer sur le téléphone ».
  2. **Hors connexion** : avec le bouton Retour, revenez à « Mes classes » et choisissez Français. Passez le téléphone en mode avion, saisissez les notes et enregistrez. Le bandeau affiche « Hors ligne · 3 notes gardées sur le téléphone ». Rétablissez le réseau : le bandeau passe à « Wi-Fi de l'école · synchronisation faite à HH:MM ».
  3. **Appel** : chaque élève est présent par défaut. Touchez A pour un absent, puis « Enregistrer l'appel ».
- **Ce qui doit apparaître** :
  - sur le PC, les notes dans Saisie des notes ;
  - l'absent dans Vie scolaire › Absences et discipline ;
  - l'appel au Journal d'audit.

### Étape 6 · Instituteur de matière : sa seule matière

- **Compte** : `essama.l`, sur un poste de bureau.
- **Gestes** :
  1. **Notes et bulletins** : il ne voit que « Mes classes · EPS ». Saisissez les notes de CM2 A, puis « Enregistrer » (Ctrl S). L'écran dit : « Vous ne voyez et ne saisissez que l'EPS. »
  2. Montrez ce qu'il ne voit pas :
     - le menu n'a ni frais, ni personnel, ni paramètres ;
     - en tapant `/finances/caisse` dans la barre d'adresse, on revient à son tableau de bord, limité à sa classe ;
     - le serveur refuse l'appel direct (403).
- **Ce qui doit apparaître** : les notes d'EPS, que le principal voit sans pouvoir les modifier.

### Étape 7 · Préfet des études : fusion et bulletins

- **Comptes** : l'instituteur principal sur un poste de bureau, puis le préfet.
- **Gestes** :
  1. **Instituteur principal › Notes et bulletins › Fusion des notes** : « Calculer les notes finales », puis « Transmettre au préfet ». S'il manque des notes, l'écran le dit et la transmission attend.
  2. **Préfet › Bulletins**, classe CM2 A, 1er trimestre : « Publier les 3 bulletins », puis confirmez avec « Publier ».
- **Ce qui doit apparaître** :
  - moyennes et rangs calculés par l'application (NGONO Esther 1re, FOUDA Junior 2e, BELINGA Kevin 3e) ;
  - le bandeau « 1 bulletin visible, 2 en attente de paiement » ;
  - « Imprimer la classe en PDF ».

### Étape 8 · Parent : bulletin bloqué, message à l'économe

- **Compte** : la famille FOUDA, sur le téléphone, à l'adresse `/parent/connexion` : téléphone 600 000 301 et mot de passe de la fiche d'inscription.
- **Gestes** :
  1. **Accueil** : les deux enfants, le reste dû, la prochaine échéance, l'annonce de l'étape 2.
  2. **Notes** : pour Junior, « Le bulletin du 1er trimestre de Junior sera visible quand la tranche 1 sera payée à 90 % (aujourd'hui 16 %) ».
  3. **Paiements** : versements et reçus ; un reçu s'affiche à l'écran, sans téléchargement.
  4. **Écrire à l'école** : choisissez « Économe » et l'enfant, écrivez le message, puis « Envoyer ».
- **Ce qui doit apparaître** :
  - le message chez l'économe seul (Messages › Messagerie des parents) ;
  - aucune donnée d'une autre famille.

### Étape 9 · Directrice : validation, levée du blocage, journal, pilotage

- **Compte** : `directrice`.
- **Gestes** :
  1. **Frais et caisse › À valider** : la réduction de l'étape 3, puis « Valider ».
  2. **Notes et bulletins › Bulletins**, CM2 A : dans le bandeau, « Voir les 2 élèves ». Choisissez FOUDA Junior, « Lever le blocage », un motif, puis « Lever le blocage ».
  3. Sur le téléphone du parent, le bulletin de Junior apparaît : 14,00 sur 20, 2e sur 3.
  4. **Paramètres › Journal d'audit** : qui a fait quoi, quand, avant et après. On y voit la levée du blocage, la validation de la réduction, la publication, la transmission, l'appel et l'emploi du temps. Le journal ne se modifie pas.
  5. **Pilotage** et **Tableau de bord** : effectifs, encaissements, recouvrement par classe.
- **Ce qui doit apparaître** : chaque décision de la directrice au journal, et des chiffres cohérents avec les étapes 2 et 3.

### Vérification automatique

`pnpm --filter @gs/controle exec tsx src/procedure.ts --secretaire <mot de passe>` rejoue ces neuf étapes dans un navigateur, sur une base sortie de `demo:vide`. Elle prend une capture à chaque geste et écrit les comptes créés dans `COMPTES-DEMO.md`.

## Après la démonstration

- `pnpm demo:sauvegarde --nom apres-demo` garde l'état obtenu.
- `pnpm demo:restaurer depart --oui` revient à l'état de départ pour un nouveau passage.

Les sauvegardes sont chiffrées et rangées dans `var/sauvegardes`. Elles ne quittent pas le PC.

## En cas de problème

| Symptôme | Que faire |
|---|---|
| `demo:lancer` : « Docker indisponible » | Démarrez Docker, puis relancez. Ou démarrez PostgreSQL autrement, sur le port de `var/config.json`. |
| Le téléphone n'ouvre pas l'adresse | Vérifiez qu'il est sur le même Wi-Fi que le PC, et que le pare-feu du PC autorise le port 8443. |
| « La connexion n'est pas privée » à chaque fois | Installez le certificat (voie complète ci-dessus). |
| Le parent ne peut pas se connecter | Le mot de passe est celui de la fiche d'inscription. La secrétaire peut le réinitialiser : Paramètres › Utilisateurs et rôles, compte de la famille. |
| Le bulletin n'apparaît pas chez le parent | Il n'est pas publié (étape 7), ou il est bloqué : tranche payée à moins de 90 % (étape 9). |
| Une note saisie hors connexion n'est pas partie | Rouvrez l'écran Notes une fois le réseau revenu ; l'envoi reprend toutes les 30 secondes. |
