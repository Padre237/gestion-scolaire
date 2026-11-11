// pnpm import:csv <fichier.csv> [--essai] [--identifiant x] — importe élèves et responsables depuis un fichier CSV
// (IMPORT.md). Le fichier reste sur le poste : il est lu ici et envoyé à l'API locale, qui applique les mêmes contrôles
// que l'écran Données (dates, téléphones, classes, doublons, matricules). Les lignes rejetées sont écrites dans
// <fichier>.rejets.csv, à côté du fichier d'origine.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, resolve } from 'node:path';
import { lireOuCreerConfig } from '@gs/db';
import { Bd, creerPool } from '@gs/api/src/core/bd.ts';
import { construireApp } from '@gs/api/src/app.ts';
import { connecter } from './client.ts';
import { argument, demander, drapeau, sortir } from './commun.ts';

/** Colonnes reconnues : intitulés français et anglais usuels (maquette Données, « Colonnes reconnues »). */
const COLONNES: Record<string, string[]> = {
  matricule: ['matricule', 'mat', 'numero matricule', 'registration number', 'student id', 'id'],
  nom: ['nom', 'nom de famille', 'last name', 'surname', 'family name', 'names', 'name', 'nom et prenoms', 'nom prenoms', 'eleve', 'student', 'pupil'],
  prenoms: ['prenoms', 'prenom', 'first name', 'first names', 'given names', 'other names'],
  sexe: ['sexe', 'genre', 'sex', 'gender', 's'],
  dateNaissance: ['date de naissance', 'ne le', 'nee le', 'ne(e) le', 'naissance', 'date naissance', 'dob', 'date of birth', 'birth date', 'birthdate'],
  lieuNaissance: ['lieu de naissance', 'lieu', 'ne a', 'place of birth', 'birth place', 'pob'],
  classe: ['classe', 'class', 'niveau', 'level', 'cours'],
  type: ['type', 'type d inscription', 'statut', 'status', 'admission'],
  responsable: ['responsable', 'parent', 'nom du responsable', 'nom du parent', 'parent name', 'guardian', 'tuteur', 'pere ou mere', 'responsable 1', 'parent 1'],
  lien: ['lien', 'lien de parente', 'relation', 'relationship', 'qualite', 'lien 1'],
  telephone: ['telephone', 'tel', 'tel parent', 'telephone du responsable', 'telephone parent', 'parent phone', 'phone', 'mobile', 'contact', 'telephone 1', 'phone 1'],
  langue: ['langue', 'language', 'langue des sms', 'sms language'],
  responsable2: ['responsable 2', 'second responsable', 'parent 2', 'autre parent', 'second parent'],
  lien2: ['lien 2', 'relation 2'],
  telephone2: ['telephone 2', 'tel 2', 'phone 2', 'second phone', 'autre telephone'],
};

const normal = (x: string) => x.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** Lecture CSV : séparateur « ; », « , » ou tabulation détecté sur l'en-tête, guillemets doublés, BOM, fins de ligne Windows. */
export function lireCsv(texte: string): string[][] {
  const t = texte.replace(/^﻿/, '');
  const entete = t.slice(0, t.search(/\r?\n/) >>> 0 || t.length);
  const sep = [';', '\t', ','].map((s) => [s, entete.split(s).length] as const).sort((a, b) => b[1] - a[1])[0]![0];
  const lignes: string[][] = [];
  let champ = '', ligne: string[] = [], guillemets = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i]!;
    if (guillemets) {
      if (c === '"' && t[i + 1] === '"') { champ += '"'; i++; } else if (c === '"') guillemets = false; else champ += c;
    } else if (c === '"' && champ === '') guillemets = true;
    else if (c === sep) { ligne.push(champ); champ = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && t[i + 1] === '\n') i++;
      ligne.push(champ); champ = '';
      lignes.push(ligne); ligne = [];
    } else champ += c;
  }
  if (champ !== '' || ligne.length) { ligne.push(champ); lignes.push(ligne); }
  return lignes;
}

export function reconnaitre(entete: string[]): { carte: Record<string, number>; inconnues: string[] } {
  const carte: Record<string, number> = {};
  const inconnues: string[] = [];
  entete.forEach((h, i) => {
    const n = normal(h);
    const champ = Object.entries(COLONNES).find(([k, syn]) => carte[k] === undefined && syn.includes(n))?.[0];
    if (champ) carte[champ] = i; else if (n) inconnues.push(h);
  });
  return { carte, inconnues };
}

