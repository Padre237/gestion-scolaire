// Configuration stricte des rôles (D-52) : séparation des tâches refusée par le serveur, directeur compris ;
// personne ne modifie ses propres droits ; attribution particulière toujours datée ; actes réservés au directeur.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { incompatibilite, ROLES_SYSTEME } from '@gs/shared';
import { connecter, preparer, type Client } from './aide.ts';

let env: Awaited<ReturnType<typeof preparer>>;
let adm: Client;
let sec: Client;
let roles: { id: string; code: string; permissions: string[] }[];
const role = (code: string) => roles.find((r) => r.code === code)!;
const dans = (jours: number) => new Date(Date.now() + 3600_000 + jours * 86400_000).toISOString().slice(0, 10);

beforeAll(async () => {
  env = await preparer();
  adm = await connecter(env.app, 'directeur', 'secret-dir-1');
  sec = await connecter(env.app, 'secretaire', 'secret-demo-1');
  roles = (await adm.get<typeof roles>('/core/roles')).corps;
});
afterAll(async () => { await env.fermer(); });

describe('Rôles prêts à l’emploi : configuration stricte (D-52)', () => {
  it('aucun rôle par défaut ne réunit deux permissions incompatibles ; la base reprend exactement la liste', () => {
    for (const r of ROLES_SYSTEME) {
      expect(incompatibilite(r.permissions)).toBeNull();
      expect([...role(r.code).permissions].sort()).toEqual([...new Set(r.permissions)].sort());
    }
  });

  it('le directeur ne saisit rien ; la justification des absences revient au seul préfet ; les instituteurs ne sanctionnent pas', () => {
    const dir = role('directeur').permissions;
    for (const p of ['finances.versement.encaisser', 'scolarite.inscription.creer', 'pedagogie.note.saisir', 'vie_scolaire.absence.justifier']) expect(dir).not.toContain(p);
    for (const p of ['finances.annulation.valider', 'finances.grille.modifier', 'pedagogie.periode.deverrouiller', 'structure.annee.cloturer', 'core.sauvegarde.restaurer']) expect(dir).toContain(p);
    const justifient = roles.filter((r) => r.permissions.includes('vie_scolaire.absence.justifier')).map((r) => r.code);
    expect(justifient).toEqual(['prefet']);
    expect(role('instituteur_principal').permissions).not.toContain('vie_scolaire.sanction.decider');
    expect(role('econome').permissions).not.toContain('finances.annulation.valider');
  });

  it('actes réservés au directeur : la secrétaire reçoit 403', async () => {
    expect((await sec.put('/structure/etablissement', { nomFr: 'X', nomEn: 'X' })).status).toBe(403);
    expect((await sec.post('/scolarite/cloture', { passages: [] })).status).toBe(403);
    expect((await sec.get('/core/journal')).status).toBe(403);
  });
});

describe('Séparation des tâches et droits sur soi-même (D-52)', () => {
  it('un rôle ne réunit jamais deux permissions incompatibles, même celui du directeur', async () => {
    const d = role('directeur');
    const r = await adm.put<{ code: string; title: string }>(`/core/roles/${d.id}/permissions`, { permissions: [...d.permissions, 'finances.versement.encaisser'] });
    expect(r.status).toBe(422);
    expect(r.corps.code).toBe('CORE_INCOMPATIBLE');
    const e = role('econome');
    expect((await adm.put(`/core/roles/${e.id}/permissions`, { permissions: [...e.permissions, 'finances.annulation.valider'] })).status).toBe(422);
    expect((await adm.post('/core/roles', { libelle: 'Caisse et contrôle', permissions: ['caisse.sortie.demander', 'caisse.sortie.valider'] })).status).toBe(422);
    // Une permission de l'espace parent ne va pas à un rôle du personnel.
    expect((await adm.put(`/core/roles/${e.id}/permissions`, { permissions: [...e.permissions, 'portail.famille.consulter'] })).status).toBe(422);
  });

  it('un compte ne cumule pas, par ses rôles ou une attribution particulière, deux permissions incompatibles', async () => {
    const c = await adm.post<{ id: string }>('/core/comptes', { identifiant: 'caissier', nomAffiche: 'M. BIYA Caissier', motDePasse: 'mdp-caissier', roles: [{ roleId: role('econome').id }] });
    expect(c.status).toBe(200);
    // Attribution particulière qui ferait valider ses propres annulations : refusée.
    expect((await adm.post(`/core/comptes/${c.corps.id}/permissions`, { permission: 'finances.annulation.valider', au: dans(30) })).status).toBe(422);
    // Rôles cumulés Économe + Directeur : refusés.
    expect((await adm.patch(`/core/comptes/${c.corps.id}`, { roles: [{ roleId: role('econome').id }, { roleId: role('directeur').id }] })).status).toBe(422);
    // Un rôle qui deviendrait incompatible avec les autres rôles d'un compte qui le porte : refusé.
    const lecture = await adm.post<{ id: string }>('/core/roles', { libelle: 'Contrôle', permissions: ['scolarite.eleve.consulter'] });
    expect((await adm.patch(`/core/comptes/${c.corps.id}`, { roles: [{ roleId: role('econome').id }, { roleId: lecture.corps.id }] })).status).toBe(200);
    expect((await adm.put(`/core/roles/${lecture.corps.id}/permissions`, { permissions: ['scolarite.eleve.consulter', 'caisse.sortie.valider'] })).status).toBe(422);
  });

  it('une attribution particulière est toujours datée ; personne ne modifie ses propres droits', async () => {
    const c = await adm.post<{ id: string }>('/core/comptes', { identifiant: 'remplacant', nomAffiche: 'Mme ABENA Remplaçante', motDePasse: 'mdp-remplacant', roles: [{ roleId: role('secretaire').id }] });
    expect((await adm.post(`/core/comptes/${c.corps.id}/permissions`, { permission: 'pilotage.tableau.consulter' })).status).toBe(400);
    expect((await adm.post(`/core/comptes/${c.corps.id}/permissions`, { permission: 'pilotage.tableau.consulter', au: dans(-1) })).status).toBe(422);
    expect((await adm.post(`/core/comptes/${c.corps.id}/permissions`, { permission: 'pilotage.tableau.consulter', au: dans(30) })).status).toBe(200);
    const moi = { compteId: (await adm.get<{ compte: { id: string } }>('/auth/moi')).corps.compte.id };
    expect((await adm.post(`/core/comptes/${moi.compteId}/permissions`, { permission: 'pilotage.tableau.consulter', au: dans(30) })).status).toBe(403);
    expect((await adm.patch(`/core/comptes/${moi.compteId}`, { roles: [{ roleId: role('directeur').id }, { roleId: role('secretaire').id }] })).status).toBe(403);
  });
});
