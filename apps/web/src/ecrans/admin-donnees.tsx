// Maquette Donnees : import d'élèves et de responsables depuis un fichier CSV enregistré par Excel (lu sur le poste,
// contrôlé par le serveur avant tout enregistrement), sauvegardes chiffrées, accès en lecture seule à la base, exports.
import { useState, type ReactNode } from 'react';
import { api, ErreurApi } from '../core/api.ts';
import { Coque } from '../core/coque.tsx';
import { useMoi } from '../core/session.tsx';
import { choisirFichier, telecharger } from '../core/documents.ts';
import { montant, pluriel } from '../core/format.ts';
import {
  agir, Bandeau, Bouton, Chargement, Colonnes, confirmer, Doux, Erreur, Etapes, LigneListe, Liste, Note, ouvrirFormulaire, Panneau, PiedFenetre,
  Radio, CaseACocher, signaler, Tableau, TitrePanneau, useDonnees, type EtatEtape,
} from '../core/ui.tsx';
import { dateAHeure, montrerMotDePasse } from './admin-commun.tsx';

// ---------------------------------------------------------------- lecture du fichier (mêmes règles que la commande import:csv)

export type ChampImport = 'matricule' | 'nom' | 'prenoms' | 'sexe' | 'dateNaissance' | 'lieuNaissance' | 'classe' | 'type'
  | 'responsable' | 'lien' | 'telephone' | 'langue' | 'responsable2' | 'lien2' | 'telephone2';

/** Données importables, longueur maximale admise par le serveur et intitulés de colonne reconnus (français et anglais usuels). */
export const CHAMPS: { cle: ChampImport; libelle: string; max: number; entete: string; synonymes: string[] }[] = [
  { cle: 'matricule', libelle: 'matricule', max: 20, entete: 'Matricule', synonymes: ['matricule', 'mat', 'numero matricule', 'registration number', 'student id', 'id'] },
  { cle: 'nom', libelle: 'nom', max: 60, entete: 'Nom', synonymes: ['nom', 'nom de famille', 'last name', 'surname', 'family name', 'names', 'name', 'nom et prenoms', 'nom prenoms', 'eleve', 'student', 'pupil'] },
  { cle: 'prenoms', libelle: 'prénoms', max: 80, entete: 'Prénoms', synonymes: ['prenoms', 'prenom', 'first name', 'first names', 'given names', 'other names'] },
  { cle: 'sexe', libelle: 'sexe', max: 10, entete: 'Sexe', synonymes: ['sexe', 'genre', 'sex', 'gender', 's'] },
  { cle: 'dateNaissance', libelle: 'date de naissance', max: 20, entete: 'Date de naissance', synonymes: ['date de naissance', 'ne le', 'nee le', 'ne e le', 'naissance', 'date naissance', 'dob', 'date of birth', 'birth date', 'birthdate'] },
  { cle: 'lieuNaissance', libelle: 'lieu de naissance', max: 80, entete: 'Lieu de naissance', synonymes: ['lieu de naissance', 'lieu', 'ne a', 'place of birth', 'birth place', 'pob'] },
  { cle: 'classe', libelle: 'classe', max: 40, entete: 'Classe', synonymes: ['classe', 'class', 'niveau', 'level', 'cours'] },
  { cle: 'type', libelle: 'type d’inscription', max: 20, entete: 'Type', synonymes: ['type', 'type d inscription', 'statut', 'status', 'admission'] },
  { cle: 'responsable', libelle: 'responsable', max: 80, entete: 'Responsable', synonymes: ['responsable', 'parent', 'nom du responsable', 'nom du parent', 'parent name', 'guardian', 'tuteur', 'pere ou mere', 'responsable 1', 'parent 1'] },
  { cle: 'lien', libelle: 'lien avec l’élève', max: 20, entete: 'Lien', synonymes: ['lien', 'lien de parente', 'relation', 'relationship', 'qualite', 'lien 1'] },
  { cle: 'telephone', libelle: 'téléphone du responsable', max: 30, entete: 'Téléphone', synonymes: ['telephone', 'tel', 'tel parent', 'telephone du responsable', 'telephone parent', 'parent phone', 'phone', 'mobile', 'contact', 'telephone 1', 'phone 1'] },
  { cle: 'langue', libelle: 'langue des SMS', max: 10, entete: 'Langue', synonymes: ['langue', 'language', 'langue des sms', 'sms language'] },
  { cle: 'responsable2', libelle: 'second responsable', max: 80, entete: 'Responsable 2', synonymes: ['responsable 2', 'second responsable', 'parent 2', 'autre parent', 'second parent'] },
  { cle: 'lien2', libelle: 'lien du second responsable', max: 20, entete: 'Lien 2', synonymes: ['lien 2', 'relation 2'] },
  { cle: 'telephone2', libelle: 'téléphone du second responsable', max: 30, entete: 'Téléphone 2', synonymes: ['telephone 2', 'tel 2', 'phone 2', 'second phone', 'autre telephone'] },
];
const OBLIGATOIRES: ChampImport[] = ['nom', 'sexe', 'dateNaissance', 'classe', 'responsable', 'telephone'];
const MAX_LIGNES = 3000;

