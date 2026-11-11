// Module personnel : fiches, statut, heures de vacation (maquette Personnel).
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { sql, ligne } from '../../../core/bd.ts';
import { introuvable } from '../../../core/erreurs.ts';
import { exiger } from '../../../core/session.ts';
import { journaliser } from '../../../core/audit.ts';
import { perimetreDePersonnel } from '../../../core/perimetre.ts';
import { versCsv } from '../../../core/csv.ts';
import { resumeClasses, type ClasseNiveau } from '../../../core/perimetre-texte.ts';
import type { Bd } from '../../../core/bd.ts';

export const FONCTIONS: Record<string, string> = {
  directeur: 'Directeur', secretaire: 'Secrétaire', econome: 'Économe', prefet: 'Préfet des études',
  instituteur_principal: 'Instituteur principal', instituteur_matiere: 'Instituteur de matière', autre: 'Autre',
};

const Fiche = z.object({
  nomAffiche: z.string().trim().min(2).max(80),
  fonction: z.enum(['directeur', 'secretaire', 'econome', 'prefet', 'instituteur_principal', 'instituteur_matiere', 'autre']),
  statut: z.enum(['permanent', 'vacataire']),
  telephone: z.string().trim().max(30).nullish(),
  diplome: z.string().trim().max(120).nullish(),
  entreeLe: z.iso.date().nullish(),
});

const LECTURE = ['personnel.fiche.consulter', 'personnel.fiche.gerer', 'pedagogie.affectation.gerer', 'core.compte.gerer'];

/** « CM2 A · toutes matières sauf anglais et EPS », « EPS · du CE1 au CM2 ». */
export async function classesEtMatieres(bd: Bd, etab: string, personnelId: string, toutes: (ClasseNiveau & { id: string; anglophone: boolean })[]): Promise<string> {
  const p = await perimetreDePersonnel(bd, etab, personnelId);
  const parties: string[] = [];
  for (const c of p.classesPrincipal) {
    const k = toutes.find((x) => x.id === c.id);
    const exc = c.exceptions ?? [];
    if (k?.anglophone) parties.push(`${c.nom} · all subjects${exc.length ? ` except ${listeEn(exc.map((e) => e.en))}` : ''}`);
    else parties.push(`${c.nom} · toutes matières${exc.length ? ` sauf ${listeFr(exc.map((e) => e.fr))}` : ''}`);
  }
  const parMatiere = new Map<string, (ClasseNiveau & { id: string })[]>();
  for (const m of p.matieres) {
    const k = toutes.find((x) => x.id === m.classeId);
    if (k) parMatiere.set(m.matiereLibelle, [...(parMatiere.get(m.matiereLibelle) ?? []), k]);
  }
  for (const [m, ks] of parMatiere) parties.push(`${m} · ${resumeClasses(ks, toutes)}`);
  return parties.join(' ; ') || '–';
}

const listeFr = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} et ${xs[xs.length - 1]}` : xs[0] ?? '');
const listeEn = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}` : xs[0] ?? '');

export async function classesAnnee(bd: Bd, etab: string) {
  return bd.lire<ClasseNiveau & { id: string; anglophone: boolean }>(sql`
    SELECT c.id, c.nom, n.rang AS "niveauRang", n.code AS "niveauCode", cy.sous_systeme = 'anglophone' AS anglophone
      FROM structure.classe c JOIN structure.niveau n ON n.id = c.niveau_id JOIN structure.cycle cy ON cy.id = n.cycle_id
      JOIN structure.annee_scolaire a ON a.id = c.annee_id AND a.statut = 'ouverte'
     WHERE c.etablissement_id = ${etab}`);
}

