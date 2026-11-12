// API publique du module scolarité (ADR-01).
import { sql, ligne, lignes, tableau, type Tx, type Bd } from '../../core/bd.ts';
import { randomInt } from 'node:crypto';
import { enregistrerFournisseurFamille } from '../../core/perimetre-texte.ts';
import { surEvenement } from '../../core/evenements.ts';
import { journaliser } from '../../core/audit.ts';

export const chiffres = (tel: string) => tel.replace(/\D/g, '');
/** « 600000055 » → « 600 000 055 » */
export const formatTelephone = (tel: string | null) => {
  if (!tel) return '';
  const d = chiffres(tel);
  return d.length === 9 ? `${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6)}` : tel;
};

enregistrerFournisseurFamille(async (bd: Bd, familleId: string) => bd.lire(sql`
  SELECT e.prenoms AS prenom, c.nom AS classe
    FROM scolarite.eleve e
    LEFT JOIN scolarite.inscription i ON i.eleve_id = e.id AND i.statut IN ('attente', 'validee')
    LEFT JOIN structure.classe c ON c.id = i.classe_id
   WHERE e.famille_id = ${familleId} ORDER BY e.date_naissance`));

export interface InscriptionInfo {
  id: string; eleve_id: string; classe_id: string; statut: string; nom: string; prenoms: string; matricule: string; classe: string; famille_id: string;
}

export async function inscription(tx: Tx, id: string, etab: string): Promise<InscriptionInfo | undefined> {
  return ligne<InscriptionInfo>(tx, sql`
    SELECT i.id, i.eleve_id, i.classe_id, i.statut, e.nom, e.prenoms, e.matricule, c.nom AS classe, e.famille_id
      FROM scolarite.inscription i JOIN scolarite.eleve e ON e.id = i.eleve_id JOIN structure.classe c ON c.id = i.classe_id
     WHERE i.id = ${id} AND i.etablissement_id = ${etab}`);
}

/** Valide l'inscription en attente : premier versement atteint ou dérogation accordée (cycle de vie 7.1). */
export async function validerInscription(tx: Tx, inscriptionId: string, raison: string, ctx: { compteId: string; etablissementId: string } | null) {
  const i = await ligne<{ eleve_id: string; nom: string }>(tx, sql`
    UPDATE scolarite.inscription i SET statut = 'validee' FROM scolarite.eleve e
     WHERE i.id = ${inscriptionId} AND i.statut = 'attente' AND e.id = i.eleve_id
    RETURNING i.eleve_id, e.nom || ' ' || e.prenoms AS nom`);
  if (i) {
    await journaliser(tx, ctx, { action: 'Modification', objetType: 'Élève', objetLibelle: `Inscription · ${i.nom}`,
      avant: 'En attente', apres: `Validée (${raison})`, eleveId: i.eleve_id, ligneId: inscriptionId, table: 'scolarite.inscription' });
  }
}

// Le premier versement valide l'inscription en attente dès qu'il atteint le montant de la ligne « Inscription » (E-21).
surEvenement('versement.enregistre', async (tx, ctx, d) => {
  const i = await ligne<{ statut: string; verse: number; minimum: number }>(tx, sql`
    SELECT i.statut,
           (SELECT COALESCE(sum(verse), 0) FROM reporting.v_echeance WHERE inscription_id = i.id)::bigint AS verse,
           (SELECT COALESCE(min(a_payer) FILTER (WHERE ordre = 1), 0) FROM reporting.v_echeance WHERE inscription_id = i.id)::bigint AS minimum
      FROM scolarite.inscription i WHERE i.id = ${d.inscriptionId}`);
  if (i?.statut === 'attente' && Number(i.verse) >= Number(i.minimum)) {
    await validerInscription(tx, d.inscriptionId, 'premier versement', ctx);
  }
});

// ---------------------------------------------------------------- vérification des documents imprimés (D-44)
const ALPHABET_CODE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
/** Codes des QR imprimés : un par carte (inscription) ou par version de bulletin, aléatoires (60 bits), réutilisés à chaque impression. */
export async function codesVerification(tx: Tx, etab: string, type: 'carte' | 'bulletin', objets: string[]): Promise<Map<string, string>> {
  if (!objets.length) return new Map();
  const deja = await lignes<{ objet_id: string; code: string }>(tx, sql`
    SELECT objet_id, code FROM scolarite.verification WHERE type = ${type} AND objet_id = ANY(${tableau(objets)}::uuid[])`);
  const codes = new Map(deja.map((x) => [x.objet_id, x.code]));
  for (const o of objets) {
    if (codes.has(o)) continue;
    const code = Array.from({ length: 12 }, () => ALPHABET_CODE[randomInt(32)]).join('');
    await tx.execute(sql`INSERT INTO scolarite.verification (code, etablissement_id, type, objet_id) VALUES (${code}, ${etab}, ${type}, ${o})`);
    codes.set(o, code);
  }
  return codes;
}
