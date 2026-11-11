// Moteur de calcul des notes (conception § 9.3) : fonction pure, décimal exact (decimal.js).
// RG-23 note ramenée sur 20 ; RG-24 absent justifié ou dispensé hors moyenne, absence non justifiée selon la règle ;
// RG-25 moyenne générale pondérée, arrondie au centième ; RG-26 ex æquo avec saut de rang.
import { Decimal } from 'decimal.js';

export interface Regles {
  absenceNonJustifiee: 'zero' | 'exclue';
  arrondi: { decimales: number };
  mentions: { tableauHonneur: number; encouragements: number; avertissement: number };
  passage: { moyenneAnnuelleMin: number };
}

export const REGLES_PAR_DEFAUT: Regles = {
  absenceNonJustifiee: 'zero',
  arrondi: { decimales: 2 },
  mentions: { tableauHonneur: 14, encouragements: 12, avertissement: 8 },
  passage: { moyenneAnnuelleMin: 10 },
};

export interface ProgrammeMatiere { matiereId: string; coefficient: number; ordre: number }
export interface EvaluationCalcul { id: string; matiereId: string; bareme: number }
export interface NoteCalcul { evaluationId: string; inscriptionId: string; valeur: number | null; statut: 'present' | 'absent' | 'absent_justifie' | 'dispense' }

export interface ResultatMatiere { matiereId: string; coefficient: number; moyenne: number | null; points: number | null; moyenneClasse: number | null }
export interface ResultatEleve { inscriptionId: string; matieres: ResultatMatiere[]; moyenne: number | null; rang: number | null }
export interface ResultatClasse {
  eleves: ResultatEleve[];
  moyenneClasse: number | null; min: number | null; max: number | null; effectif: number;
}

const arrondir = (d: Decimal, decimales: number) => d.toDecimalPlaces(decimales, Decimal.ROUND_HALF_UP).toNumber();

export function calculerResultats(regles: Regles, programme: ProgrammeMatiere[], evaluations: EvaluationCalcul[],
  notes: NoteCalcul[], inscriptions: string[]): ResultatClasse {
  const evalParId = new Map(evaluations.map((e) => [e.id, e]));
  const notesParEleve = new Map<string, NoteCalcul[]>();
  for (const n of notes) notesParEleve.set(n.inscriptionId, [...(notesParEleve.get(n.inscriptionId) ?? []), n]);
  const dec = regles.arrondi.decimales;

  const brut = inscriptions.map((insc) => {
    const sesNotes = notesParEleve.get(insc) ?? [];
    const matieres = [...programme].sort((a, b) => a.ordre - b.ordre).map((p) => {
      const valeurs: Decimal[] = [];
      for (const n of sesNotes) {
        const ev = evalParId.get(n.evaluationId);
        if (!ev || ev.matiereId !== p.matiereId) continue;
        if (n.statut === 'present' && n.valeur !== null) valeurs.push(new Decimal(n.valeur).mul(20).div(ev.bareme));
        else if (n.statut === 'absent' && regles.absenceNonJustifiee === 'zero') valeurs.push(new Decimal(0));
        // absent justifié, dispensé, ou absence « exclue » : l'évaluation sort de la moyenne (RG-24)
      }
      const moy = valeurs.length ? valeurs.reduce((a, b) => a.add(b), new Decimal(0)).div(valeurs.length) : null;
      return { matiereId: p.matiereId, coefficient: p.coefficient, moyenne: moy };
    });
    const notees = matieres.filter((m) => m.moyenne !== null);
    const sommeCoef = notees.reduce((s, m) => s.add(m.coefficient), new Decimal(0));
    const moyenne = sommeCoef.gt(0)
      ? notees.reduce((s, m) => s.add(arrondirDec(m.moyenne!, dec).mul(m.coefficient)), new Decimal(0)).div(sommeCoef)
      : null;
    return { inscriptionId: insc, matieres, moyenne: moyenne ? arrondir(moyenne, dec) : null };
  });

  // Moyenne de la classe par matière
  const moyClasseMatiere = new Map<string, number | null>();
  for (const p of programme) {
    const vals = brut.map((e) => e.matieres.find((m) => m.matiereId === p.matiereId)?.moyenne).filter((v): v is Decimal => !!v);
    moyClasseMatiere.set(p.matiereId, vals.length ? arrondir(vals.reduce((a, b) => a.add(b), new Decimal(0)).div(vals.length), dec) : null);
  }

  // RG-26 : rangs ex æquo avec saut (1, 2, 2, 4)
  const classees = brut.filter((e) => e.moyenne !== null).sort((a, b) => b.moyenne! - a.moyenne!);
  const rangs = new Map<string, number>();
  classees.forEach((e, i) => {
    const precedent = classees[i - 1];
    rangs.set(e.inscriptionId, precedent && precedent.moyenne === e.moyenne ? rangs.get(precedent.inscriptionId)! : i + 1);
  });

  const moyennes = classees.map((e) => new Decimal(e.moyenne!));
  return {
    eleves: brut.map((e) => ({
      inscriptionId: e.inscriptionId,
      moyenne: e.moyenne,
      rang: rangs.get(e.inscriptionId) ?? null,
      matieres: e.matieres.map((m) => ({
        matiereId: m.matiereId, coefficient: m.coefficient,
        moyenne: m.moyenne ? arrondir(m.moyenne, dec) : null,
        points: m.moyenne ? arrondir(arrondirDec(m.moyenne, dec).mul(m.coefficient), dec) : null,
        moyenneClasse: moyClasseMatiere.get(m.matiereId) ?? null,
      })),
    })),
    moyenneClasse: moyennes.length ? arrondir(moyennes.reduce((a, b) => a.add(b), new Decimal(0)).div(moyennes.length), dec) : null,
    min: moyennes.length ? Decimal.min(...moyennes).toNumber() : null,
    max: moyennes.length ? Decimal.max(...moyennes).toNumber() : null,
    effectif: inscriptions.length,
  };
}

function arrondirDec(d: Decimal, dec: number) {
  return d.toDecimalPlaces(dec, Decimal.ROUND_HALF_UP);
}

export type Distinction = 'tableau_honneur' | 'encouragements' | 'aucune' | 'avertissement_travail';

/** Distinction proposée d'après les seuils paramétrés (14, 12, 8 ; tableau d'honneur sans sanction). */
export function distinctionProposee(regles: Regles, moyenne: number | null, sanctions: number): Distinction {
  if (moyenne === null) return 'aucune';
  if (moyenne >= regles.mentions.tableauHonneur && sanctions === 0) return 'tableau_honneur';
  if (moyenne >= regles.mentions.encouragements) return 'encouragements';
  if (moyenne < regles.mentions.avertissement) return 'avertissement_travail';
  return 'aucune';
}