export async function routesPersonnel(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  const Filtre = z.object({
    q: z.string().trim().max(60).optional(), fonction: z.string().max(40).optional(), statut: z.enum(['permanent', 'vacataire']).optional(),
    page: z.coerce.number().int().min(1).default(1), taille: z.coerce.number().int().min(1).max(500).default(10),
  });

  const requete = (etab: string, f: z.infer<typeof Filtre>) => sql`
      FROM personnel.fiche p LEFT JOIN core.compte c ON c.personnel_id = p.id AND c.actif
     WHERE p.etablissement_id = ${etab} AND p.actif
       AND (${f.q ?? null}::text IS NULL OR core.sans_accent(p.nom_affiche) LIKE '%' || core.sans_accent(${f.q ?? ''}) || '%'
            OR regexp_replace(COALESCE(p.telephone, ''), '\\D', '', 'g') LIKE '%' || regexp_replace(${f.q ?? ''}, '\\D', '', 'g') || '%' AND length(regexp_replace(${f.q ?? ''}, '\\D', '', 'g')) > 2)
       AND (${f.fonction ?? null}::text IS NULL OR p.fonction = ${f.fonction ?? null})
       AND (${f.statut ?? null}::text IS NULL OR p.statut = ${f.statut ?? null})`;

  r.get('/personnel', { config: { unePermissionParmi: LECTURE }, schema: { tags: ['personnel'], querystring: Filtre } }, async (req) => {
    const ctx = exiger(req);
    const f = req.query;
    const total = await app.bd.lireUn<{ n: number }>(sql`SELECT count(*)::int AS n ${requete(ctx.etablissementId, f)}`);
    const rows = await app.bd.lire<{ id: string; nom_affiche: string; fonction: string; statut: string; telephone: string | null; compte: string | null }>(sql`
      SELECT p.id, p.nom_affiche, p.fonction, p.statut, p.telephone, c.identifiant AS compte
      ${requete(ctx.etablissementId, f)}
      ORDER BY array_position(ARRAY['directeur','econome','secretaire','prefet','instituteur_principal','instituteur_matiere','autre'], p.fonction),
               p.cree_le
      LIMIT ${f.taille} OFFSET ${(f.page - 1) * f.taille}`);
    const toutes = await classesAnnee(app.bd, ctx.etablissementId);
    const lignes = [];
    for (const p of rows) {
      lignes.push({ id: p.id, nomAffiche: p.nom_affiche, fonction: p.fonction, fonctionLibelle: FONCTIONS[p.fonction], statut: p.statut,
        classesMatieres: await classesEtMatieres(app.bd, ctx.etablissementId, p.id, toutes), telephone: p.telephone, compte: p.compte });
    }
    return { total: total!.n, page: f.page, taille: f.taille, lignes };
  });

  r.get('/personnel/export', { config: { permission: 'personnel.fiche.consulter' }, schema: { tags: ['personnel'] } }, async (req, rep) => {
    const ctx = exiger(req);
    const rows = await app.bd.lire<Record<string, unknown>>(sql`
      SELECT p.nom_affiche AS "Nom", p.fonction AS "Fonction", p.statut AS "Statut", p.telephone AS "Téléphone",
             COALESCE(c.identifiant, 'Sans compte') AS "Compte"
        FROM personnel.fiche p LEFT JOIN core.compte c ON c.personnel_id = p.id AND c.actif
       WHERE p.etablissement_id = ${ctx.etablissementId} AND p.actif ORDER BY p.cree_le`);
    for (const x of rows) x['Fonction'] = FONCTIONS[x['Fonction'] as string];
    await app.bd.transaction(ctx.compteId, (tx) => journaliser(tx, ctx, { action: 'Export', objetType: 'Personnel',
      objetLibelle: `Export du personnel · ${rows.length} lignes`, avant: '–', apres: 'CSV' }));
    return rep.header('content-type', 'text/csv; charset=utf-8').header('content-disposition', 'attachment; filename="personnel.csv"').send(versCsv(rows));
  });

  r.get('/personnel/:id', { config: { unePermissionParmi: LECTURE }, schema: { tags: ['personnel'], params: z.object({ id: z.uuid() }) } }, async (req) => {
    const ctx = exiger(req);
    const p = await app.bd.lireUn<Record<string, unknown>>(sql`
      SELECT p.id, p.nom_affiche AS "nomAffiche", p.fonction, p.statut, p.telephone, p.diplome, p.entree_le AS "entreeLe", p.version,
             c.identifiant AS compte, c.id AS "compteId"
        FROM personnel.fiche p LEFT JOIN core.compte c ON c.personnel_id = p.id AND c.actif
       WHERE p.id = ${req.params.id} AND p.etablissement_id = ${ctx.etablissementId}`);
    if (!p) throw introuvable('Fiche');
    const perimetre = await perimetreDePersonnel(app.bd, ctx.etablissementId, req.params.id);
    const classes = [...new Set([...perimetre.classesPrincipal.map((c) => c.nom), ...perimetre.matieres.map((m) => m.classeNom)])];
    const matieres = [...new Set(perimetre.matieres.map((m) => m.matiereLibelle))];
    const vacations = await app.bd.lire(sql`
      SELECT to_char(mois, 'YYYY-MM') AS mois, heures_prevues AS prevues, heures_effectuees AS effectuees
        FROM personnel.vacation WHERE personnel_id = ${req.params.id} ORDER BY mois`);
    return { ...p, fonctionLibelle: FONCTIONS[p['fonction'] as string], classes, matieres, vacations };
  });

  r.post('/personnel', { config: { permission: 'personnel.fiche.gerer' }, schema: { tags: ['personnel'], body: Fiche } }, async (req) => {
    const ctx = exiger(req);
    const b = req.body;
    return app.bd.transaction(ctx.compteId, async (tx) => {
      const p = await ligne<{ id: string }>(tx, sql`
        INSERT INTO personnel.fiche (etablissement_id, nom_affiche, fonction, statut, telephone, diplome, entree_le, cree_par)
        VALUES (${ctx.etablissementId}, ${b.nomAffiche}, ${b.fonction}, ${b.statut}, ${b.telephone ?? null}, ${b.diplome ?? null},
                ${b.entreeLe ?? null}, ${ctx.compteId}) RETURNING id`);
      await journaliser(tx, ctx, { action: 'Création', objetType: 'Personnel', objetLibelle: `Personnel · ${b.nomAffiche}`,
        avant: '–', apres: `${FONCTIONS[b.fonction]} · ${b.statut}`, ligneId: p!.id, table: 'personnel.fiche' });
      return { id: p!.id };
    });
  });

  r.patch('/personnel/:id', {
    config: { permission: 'personnel.fiche.gerer' }, schema: { tags: ['personnel'], params: z.object({ id: z.uuid() }), body: Fiche.partial() },
  }, async (req) => {
    const ctx = exiger(req);
    const b = req.body;
    return app.bd.transaction(ctx.compteId, async (tx) => {
      const a = await ligne<{ nom_affiche: string; fonction: string; statut: string; telephone: string | null; diplome: string | null; entree_le: string | null }>(tx, sql`
        SELECT nom_affiche, fonction, statut, telephone, diplome, entree_le FROM personnel.fiche
         WHERE id = ${req.params.id} AND etablissement_id = ${ctx.etablissementId}`);
      if (!a) throw introuvable('Fiche');
      await tx.execute(sql`
        UPDATE personnel.fiche SET nom_affiche = ${b.nomAffiche ?? a.nom_affiche}, fonction = ${b.fonction ?? a.fonction},
               statut = ${b.statut ?? a.statut}, telephone = ${b.telephone === undefined ? a.telephone : b.telephone},
               diplome = ${b.diplome === undefined ? a.diplome : b.diplome}, entree_le = ${b.entreeLe === undefined ? a.entree_le : b.entreeLe}
         WHERE id = ${req.params.id}`);
      await journaliser(tx, ctx, { action: 'Modification', objetType: 'Personnel', objetLibelle: `Personnel · ${b.nomAffiche ?? a.nom_affiche}`,
        avant: `${FONCTIONS[a.fonction]} · ${a.statut}`, apres: `${FONCTIONS[b.fonction ?? a.fonction]} · ${b.statut ?? a.statut}`,
        ligneId: req.params.id, table: 'personnel.fiche' });
      return { id: req.params.id };
    });
  });
}
