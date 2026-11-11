// Documents produits par le serveur (PDF, CSV) et fichiers choisis sur le poste.
import { url } from './api.ts';

/** Ouvre un document (PDF) dans un nouvel onglet ; l'impression part de la boîte de dialogue du navigateur. */
export const ouvrirDocument = (chemin: string) => { window.open(url(chemin), '_blank'); };
export const imprimerDocument = ouvrirDocument;

/** Téléchargement d'un export (CSV) sans quitter l'écran. */
export function telecharger(chemin: string) {
  const a = document.createElement('a');
  a.href = url(chemin);
  a.download = '';
  document.body.append(a);
  a.click();
  a.remove();
}

/** Document produit par une requête POST (fiche d'inscription, avis) : la fenêtre s'ouvre pendant le clic, puis reçoit le PDF. */
export async function ouvrirDocumentPost(chemin: string, corps: unknown): Promise<string | null> {
  const fenetre = window.open('', '_blank');
  try {
    const r = await fetch(url(chemin), { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(corps) });
    if (!r.ok) {
      fenetre?.close();
      try { const j = await r.json(); return String(j.detail ?? j.message ?? `Erreur ${r.status}`); } catch { return `Erreur ${r.status}`; }
    }
    const lien = URL.createObjectURL(await r.blob());
    if (fenetre) fenetre.location.href = lien; else window.open(lien, '_blank');
    return null;
  } catch {
    fenetre?.close();
    return 'Serveur injoignable : vérifiez le réseau de l’école.';
  }
}

/** Ouvre une fenêtre pendant le clic, puis y charge l'adresse obtenue après un appel au serveur (« Valider et imprimer »). */
export async function ouvrirApres(obtenir: () => Promise<string | null>) {
  const fenetre = window.open('', '_blank');
  let cible: string | null = null;
  try { cible = await obtenir(); } finally { if (!cible) fenetre?.close(); }
  if (!cible) return;
  if (fenetre) fenetre.location.href = url(cible); else window.open(url(cible), '_blank');
}

export interface Fichier { nom: string; type: string; octets: Uint8Array; base64: string; texte: string }

export function choisirFichier(accepte: string): Promise<Fichier | null> {
  return new Promise((ok) => {
    const entree = document.createElement('input');
    entree.type = 'file';
    entree.accept = accepte;
    entree.onchange = async () => {
      const f = entree.files?.[0];
      if (!f) return ok(null);
      const octets = new Uint8Array(await f.arrayBuffer());
      let binaire = '';
      for (let i = 0; i < octets.length; i += 0x8000) binaire += String.fromCharCode(...octets.subarray(i, i + 0x8000));
      ok({ nom: f.name, type: f.type, octets, base64: btoa(binaire), texte: new TextDecoder().decode(octets) });
    };
    entree.click();
  });
}
