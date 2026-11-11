// Règles pures du domaine : tests sans base (conception § 11.1, « Domaine »).
import { describe, expect, it } from 'vitest';
import { calculerLigne, repartir, soldeTrancheEnCours } from '../src/modules/finances/domain/repartir.ts';
import { enLettresEn, enLettresFr, francsCfaEn, francsCfaFr } from '../src/modules/finances/domain/montant-lettres.ts';
import { tauxPaye, visibiliteBulletin } from '../src/modules/finances/domain/solvabilite.ts';
import { calculerResultats, distinctionProposee, REGLES_PAR_DEFAUT } from '../src/modules/pedagogie/domain/calcul.ts';
import { ecartDeCloture } from '../src/modules/caisse/domain/cloture.ts';

const lignes = [
  { id: 'insc', ordre: 1, reste: 0 },
  { id: 't1', ordre: 2, reste: 0 },
  { id: 't2', ordre: 3, reste: 10_000 },
  { id: 't3', ordre: 4, reste: 15_000 },
];

describe('RG-12 · répartition dans l\'ordre des tranches', () => {
  it('impute 15 000 sur la tranche 2 puis la tranche 3 (exemple de la maquette Encaissement)', () => {
    expect(repartir(15_000, lignes)).toEqual([{ ligneId: 't2', montant: 10_000 }, { ligneId: 't3', montant: 5_000 }]);
  });
  it('ignore l\'ordre de la liste fournie', () => {
    expect(repartir(12_000, [...lignes].reverse())[0]).toEqual({ ligneId: 't2', montant: 10_000 });
  });
  it('refuse un montant supérieur au reste dû', () => {
    expect(() => repartir(25_001, lignes)).toThrow(/dépasse/);
  });
  it('refuse un montant nul, négatif ou non entier (RG-20)', () => {
    expect(() => repartir(0, lignes)).toThrow();
    expect(() => repartir(-5, lignes)).toThrow();
    expect(() => repartir(10.5, lignes)).toThrow();
  });
  it('solde la tranche en cours', () => {
    expect(soldeTrancheEnCours(lignes)).toBe(10_000);
  });
});

describe('RG-10 · à payer et reste', () => {
  it('à payer = prix − réduction ; reste jamais négatif', () => {
    expect(calculerLigne(25_000, 5_000, 20_000)).toEqual({ aPayer: 20_000, verse: 20_000, reste: 0 });
    expect(calculerLigne(20_000, 0, 25_000).reste).toBe(0);
  });
});

describe('Montant en lettres (conception § 9.2)', () => {
  const cas: [number, string, string][] = [
    [71, 'soixante et onze', 'seventy-one'],
    [80, 'quatre-vingts', 'eighty'],
    [91, 'quatre-vingt-onze', 'ninety-one'],
    [100, 'cent', 'one hundred'],
    [200, 'deux cents', 'two hundred'],
    [1_000, 'mille', 'one thousand'],
    [1_000_000, 'un million', 'one million'],
    [15_000, 'quinze mille', 'fifteen thousand'],
    [70_000, 'soixante-dix mille', 'seventy thousand'],
    [280_000, 'deux cent quatre-vingt mille', 'two hundred and eighty thousand'],
    [201, 'deux cent un', 'two hundred and one'],
    [1_200_080, 'un million deux cent mille quatre-vingts', 'one million two hundred thousand and eighty'],
  ];
  for (const [n, fr, en] of cas) {
    it(`${n}`, () => {
      expect(enLettresFr(n)).toBe(fr);
      expect(enLettresEn(n)).toBe(en);
    });
  }
  it('formule du reçu', () => {
    expect(francsCfaFr(15_000)).toBe('Quinze mille francs CFA');
    expect(francsCfaEn(15_000)).toBe('Fifteen thousand CFA francs');
    expect(francsCfaFr(1_000_000)).toBe('Un million de francs CFA');
  });
});

describe('RG-40 · visibilité du bulletin pour le parent', () => {
  const ech = [
    { ordre: 1, aPayer: 10_000, verse: 10_000 },
    { ordre: 2, aPayer: 20_000, verse: 14_000 }, // tranche 1 payée à 70 %
    { ordre: 3, aPayer: 18_000, verse: 0 },
  ];
  it('bloque un bulletin de période sous 90 % de la tranche rattachée', () => {
    expect(visibiliteBulletin(ech, 1, false, false)).toMatchObject({ visible: false, taux: 70, seuil: 90 });
  });
  it('rend visible à 90 % exactement', () => {
    const e = ech.map((l) => (l.ordre === 2 ? { ...l, verse: 18_000 } : l));
    expect(visibiliteBulletin(e, 1, false, false).visible).toBe(true);
  });
  it('exige 100 % des frais de l\'année pour le bulletin annuel', () => {
    const e = ech.map((l) => ({ ...l, verse: l.aPayer }));
    expect(visibiliteBulletin(e, null, true, false).visible).toBe(true);
    e[2]!.verse -= 1;
    expect(visibiliteBulletin(e, null, true, false).visible).toBe(false);
  });
  it('la levée du blocage par le directeur rend visible', () => {
    expect(visibiliteBulletin(ech, 1, false, true).visible).toBe(true);
  });
  it('une tranche sans montant dû compte comme payée', () => {
    expect(tauxPaye([{ ordre: 2, aPayer: 0, verse: 0 }])).toBe(100);
  });
});

