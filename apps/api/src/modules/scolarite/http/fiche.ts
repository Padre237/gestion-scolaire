// Mise à jour d'une fiche (lot 3, D-43) : identité et renseignements de l'élève, coordonnées des responsables.
// Rien n'est effacé : chaque version précédente reste dans le journal d'audit et se relit dans l'historique des modifications.
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { sql, ligne, lignes, tableau } from '../../../core/bd.ts';
import { ErreurMetier, introuvable } from '../../../core/erreurs.ts';
import { exiger } from '../../../core/session.ts';
import type { Contexte } from '../../../core/contexte.ts';
import { journaliser } from '../../../core/audit.ts';
import { BIBLIOTHEQUE } from '@gs/shared';
import { chiffres, formatTelephone } from '../index.ts';
import { champsFormulaire, joindrePieces, libellesChamps, preparerRenseignements } from './formulaire.ts';

const LIENS: Record<string, string> = { mere: 'Mère', pere: 'Père', tuteur: 'Tuteur' };
const SEXES: Record<string, string> = { M: 'Garçon', F: 'Fille' };
const LANGUES: Record<string, string> = { fr: 'Français', en: 'English' };
const dateFr = (d: unknown) => (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}/.test(d) ? d.slice(0, 10).split('-').reverse().join('/') : d ? String(d) : '–');
const ouiNon = (v: unknown) => (v === true ? 'Oui' : v === false ? 'Non' : '–');

const MajEleve = z.object({
  nom: z.string().trim().min(1).max(60).transform((s) => s.toUpperCase()).optional(),
  prenoms: z.string().trim().min(1).max(80).optional(),
  sexe: z.enum(['M', 'F']).optional(),
  dateNaissance: z.iso.date().optional(),
  lieuNaissance: z.string().trim().max(80).nullish(),
  photo: z.string().max(7_100_000).nullish(),
  /** Réponses au formulaire : une réponse vide retire la valeur ; une photo déjà jointe garde { piece }. */
  renseignements: z.record(z.string(), z.unknown()).optional(),
});
const MajResponsable = z.object({
  nom: z.string().trim().min(2).max(80).optional(),
  telephone: z.string().trim().transform(chiffres).pipe(z.string().regex(/^\d{8,12}$/, 'Numéro incomplet')).optional(),
  langue: z.enum(['fr', 'en']).optional(),
  lien: z.enum(['mere', 'pere', 'tuteur']).optional(),
  recoitSms: z.boolean().optional(),
});

