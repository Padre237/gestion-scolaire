// Lot 1 (D-40) : sections préinstallées, année préremplie (classes et programme), nom des classes attribué par l'application.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
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
    const adm = await connecter(env.app, 'directeur', 'secret-dir-1');
    const roles = (await adm.get<{ id: string; code: string }[]>('/core/roles')).corps;
    const dir = roles.find((r) => r.code === 'directeur')!;
    expect((await adm.post('/core/comptes', { identifiant: 'dir.test', nomAffiche: 'Directeur test', roles: [{ roleId: dir.id }], motDePasse: 'mdp-directeur-1' })).status).toBe(200);
    const directeur = await connecter(env.app, 'dir.test', 'mdp-directeur-1');
    const d = await directeur.get<{ catalogue: { code: string; par: { code: string }[] }[] }>('/pilotage/cartes');
    expect(d.corps.catalogue).toHaveLength(6);
    for (const i of d.corps.catalogue) for (const p of i.par) {
      const r = await directeur.get(`/pilotage/cartes/donnees?indicateur=${i.code}&par=${p.code}&duree=30j`);
      expect([i.code, p.code, r.status]).toEqual([i.code, p.code, 200]);
    }
  });
});

describe('Modèles d’impression (D-44)', () => {
  it('choix du modèle par document, adresse de vérification, aperçu des neuf modèles', async () => {
    const g = await sec.get('/structure/gabarits');
    expect(g.corps).toMatchObject({ fiche: 'classique', carte: 'classique', bulletin: 'classique' });
    expect((await sec.put('/structure/gabarits', { fiche: 'epure', carte: 'bandeau', bulletin: 'bandeau', adresseVerification: 'ecole' })).status).toBe(400);
    expect((await sec.put('/structure/gabarits', { fiche: 'epure', carte: 'bandeau', bulletin: 'bandeau', adresseVerification: 'https://ecole.example.cm' })).status).toBe(200);
    expect((await sec.get('/structure/gabarits')).corps).toMatchObject({ fiche: 'epure', carte: 'bandeau', adresseVerification: 'https://ecole.example.cm' });
    for (const document of ['fiche', 'carte', 'bulletin']) for (const gabarit of ['classique', 'bandeau', 'epure']) {
      const r = await sec.get(`/structure/gabarits/apercu?document=${document}&gabarit=${gabarit}`);
      expect([document, gabarit, r.status, r.brut.subarray(0, 4).toString()]).toEqual([document, gabarit, 200, '%PDF']);
    }
  });
});

describe('Utilisateurs et rôles : le directeur seul, droits sur mesure, périodes (D-46)', () => {
  it('rôle créé de zéro, attribution limitée dans le temps, permission particulière ; les périodes s’appliquent', async () => {
    const adm = await connecter(env.app, 'directeur', 'secret-dir-1');
    const roles = (await adm.get<{ id: string; code: string }[]>('/core/roles')).corps;
    const secretaire = roles.find((r) => r.code === 'secretaire')!.id;
    // Rôle sur mesure : une seule action, sans limite.
    const r = await adm.post<{ id: string }>('/core/roles', { libelle: 'Lecture des élèves', permissions: ['scolarite.eleve.consulter'] });
    expect(r.status).toBe(200);
    const auj = new Date(Date.now() + 3600_000).toISOString().slice(0, 10);
    const hier = new Date(Date.now() + 3600_000 - 86400_000).toISOString().slice(0, 10);
    // Compte avec le rôle sur mesure, et le rôle Secrétaire échu depuis hier : seul le rôle sur mesure compte.
    const c = await adm.post<{ id: string }>('/core/comptes', { identifiant: 'stagiaire', nomAffiche: 'Stagiaire', motDePasse: 'mdp-stagiaire',
      roles: [{ roleId: r.corps.id }, { roleId: secretaire, du: '2026-01-01', au: hier }] });
    expect(c.status).toBe(200);
    const st = await connecter(env.app, 'stagiaire', 'mdp-stagiaire');
    const moi = (await st.get<{ permissions: string[] }>('/auth/moi')).corps;
    expect(moi.permissions).toContain('scolarite.eleve.consulter');
    expect(moi.permissions).not.toContain('structure.etablissement.modifier');
    // Permission particulière jusqu'à aujourd'hui : en vigueur ; puis retirée.
    const p = await adm.post<{ id: string }>(`/core/comptes/${c.corps.id}/permissions`, { permission: 'pilotage.tableau.consulter', au: auj, motif: 'Remplacement' });
    expect(p.status).toBe(200);
    const st2 = await connecter(env.app, 'stagiaire', 'mdp-stagiaire');
    expect((await st2.get<{ permissions: string[] }>('/auth/moi')).corps.permissions).toContain('pilotage.tableau.consulter');
    expect((await adm.delete(`/core/comptes/${c.corps.id}/permissions/${p.corps.id}`)).status).toBe(200);
    // Période incohérente refusée ; la secrétaire ne gère ni comptes ni rôles.
    expect((await adm.post('/core/roles', { libelle: 'Rôle daté', permissions: [], du: '2026-12-01', au: '2026-11-01' })).status).toBe(422);
    expect((await sec.post('/core/roles', { libelle: 'Y', permissions: [] })).status).toBe(403);
    expect((await sec.post(`/core/comptes/${c.corps.id}/permissions`, { permission: 'pilotage.tableau.consulter' })).status).toBe(403);
    // Réinitialisation par la secrétaire : refusée sur un compte du personnel.
    expect((await sec.post(`/core/comptes/${c.corps.id}/reinitialisation`)).status).toBe(403);
  });
});

