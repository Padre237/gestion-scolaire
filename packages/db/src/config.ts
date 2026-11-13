// Configuration locale (conception § 8, « Secrets ») : un fichier hors du dépôt,
// var/config.json, créé par demo:vide. Aucun secret dans le code.
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const RACINE = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

export interface ConfigPg {
  hote: string;
  port: number;
  base: string;
  proprietaire: { utilisateur: string; motDePasse: string };
  application: { utilisateur: string; motDePasse: string };
  lecture: { utilisateur: string; motDePasse: string };
}

export interface Config {
  pg: ConfigPg;
  serveur: { port: number; hote: string };
  sms: { fournisseur: 'desactive' };            // ECARTS E-22
  ia: { fournisseur: 'desactive' };             // ECARTS E-37
  sauvegarde: { dossier: string; cle: string; heure: string };
  /**
   * Application hybride (D-49) : « principal » est le poste de l'école, qui envoie et reçoit les modifications
   * à l'adresse de la version en ligne ; « en_ligne » est la version en ligne, qui les reçoit. Même jeton des deux côtés.
   * Absent : instance seule, sans synchronisation.
   */
  synchro?: { role: 'principal' | 'en_ligne'; adresse?: string; jeton: string; intervalleSecondes?: number };
}

export const cheminConfig = (): string => process.env.GS_CONFIG ?? resolve(RACINE, 'var/config.json');

const secret = () => randomBytes(18).toString('base64url');

export function configParDefaut(): Config {
  return {
    pg: {
      hote: '127.0.0.1',
      port: 5442,
      base: 'gestion_scolaire',
      proprietaire: { utilisateur: 'gs_proprietaire', motDePasse: process.env.GS_PG_PROPRIETAIRE_MDP ?? 'gs_proprietaire_local' },
      application: { utilisateur: 'gs_application', motDePasse: secret() },
      lecture: { utilisateur: 'gs_lecture', motDePasse: secret() },
    },
    serveur: { port: 8443, hote: '0.0.0.0' },
    sms: { fournisseur: 'desactive' },
    ia: { fournisseur: 'desactive' },
    sauvegarde: { dossier: resolve(RACINE, 'var/sauvegardes'), cle: secret() + secret(), heure: '18:00' },
  };
}

export function lireConfig(): Config {
  const chemin = cheminConfig();
  if (!existsSync(chemin)) {
    throw new Error(`Configuration absente : ${chemin}. Lancez d'abord « pnpm demo:vide ».`);
  }
  return JSON.parse(readFileSync(chemin, 'utf8')) as Config;
}

export function lireOuCreerConfig(): Config {
  const chemin = cheminConfig();
  if (existsSync(chemin)) return lireConfig();
  const config = configParDefaut();
  mkdirSync(dirname(chemin), { recursive: true });
  writeFileSync(chemin, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 });
  chmodSync(chemin, 0o600);
  return config;
}
