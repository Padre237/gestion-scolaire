// Client interne des commandes de démonstration : les données passent par l'API et ses règles, comme à l'écran.
import type { construireApp } from '@gs/api/src/app.ts';

type FastifyInstance = Awaited<ReturnType<typeof construireApp>>;

export class Client {
  constructor(private app: FastifyInstance, readonly jeton: string, readonly nom: string) {}

  async appel<T = any>(method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, payload?: unknown, headers: Record<string, string> = {}): Promise<T> {
    const r = await this.app.inject({ method, url: `/api/v1${url}`, payload: payload as object,
      headers: { authorization: `Bearer ${this.jeton}`, ...headers } });
    const type = String(r.headers['content-type'] ?? '');
    const corps = type.includes('json') ? r.json() : r.body;
    if (r.statusCode >= 300) throw new Error(`${this.nom} · ${method} ${url} → ${r.statusCode} ${typeof corps === 'string' ? corps.slice(0, 200) : JSON.stringify(corps)}`);
    return corps as T;
  }

  get<T = any>(url: string) { return this.appel<T>('GET', url); }
  post<T = any>(url: string, corps: unknown = {}, headers?: Record<string, string>) { return this.appel<T>('POST', url, corps, headers); }
  put<T = any>(url: string, corps: unknown = {}) { return this.appel<T>('PUT', url, corps); }
  patch<T = any>(url: string, corps: unknown = {}) { return this.appel<T>('PATCH', url, corps); }
}

export async function connecter(app: FastifyInstance, identifiant: string, motDePasse: string): Promise<Client> {
  const r = await app.inject({ method: 'POST', url: '/api/v1/auth/connexion', payload: { identifiant, motDePasse, client: 'application' } });
  if (r.statusCode !== 200) throw new Error(`Connexion de ${identifiant} refusée (${r.statusCode}) : ${r.body}`);
  return new Client(app, r.json().jeton, identifiant);
}
