// Mots de passe : scrypt du module crypto de Node.js (ADR-05).
// Format stocké : scrypt$N$r$p$sel$empreinte (base64), pour durcir plus tard sans réinitialiser.
import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';

const N_DEFAUT = 2 ** 17;
const R = 8;
const P = 1;
const LONGUEUR = 64;

// Les tests abaissent N (variable GS_SCRYPT_N) pour rester rapides ; jamais en production.
const nCourant = () => Number(process.env.GS_SCRYPT_N ?? N_DEFAUT);

function scrypt(motDePasse: string, sel: Buffer, n: number, r: number, p: number): Promise<Buffer> {
  return new Promise((ok, ko) =>
    scryptCb(motDePasse.normalize('NFC'), sel, LONGUEUR, { N: n, r, p, maxmem: 256 * n * r + 1024 * 1024 },
      (err, cle) => (err ? ko(err) : ok(cle))));
}

export async function hacher(motDePasse: string): Promise<string> {
  const sel = randomBytes(16);
  const n = nCourant();
  const cle = await scrypt(motDePasse, sel, n, R, P);
  return ['scrypt', n, R, P, sel.toString('base64'), cle.toString('base64')].join('$');
}

export async function verifier(motDePasse: string, stocke: string): Promise<boolean> {
  const [algo, n, r, p, sel, empreinte] = stocke.split('$');
  if (algo !== 'scrypt' || !n || !r || !p || !sel || !empreinte) return false;
  const attendu = Buffer.from(empreinte, 'base64');
  const cle = await scrypt(motDePasse, Buffer.from(sel, 'base64'), Number(n), Number(r), Number(p));
  return cle.length === attendu.length && timingSafeEqual(cle, attendu);
}

// Mot de passe lisible pour une fiche imprimée (sans 0/O ni 1/l).
export function motDePasseAleatoire(longueur = 8): string {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  const octets = randomBytes(longueur);
  return Array.from(octets, (o) => alphabet[o % alphabet.length]).join('');
}
