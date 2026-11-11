// Création d'un établissement vierge : les sept rôles prêts à l'emploi (ADR-12) et un seul compte,
// celui de la secrétaire, qui administre l'application (E-06). Utilisé par demo:vide et par les tests.
import { ROLES_SYSTEME } from '@gs/shared';
import { sql, ligne, type Bd } from './bd.ts';
import { hacher } from './motdepasse.ts';
import { journaliser } from './audit.ts';

export interface NouvelEtablissement {
  nomFr: string;
  nomEn: string;
  secretaire: { identifiant: string; nomAffiche: string; motDePasse: string };
}

export async function creerEtablissement(bd: Bd, e: NouvelEtablissement): Promise<{ etablissementId: string; compteId: string }> {
  const empreinte = await hacher(e.secretaire.motDePasse);
  return bd.transaction(null, async (tx) => {
    const etab = await ligne<{ id: string }>(tx, sql`
      INSERT INTO structure.etablissement (nom_fr, nom_en) VALUES (${e.nomFr}, ${e.nomEn}) RETURNING id`);
    const roles: Record<string, string> = {};
    let ordre = 0;
    for (const r of ROLES_SYSTEME) {
      const role = await ligne<{ id: string }>(tx, sql`
        INSERT INTO core.role (etablissement_id, code, libelle_fr, libelle_en, systeme, perimetre_type, ordre)
        VALUES (${etab!.id}, ${r.code}, ${r.libelleFr}, ${r.libelleEn}, true, ${r.perimetre}, ${++ordre}) RETURNING id`);
      roles[r.code] = role!.id;
      for (const p of r.permissions) {
        await tx.execute(sql`INSERT INTO core.role_permission (role_id, permission_code) VALUES (${role!.id}, ${p})`);
      }
    }
    const fiche = await ligne<{ id: string }>(tx, sql`
      INSERT INTO personnel.fiche (etablissement_id, nom_affiche, fonction, statut) VALUES (${etab!.id}, ${e.secretaire.nomAffiche}, 'secretaire', 'permanent') RETURNING id`);
    const compte = await ligne<{ id: string }>(tx, sql`
      INSERT INTO core.compte (etablissement_id, identifiant, nom_affiche, mot_de_passe, type, personnel_id)
      VALUES (${etab!.id}, ${e.secretaire.identifiant.toLowerCase()}, ${e.secretaire.nomAffiche}, ${empreinte}, 'personnel', ${fiche!.id}) RETURNING id`);
    await tx.execute(sql`INSERT INTO core.compte_role (etablissement_id, compte_id, role_id) VALUES (${etab!.id}, ${compte!.id}, ${roles['secretaire']!})`);
    for (const code of ['recu', 'absence', 'bulletin', 'rappel_echeance']) {
      await tx.execute(sql`INSERT INTO communication.notification_auto (etablissement_id, code, active) VALUES (${etab!.id}, ${code}, ${code !== 'rappel_echeance'})`);
    }
    await journaliser(tx, null, { action: 'Création', objetType: 'Établissement', objetLibelle: `Établissement · ${e.nomFr}`, avant: '–',
      apres: `Sept rôles, compte ${e.secretaire.identifiant}` }, etab!.id);
    return { etablissementId: etab!.id, compteId: compte!.id };
  });
}
