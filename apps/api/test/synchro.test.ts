// Application hybride (D-49) : deux bases, le poste de l'école (A) et la version en ligne (B), échangent leurs modifications.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { creerBase, lireOuCreerConfig, migrer } from '@gs/db';
import { Bd, creerPool, sql } from '../src/core/bd.ts';
import { construireApp } from '../src/app.ts';
import { cycleSynchro, repondreEchange } from '../src/core/synchro.ts';
import { exigerPostePrincipal } from '../src/core/http/synchro.ts';
import { Client, connecter, preparer } from './aide.ts';

const config = lireOuCreerConfig();
const BASE_A = 'gestion_scolaire_test', BASE_B = 'gestion_scolaire_test_b';
let env: Awaited<ReturnType<typeof preparer>>;
let bdB: Bd;
let appB: Awaited<ReturnType<typeof construireApp>>;
let poolB: ReturnType<typeof creerPool>;
// Transport direct (sans HTTP) : la version en ligne répond comme la route /synchro/echange.
const synchroniser = () => cycleSynchro(config.pg, BASE_A, 'jeton-essai', (e) => repondreEchange(config.pg, BASE_B, e));

beforeAll(async () => {
  env = await preparer();
  await creerBase(config.pg, BASE_B, true);
  await migrer(config.pg, BASE_B);
  poolB = creerPool(config.pg, BASE_B);
  bdB = new Bd(poolB);
  appB = await construireApp({ bd: bdB, dossierWeb: '/inexistant', journal: false });
  await appB.ready();
});
afterAll(async () => { await appB?.close(); await poolB?.end(); await env?.fermer(); });

describe('Synchronisation entre le poste de l’école et la version en ligne (D-49)', () => {
  it('première synchronisation : la version en ligne reçoit l’établissement et les comptes', async () => {
    const r = await synchroniser();
    expect(r.envoyes).toBeGreaterThan(10);
    const comptes = await bdB.lire<{ identifiant: string }>(sql`SELECT identifiant FROM core.compte ORDER BY identifiant`);
    expect(comptes.map((c) => c.identifiant)).toEqual(['directeur', 'secretaire']);
    // Le même mot de passe ouvre la version en ligne.
    await connecter(appB, 'secretaire', 'secret-demo-1');
  });

  it('une modification faite en ligne revient au poste, et inversement', async () => {
    const secB = await connecter(appB, 'secretaire', 'secret-demo-1');
    const f = await secB.post<{ id: string }>('/personnel', { nomAffiche: 'Mme BELLA Joséphine', fonction: 'autre', statut: 'permanent' });
    expect(f.status).toBe(200);
    const secA = await connecter(env.app, 'secretaire', 'secret-demo-1');
    const g = await secA.post<{ id: string }>('/personnel', { nomAffiche: 'M. TCHOUA Rodrigue', fonction: 'autre', statut: 'permanent' });
    const r = await synchroniser();
    expect(r.recus).toBeGreaterThan(0);
    const surA = await env.bd.lireUn(sql`SELECT 1 AS ok FROM personnel.fiche WHERE id = ${f.corps.id}`);
    const surB = await bdB.lireUn(sql`SELECT 1 AS ok FROM personnel.fiche WHERE id = ${g.corps.id}`);
    expect(surA).toBeTruthy();
    expect(surB).toBeTruthy();
    // Rien ne repart en boucle : un nouvel échange n'a plus rien à envoyer ni à recevoir.
    expect(await synchroniser()).toMatchObject({ envoyes: 0, recus: 0 });
  });

  it('même ligne modifiée des deux côtés : la plus récente l’emporte, l’autre version est gardée', async () => {
    const fiche = (await env.bd.lireUn<{ id: string }>(sql`SELECT id FROM personnel.fiche WHERE nom_affiche = 'Mme BELLA Joséphine'`))!.id;
    const secA = await connecter(env.app, 'secretaire', 'secret-demo-1');
    const secB = await connecter(appB, 'secretaire', 'secret-demo-1');
    expect((await secA.patch(`/personnel/${fiche}`, { telephone: '600 000 111' })).status).toBe(200);
    await new Promise((ok) => setTimeout(ok, 30));
    expect((await secB.patch(`/personnel/${fiche}`, { telephone: '600 000 222' })).status).toBe(200);
    await synchroniser();
    const tel = async (bd: Bd) => (await bd.lireUn<{ t: string }>(sql`SELECT telephone AS t FROM personnel.fiche WHERE id = ${fiche}`))!.t;
    expect(await tel(env.bd)).toContain('222');
    expect(await tel(bdB)).toContain('222');
    const c = await env.bd.lire<{ issue: string; ecartee: string }>(sql`
      SELECT issue, version_ecartee->>'telephone' AS ecartee FROM sync.conflit WHERE cle->>'id' = ${fiche}`);
    expect(c).toEqual(expect.arrayContaining([expect.objectContaining({ issue: 'distant_garde' })]));
    expect(c.some((x) => (x.ecartee ?? '').includes('111'))).toBe(true);
  });

  it('l’échange exige le jeton ; la version en ligne ne numérote pas', async () => {
    process.env.GS_SYNCHRO_ROLE = 'en_ligne';
    process.env.GS_SYNCHRO_JETON = 'jeton-essai';
    try {
      expect((await new Client(appB).post('/synchro/echange', { jeton: 'mauvais', depuis: 0, changements: [] })).status).toBe(401);
      const ok = await new Client(appB).post('/synchro/echange', { jeton: 'jeton-essai', depuis: 0, changements: [] });
      expect(ok.status).toBe(200);
      expect(() => exigerPostePrincipal()).toThrow(/poste de l’école/);
    } finally {
      delete process.env.GS_SYNCHRO_ROLE;
      delete process.env.GS_SYNCHRO_JETON;
    }
  });
});
