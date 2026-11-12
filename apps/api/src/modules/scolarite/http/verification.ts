// Page publique « Vérifier » (D-44) : le QR code d'une carte scolaire ou d'un bulletin mène ici, sans connexion.
// Le code est aléatoire (60 bits) ; la réponse se limite à ce qui permet de reconnaître le document, rien de plus.
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { sql } from '../../../core/bd.ts';
import { introuvable } from '../../../core/erreurs.ts';

const note = (n: number | null) => (n === null || n === undefined ? '–' : Number(n).toFixed(2).replace('.', ','));

export async function routesVerification(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  r.get('/verification/:code', {
    config: { public: true },
    schema: { tags: ['scolarite'], params: z.object({ code: z.string().trim().toUpperCase().regex(/^[A-Z2-7]{12}$/) }) },
  }, async (req) => {
    const v = await app.bd.lireUn<{ type: 'carte' | 'bulletin'; objet_id: string; emis_le: string; etablissement: string }>(sql`
      SELECT v.type, v.objet_id, v.emis_le, e.nom_fr AS etablissement FROM scolarite.verification v
        JOIN structure.etablissement e ON e.id = v.etablissement_id WHERE v.code = ${req.params.code}`);
    if (!v) throw introuvable('Document');
    if (v.type === 'carte') {
      const c = await app.bd.lireUn<{ eleve: string; matricule: string; classe: string; annee: string; statut: string }>(sql`
        SELECT el.nom || ' ' || el.prenoms AS eleve, el.matricule, c.nom AS classe, a.libelle AS annee, i.statut
          FROM scolarite.inscription i JOIN scolarite.eleve el ON el.id = i.eleve_id JOIN structure.classe c ON c.id = i.classe_id
          JOIN structure.annee_scolaire a ON a.id = i.annee_id WHERE i.id = ${v.objet_id}`);
      if (!c) throw introuvable('Document');
      const alerte = c.statut === 'sortie' ? 'L’élève a quitté l’établissement : cette carte n’est plus valable.'
        : c.statut === 'annulee' ? 'Inscription annulée : cette carte n’est pas valable.'
          : c.statut === 'cloturee' ? `Carte de l’année ${c.annee}, aujourd’hui terminée.` : null;
      return { valide: !alerte || c.statut === 'cloturee', type: 'carte', titre: 'Carte scolaire', etablissement: v.etablissement, alerte,
        lignes: [{ libelle: 'Élève', valeur: c.eleve }, { libelle: 'Matricule', valeur: c.matricule }, { libelle: 'Classe', valeur: c.classe }, { libelle: 'Année scolaire', valeur: c.annee }] };
    }
    const b = await app.bd.lireUn<{ eleve: string; matricule: string; classe: string; annee: string; periode: string | null; moyenne: number | null; rang: number | null;
      effectif: number | null; version: number; statut: string; publie_le: string | null }>(sql`
      SELECT el.nom || ' ' || el.prenoms AS eleve, el.matricule, c.nom AS classe, a.libelle AS annee, p.libelle_fr AS periode,
             b.moyenne, b.rang, b.effectif, b.version, b.statut, b.publie_le
        FROM pedagogie.bulletin b JOIN scolarite.inscription i ON i.id = b.inscription_id JOIN scolarite.eleve el ON el.id = i.eleve_id
        JOIN structure.classe c ON c.id = i.classe_id JOIN structure.annee_scolaire a ON a.id = i.annee_id
        LEFT JOIN structure.periode p ON p.id = b.periode_id WHERE b.id = ${v.objet_id}`);
    if (!b) throw introuvable('Document');
    const alerte = b.statut === 'remplace' ? 'Une version plus récente de ce bulletin a été publiée : celle-ci n’est plus la version en vigueur.'
      : b.statut !== 'publie' ? 'Ce bulletin n’a pas été publié.' : null;
    return { valide: !alerte, type: 'bulletin', titre: `Bulletin · ${b.periode ?? 'année complète'}`, etablissement: v.etablissement, alerte,
      lignes: [{ libelle: 'Élève', valeur: b.eleve }, { libelle: 'Matricule', valeur: b.matricule }, { libelle: 'Classe', valeur: b.classe },
        { libelle: 'Année scolaire', valeur: b.annee }, { libelle: 'Moyenne générale', valeur: `${note(b.moyenne)} sur 20` },
        { libelle: 'Rang', valeur: b.rang ? `${b.rang}${b.rang === 1 ? 'er' : 'e'} sur ${b.effectif}` : '–' }, { libelle: 'Version', valeur: String(b.version) }] };
  });
}
