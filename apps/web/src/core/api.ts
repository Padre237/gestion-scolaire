// Client de l'API : JSON sur /api/v1, même origine, session portée par le cookie httpOnly posé à la connexion.
export class ErreurApi extends Error {
  constructor(readonly statut: number, readonly code: string, message: string, readonly champ?: string) { super(message); }
}

let surNonAuthentifie: (() => void) | null = null;
export const quandNonAuthentifie = (f: () => void) => { surNonAuthentifie = f; };

export const url = (chemin: string) => `/api/v1${chemin}`;

// Horodatages au format texte de PostgreSQL (« 2026-11-11 05:59:00.011762+00 ») : réécrits en ISO 8601 strict,
// que Safari et Firefox lisent aussi (millisecondes, décalage « +00:00 »).
const HORODATAGE = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)(?:\.(\d+))?(Z|[+-]\d{2}(?::?\d{2})?)$/;
function versIso(_cle: string, v: unknown) {
  if (typeof v !== 'string' || v.length < 16 || v.length > 40) return v;
  const m = HORODATAGE.exec(v);
  if (!m) return v;
  const secondes = m[2]!.length === 5 ? `${m[2]}:00` : m[2]!;
  const ms = (m[3] ?? '').padEnd(3, '0').slice(0, 3);
  const z = m[4] === 'Z' ? 'Z' : m[4]!.length === 3 ? `${m[4]}:00` : m[4]!.includes(':') ? m[4]! : `${m[4]!.slice(0, 3)}:${m[4]!.slice(3)}`;
  return `${m[1]}T${secondes}.${ms}${z}`;
}

/** Paramètres de requête, sans les valeurs vides. */
export function requete(p: Record<string, unknown>): string {
  const q = Object.entries(p).filter(([, v]) => v !== null && v !== undefined && `${v}` !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  return q.length ? `?${q.join('&')}` : '';
}

async function envoyer<T>(methode: string, chemin: string, corps?: unknown, entetes: Record<string, string> = {}): Promise<T> {
  let r: Response;
  try {
    r = await fetch(url(chemin), { method: methode, credentials: 'same-origin',
      headers: { accept: 'application/json', ...(corps !== undefined ? { 'content-type': 'application/json' } : {}), ...entetes },
      body: corps !== undefined ? JSON.stringify(corps) : undefined });
  } catch {
    throw new ErreurApi(0, 'RESEAU', 'Serveur injoignable : vérifiez le réseau de l’école.');
  }
  const type = r.headers.get('content-type') ?? '';
  const texte = await r.text();
  const json = texte && type.includes('json') ? JSON.parse(texte, versIso) : texte;
  if (r.ok) return json as T;
  if (r.status === 401 && !chemin.startsWith('/auth/connexion')) surNonAuthentifie?.();
  if (json && typeof json === 'object') throw new ErreurApi(r.status, String(json.code ?? 'ERREUR'), String(json.detail ?? json.message ?? 'Erreur'), json.champ);
  throw new ErreurApi(r.status, 'ERREUR', `Erreur ${r.status}`);
}

export const api = {
  get: <T = any>(chemin: string) => envoyer<T>('GET', chemin),
  post: <T = any>(chemin: string, corps: unknown = {}, entetes?: Record<string, string>) => envoyer<T>('POST', chemin, corps, entetes),
  put: <T = any>(chemin: string, corps: unknown) => envoyer<T>('PUT', chemin, corps),
  patch: <T = any>(chemin: string, corps: unknown) => envoyer<T>('PATCH', chemin, corps),
  del: <T = any>(chemin: string) => envoyer<T>('DELETE', chemin),
};