const normal = (x: string) => x.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const majuscule = (x: string) => x.charAt(0).toUpperCase() + x.slice(1);
const libelleChamp = (k: ChampImport) => CHAMPS.find((c) => c.cle === k)!.libelle;

/** Texte du fichier : UTF-8, ou Windows-1252 (« CSV » d'Excel en français) si l'UTF-8 ne se lit pas. */
export function decoder(octets: Uint8Array): string {
  const utf8 = new TextDecoder('utf-8').decode(octets);
  return utf8.includes('�') ? new TextDecoder('windows-1252').decode(octets) : utf8;
}

export interface LigneCsv { numero: number; cellules: string[] }

/** Lecture CSV : séparateur « ; », « , » ou tabulation détecté sur l'en-tête, guillemets doublés, BOM, fins de ligne Windows.
 *  Chaque enregistrement garde le numéro de sa ligne dans le fichier, pour le rapport d'erreurs. */
export function lireCsv(texte: string): LigneCsv[] {
  const t = texte.replace(/^﻿/, '');
  const fin = t.search(/\r?\n/);
  const entete = fin < 0 ? t : t.slice(0, fin);
  const sep = [';', '\t', ','].map((s) => [s, entete.split(s).length] as const).sort((a, b) => b[1] - a[1])[0]![0];
  const lignes: LigneCsv[] = [];
  let champ = '', cellules: string[] = [], guillemets = false, numero = 1, debut = 1;
  for (let i = 0; i < t.length; i++) {
    const c = t[i]!;
    if (guillemets) {
      if (c === '"' && t[i + 1] === '"') { champ += '"'; i++; } else if (c === '"') guillemets = false; else { if (c === '\n') numero++; champ += c; }
    } else if (c === '"' && champ === '') guillemets = true;
    else if (c === sep) { cellules.push(champ); champ = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && t[i + 1] === '\n') i++;
      cellules.push(champ); champ = '';
      lignes.push({ numero: debut, cellules }); cellules = [];
      numero++; debut = numero;
    } else champ += c;
  }
  if (champ !== '' || cellules.length) { cellules.push(champ); lignes.push({ numero: debut, cellules }); }
  return lignes;
}

/** Colonne → donnée reconnue d'après l'intitulé ; une donnée n'est prise qu'une fois (la première colonne l'emporte). */
export function reconnaitre(entete: string[]): (ChampImport | null)[] {
  const prises = new Set<ChampImport>();
  return entete.map((h) => {
    const n = normal(h);
    const c = CHAMPS.find((x) => !prises.has(x.cle) && x.synonymes.includes(n));
    if (!c) return null;
    prises.add(c.cle);
    return c.cle;
  });
}