describe('RG-23 à RG-26 · moteur de calcul', () => {
  const programme = [{ matiereId: 'fr', coefficient: 4, ordre: 1 }, { matiereId: 'ma', coefficient: 2, ordre: 2 }];
  const evaluations = [{ id: 'e1', matiereId: 'fr', bareme: 20 }, { id: 'e2', matiereId: 'ma', bareme: 10 }, { id: 'e3', matiereId: 'ma', bareme: 20 }];
  it('ramène sur 20, pondère et arrondit au centième', () => {
    const r = calculerResultats(REGLES_PAR_DEFAUT, programme, evaluations, [
      { evaluationId: 'e1', inscriptionId: 'a', valeur: 13.5, statut: 'present' },
      { evaluationId: 'e2', inscriptionId: 'a', valeur: 7, statut: 'present' }, // 14/20
      { evaluationId: 'e3', inscriptionId: 'a', valeur: 15, statut: 'present' },
    ], ['a']);
    // français 13,50 ; maths (14 + 15) / 2 = 14,50 ; (13,5×4 + 14,5×2) / 6 = 13,83
    expect(r.eleves[0]!.moyenne).toBe(13.83);
    expect(r.eleves[0]!.matieres[1]!.points).toBe(29);
  });
  it('sort l\'absent justifié et le dispensé ; compte zéro pour l\'absence non justifiée (RG-24)', () => {
    const r = calculerResultats(REGLES_PAR_DEFAUT, programme, evaluations, [
      { evaluationId: 'e1', inscriptionId: 'a', valeur: 12, statut: 'present' },
      { evaluationId: 'e2', inscriptionId: 'a', valeur: null, statut: 'absent_justifie' },
      { evaluationId: 'e3', inscriptionId: 'a', valeur: 16, statut: 'present' },
      { evaluationId: 'e1', inscriptionId: 'b', valeur: null, statut: 'absent' },
      { evaluationId: 'e3', inscriptionId: 'b', valeur: 10, statut: 'present' },
    ], ['a', 'b']);
    expect(r.eleves[0]!.matieres[1]!.moyenne).toBe(16);
    expect(r.eleves[1]!.matieres[0]!.moyenne).toBe(0);
  });
  it('donne le même rang aux ex æquo et décale le suivant : 1, 2, 2, 4 (RG-26)', () => {
    const notes = [['a', 18], ['b', 15], ['c', 15], ['d', 9]].map(([i, v]) => (
      { evaluationId: 'e1', inscriptionId: i as string, valeur: v as number, statut: 'present' as const }));
    const r = calculerResultats(REGLES_PAR_DEFAUT, programme, evaluations, notes, ['a', 'b', 'c', 'd']);
    expect(r.eleves.map((e) => e.rang)).toEqual([1, 2, 2, 4]);
    expect(r.max).toBe(18);
    expect(r.min).toBe(9);
  });
  it('propose les distinctions selon les seuils', () => {
    expect(distinctionProposee(REGLES_PAR_DEFAUT, 14.35, 0)).toBe('tableau_honneur');
    expect(distinctionProposee(REGLES_PAR_DEFAUT, 14.35, 1)).toBe('encouragements');
    expect(distinctionProposee(REGLES_PAR_DEFAUT, 7.45, 1)).toBe('avertissement_travail');
    expect(distinctionProposee(REGLES_PAR_DEFAUT, 10, 0)).toBe('aucune');
  });
});

describe('RG-18 · écart de clôture', () => {
  it('calcule l\'écart et exige un motif s\'il n\'est pas nul', () => {
    expect(ecartDeCloture(77_500, 20_000, 66_000, 8_500, null)).toBe(0);
    expect(() => ecartDeCloture(77_000, 20_000, 66_000, 8_500, '')).toThrow(/motif/);
    expect(ecartDeCloture(77_000, 20_000, 66_000, 8_500, 'Erreur de rendu de monnaie')).toBe(-500);
  });
});

describe('Messages montrés à l\'écran', () => {
  it('ne citent ni les règles ni les écarts des cahiers', async () => {
    const { sansReferences, interdit } = await import('../src/core/erreurs.ts');
    expect(sansReferences('Ce bordereau est déjà enregistré pour cette banque (RG-13).')).toBe('Ce bordereau est déjà enregistré pour cette banque.');
    expect(sansReferences('Cet élève a déjà une inscription active cette année (RG-05) : changez-le de classe.'))
      .toBe('Cet élève a déjà une inscription active cette année : changez-le de classe.');
    expect(sansReferences('Aucune grille des frais pour le niveau CE2 (CU-07).')).toBe('Aucune grille des frais pour le niveau CE2.');
    const e = interdit('finances.versement.encaisser');
    expect(e.message).toBe('Cette action est hors de vos droits.');
    expect(e.permission).toBe('finances.versement.encaisser');
  });
});

describe('Sauvegardes : rotation', () => {
  it('ne tourne que sur les sauvegardes automatiques ; les sauvegardes demandées restent', async () => {
    const { estAutomatique, motifValide } = await import('@gs/db');
    expect(estAutomatique('gs-20261111-180000-quotidienne.sauvegarde')).toBe(true);
    expect(estAutomatique('gs-20261111-180500-avant-restauration.sauvegarde')).toBe(true);
    expect(estAutomatique('gs-20261111-120000-depart.sauvegarde')).toBe(false);
    expect(estAutomatique('gs-20261111-120000-manuelle.sauvegarde')).toBe(false);
    expect(motifValide('depart')).toBe(true);
    expect(motifValide('Départ !')).toBe(false);
  });
});
