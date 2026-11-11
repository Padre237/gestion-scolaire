// Session et préférences du poste : personne connectée, permissions, mode Jour ou Nuit, langue.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, ErreurApi, quandNonAuthentifie } from './api.ts';

export interface Moi {
  compteId: string; nom: string; identifiant: string; famille: boolean; libelleRoles: string; roles: string[];
  permissions: Set<string>; etablissement: string; etablissementEn: string; anneeId: string | null; annee: string | null;
  a: (p: string) => boolean; unParmi: (ps: string[]) => boolean; role: (c: string) => boolean;
}

function versMoi(j: any): Moi {
  const permissions = new Set<string>(j.permissions as string[]);
  const roles = (j.roles as { code: string }[]).map((r) => r.code);
  return {
    compteId: j.compte.id, nom: j.compte.nomAffiche, identifiant: j.compte.identifiant, famille: j.compte.type === 'famille',
    libelleRoles: j.libelleRoles, roles, permissions, etablissement: j.etablissement.nomFr, etablissementEn: j.etablissement.nomEn,
    anneeId: j.annee?.id ?? null, annee: j.annee?.libelle ?? null,
    a: (p) => permissions.has(p), unParmi: (ps) => ps.some((p) => permissions.has(p)), role: (c) => roles.includes(c),
  };
}

/** Efface les réponses de l'API gardées pour la consultation hors connexion : rien ne reste d'une personne à l'autre sur un poste partagé. */
async function oublierDonnees() {
  try {
    if (!('caches' in window)) return;
    for (const nom of await caches.keys()) {
      const c = await caches.open(nom);
      for (const r of await c.keys()) if (new URL(r.url).pathname.startsWith('/api/')) await c.delete(r);
    }
  } catch { /* cache indisponible */ }
}

const lire = (cle: string) => { try { return localStorage.getItem(cle); } catch { return null; } };
const ecrire = (cle: string, v: string) => { try { localStorage.setItem(cle, v); } catch { /* stockage indisponible */ } };

interface ContexteSession {
  moi: Moi | null; pret: boolean;
  charger: () => Promise<Moi | null>;
  connecter: (identifiant: string, motDePasse: string) => Promise<Moi>;
  connecterParent: (telephone: string, motDePasse: string) => Promise<Moi>;
  deconnecter: () => Promise<void>;
  mode: 'jour' | 'nuit'; basculerMode: () => void;
}

const Ctx = createContext<ContexteSession | null>(null);

export function FournisseurSession({ children }: { children: ReactNode }) {
  const [moi, setMoi] = useState<Moi | null>(null);
  const [pret, setPret] = useState(false);
  const [mode, setMode] = useState<'jour' | 'nuit'>(lire('gs.mode') === 'nuit' ? 'nuit' : 'jour');

  useEffect(() => {
    document.documentElement.dataset['theme'] = mode;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', mode === 'nuit' ? '#101318' : '#F6F8FC');
  }, [mode]);

  const charger = useCallback(async () => {
    try {
      const m = versMoi(await api.get('/auth/moi'));
      setMoi(m);
      return m;
    } catch (e) {
      if (!(e instanceof ErreurApi) || e.statut !== 0) setMoi(null);
      return null;
    } finally {
      setPret(true);
    }
  }, []);

  useEffect(() => { quandNonAuthentifie(() => setMoi(null)); void charger(); }, [charger]);

  const valeur = useMemo<ContexteSession>(() => ({
    moi, pret, charger,
    connecter: async (identifiant, motDePasse) => {
      await oublierDonnees();
      const m = versMoi(await api.post('/auth/connexion', { identifiant, motDePasse, client: 'web' }));
      setMoi(m);
      return m;
    },
    connecterParent: async (telephone, motDePasse) => {
      await oublierDonnees();
      const m = versMoi(await api.post('/auth/connexion-parent', { telephone, motDePasse, client: 'web' }));
      setMoi(m);
      return m;
    },
    deconnecter: async () => { try { await api.post('/auth/deconnexion'); } catch { /* déjà déconnecté */ } await oublierDonnees(); setMoi(null); },
    mode,
    basculerMode: () => setMode((m) => { const n = m === 'jour' ? 'nuit' : 'jour'; ecrire('gs.mode', n); return n; }),
  }), [moi, pret, charger, mode]);

  return <Ctx.Provider value={valeur}>{children}</Ctx.Provider>;
}

export function useSession() {
  const c = useContext(Ctx);
  if (!c) throw new Error('FournisseurSession manquant');
  return c;
}

/** Personne connectée (les écrans protégés ne s'affichent qu'avec une session). */
export function useMoi(): Moi {
  const { moi } = useSession();
  if (!moi) throw new Error('Session requise');
  return moi;
}