export interface LigneImport {
  ligne: number; matricule: string | null; nom: string; prenoms: string; sexe: string; dateNaissance: string; lieuNaissance: string | null; classe: string;
  type: string | null; responsable: string; lien: string | null; telephone: string; langue: string | null;
  responsable2: string | null; lien2: string | null; telephone2: string | null;
}
export interface ErreurImport { ligne: number; champ: string; valeur: string; probleme: string }

/** Lignes à envoyer au serveur ; une valeur plus longue que la limite est signalée ici (le serveur refuserait tout l'envoi). */
export function preparer(lignes: LigneCsv[], carte: (ChampImport | null)[]): { lignes: LigneImport[]; erreurs: ErreurImport[] } {
  const erreurs: ErreurImport[] = [];
  const valides: LigneImport[] = [];
  for (const l of lignes) {
    const val = (k: ChampImport) => { const i = carte.indexOf(k); return i < 0 ? '' : (l.cellules[i] ?? '').trim(); };
    const trop = CHAMPS.filter((c) => val(c.cle).length > c.max);
    for (const c of trop) erreurs.push({ ligne: l.numero, champ: majuscule(c.libelle), valeur: `${val(c.cle).slice(0, 40)}…`, probleme: `Valeur trop longue (${c.max} caractères au plus)` });
    if (trop.length) continue;
    valides.push({
      ligne: l.numero, matricule: val('matricule') || null, nom: val('nom'), prenoms: val('prenoms'), sexe: val('sexe'), dateNaissance: val('dateNaissance'),
      lieuNaissance: val('lieuNaissance') || null, classe: val('classe'), type: val('type') || null, responsable: val('responsable'), lien: val('lien') || null,
      telephone: val('telephone'), langue: val('langue') || null, responsable2: val('responsable2') || null, lien2: val('lien2') || null, telephone2: val('telephone2') || null,
    });
  }
  return { lignes: valides, erreurs };
}