const csvChamp = (x: string | number) => { const s = String(x); return /[;"\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s; };

async function main() {
  const fichier = process.argv.slice(2).find((a) => !a.startsWith('--') && process.argv[process.argv.indexOf(a) - 1] !== '--identifiant');
  if (!fichier) sortir('Usage : pnpm import:csv <fichier.csv> [--essai] [--identifiant secretaire]\nVoir IMPORT.md.');
  const chemin = resolve(process.env.INIT_CWD ?? process.cwd(), fichier);
  if (!existsSync(chemin)) sortir(`Fichier introuvable : ${chemin}`);
  if (/\.xlsx?$/i.test(chemin)) sortir('Enregistrez d’abord le classeur au format CSV (Fichier › Enregistrer sous › CSV UTF-8), ou importez-le depuis l’écran Paramètres › Données.');
  const essai = drapeau('essai');
  const tableau = lireCsv(readFileSync(chemin, 'utf8')).filter((l) => l.some((c) => c.trim() !== ''));
  if (tableau.length < 2) sortir('Le fichier ne contient aucune ligne après l’en-tête.');
  const { carte, inconnues } = reconnaitre(tableau[0]!);
  const manquantes = ['nom', 'dateNaissance', 'classe', 'telephone'].filter((c) => carte[c] === undefined);
  console.log(`Fichier : ${basename(chemin)} · ${tableau.length - 1} lignes`);
  console.log('Colonnes reconnues : ' + Object.entries(carte).map(([k, i]) => `« ${tableau[0]![i]!.trim()} » → ${k}`).join(' · '));
  if (inconnues.length) console.log(`Colonnes ignorées : ${inconnues.map((x) => `« ${x.trim()} »`).join(', ')}`);
  if (manquantes.length) sortir(`Colonnes obligatoires absentes : ${manquantes.join(', ')}. Renommez l’en-tête (voir IMPORT.md).`);

  const val = (l: string[], k: string) => (carte[k] === undefined ? '' : (l[carte[k]!] ?? '').trim());
  const lignes = tableau.slice(1).map((l, i) => ({
    ligne: i + 2, matricule: val(l, 'matricule') || null, nom: val(l, 'nom'), prenoms: val(l, 'prenoms'), sexe: val(l, 'sexe'),
    dateNaissance: val(l, 'dateNaissance'), lieuNaissance: val(l, 'lieuNaissance') || null, classe: val(l, 'classe'), type: val(l, 'type') || null,
    responsable: val(l, 'responsable'), lien: val(l, 'lien') || null, telephone: val(l, 'telephone'), langue: val(l, 'langue') || null,
    responsable2: val(l, 'responsable2') || null, lien2: val(l, 'lien2') || null, telephone2: val(l, 'telephone2') || null,
  }));
  if (lignes.length > 3000) sortir('Plus de 3 000 lignes : découpez le fichier par section ou par classe.');

  const identifiant = argument('identifiant') ?? await demander('Identifiant (compte autorisé à importer)', 'secretaire');
  const motDePasse = process.env.GS_MOT_DE_PASSE ?? await demander('Mot de passe', undefined, true);
  const config = lireOuCreerConfig();
  const pool = creerPool(config.pg);
  const app = await construireApp({ bd: new Bd(pool), dossierWeb: '/inexistant', journal: false });
  await app.ready();
  try {
    const client = await connecter(app, identifiant, motDePasse).catch(() => sortir('Identifiant ou mot de passe incorrect.'));
    let r: { lues: number; valides: number; importes: number; erreurs: { ligne: number; champ: string; valeur: string; probleme: string }[] };
    try {
      r = await client.post('/scolarite/import', { essai, lignes });
    } catch (e) {
      const m = String((e as Error).message);
      sortir(m.includes('403') ? `Le compte « ${identifiant} » n’a pas le droit d’importer des élèves.` : m.replace(/^.*?→ /, 'Import refusé : '));
    }
    console.log(`\nLignes lues : ${r.lues} · valides : ${r.valides} · en erreur : ${r.erreurs.length}`);
    if (essai) console.log('Essai : rien n’a été enregistré. Relancez sans --essai pour importer les lignes valides.');
    else console.log(`Lignes importées : ${r.importes}`);
    if (r.erreurs.length) {
      for (const e of r.erreurs.slice(0, 20)) console.log(`  ligne ${String(e.ligne).padStart(4)} · ${e.champ} « ${e.valeur} » : ${e.probleme}`);
      if (r.erreurs.length > 20) console.log(`  … et ${r.erreurs.length - 20} autres`);
      const rapport = resolve(dirname(chemin), `${basename(chemin, extname(chemin))}.rejets.csv`);
      writeFileSync(rapport, '﻿' + ['Ligne;Champ;Valeur;Problème', ...r.erreurs.map((e) => [e.ligne, e.champ, e.valeur, e.probleme].map(csvChamp).join(';'))].join('\r\n') + '\r\n');
      console.log(`Rapport des lignes rejetées : ${rapport}`);
    }
  } finally {
    await app.close();
    await pool.end();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) await main();