describe('Assistant relié à un fournisseur (D-48)', () => {
  it('aucune donnée personnelle ne part ; file sans fournisseur ; clé jamais renvoyée ni journalisée', async () => {
    // Faux fournisseur compatible OpenRouter : il garde ce qu'il reçoit.
    const recues: string[] = [];
    const serveur = createServer((req, res) => {
      let corps = '';
      req.on('data', (d) => { corps += d; });
      req.on('end', () => {
        recues.push(`${req.headers.authorization}\n${corps}`);
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ choices: [{ message: { content: 'Réponse de l’assistant.' } }], usage: { total_tokens: 42 } }));
      });
    });
    await new Promise<void>((ok) => serveur.listen(0, '127.0.0.1', ok));
    const port = (serveur.address() as AddressInfo).port;
    try {
      const adm = await connecter(env.app, 'directeur', 'secret-dir-1');
      expect((await sec.post('/personnel', { nomAffiche: 'M. KAMDEM Arnaud', fonction: 'autre', statut: 'permanent' })).status).toBe(200);
      // Sans fournisseur : la question reste en file.
      const q0 = await adm.post<{ statut: string }>('/assistant/questions', { question: 'Combien d’élèves sont inscrits cette année ?' });
      expect(q0.corps.statut).toBe('en_file');
      // Réglage : directeur seul ; la clé ne revient pas à l'écran.
      const reglage = { adresse: `http://127.0.0.1:${port}`, modele: 'modele-essai', cle: 'cle-secrete-1234', actif: true };
      expect((await sec.put('/assistant/reglage', reglage)).status).toBe(403);
      expect((await adm.put('/assistant/reglage', reglage)).status).toBe(200);
      const lu = (await adm.get('/assistant/reglage')).corps;
      expect(lu).toMatchObject({ actif: true, cleEnregistree: true, finCle: '1234' });
      expect(JSON.stringify(lu)).not.toContain('cle-secrete');
      // Question avec un nom, un téléphone et une adresse : tout est retiré avant l'envoi.
      const q1 = await adm.post<{ statut: string; remplacements: number }>('/assistant/questions',
        { question: 'Quel est le reste dû de KAMDEM ? Il a appelé du 677 12 34 56, écrire à kamdem@exemple.cm' });
      expect(q1.corps.statut).toBe('proposee');
      expect(q1.corps.remplacements).toBeGreaterThanOrEqual(3);
      const envoye = recues.at(-1)!;
      expect(envoye).toContain('Bearer cle-secrete-1234');
      expect(envoye).toContain('Totaux');
      for (const interdit of ['KAMDEM', 'Kamdem', '677 12', '6771234', 'exemple.cm']) expect(envoye).not.toContain(interdit);
      // La file repart : la première question reçoit sa réponse.
      const f = await adm.post<{ traitees: number }>('/assistant/file');
      expect(f.corps.traitees).toBe(1);
      const etat = (await adm.get<{ fournisseur: string; questions: { statut: string; reponse: { texte: string } | null }[] }>('/assistant')).corps;
      expect(etat.fournisseur).toBe('actif');
      expect(etat.questions.every((q) => q.statut === 'proposee' && q.reponse?.texte === 'Réponse de l’assistant.')).toBe(true);
      // La clé n'est écrite dans aucune ligne du journal d'audit.
      const fuites = await env.bd.lire(sql`SELECT 1 FROM core.journal_audit
        WHERE coalesce(avant::text, '') || coalesce(apres::text, '') || coalesce(avant_libelle, '') || coalesce(apres_libelle, '') LIKE '%cle-secrete%'`);
      expect(fuites).toHaveLength(0);
    } finally {
      serveur.close();
    }
  });
});
