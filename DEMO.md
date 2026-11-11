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

### Répétition

Pour répéter sur une école déjà remplie, avec un trimestre de notes, de paiements et d'absences, lancez `pnpm demo:fictif`. Les comptes de répétition s'affichent à la fin, avec leurs mots de passe ; ne les utilisez jamais pour la vraie démonstration.

Entre deux passages, revenez à un état propre :

```
pnpm demo:sauvegarde          (avant le passage : garde l'état de départ)
pnpm demo:restaurer           (après : liste les sauvegardes et remet celle choisie)
```

La restauration commence toujours par une sauvegarde de l'état actuel. Le serveur peut rester allumé : il se reconnecte seul.

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

Les noms, montants et téléphones ci-dessous sont des exemples : saisissez ceux de votre choix. Utilisez des téléphones de la plage 600 000 xxx si vous ne voulez pas de vrais numéros.

### Étape 1 · Paramétrage de l'établissement et création des comptes

La conception confie le paramétrage à la secrétaire, et le directeur valide sans saisir (ECARTS E-07). Cette étape est donc jouée par la secrétaire ; le directeur entre en scène aux étapes 3 et 9.

- **Compte** : la secrétaire, créée par `demo:vide`.
- **Écran** : Paramètres › Établissement.
- **Gestes** :
  1. **Identité** : complétez la devise, la ville et la boîte postale, le téléphone et le signataire des documents. Dans « Réductions sans validation jusqu'à (FCFA) », saisissez par exemple **10 000**. Enregistrez (Ctrl S).
  2. **Années scolaires** : créez l'année 2026/2027 (du 07/09/2026 au 25/06/2027) avec « Créer l'année », puis « Ouvrir ». Les trois trimestres sont créés avec elle ; vérifiez leurs dates sous « Périodes d'évaluation ».
  3. **Cycles, niveaux et classes** : « Ajouter un cycle », par exemple Francophone · primaire. Ses niveaux, de la SIL au CM2, sont créés avec lui.
  4. **Personnel** (menu Personnel) : « Nouvelle fiche » pour la directrice, l'économe, le préfet des études et deux instituteurs. Ouvrez chaque fiche, puis « Créer son compte ».
  5. **Paramètres › Utilisateurs et rôles** : vérifiez les rôles et périmètres. Donnez à un instituteur le rôle « Instituteur principal » de sa classe, et à l'autre le rôle « Instituteur de matière » pour l'EPS. Notez le mot de passe de chaque compte : il ne s'affiche qu'une fois.
- **Ce qui doit apparaître** :
  - le nom de l'établissement dans la barre latérale et sur la page de connexion ;
  - l'année 2026/2027 « Ouverte » en haut de chaque écran ;
  - les comptes dans la liste, avec leurs rôles ;
  - chaque création au Journal d'audit.

