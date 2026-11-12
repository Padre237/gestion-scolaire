// Formulaire d'inscription configurable (lot 2, D-42) : l'établissement choisit les champs (questions prêtes ou les siennes),
// leur type, leur bloc, leur caractère obligatoire ; l'inscription contrôle les réponses et range les photos jointes.
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { SQL } from 'drizzle-orm';
import { sql, ligne, lignes, tableau, type Tx } from '../../../core/bd.ts';
import { ErreurMetier } from '../../../core/erreurs.ts';
import { exiger } from '../../../core/session.ts';
import type { Contexte } from '../../../core/contexte.ts';
import { journaliser } from '../../../core/audit.ts';
import { BIBLIOTHEQUE, BLOCS, FORMULAIRE_PAR_DEFAUT, PHOTO_MAX_OCTETS, TYPES_CHAMP, type ChampInscription } from '@gs/shared';

const Bloc = z.enum(BLOCS.map(([b]) => b) as [string, ...string[]]);
const Type = z.enum(TYPES_CHAMP.map(([t]) => t) as [string, ...string[]]);
const Champ = z.object({
  code: z.string().trim().regex(/^[a-z0-9_]{2,40}$/), bloc: Bloc, libelle: z.string().trim().min(2).max(120), type: Type,
  options: z.array(z.string().trim().min(1).max(80)).max(30).default([]), obligatoire: z.boolean(), actif: z.boolean(), ordre: z.number().int().min(0).max(999),
  modele: z.string().max(40).nullable().default(null),
});

/** Champs du formulaire de l'établissement (non retirés), dans l'ordre ; le formulaire par défaut tant que rien n'est réglé. */
type Lire = <T>(q: SQL) => Promise<T[]>;
export async function champsFormulaire(lire: Lire, etab: string): Promise<{ champs: ChampInscription[]; regle: boolean }> {
  const rows = await lire<ChampInscription & { supprime: boolean }>(sql`
    SELECT code, bloc, libelle, type, options, obligatoire, actif, ordre, modele, supprime FROM scolarite.champ_inscription
     WHERE etablissement_id = ${etab} ORDER BY ordre, libelle`);
  if (!rows.length) return { champs: FORMULAIRE_PAR_DEFAUT, regle: false };
  return { champs: rows.filter((r) => !r.supprime).map(({ supprime: _s, ...c }) => c), regle: true };
}

/** Photo jointe : base64 d'une image PNG, JPEG ou WebP de 5 Mo au plus. */
function lirePhoto(v: unknown, libelle: string): { octets: Buffer; type: string; nom: string | null } {
  const o = v as { base64?: unknown; nom?: unknown };
  if (!o || typeof o.base64 !== 'string') throw new ErreurMetier('SCO_RENSEIGNEMENT', 422, `${libelle} : photo illisible.`);
  const octets = Buffer.from(o.base64, 'base64');
  if (octets.length > PHOTO_MAX_OCTETS) throw new ErreurMetier('SCO_PHOTO_LOURDE', 422, `${libelle} : 5 Mo au plus.`);
  const type = octets[0] === 0x89 ? 'image/png' : octets[0] === 0xff && octets[1] === 0xd8 ? 'image/jpeg' : octets.subarray(8, 12).toString() === 'WEBP' ? 'image/webp' : null;
  if (!type) throw new ErreurMetier('SCO_PHOTO_FORMAT', 422, `${libelle} : image PNG, JPEG ou WebP attendue.`);
  return { octets, type, nom: typeof o.nom === 'string' ? o.nom.slice(0, 120) : null };
}

export interface Piece { id: string; code: string; octets: Buffer; type: string; nom: string | null }

/**
 * Contrôle les réponses et prépare leur enregistrement : valeurs à écrire dans eleve.renseignements et photos à joindre
 * (identifiants attribués d'avance, pour que la fiche soit écrite en une fois à l'inscription).
 * Inscription : les champs obligatoires actifs doivent être remplis. Mise à jour (partiel) : seules les réponses envoyées sont contrôlées.
 */