const csvChamp = (x: string | number) => { const s = String(x); return /[;"\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s; };
export const rapportCsv = (erreurs: ErreurImport[]) =>
  ['Ligne;Champ;Valeur;Problème', ...erreurs.map((e) => [e.ligne, e.champ, e.valeur, e.probleme].map(csvChamp).join(';'))].join('\r\n') + '\r\n';

/** Fichier produit sur le poste (rapport d'erreurs, modèle) : téléchargé sans passer par le serveur. */
function telechargerTexte(nom: string, texte: string) {
  const lien = URL.createObjectURL(new Blob(['﻿' + texte], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = lien;
  a.download = nom;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(lien), 2000);
}

// ---------------------------------------------------------------- import

interface ReponseImport { essai: boolean; lues: number; valides: number; erreurs: ErreurImport[]; importes: number }
interface Fichier { nom: string; entete: string[]; lignes: LigneCsv[]; carte: (ChampImport | null)[] }
interface Controle { valides: number; erreurs: ErreurImport[]; envoi: LigneImport[] }

function FenetreColonnes({ fermer, entete, carte, exemple }: { fermer: (c?: (ChampImport | null)[]) => void; entete: string[]; carte: (ChampImport | null)[]; exemple: string[] }) {
  const [c, setC] = useState(carte);
  const options: [ChampImport | null, string][] = [[null, 'Ignorer cette colonne'], ...CHAMPS.map((x): [ChampImport, string] => [x.cle, majuscule(x.libelle)])];
  const doublons = CHAMPS.filter((x) => c.filter((y) => y === x.cle).length > 1);
  return (
    <>
      <Doux>Associez chaque colonne du fichier à une donnée. Les colonnes ignorées ne sont pas importées.</Doux>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {entete.map((h, i) => (
          <div key={i} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12 }}>
            <div style={{ flex: '1 1 160px', display: 'flex', flexDirection: 'column', minWidth: 0 }}>
              <span className="gras">« {h || `Colonne ${i + 1}`} »</span>
              {exemple[i] && <Doux>Exemple : {exemple[i]}</Doux>}
            </div>
            <div style={{ flex: '1 1 220px', minWidth: 0 }}>
              <Liste ariaLabel={`Donnée de la colonne ${h || i + 1}`} value={c[i] ?? null} options={options}
                onChange={(v) => setC((x) => x.map((y, j) => (j === i ? v : y)))} />
            </div>
          </div>
        ))}
      </div>
      {doublons.length > 0 && <Note ton="attention">Une même donnée est associée à plusieurs colonnes : {doublons.map((x) => x.libelle).join(', ')}.</Note>}
      <PiedFenetre fermer={() => fermer()} action="Appliquer et contrôler" onAction={() => fermer(c)} disabled={doublons.length > 0} />
    </>
  );
}

function TableauErreurs({ erreurs }: { erreurs: ErreurImport[] }) {
  const affichees = erreurs.slice(0, 50);
  return (
    <>
      <Tableau serre colonnes={[{ titre: 'Ligne', droite: true, largeur: 70 }, { titre: 'Champ', mobile: 'entete' }, { titre: 'Valeur' }, { titre: 'Problème' }]}
        lignes={affichees.map((e) => [e.ligne, <span className="gras">{e.champ}</span>, <span style={{ overflowWrap: 'anywhere' }}>{e.valeur || '–'}</span>, e.probleme])} />
      {erreurs.length > affichees.length && <Doux>… et {pluriel(erreurs.length - affichees.length, 'autre erreur', 'autres erreurs')}, toutes dans le rapport.</Doux>}
    </>
  );
}

const nombreLignes = (erreurs: ErreurImport[]) => new Set(erreurs.map((e) => e.ligne)).size;

function Chiffre({ libelle, valeur, couleur }: { libelle: string; valeur: number; couleur?: string }) {
  return (
    <div className="info-caps">
      <span className="etiquette">{libelle}</span>
      <span style={{ fontSize: 26, fontWeight: 700, lineHeight: 1.15, ...(couleur ? { color: couleur } : {}) }}>{montant(valeur)}</span>
    </div>
  );
}

function PanneauImport() {
  const [fichier, setFichier] = useState<Fichier | null>(null);
  const [controle, setControle] = useState<Controle | null>(null);
  const [resultat, setResultat] = useState<ReponseImport | null>(null);
  const [probleme, setProbleme] = useState<string | null>(null);
  const [charge, setCharge] = useState(false);

  const controler = async (f: Fichier) => {
    setFichier(f);
    setControle(null);
    setResultat(null);
    setProbleme(null);
    const manquantes = OBLIGATOIRES.filter((k) => !f.carte.includes(k));
    if (manquantes.length) {
      setProbleme(`Colonnes obligatoires absentes : ${manquantes.map(libelleChamp).join(', ')}. Renommez l’en-tête du fichier ou corrigez les colonnes.`);
      return;
    }
    const { lignes, erreurs } = preparer(f.lignes, f.carte);
    setCharge(true);
    try {
      const r = lignes.length ? await api.post<ReponseImport>('/scolarite/import', { essai: true, lignes }) : null;
      setControle({ valides: r?.valides ?? 0, erreurs: [...erreurs, ...(r?.erreurs ?? [])].sort((a, b) => a.ligne - b.ligne), envoi: lignes });
    } catch (e) {
      setProbleme(e instanceof ErreurApi ? e.message : String(e));
    } finally {
      setCharge(false);
    }
  };
  const choisir = async () => {
    const f = await choisirFichier('.csv,.txt,text/csv');
    if (!f) return;
    setResultat(null);
    setControle(null);
    if (/\.(xlsx|xlsm|xls|ods)$/i.test(f.nom)) {
      setFichier(null);
      setProbleme('Enregistrez d’abord le classeur au format CSV depuis Excel (Fichier › Enregistrer sous › CSV), puis choisissez ce fichier.');
      return;
    }
    const tableau = lireCsv(decoder(f.octets)).filter((l) => l.cellules.some((c) => c.trim() !== ''));
    if (tableau.length < 2) { setFichier(null); setProbleme('Le fichier ne contient aucune ligne après l’en-tête.'); return; }
    if (tableau.length - 1 > MAX_LIGNES) { setFichier(null); setProbleme('3 000 lignes au plus par import : découpez le fichier par classe ou par section.'); return; }
    const entete = tableau[0]!.cellules.map((c) => c.trim());
    await controler({ nom: f.nom, entete, lignes: tableau.slice(1), carte: reconnaitre(entete) });
  };
  const corriger = async () => {
    if (!fichier) return;
    const exemple = fichier.lignes[0]?.cellules.map((c) => c.trim()) ?? [];
    const carte = await ouvrirFormulaire<(ChampImport | null)[]>('Corriger les colonnes',
      ({ fermer }) => <FenetreColonnes fermer={fermer} entete={fichier.entete} carte={fichier.carte} exemple={exemple} />, 620);
    if (carte) await controler({ ...fichier, carte });
  };
  const importer = async () => {
    if (!fichier || !controle) return;
    const ok = await confirmer('Importer les élèves', `${pluriel(controle.valides, 'élève')} et ${controle.valides > 1 ? 'leurs responsables' : 'ses responsables'} seront inscrits dans l’année en cours. Les lignes en erreur ne sont pas importées.`, `Importer les ${montant(controle.valides)} lignes valides`);
    if (!ok) return;
    setCharge(true);
    const r = await agir(() => api.post<ReponseImport>('/scolarite/import', { essai: false, lignes: controle.envoi }));
    setCharge(false);
    if (!r) return;
    const locales = controle.erreurs.filter((e) => !controle.envoi.some((l) => l.ligne === e.ligne));
    setResultat({ ...r, erreurs: [...locales, ...r.erreurs].sort((a, b) => a.ligne - b.ligne) });
    signaler(`${pluriel(r.importes, 'élève importé', 'élèves importés')}`);
  };
  const rapport = (erreurs: ErreurImport[]) => telechargerTexte(`${(fichier?.nom ?? 'import').replace(/\.[^.]+$/, '')}.rejets.csv`, rapportCsv(erreurs));
  const modele = () => telechargerTexte('modele-import-eleves.csv', `${CHAMPS.map((c) => c.entete).join(';')}\r\n`);

  const colonnesOk = !!fichier && OBLIGATOIRES.every((k) => fichier.carte.includes(k));
  const etapes: [string, EtatEtape][] = [
    ['Fichier', fichier ? 'faite' : 'courante'],
    ['Colonnes', colonnesOk ? 'faite' : fichier ? 'courante' : 'avenir'],
    ['Contrôle', resultat ? 'faite' : colonnesOk ? 'courante' : 'avenir'],
    ['Import', resultat ? 'faite' : 'avenir'],
  ];
  const reconnues = fichier ? fichier.carte.map((k, i) => (k ? { h: fichier.entete[i] || `Colonne ${i + 1}`, k } : null)).filter((x): x is { h: string; k: ChampImport } => !!x) : [];
  const ignorees = fichier ? fichier.entete.filter((h, i) => !fichier.carte[i] && h) : [];
  const libelleReconnu = (k: ChampImport) => (k === 'nom' && fichier && !fichier.carte.includes('prenoms') ? 'nom et prénoms' : libelleChamp(k));

  let corps: ReactNode = null;
  if (resultat) {
    corps = (
      <>
        <Bandeau ton="succes" icone="coche">{pluriel(resultat.importes, 'élève importé', 'élèves importés')} avec leurs responsables, sur {pluriel(resultat.lues, 'ligne lue', 'lignes lues')}.</Bandeau>
        {resultat.erreurs.length > 0 && (
          <>
            <Chiffre libelle="Lignes rejetées" valeur={nombreLignes(resultat.erreurs)} couleur="var(--attention)" />
            <TableauErreurs erreurs={resultat.erreurs} />
          </>
        )}
        <div className="pile-mobile" style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {resultat.erreurs.length > 0 && <Bouton icone="exporter" onClick={() => rapport(resultat.erreurs)}>Télécharger le rapport d'erreurs</Bouton>}
          <Bouton onClick={() => { setFichier(null); setControle(null); setResultat(null); setProbleme(null); }}>Importer un autre fichier</Bouton>
        </div>
      </>
    );
  } else if (controle) {
    const enErreur = nombreLignes(controle.erreurs);
    corps = (
      <>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px 40px' }}>
          <Chiffre libelle="Lignes valides" valeur={controle.valides} couleur="var(--succes)" />
          <Chiffre libelle="Lignes en erreur" valeur={enErreur} couleur={enErreur ? 'var(--attention)' : undefined} />
        </div>
        {controle.erreurs.length > 0 && <TableauErreurs erreurs={controle.erreurs} />}
        <div className="pile-mobile" style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {controle.erreurs.length > 0 && <Bouton icone="exporter" onClick={() => rapport(controle.erreurs)}>Télécharger le rapport d'erreurs</Bouton>}
          <Bouton variante="principal" disabled={controle.valides === 0} charge={charge} onClick={importer}>Importer les {montant(controle.valides)} lignes valides</Bouton>
        </div>
        <Doux>Rien n’est enregistré avant « Importer » ; les lignes en erreur se corrigent dans le fichier, puis s’importent à leur tour.</Doux>
      </>
    );
  }

  return (
    <Panneau>
      <TitrePanneau titre="Import depuis Excel" sous="Élèves et responsables · fichier CSV" action={<Bouton variante="lien" onClick={modele}>Modèle de fichier</Bouton>} />
      <Etapes etapes={etapes} />
      {fichier ? (
        <div className="pile-mobile" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12 }}>
          <div style={{ flex: '1 1 220px', display: 'flex', flexDirection: 'column', minWidth: 0 }}>
            <span className="gras" style={{ overflowWrap: 'anywhere' }}>{fichier.nom}</span>
            <Doux>Élèves et responsables · {pluriel(fichier.lignes.length, 'ligne lue', 'lignes lues')}</Doux>
          </div>
          <Bouton onClick={choisir} disabled={charge}>Changer de fichier</Bouton>
        </div>
      ) : (
        <div className="pile-mobile" style={{ display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'flex-start' }}>
          <p>Enregistrez la liste depuis Excel au format CSV (séparateur « ; » ou « , »), une ligne par élève, avec l’en-tête en première ligne.
            Les intitulés usuels sont reconnus en français et en anglais : Nom, Names, Prénoms, Sexe, Date de naissance, DOB, Classe, Class,
            Responsable, Parent, Téléphone, Parent phone, Matricule, Lien, Langue.</p>
          <Bouton variante="principal" icone="sortie" onClick={choisir}>Choisir un fichier</Bouton>
        </div>
      )}
      {fichier && (
        <div className="bloc-assistant">
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: '4px 12px' }}>
            <span className="gras">Colonnes reconnues</span><Doux>À relire avant l’import</Doux>
          </div>
          <span>{reconnues.length ? reconnues.map((r) => `« ${r.h} » → ${libelleReconnu(r.k)}`).join(' · ') : 'Aucune colonne reconnue.'}</span>
          {ignorees.length > 0 && <Doux>Colonnes ignorées : {ignorees.map((h) => `« ${h} »`).join(', ')}</Doux>}
          <div className="pile-mobile"><Bouton icone="colonnes" onClick={corriger} disabled={charge}>Corriger les colonnes</Bouton></div>
        </div>
      )}
      {probleme && <div role="alert"><Note ton="danger">{probleme}</Note></div>}
      {charge && !controle && !resultat ? <Chargement /> : corps}
    </Panneau>
  );
}

