// Outils des tests d'intégration : base de test vierge, application, clients par rôle.
import type { FastifyInstance } from 'fastify';
import { creerBase, lireOuCreerConfig, migrer } from '@gs/db';
import { Bd, creerPool } from '../src/core/bd.ts';
import { construireApp } from '../src/app.ts';
import { creerEtablissement } from '../src/core/etablissement.ts';

export interface Reponse<T = any> { status: number; corps: T; entetes: Record<string, unknown>; brut: Buffer }

export class Client {
  constructor(private app: FastifyInstance, readonly jeton: string | null = null) {}

  private async envoyer<T>(method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, payload?: unknown, headers: Record<string, string> = {}): Promise<Reponse<T>> {
    const r = await this.app.inject({ method, url: `/api/v1${url}`, payload: payload as object,
      headers: { ...(this.jeton ? { authorization: `Bearer ${this.jeton}` } : {}), ...headers } });
    let corps: unknown = null;
    const type = String(r.headers['content-type'] ?? '');
    if (type.includes('json')) corps = r.json();
    else corps = r.body;
    return { status: r.statusCode, corps: corps as T, entetes: r.headers, brut: r.rawPayload };
  }

  get<T = any>(url: string) { return this.envoyer<T>('GET', url); }
  post<T = any>(url: string, corps: unknown = {}, headers?: Record<string, string>) { return this.envoyer<T>('POST', url, corps, headers); }
  put<T = any>(url: string, corps: unknown = {}) { return this.envoyer<T>('PUT', url, corps); }
  patch<T = any>(url: string, corps: unknown = {}) { return this.envoyer<T>('PATCH', url, corps); }
  delete<T = any>(url: string) { return this.envoyer<T>('DELETE', url); }
}

export async function preparer() {
  const config = lireOuCreerConfig();
  const base = 'gestion_scolaire_test';
  await creerBase(config.pg, base, true);
  await migrer(config.pg, base);
  const pool = creerPool(config.pg, base);
  const bd = new Bd(pool);
  const app = await construireApp({ bd, dossierWeb: '/inexistant', journal: process.env.GS_JOURNAL ? { level: 'error' } as never : false });
  await app.ready();
  const etab = await creerEtablissement(bd, { nomFr: 'École de démonstration', nomEn: 'Demonstration School',
    secretaire: { identifiant: 'secretaire', nomAffiche: 'Secrétaire démo', motDePasse: 'secret-demo-1' } });
  return { app, bd, etab, fermer: async () => { await app.close(); await pool.end(); } };
}

export async function connecter(app: FastifyInstance, identifiant: string, motDePasse: string): Promise<Client> {
  const r = await new Client(app).post<{ jeton: string }>('/auth/connexion', { identifiant, motDePasse, client: 'application' });
  if (r.status !== 200) throw new Error(`Connexion de ${identifiant} : ${r.status} ${JSON.stringify(r.corps)}`);
  return new Client(app, r.corps.jeton);
}

export async function connecterParent(app: FastifyInstance, telephone: string, motDePasse: string): Promise<Client> {
  const r = await new Client(app).post<{ jeton: string }>('/auth/connexion-parent', { telephone, motDePasse, client: 'application' });
  if (r.status !== 200) throw new Error(`Connexion du parent ${telephone} : ${r.status} ${JSON.stringify(r.corps)}`);
  return new Client(app, r.corps.jeton);
}

export const auj = () => new Date(Date.now() + 3600_000).toISOString().slice(0, 10);
export const jourSemaine = () => ((new Date(`${auj()}T12:00:00Z`).getUTCDay() + 6) % 7) + 1;