export async function preparerRenseignements(tx: Tx, etab: string, valeurs: Record<string, unknown>, options: { partiel?: boolean } = {}) {
  const { champs } = await champsFormulaire((q) => lignes(tx, q), etab);
  const r: Record<string, unknown> = {};
  const pieces: Piece[] = [];
  for (const c of champs.filter((x) => (options.partiel ? x.code in valeurs : x.actif))) {
    const v = valeurs[c.code];
    const vide = v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);
    if (vide) {
      if (c.obligatoire && c.actif) throw new ErreurMetier('SCO_RENSEIGNEMENT_REQUIS', 422, `${c.libelle} : réponse obligatoire.`, `renseignements.${c.code}`);
      continue;
    }
    const refus = (m: string) => new ErreurMetier('SCO_RENSEIGNEMENT', 422, `${c.libelle} : ${m}.`, `renseignements.${c.code}`);
    switch (c.type) {
      case 'texte': if (typeof v !== 'string' || v.trim().length > 500) throw refus('texte de 500 caractères au plus'); r[c.code] = v.trim(); break;
      case 'nombre': { const n = Number(String(v).replace(',', '.')); if (!Number.isFinite(n)) throw refus('nombre attendu'); r[c.code] = n; break; }
      case 'date': if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw refus('date attendue'); r[c.code] = v; break;
      case 'choix_unique': if (typeof v !== 'string' || !c.options.includes(v)) throw refus('choix hors de la liste'); r[c.code] = v; break;
      case 'choix_multiple':
        if (!Array.isArray(v) || v.some((x) => typeof x !== 'string' || !c.options.includes(x))) throw refus('choix hors de la liste');
        r[c.code] = [...new Set(v as string[])];
        break;
      case 'photo': {
        const p = lirePhoto(v, c.libelle);
        const id = (await ligne<{ id: string }>(tx, sql`SELECT core.uuid_v7() AS id`))!.id;
        pieces.push({ id, code: c.code, octets: p.octets, type: p.type, nom: p.nom });
        r[c.code] = { piece: id, nom: p.nom };
        break;
      }
    }
  }
  return { valeurs: r, pieces };
}

export async function joindrePieces(tx: Tx, ctx: Contexte, eleveId: string, pieces: Piece[]) {
  for (const p of pieces) {
    await tx.execute(sql`
      INSERT INTO scolarite.piece_eleve (id, etablissement_id, eleve_id, champ_code, nom_fichier, type_mime, taille, contenu, cree_par)
      VALUES (${p.id}, ${ctx.etablissementId}, ${eleveId}, ${p.code}, ${p.nom}, ${p.type}, ${p.octets.length}, ${p.octets}, ${ctx.compteId})`);
  }
}

/** Libellés de tous les champs connus, y compris ceux retirés du formulaire (leurs réponses restent lisibles). */
export async function libellesChamps(lire: Lire, etab: string) {
  const rows = await lire<{ code: string; bloc: string; libelle: string; type: string }>(sql`
    SELECT code, bloc, libelle, type FROM scolarite.champ_inscription WHERE etablissement_id = ${etab}`);
  const m = new Map<string, { code: string; bloc: string; libelle: string; type: string }>(BIBLIOTHEQUE.map((c) => [c.code, c]));
  for (const c of rows) m.set(c.code, c);
  return m;
}