// ---------------------------------------------------------------- sauvegardes et base

interface Sauvegarde { nom: string; taille: number; date: string }
interface EtatSauvegardes { liste: Sauvegarde[]; derniere: Sauvegarde | null; heure: string; conservation: string; copie: { dossier: string; branche: boolean } | null }
interface Base { lecture: string; schema: string; hote: string; port: number; base: string }

const taille = (o: number) => (o < 1_000_000 ? `${Math.max(1, Math.round(o / 1000))} ko` : `${Math.round(o / 1_000_000)} Mo`);

function FenetreRestauration({ fermer, liste }: { fermer: (ok?: boolean) => void; liste: Sauvegarde[] }) {
  const [nom, setNom] = useState<string | null>(null);
  const [accord, setAccord] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [charge, setCharge] = useState(false);
  const valider = async () => {
    if (!nom || !accord) return;
    setCharge(true);
    try {
      await api.post('/core/sauvegardes/restauration', { nom });
      fermer(true);
    } catch (e) {
      setErreur(e instanceof ErreurApi ? e.message : String(e));
      setCharge(false);
    }
  };
  return (
    <>
      <p>La base revient à l’état de la sauvegarde choisie ; les saisies faites depuis sont retirées. L’état actuel est d’abord sauvegardé, et les connexions ouvertes sont coupées.</p>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {liste.slice(0, 12).map((s) => (
          <Radio key={s.nom} nom="sauvegarde" actif={nom === s.nom} onChange={() => setNom(s.nom)}
            libelle={<span>{dateAHeure(s.date)} · {taille(s.taille)} <span className="doux petit">{s.nom}</span></span>} />
        ))}
      </div>
      <CaseACocher libelle="Je confirme la restauration de cette sauvegarde" valeur={accord} onChange={setAccord} />
      {erreur && <div role="alert"><Note ton="danger">{erreur}</Note></div>}
      <PiedFenetre fermer={() => fermer()} action="Restaurer" onAction={valider} charge={charge} disabled={!nom || !accord} />
    </>
  );
}