export async function routesFiche(app: FastifyInstance, exigerEleveAccessible: (ctx: Contexte, eleveId: string) => Promise<void>) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.patch('/scolarite/eleves/:id', {
    config: { permission: 'scolarite.inscription.creer' }, bodyLimit: 40_000_000,
    schema: { tags: ['scolarite'], params: z.object({ id: z.uuid() }), body: MajEleve },
  }, async (req) => {
    const ctx = exiger(req);
    const b = req.body;
    return app.bd.transaction(ctx.compteId, async (tx) => {
      const e = await ligne<{ nom: string; prenoms: string; sexe: string; date_naissance: string; lieu_naissance: string | null; renseignements: Record<string, unknown> }>(tx, sql`
        SELECT nom, prenoms, sexe, date_naissance::text, lieu_naissance, renseignements FROM scolarite.eleve
         WHERE id = ${req.params.id} AND etablissement_id = ${ctx.etablissementId} FOR UPDATE`);
      if (!e) throw introuvable('Élève');
      const changes: string[] = [];
      const nouveau = {
        nom: b.nom ?? e.nom, prenoms: b.prenoms ?? e.prenoms, sexe: b.sexe ?? e.sexe, date_naissance: b.dateNaissance ?? e.date_naissance,
        lieu_naissance: b.lieuNaissance === undefined ? e.lieu_naissance : (b.lieuNaissance || null),
      };
      for (const [k, l] of [['nom', 'nom'], ['prenoms', 'prénoms'], ['sexe', 'sexe'], ['date_naissance', 'date de naissance'], ['lieu_naissance', 'lieu de naissance']] as const) {
        if ((nouveau[k] ?? null) !== (e[k] ?? null)) changes.push(l);
      }
      if (changes.length) {
        await tx.execute(sql`UPDATE scolarite.eleve SET nom = ${nouveau.nom}, prenoms = ${nouveau.prenoms}, sexe = ${nouveau.sexe},
                               date_naissance = ${nouveau.date_naissance}, lieu_naissance = ${nouveau.lieu_naissance} WHERE id = ${req.params.id}`);
      }
      if (b.photo !== undefined) {
        const octets = b.photo ? Buffer.from(b.photo, 'base64') : null;
        if (octets && octets.length > 5 * 1024 * 1024) throw new ErreurMetier('SCO_PHOTO_LOURDE', 422, 'Photo : 5 Mo au plus.', 'photo');
        await tx.execute(sql`UPDATE scolarite.eleve SET photo = ${octets} WHERE id = ${req.params.id}`);
        changes.push('photo');
      }
      if (b.renseignements) {
        // Réponses envoyées comparées aux réponses en place ; seules celles qui changent sont écrites (version précédente au journal).
        const avant = e.renseignements ?? {};
        const garder: Record<string, unknown> = {};
        const nouvelles: Record<string, unknown> = {};
        const retirees: string[] = [];
        for (const [code, v] of Object.entries(b.renseignements)) {
          const vide = v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);
          const deja = (v as { piece?: string } | null)?.piece;
          if (deja && (avant[code] as { piece?: string } | undefined)?.piece === deja) { garder[code] = avant[code]; continue; }
          if (vide) { if (code in avant) retirees.push(code); continue; }
          if (JSON.stringify(v) === JSON.stringify(avant[code])) continue;
          nouvelles[code] = v;
        }
        if (Object.keys(nouvelles).length || retirees.length) {
          if (retirees.length) await tx.execute(sql`UPDATE scolarite.eleve SET renseignements = renseignements - ${tableau(retirees)}::text[] WHERE id = ${req.params.id}`);
          // Contrôle des réponses nouvelles (type, choix permis, photo) ; les obligatoires laissées vides sont refusées.
          const { champs } = await champsFormulaire((q) => lignes(tx, q), ctx.etablissementId);
          for (const c of champs.filter((x) => x.actif && x.obligatoire)) {
            if (retirees.includes(c.code)) throw new ErreurMetier('SCO_RENSEIGNEMENT_REQUIS', 422, `${c.libelle} : réponse obligatoire.`, `renseignements.${c.code}`);
          }
          const p = await preparerRenseignements(tx, ctx.etablissementId, nouvelles, { partiel: true });
          await joindrePieces(tx, ctx, req.params.id, p.pieces);
          if (Object.keys(p.valeurs).length) await tx.execute(sql`UPDATE scolarite.eleve SET renseignements = renseignements || ${JSON.stringify(p.valeurs)}::jsonb WHERE id = ${req.params.id}`);
          changes.push(...[...Object.keys(nouvelles), ...retirees].map((code) => (champs.find((c) => c.code === code) ?? BIBLIOTHEQUE.find((c) => c.code === code))?.libelle.toLowerCase() ?? code));
        }
      }
      if (changes.length) {
        await journaliser(tx, ctx, { action: 'Modification', objetType: 'Élève', objetLibelle: `Fiche · ${nouveau.nom} ${nouveau.prenoms}`,
          avant: 'version précédente au journal', apres: `Modifié : ${changes.join(', ')}`, eleveId: req.params.id, ligneId: req.params.id, table: 'scolarite.eleve' });
      }
      return { ok: true, modifies: changes };
    });
  });

  r.patch('/scolarite/eleves/:id/responsables/:rid', {
    config: { permission: 'scolarite.responsable.gerer' },
    schema: { tags: ['scolarite'], params: z.object({ id: z.uuid(), rid: z.uuid() }), body: MajResponsable },
  }, async (req) => {
    const ctx = exiger(req);
    const b = req.body;
    return app.bd.transaction(ctx.compteId, async (tx) => {
      const x = await ligne<{ famille_id: string; nom: string; telephone: string; langue: string; lien: string; recoit_sms: boolean; payeur: boolean; eleve: string }>(tx, sql`
        SELECT r.famille_id, r.nom, r.telephone, r.langue, er.lien, er.recoit_sms, er.payeur, e.nom || ' ' || e.prenoms AS eleve
          FROM scolarite.eleve_responsable er JOIN scolarite.responsable r ON r.id = er.responsable_id JOIN scolarite.eleve e ON e.id = er.eleve_id
         WHERE er.eleve_id = ${req.params.id} AND er.responsable_id = ${req.params.rid} AND e.etablissement_id = ${ctx.etablissementId}`);
      if (!x) throw introuvable('Responsable');
      const changes: string[] = [];
      if (b.telephone && b.telephone !== x.telephone) {
        const pris = await ligne(tx, sql`SELECT 1 FROM scolarite.responsable WHERE famille_id = ${x.famille_id} AND telephone = ${b.telephone} AND id <> ${req.params.rid}`);
        if (pris) throw new ErreurMetier('SCO_TELEPHONE_PRIS', 409, 'Un autre responsable de la famille a déjà ce numéro.', 'telephone');
        // Le compte famille se connecte par le téléphone du payeur : son identifiant suit le nouveau numéro.
        const compte = await ligne<{ id: string }>(tx, sql`SELECT id FROM core.compte WHERE famille_id = ${x.famille_id} AND identifiant = ${x.telephone}`);
        if (compte) {
          const autre = await ligne(tx, sql`SELECT 1 FROM core.compte WHERE identifiant = ${b.telephone} AND id <> ${compte.id}`);
          if (autre) throw new ErreurMetier('SCO_TELEPHONE_PRIS', 409, 'Ce numéro est déjà celui d’un autre compte.', 'telephone');
          await tx.execute(sql`UPDATE core.compte SET identifiant = ${b.telephone} WHERE id = ${compte.id}`);
        }
        changes.push('téléphone');
      }
      if (b.nom && b.nom !== x.nom) changes.push('nom');
      if (b.langue && b.langue !== x.langue) changes.push('langue');
      if (changes.length) {
        await tx.execute(sql`UPDATE scolarite.responsable SET nom = ${b.nom ?? x.nom}, telephone = ${b.telephone ?? x.telephone}, langue = ${b.langue ?? x.langue}
                             WHERE id = ${req.params.rid}`);
      }
      const lienChange = b.lien !== undefined && b.lien !== x.lien;
      const smsChange = b.recoitSms !== undefined && b.recoitSms !== x.recoit_sms;
      if (lienChange || smsChange) {
        await tx.execute(sql`UPDATE scolarite.eleve_responsable SET lien = ${b.lien ?? x.lien}, recoit_sms = ${b.recoitSms ?? x.recoit_sms}
                             WHERE eleve_id = ${req.params.id} AND responsable_id = ${req.params.rid}`);
        if (lienChange) changes.push('lien');
        if (smsChange) changes.push('SMS');
      }
      if (changes.length) {
        await journaliser(tx, ctx, { action: 'Modification', objetType: 'Élève', objetLibelle: `Responsable · ${b.nom ?? x.nom} (${x.eleve})`,
          avant: 'version précédente au journal', apres: `Modifié : ${changes.join(', ')}`, eleveId: req.params.id, ligneId: req.params.rid, table: 'scolarite.responsable' });
      }
      return { ok: true, modifies: changes };
    });
  });

  /** Historique des modifications de la fiche : chaque champ changé, sa valeur avant et après, la date et l'auteur. */
  r.get('/scolarite/eleves/:id/variations', {
    config: { permission: 'scolarite.eleve.consulter' }, schema: { tags: ['scolarite'], params: z.object({ id: z.uuid() }) },
  }, async (req) => {
    const ctx = exiger(req);
    await exigerEleveAccessible(ctx, req.params.id);
    const etab = ctx.etablissementId;
    const rid = (await app.bd.lire<{ responsable_id: string }>(sql`SELECT responsable_id FROM scolarite.eleve_responsable WHERE eleve_id = ${req.params.id}`)).map((x) => x.responsable_id);
    // Seules les colonnes suivies sont lues (la photo n'est comparée qu'en SQL, sans être transportée).
    const rows = await app.bd.lire<{ horodatage: string; table_nom: string; auteur: string | null; avant: Record<string, unknown>; apres: Record<string, unknown>; photo: boolean }>(sql`
      SELECT j.horodatage, j.table_nom, c.nom_affiche AS auteur,
             jsonb_build_object('nom', j.avant->'nom', 'prenoms', j.avant->'prenoms', 'sexe', j.avant->'sexe', 'date_naissance', j.avant->'date_naissance',
               'lieu_naissance', j.avant->'lieu_naissance', 'renseignements', j.avant->'renseignements', 'telephone', j.avant->'telephone', 'langue', j.avant->'langue',
               'lien', j.avant->'lien', 'recoit_sms', j.avant->'recoit_sms', 'payeur', j.avant->'payeur') AS avant,
             jsonb_build_object('nom', j.apres->'nom', 'prenoms', j.apres->'prenoms', 'sexe', j.apres->'sexe', 'date_naissance', j.apres->'date_naissance',
               'lieu_naissance', j.apres->'lieu_naissance', 'renseignements', j.apres->'renseignements', 'telephone', j.apres->'telephone', 'langue', j.apres->'langue',
               'lien', j.apres->'lien', 'recoit_sms', j.apres->'recoit_sms', 'payeur', j.apres->'payeur') AS apres,
             (j.table_nom = 'scolarite.eleve' AND (j.avant->>'photo') IS DISTINCT FROM (j.apres->>'photo')) AS photo
        FROM core.journal_audit j LEFT JOIN core.compte c ON c.id = j.utilisateur_id
       WHERE j.action = 'UPDATE' AND (
             (j.table_nom = 'scolarite.eleve' AND j.ligne_id = ${req.params.id} AND j.etablissement_id = ${etab})
          OR (j.table_nom = 'scolarite.responsable' AND j.ligne_id = ANY(${tableau(rid)}::uuid[]) AND j.etablissement_id = ${etab})
          -- Lien élève-responsable : table sans établissement ; l'élève a été vérifié ci-dessus.
          OR (j.table_nom = 'scolarite.eleve_responsable' AND j.ligne_id IS NULL AND j.apres->>'eleve_id' = ${req.params.id}::text))
       ORDER BY j.horodatage DESC LIMIT 300`);
    const connus = await libellesChamps((q) => app.bd.lire(q), etab);
    const libelleChamp = (code: string) => connus.get(code)?.libelle ?? code;
    const lisible = (v: unknown) => (v === null || v === undefined ? '–' : Array.isArray(v) ? v.join(', ') : typeof v === 'object' ? ((v as { nom?: string }).nom ?? 'Photo jointe')
      : /^\d{4}-\d{2}-\d{2}$/.test(String(v)) ? dateFr(v) : String(v));
    const variations: { quand: string; auteur: string; objet: string; champ: string; avant: string; apres: string }[] = [];
    for (const x of rows) {
      const auteur = x.auteur ?? 'Application';
      const ajout = (objet: string, champ: string, avant: string, apres: string) => { if (avant !== apres) variations.push({ quand: x.horodatage, auteur, objet, champ, avant, apres }); };
      if (x.table_nom === 'scolarite.eleve') {
        ajout('Élève', 'Nom', lisible(x.avant['nom']), lisible(x.apres['nom']));
        ajout('Élève', 'Prénoms', lisible(x.avant['prenoms']), lisible(x.apres['prenoms']));
        ajout('Élève', 'Sexe', SEXES[String(x.avant['sexe'])] ?? '–', SEXES[String(x.apres['sexe'])] ?? '–');
        ajout('Élève', 'Date de naissance', dateFr(x.avant['date_naissance']), dateFr(x.apres['date_naissance']));
        ajout('Élève', 'Lieu de naissance', lisible(x.avant['lieu_naissance']), lisible(x.apres['lieu_naissance']));
        if (x.photo) variations.push({ quand: x.horodatage, auteur, objet: 'Élève', champ: 'Photo', avant: 'Ancienne photo', apres: 'Nouvelle photo' });
        const ra = (x.avant['renseignements'] ?? {}) as Record<string, unknown>;
        const rp = (x.apres['renseignements'] ?? {}) as Record<string, unknown>;
        for (const code of new Set([...Object.keys(ra), ...Object.keys(rp)])) ajout('Élève', libelleChamp(code), lisible(ra[code]), lisible(rp[code]));
      } else if (x.table_nom === 'scolarite.responsable') {
        const qui = `Responsable · ${lisible(x.apres['nom'])}`;
        ajout(qui, 'Nom', lisible(x.avant['nom']), lisible(x.apres['nom']));
        ajout(qui, 'Téléphone', formatTelephone(String(x.avant['telephone'] ?? '')), formatTelephone(String(x.apres['telephone'] ?? '')));
        ajout(qui, 'Langue des messages', LANGUES[String(x.avant['langue'])] ?? '–', LANGUES[String(x.apres['langue'])] ?? '–');
      } else {
        ajout('Responsable', 'Lien', LIENS[String(x.avant['lien'])] ?? '–', LIENS[String(x.apres['lien'])] ?? '–');
        ajout('Responsable', 'Reçoit les SMS', ouiNon(x.avant['recoit_sms']), ouiNon(x.apres['recoit_sms']));
        ajout('Responsable', 'Payeur', ouiNon(x.avant['payeur']), ouiNon(x.apres['payeur']));
      }
    }
    return { variations };
  });
}