/** Réponses lisibles, bloc par bloc (fiche de l'élève, fiche d'inscription imprimée). */
export async function renseignementsLisibles(lire: Lire, etab: string, renseignements: Record<string, unknown>) {
  const connus = await libellesChamps(lire, etab);
  return BLOCS.map(([bloc, libelle]) => ({
    bloc, libelle,
    lignes: Object.entries(renseignements).map(([code, v]) => ({ c: connus.get(code), v })).filter((x) => x.c?.bloc === bloc)
      .map(({ c, v }) => ({ code: c!.code, libelle: c!.libelle, type: c!.type,
        valeur: c!.type === 'photo' ? ((v as { nom?: string })?.nom ?? 'Photo jointe') : Array.isArray(v) ? v.join(', ')
          : c!.type === 'date' && typeof v === 'string' ? v.split('-').reverse().join('/') : String(v),
        piece: c!.type === 'photo' ? (v as { piece?: string })?.piece ?? null : null })),
  })).filter((b) => b.lignes.length);
}

export async function routesFormulaire(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get('/scolarite/formulaire', {
    config: { unePermissionParmi: ['scolarite.inscription.creer', 'structure.etablissement.modifier', 'structure.consulter'] }, schema: { tags: ['scolarite'] },
  }, async (req) => {
    const ctx = exiger(req);
    const { champs, regle } = await champsFormulaire((q) => app.bd.lire(q), ctx.etablissementId);
    return { regle, champs, blocs: BLOCS.map(([code, libelle]) => ({ code, libelle })), types: TYPES_CHAMP.map(([code, libelle]) => ({ code, libelle })), bibliotheque: BIBLIOTHEQUE };
  });

  r.put('/scolarite/formulaire', {
    config: { permission: 'structure.etablissement.modifier' }, schema: { tags: ['scolarite'], body: z.object({ champs: z.array(Champ).max(80) }) },
  }, async (req) => {
    const ctx = exiger(req);
    const champs = req.body.champs;
    const codes = new Set<string>();
    for (const c of champs) {
      if (codes.has(c.code)) throw new ErreurMetier('SCO_CHAMP_DOUBLON', 422, `Deux champs portent le code ${c.code}.`);
      codes.add(c.code);
      if ((c.type === 'choix_unique' || c.type === 'choix_multiple') && c.options.length < 2) {
        throw new ErreurMetier('SCO_CHAMP_OPTIONS', 422, `« ${c.libelle} » : au moins deux choix.`, 'options');
      }
    }
    return app.bd.transaction(ctx.compteId, async (tx) => {
      for (const c of champs) {
        const options = c.type === 'choix_unique' || c.type === 'choix_multiple' ? c.options : [];
        await tx.execute(sql`
          INSERT INTO scolarite.champ_inscription (etablissement_id, code, bloc, libelle, type, options, obligatoire, actif, supprime, ordre, modele, cree_par)
          VALUES (${ctx.etablissementId}, ${c.code}, ${c.bloc}, ${c.libelle}, ${c.type}, ${JSON.stringify(options)}::jsonb, ${c.obligatoire}, ${c.actif}, false, ${c.ordre}, ${c.modele}, ${ctx.compteId})
          ON CONFLICT (etablissement_id, code) DO UPDATE SET bloc = EXCLUDED.bloc, libelle = EXCLUDED.libelle, type = EXCLUDED.type, options = EXCLUDED.options,
            obligatoire = EXCLUDED.obligatoire, actif = EXCLUDED.actif, supprime = false, ordre = EXCLUDED.ordre`);
      }
      // Champs retirés : masqués, jamais effacés (les réponses déjà données restent lisibles sur les fiches).
      await tx.execute(sql`UPDATE scolarite.champ_inscription SET supprime = true
                            WHERE etablissement_id = ${ctx.etablissementId} AND NOT (code = ANY(${tableau([...codes])}::text[])) AND NOT supprime`);
      await journaliser(tx, ctx, { action: 'Modification', objetType: 'Établissement', objetLibelle: 'Formulaire d’inscription',
        avant: '–', apres: `${champs.filter((c) => c.actif).length} champs actifs, ${champs.filter((c) => c.actif && c.obligatoire).length} obligatoires` });
      return { ok: true };
    });
  });
}