function PanneauSauvegardes() {
  const moi = useMoi();
  const s = useDonnees(() => api.get<EtatSauvegardes>('/core/sauvegardes'));
  const [charge, setCharge] = useState(false);
  const sauvegarder = async () => {
    setCharge(true);
    const r = await agir(() => api.post<Sauvegarde>('/core/sauvegardes'));
    setCharge(false);
    if (r) { signaler(`Sauvegarde faite · ${taille(r.taille)}`); void s.recharger(); }
  };
  const restaurer = async () => {
    if (!s.d) return;
    const ok = await ouvrirFormulaire<boolean>('Restaurer une sauvegarde', ({ fermer }) => <FenetreRestauration fermer={fermer} liste={s.d!.liste} />, 560);
    if (ok) { signaler('Sauvegarde restaurée'); setTimeout(() => window.location.reload(), 1200); }
  };
  const d = s.d;
  return (
    <Panneau>
      <TitrePanneau titre="Sauvegardes" />
      {s.erreur && !d ? <Erreur message={s.erreur} recharger={s.recharger} /> : !d ? <Chargement /> : (
        <>
          {d.derniere
            ? <Bandeau ton="succes" icone="coche">Dernière sauvegarde réussie : {dateAHeure(d.derniere.date)} · {taille(d.derniere.taille)}</Bandeau>
            : <Bandeau ton="attention" icone="alerte">Aucune sauvegarde pour l’instant.</Bandeau>}
          <div>
            <LigneListe><span style={{ flex: '1 1 160px' }}>Sauvegarde automatique</span><span className="gras">Chaque jour à {d.heure}</span></LigneListe>
            <LigneListe>
              <span style={{ flex: '1 1 160px' }}>Copie sur disque externe</span>
              <span className="gras" style={{ overflowWrap: 'anywhere', minWidth: 0 }}>{d.copie ? `${d.copie.dossier} · ${d.copie.branche ? 'branché' : 'débranché'}` : 'Non configurée'}</span>
            </LigneListe>
            <LigneListe><span style={{ flex: '1 1 160px' }}>Sauvegardes conservées</span><span className="gras">{d.conservation}</span></LigneListe>
          </div>
          <div className="pile-mobile" style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {moi.a('core.sauvegarde.lancer') && <Bouton variante="principal" charge={charge} onClick={sauvegarder}>Sauvegarder maintenant</Bouton>}
            {moi.a('core.sauvegarde.restaurer') && <Bouton onClick={restaurer} disabled={d.liste.length === 0}>Restaurer…</Bouton>}
          </div>
          <Doux>Sauvegardes chiffrées. La restauration se fait pas à pas et commence par une sauvegarde de l’état actuel.</Doux>
        </>
      )}
    </Panneau>
  );
}