**Préparation des frais** (économe, avant l'étape 2) : Frais et caisse › Grille des frais. Pour chaque niveau, saisissez l'inscription et les trois tranches, en tarif « nouveau » et en tarif « ancien », puis enregistrez. Sans grille, une inscription ne crée pas d'échéancier.

### Étape 2 · Secrétaire : classes, inscriptions, annonce

- **Compte** : la secrétaire.
- **Gestes** :
  1. **Paramètres › Établissement › Ajouter une classe** : CE2 B, SIL A, CM2 A, avec leur effectif maximal.
  2. **Élèves › Nouvelle inscription** : élève (nom, prénoms, sexe, date et lieu de naissance), responsable payeur avec son téléphone, classe CE2 B, type Nouvelle. Enregistrez avec « Enregistrer l'inscription ».
  3. Une fenêtre affiche le **compte famille** : l'identifiant est le téléphone du payeur, et le mot de passe s'affiche une seule fois. Imprimez la fiche d'inscription, qui porte ce mot de passe ; elle servira à l'étape 8.
  4. Inscrivez un second enfant avec **le même téléphone** de payeur. L'application reconnaît la famille, et le même compte sert aux deux enfants.
  5. Inscrivez deux ou trois élèves en CM2 A (classe de l'instituteur principal).
  6. **Messages › Annonces › Nouvelle annonce** : destinataires, titre et texte en français et en anglais, puis « Publier ».
- **Ce qui doit apparaître** :
  - le matricule attribué automatiquement (26FR0001…) ;
  - l'échéancier copié de la grille sur la fiche de l'élève ;
  - l'annonce sous « Annonces publiées » ;
  - si une classe est pleine, une demande de dérogation qui part à la directrice.

### Étape 3 · Économe : encaissement, reçu, réduction, impayés

- **Compte** : l'économe.
- **Gestes** :
  1. **Frais et caisse › Caisse du jour** : « Ouvrir la session » avec le fonds de caisse.
  2. « Encaisser un élève » (ou Ctrl K), choisissez l'élève inscrit à l'étape 2, saisissez un montant, espèces, puis « Valider et imprimer ».
  3. Le **reçu bilingue** s'affiche, en français et en anglais, avec le montant en lettres. Le PDF s'ouvre pour l'impression ; une réimpression porte la mention « Duplicata ».
  4. **Fiche de l'élève › Accorder une réduction** : un montant **au-delà du seuil** de l'étape 1, par exemple 15 000 FCFA, avec un motif. La réduction devient une demande, à valider par la directrice.
  5. **Frais et caisse › Impayés** : la liste des échéances dépassées, avec les filtres et l'export.
- **Ce qui doit apparaître** :
  - le versement dans les « Opérations de la session » ;
  - l'inscription qui passe de « en attente » à « validée » dès le premier versement suffisant ;
  - la demande de réduction « en attente de validation ».

Pour montrer la règle des droits, connectez-vous en directrice et cherchez un bouton d'encaissement : il n'y en a pas, et le serveur refuserait l'appel (403).

### Étape 4 · Préfet des études : matières, affectations, emploi du temps

- **Compte** : le préfet des études.
- **Gestes** :
  1. **Notes et bulletins › Matières** : « Ajouter une matière » (Mathématiques, Français, EPS…), avec le coefficient et le barème. « Affecter un instituteur » : le principal pour sa classe CM2 A, l'instituteur de matière pour l'EPS.
  2. **Saisie des notes** : choisissez la classe et la séquence 1, puis « Ouvrir la saisie ».
  3. **Emploi du temps** : choisissez la classe CM2 A et placez les cours d'un clic sur la grille. Ajoutez l'EPS avec l'instituteur de matière, puis « Valider et publier ».
- **Ce qui doit apparaître** :
  - « Équipe de la classe » avec les deux instituteurs ;
  - l'emploi du temps publié ;
  - côté parent, l'agenda qui le reprendra.

### Étape 5 · Instituteur principal : appel et notes sur le téléphone

- **Compte** : l'instituteur principal, sur le téléphone, à l'adresse `/instituteur/connexion`.
- **Gestes** :
  1. **Appel** : chaque élève est présent par défaut. Touchez A pour un absent, R pour un retard, puis « Enregistrer l'appel ».
  2. **Notes** : sous « Mes classes », choisissez CM2 A et une matière. Saisissez les notes au pavé numérique ; Entrée passe à l'élève suivant. Touchez le nom d'un élève pour le marquer absent ou dispensé. Puis « Enregistrer sur le téléphone ».
  3. **Hors connexion** : passez le téléphone en mode avion, saisissez une note et enregistrez. Le bandeau affiche « Hors ligne · notes gardées sur le téléphone ». Rétablissez le réseau : les notes partent seules et le bandeau confirme la synchronisation.
- **Ce qui doit apparaître** :
  - sur le PC, l'absent dans Vie scolaire › Absences et discipline ;
  - les notes dans Saisie des notes, avec l'avancement de la classe.

### Étape 6 · Instituteur de matière : sa seule matière

- **Compte** : l'instituteur de matière, sur un poste de bureau.
- **Gestes** :
  1. **Notes et bulletins › Saisie des notes** : il ne voit que ses classes et l'EPS. Saisissez les notes ; A, J et D posent absent, absent justifié et dispensé ; Ctrl S enregistre.
  2. Montrez ce qu'il ne voit pas : le menu ne propose ni les frais, ni les autres matières, ni les bulletins. En tapant l'adresse d'un autre écran, par exemple `/finances/caisse`, on revient à son écran, et le serveur refuse l'appel direct (403).
- **Ce qui doit apparaître** : la colonne EPS remplie, en lecture seule pour le principal.

### Étape 7 · Préfet des études : fusion et bulletins

- **Comptes** : d'abord l'instituteur principal sur un poste de bureau, puis le préfet.
- **Gestes** :
  1. **Instituteur principal** › Notes et bulletins › Fusion des notes : « Calculer les notes finales », puis « Transmettre au préfet ». S'il manque des notes, l'écran le dit et la transmission attend.
  2. **Préfet** › Fusion des notes : les notes transmises de CM2 A.
  3. **Préfet** › Bulletins : choisissez CM2 A et le 1er trimestre, « Recalculer », puis « Publier les N bulletins ».
- **Ce qui doit apparaître** :
  - moyennes, rangs et appréciations calculés par l'application ;
  - le bulletin de chaque élève ;
  - le PDF de la classe (« Imprimer la classe ») ;
  - une correction après publication, qui crée une version 2.

### Étape 8 · Parent : bulletin bloqué, message à l'économe

- **Compte** : le compte famille de l'étape 2 (téléphone du payeur et mot de passe de la fiche), sur le téléphone, à l'adresse `/parent/connexion`.
- **Gestes** :
  1. **Accueil** : les enfants, le reste dû, la prochaine échéance et les dernières nouvelles, dont l'annonce de l'étape 2.
  2. **Notes** : pour l'enfant dont la tranche 1 est payée à moins de 90 %, le bulletin est **bloqué**, avec le message qui l'explique. Le parent ne le voit pas.
  3. **Paiements** : versements et reçus. Un reçu s'affiche à l'écran, sans téléchargement.
  4. **Écrire à l'école** : choisissez « Économe », l'enfant concerné, écrivez le message, puis « Envoyer ».
- **Ce qui doit apparaître** :
  - le message chez l'économe (Messages › Messagerie des parents), et chez lui seul ;
  - aucune donnée d'une autre famille.

### Étape 9 · Directrice : validation, levée du blocage, journal, pilotage

- **Compte** : la directrice.
- **Gestes** :
  1. **Frais et caisse › À valider** : la réduction demandée à l'étape 3. « Valider » ; l'échéancier de l'élève se met à jour.
  2. **Notes et bulletins › Bulletins** : l'élève dont le bulletin est bloqué. « Lever le blocage », avec un motif. Sur le téléphone du parent, le bulletin apparaît.
  3. **Paramètres › Journal d'audit** : qui a fait quoi, quand, avant et après. Filtrez par utilisateur ou par action : on y retrouve l'encaissement, la réduction, la publication et la levée du blocage. Le journal ne se modifie pas.
  4. **Pilotage** et **Tableau de bord** : effectifs, encaissements, recouvrement par classe, échéances dépassées.
- **Ce qui doit apparaître** : la décision de la directrice tracée dans le journal, et les chiffres du tableau de bord cohérents avec les étapes 2 et 3.

## Après la démonstration

- `pnpm demo:sauvegarde` garde l'état obtenu.
- `pnpm demo:restaurer` revient à l'état de départ pour un nouveau passage.

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
