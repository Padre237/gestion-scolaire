// Lot 1 (D-40) : sections préinstallées, année préremplie (classes et programme), nom des classes attribué par l'application.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from '../src/core/bd.ts';
import { connecter, preparer, type Client } from './aide.ts';

let env: Awaited<ReturnType<typeof preparer>>;
let sec: Client;
beforeAll(async () => {
  env = await preparer();
  sec = await connecter(env.app, 'secretaire', 'secret-demo-1');
  for (const sousSysteme of ['francophone', 'anglophone']) for (const ordreEnseignement of ['maternelle', 'primaire']) {
    expect((await sec.post('/structure/cycles', { sousSysteme, ordreEnseignement })).status).toBe(200);
  }
});
afterAll(async () => { await env.fermer(); });

const classes = async (anneeId: string) => (await env.bd.lire<{ nom: string }>(sql`SELECT nom FROM structure.classe WHERE annee_id = ${anneeId} ORDER BY nom`)).map((c) => c.nom);

describe('Configuration de l’établissement (lot 1)', () => {
  let a1 = '';
  it('la première année reçoit une classe par niveau et le programme préinstallé', async () => {
    const r = await sec.post<{ id: string }>('/structure/annees', { libelle: '2026/2027', dateDebut: '2026-09-07', dateFin: '2027-06-25', ouvrir: true });
    expect(r.status).toBe(200);
    a1 = r.corps.id;
    const noms = await classes(a1);
    expect(noms).toHaveLength(17);
    expect(noms).toEqual(expect.arrayContaining(['PS', 'CM2', 'Nursery 1', 'Class 6']));
    const prog = await env.bd.lire<{ code: string; matiere: string; coefficient: number }>(sql`
      SELECT n.code, m.libelle_fr AS matiere, p.coefficient FROM pedagogie.programme_niveau p
        JOIN structure.niveau n ON n.id = p.niveau_id JOIN pedagogie.matiere m ON m.id = p.matiere_id WHERE p.annee_id = ${a1}`);
    expect(prog.filter((p) => p.code === 'CM2').map((p) => p.matiere)).toContain('Mathématiques');
    expect(prog.find((p) => p.code === 'Class 4' && p.matiere === 'Anglais')?.coefficient).toBe(4);
    expect(prog.filter((p) => p.code === 'PS').map((p) => p.matiere)).toContain('Langage');
  });

  it('ajouter une classe : la classe existante devient A, la nouvelle B, puis C ; le nom n’est pas saisi', async () => {
    const niveau = (await env.bd.lireUn<{ id: string }>(sql`SELECT id FROM structure.niveau WHERE code = 'CM2'`))!.id;
    const b = await sec.post<{ nom: string }>('/structure/classes', { niveauId: niveau, effectifMax: 40, anneeId: a1 });
    expect(b.status).toBe(200);
    expect(b.corps.nom).toBe('CM2 B');
    const c = await sec.post<{ nom: string }>('/structure/classes', { niveauId: niveau, effectifMax: 40, anneeId: a1 });
    expect(c.corps.nom).toBe('CM2 C');
    expect((await classes(a1)).filter((n) => n.startsWith('CM2'))).toEqual(['CM2 A', 'CM2 B', 'CM2 C']);
  });

  it('l’année suivante reprend les classes et le programme de la précédente', async () => {
    const r = await sec.post<{ id: string }>('/structure/annees', { libelle: '2027/2028', dateDebut: '2027-09-06', dateFin: '2028-06-30' });
    expect(r.status).toBe(200);
    expect(await classes(r.corps.id)).toEqual(await classes(a1));
    const n = async (a: string) => (await env.bd.lireUn<{ n: number }>(sql`SELECT count(*)::int AS n FROM pedagogie.programme_niveau WHERE annee_id = ${a}`))!.n;
    expect(await n(r.corps.id)).toBe(await n(a1));
  });
});

describe('Tableau de bord personnalisable (D-41)', () => {
  it('cartes par défaut, données d’une carte, enregistrement de six cartes au plus, retour aux cartes par défaut', async () => {
    const d = await sec.get<{ cartes: { indicateur: string }[]; catalogue: { code: string }[]; personnalise: boolean }>('/pilotage/cartes');
    expect(d.status).toBe(200);
    expect(d.corps.personnalise).toBe(false);
    expect(d.corps.catalogue.map((c) => c.code)).toContain('effectifs');
    // Chaque carte ne propose que les indicateurs permis à l'utilisateur.
    expect(d.corps.cartes.every((c) => d.corps.catalogue.some((k) => k.code === c.indicateur))).toBe(true);
    const pts = await sec.get<{ unite: string; points: unknown[] }>('/pilotage/cartes/donnees?indicateur=effectifs&par=classe&section=francophone');
    expect(pts.status).toBe(200);
    expect(pts.corps.unite).toBe('élèves');
    const carte = { id: 'a', indicateur: 'effectifs', par: 'sexe', forme: 'anneau' };
    expect((await sec.put('/pilotage/cartes', { cartes: Array.from({ length: 7 }, (_, i) => ({ ...carte, id: `c${i}` })) })).status).toBe(400);
    expect((await sec.put('/pilotage/cartes', { cartes: [{ ...carte, par: 'mode' }] })).status).toBe(422);
    expect((await sec.put('/pilotage/cartes', { cartes: [carte] })).status).toBe(200);
    const apres = await sec.get<{ cartes: { par: string }[]; personnalise: boolean }>('/pilotage/cartes');
    expect(apres.corps.personnalise).toBe(true);
    expect(apres.corps.cartes).toHaveLength(1);
    expect(apres.corps.cartes[0]!.par).toBe('sexe');
    expect((await sec.delete('/pilotage/cartes')).status).toBe(200);
    expect((await sec.get<{ personnalise: boolean }>('/pilotage/cartes')).corps.personnalise).toBe(false);
  });
});

describe('Cartes du tableau de bord : toutes les combinaisons répondent', () => {
  it('chaque indicateur, chaque regroupement permis (compte du directeur : tous les indicateurs)', async () => {
    const roles = (await sec.get<{ id: string; code: string }[]>('/core/roles')).corps;
    const dir = roles.find((r) => r.code === 'directeur')!;
    expect((await sec.post('/core/comptes', { identifiant: 'dir.test', nomAffiche: 'Directeur test', roles: [{ roleId: dir.id }], motDePasse: 'mdp-directeur-1' })).status).toBe(200);
    const directeur = await connecter(env.app, 'dir.test', 'mdp-directeur-1');
    const d = await directeur.get<{ catalogue: { code: string; par: { code: string }[] }[] }>('/pilotage/cartes');
    expect(d.corps.catalogue).toHaveLength(6);
    for (const i of d.corps.catalogue) for (const p of i.par) {
      const r = await directeur.get(`/pilotage/cartes/donnees?indicateur=${i.code}&par=${p.code}&duree=30j`);
      expect([i.code, p.code, r.status]).toEqual([i.code, p.code, 200]);
    }
  });
});