function PanneauBase() {
  const b = useDonnees(() => api.get<Base>('/core/base'));
  const changer = async () => {
    const ok = await confirmer('Changer le mot de passe', 'Un nouveau mot de passe est créé pour le compte en lecture seule ; les outils qui utilisent l’ancien devront être mis à jour.', 'Changer le mot de passe');
    if (!ok) return;
    const r = await agir(() => api.post<{ utilisateur: string; motDePasse: string }>('/core/base/lecture'));
    if (r) await montrerMotDePasse('Accès en lecture seule', r.utilisateur, r.motDePasse, 'Saisissez ce mot de passe dans Excel ou dans l’outil de lecture : l’ancien ne fonctionne plus.');
  };
  const d = b.d;
  return (
    <Panneau>
      <TitrePanneau titre="Accès direct à la base" />
      {b.erreur && !d ? <Erreur message={b.erreur} recharger={b.recharger} /> : !d ? <Chargement /> : (
        <>
          <div>
            <LigneListe><span style={{ flex: '1 1 160px' }}>Compte en lecture seule</span><span className="gras" style={{ overflowWrap: 'anywhere' }}>{d.lecture}</span></LigneListe>
            <LigneListe><span style={{ flex: '1 1 160px' }}>Vues prêtes à l’emploi</span><span className="gras">schéma {d.schema}</span></LigneListe>
            <LigneListe><span style={{ flex: '1 1 160px' }}>Serveur</span><span className="gras" style={{ overflowWrap: 'anywhere' }}>{d.hote} · port {d.port} · base {d.base}</span></LigneListe>
          </div>
          <div className="pile-mobile" style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            <Bouton icone="exporter" onClick={() => telecharger('/core/base/description')}>Description des tables et des vues</Bouton>
            <Bouton icone="bouclier" onClick={changer}>Changer le mot de passe</Bouton>
          </div>
          <Doux>L’établissement lit librement ses données avec Excel ou tout autre outil ; les écritures passent par l’application.</Doux>
        </>
      )}
    </Panneau>
  );
}

// ---------------------------------------------------------------- écran

export function EcranDonnees() {
  const moi = useMoi();
  const droite = (
    <>
      {moi.unParmi(['core.sauvegarde.lancer', 'core.sauvegarde.restaurer']) && <PanneauSauvegardes />}
      {moi.a('core.lecture.gerer') && <PanneauBase />}
      <Panneau>
        <TitrePanneau titre="Exports" />
        <span>Chaque liste s’exporte en CSV, lisible par Excel, depuis son écran : élèves, impayés, personnel, statistiques, journal d’audit.</span>
      </Panneau>
    </>
  );
  return (
    <Coque module="parametres">
      {moi.a('scolarite.import.executer')
        ? <Colonnes colonnes={[{ flex: 3, min: 600, enfants: <PanneauImport /> }, { flex: 2, min: 360, enfants: droite }]} />
        : <Colonnes colonnes={[{ flex: 1, min: 360, enfants: droite }]} />}
    </Coque>
  );
}
