// Conception § 8 : chaque route déclare elle-même sa permission. Une route d'API sans déclaration est une faille.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { preparer } from './aide.ts';
import { estPermission } from '@gs/shared';

let env: Awaited<ReturnType<typeof preparer>>;
beforeAll(async () => { env = await preparer(); });
afterAll(async () => { await env?.fermer(); });

// Routes accessibles à toute personne connectée, sans permission particulière.
// Le logo de l'établissement figure sur les reçus et documents ; cachet et signature restent soumis à structure.consulter (contrôle dans la route).
const SESSION_SEULE = new Set(['GET /api/v1/auth/moi', 'POST /api/v1/auth/deconnexion', 'GET /api/v1/structure/etablissement/images/:type']);

describe('Déclaration des permissions', () => {
  it('chaque route /api/v1 est publique, de session seule, ou déclare une permission connue', () => {
    const fautives: string[] = [];
    for (const r of env.app.inventaireRoutes) {
      if (!r.url.startsWith('/api/v1') || r.methode === 'HEAD') continue;
      const cle = `${r.methode} ${r.url}`;
      const c = r.config as { public?: boolean; permission?: string; unePermissionParmi?: string[] };
      const perms = [c.permission, ...(c.unePermissionParmi ?? [])].filter(Boolean) as string[];
      if (c.public || SESSION_SEULE.has(cle)) continue;
      if (!perms.length || perms.some((p) => !estPermission(p))) fautives.push(cle);
    }
    expect(fautives).toEqual([]);
  });
  it('les routes publiques se limitent à la connexion', () => {
    const publiques = env.app.inventaireRoutes.filter((r) => (r.config as { public?: boolean }).public && r.methode !== 'HEAD').map((r) => `${r.methode} ${r.url}`).sort();
    // La page « Vérifier » des QR codes imprimés (D-44) est publique : un code aléatoire, des informations réduites.
    // L'échange de synchronisation (D-49) n'a pas de session : il exige le jeton partagé entre le poste de l'école et la version en ligne.
    expect(publiques).toEqual(['GET /api/v1/auth/accueil', 'GET /api/v1/verification/:code', 'POST /api/v1/auth/connexion', 'POST /api/v1/auth/connexion-parent', 'POST /api/v1/synchro/echange']);
  });
});
