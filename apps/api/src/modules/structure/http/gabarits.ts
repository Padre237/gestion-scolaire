// Modèles d'impression (D-44) : choix du modèle par document, adresse de la page « Vérifier », aperçu PDF de chaque modèle.
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { sql } from '../../../core/bd.ts';
import { exiger } from '../../../core/session.ts';
import { journaliser } from '../../../core/audit.ts';
import { pdfBulletins, pdfCartesScolaires, pdfFicheInscription, type Etablissement } from '@gs/print';
import { anneeOuverte, baseVerification } from '../index.ts';

const Gabarit = z.enum(['classique', 'bandeau', 'epure']);
const Document = z.enum(['fiche', 'carte', 'bulletin']);
const LIBELLES: Record<string, string> = { classique: 'Classique', bandeau: 'Bandeau', epure: 'Épuré' };

export async function routesGabarits(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get('/structure/gabarits', { config: { permission: 'structure.consulter' }, schema: { tags: ['structure'] } }, async (req) => {
    const ctx = exiger(req);
    const e = await app.bd.lireUn<{ gabarits: Record<string, string>; adresse_verification: string | null; a_logo: boolean }>(sql`
      SELECT gabarits, adresse_verification, logo IS NOT NULL AS a_logo FROM structure.etablissement WHERE id = ${ctx.etablissementId}`);
    const g = (d: string) => (e?.gabarits?.[d] === 'bandeau' || e?.gabarits?.[d] === 'epure' ? e.gabarits[d] : 'classique');
    return { fiche: g('fiche'), carte: g('carte'), bulletin: g('bulletin'), adresseVerification: e?.adresse_verification ?? '', aLogo: !!e?.a_logo,
      adresseParDefaut: baseVerification(null, req) };
  });

  r.put('/structure/gabarits', {
    config: { permission: 'core.modele.modifier' },
    schema: { tags: ['structure'], body: z.object({ fiche: Gabarit, carte: Gabarit, bulletin: Gabarit,
      adresseVerification: z.string().trim().max(200).regex(/^(https?:\/\/[^\s]+)?$/, 'Adresse commençant par http:// ou https://').default('') }) },
  }, async (req) => {
    const ctx = exiger(req);
    const { adresseVerification, ...g } = req.body;
    await app.bd.transaction(ctx.compteId, async (tx) => {
      await tx.execute(sql`UPDATE structure.etablissement SET gabarits = ${JSON.stringify(g)}::jsonb, adresse_verification = ${adresseVerification || null}
                           WHERE id = ${ctx.etablissementId}`);
      await journaliser(tx, ctx, { action: 'Modification', objetType: 'Établissement', objetLibelle: 'Modèles d’impression',
        avant: '–', apres: `Fiche ${LIBELLES[g.fiche]}, carte ${LIBELLES[g.carte]}, bulletin ${LIBELLES[g.bulletin]}` });
    });
    return { ok: true };
  });

  /** Aperçu d'un modèle, avec l'en-tête et le logo de l'établissement et un élève pris pour exemple. */
  r.get('/structure/gabarits/apercu', {
    config: { permission: 'structure.consulter' },
    schema: { tags: ['structure'], querystring: z.object({ document: Document, gabarit: Gabarit }) },
  }, async (req, rep) => {
    const ctx = exiger(req);
    const e = await app.bd.lireUn<Etablissement & { logo: Buffer | null }>(sql`
      SELECT nom_fr, nom_en, ville_bp, telephone, devise, modeles, logo FROM structure.etablissement WHERE id = ${ctx.etablissementId}`);
    const annee = (await anneeOuverte(app.bd, ctx.etablissementId))?.libelle ?? '2026/2027';
    const el = await app.bd.lireUn<{ nom: string; prenoms: string; matricule: string; sexe: string; naissance: string; lieu: string | null; classe: string; photo: Buffer | null }>(sql`
      SELECT e.nom, e.prenoms, e.matricule, e.sexe, to_char(e.date_naissance, 'DD/MM/YYYY') AS naissance, e.lieu_naissance AS lieu, c.nom AS classe, e.photo
        FROM scolarite.inscription i JOIN scolarite.eleve e ON e.id = i.eleve_id JOIN structure.classe c ON c.id = i.classe_id
       WHERE i.etablissement_id = ${ctx.etablissementId} AND i.statut IN ('attente', 'validee') ORDER BY i.inscrit_le LIMIT 1`)
      ?? { nom: 'NOM', prenoms: 'Prénoms de l’élève', matricule: '26FR0001', sexe: 'F', naissance: '01/01/2018', lieu: 'Yaoundé', classe: 'CM2 A', photo: null };
    const lien = `${baseVerification(null, req)}/verifier/APERCUAPERCU`;
    const { logo, ...etab } = e!;
    const g = req.query.gabarit;
    let pdf: Uint8Array;
    if (req.query.document === 'carte') {
      pdf = await pdfCartesScolaires({ etablissement: etab, classe: el.classe, annee, logo, gabarit: g,
        eleves: [{ matricule: el.matricule, nom: el.nom, prenoms: el.prenoms, sexe: el.sexe, naissance: el.naissance, lieu: el.lieu, photo: el.photo, verification: lien }] });
    } else if (req.query.document === 'fiche') {
      pdf = await pdfFicheInscription({ nom: el.nom, prenoms: el.prenoms, matricule: el.matricule, sexe: el.sexe, naissance: el.naissance, lieu: el.lieu ?? '', classe: el.classe, annee,
        nom_fr: etab.nom_fr, nom_en: etab.nom_en, ville_bp: etab.ville_bp ?? '', telephone: etab.telephone ?? '', motDePasse: '••••••••', telephoneConnexion: '6XX XXX XXX',
        responsables: [{ nom: `${el.nom} (responsable)`, lien: 'Mère', telephone: '6XX XXX XXX', payeur: true }],
        blocs: [{ libelle: 'Santé', lignes: [{ libelle: 'Groupe sanguin', valeur: 'O+' }, { libelle: 'Allergies', valeur: 'Aucune' }] }], gabarit: g, logo } as never);
    } else {
      const matieres = [['Français', 4, 13.5], ['Mathématiques', 4, 15], ['Anglais', 2, 12], ['Sciences et technologie', 2, 14], ['Histoire et géographie', 2, 11.5],
        ['Éducation civique et morale', 1, 16], ['Éducation physique et sportive', 1, 15], ['Arts et travaux manuels', 1, 14]] as [string, number, number][];
      const points = matieres.reduce((t, [, c, n]) => t + c * n, 0), coefs = matieres.reduce((t, [, c]) => t + c, 0);
      pdf = await pdfBulletins([{
        verification: lien, etablissement: etab.nom_fr, modele: etab.modeles?.bulletin ?? undefined, periodeFr: '1er trimestre', periodeEn: 'First term', annee,
        version: 1, statut: 'publie', eleve: `${el.nom} ${el.prenoms}`, matricule: el.matricule, classe: el.classe, effectif: 28, naissance: el.naissance,
        matieres: matieres.map(([libelle, coefficient, moyenne]) => ({ libelle, coefficient, moyenne, points: moyenne * coefficient, moyenneClasse: 12.4, appreciation: moyenne >= 14 ? 'Très bien' : 'Bien' })),
        totalCoefficients: coefs, totalPoints: points, moyenne: points / coefs, rang: 4, moyenneClasse: 12.4, min: 7.8, max: 16.9,
        absences: '2 h dont 2 h justifiées', distinction: 'Tableau d’honneur', appreciationGenerale: 'Trimestre sérieux, à poursuivre.',
      }], { gabarit: g, logo, etablissement: etab });
    }
    return rep.type('application/pdf').header('content-disposition', `inline; filename="apercu-${req.query.document}-${g}.pdf"`).send(Buffer.from(pdf));
  });
}
