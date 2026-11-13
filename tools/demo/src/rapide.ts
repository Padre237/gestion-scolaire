// pnpm demo:donnees — école complète sur deux années (2025/2026 achevée et clôturée, 2026/2027 jusqu'à aujourd'hui),
// 25 à 30 élèves par classe avec leurs familles, en quelques minutes.
// La structure (établissement, classes, personnel, matières, grilles, emplois du temps) passe par l'API ; le volume
// (familles, élèves, inscriptions, échéanciers, versements, caisse, notes, appels) est inséré directement en SQL ;
// bulletins, conseils de classe et clôture d'année sont ensuite calculés par l'application elle-même.
import { randomBytes } from 'node:crypto';
// Comptes de répétition (mots de passe « demo-… » connus) : scrypt au coût interactif standard (N = 2^14) au lieu de 2^17.
// Le coût est enregistré dans chaque empreinte : la connexion fonctionne, et les comptes créés ensuite dans l'application gardent 2^17.
process.env.GS_SCRYPT_N ??= String(2 ** 14);
import { creerBase, lireOuCreerConfig, migrer, connexionProprietaire } from '@gs/db';
import { Bd, creerPool } from '@gs/api/src/core/bd.ts';
import { construireApp } from '@gs/api/src/app.ts';
import { creerEtablissement } from '@gs/api/src/core/etablissement.ts';
import { hacher } from '@gs/api/src/core/motdepasse.ts';
import { FORMATS, cleCompteur } from '@gs/api/src/modules/structure/index.ts';
import { connecter } from './client.ts';
import { demander, drapeau, sortir } from './commun.ts';
import { CLASSES, anglophone, classeDe, classesSuivantes, elevesDe, genererEcole, matieresDuNiveau, matieresPar } from './fictif-ecole.ts';
import { affectations, creerAnnee, emploiDuTemps, fondation, grille, lirePeriodes } from './fictif-annee.ts';
import {
  AUJ, DEBUT, choisir, dernierVendredi, entier, hasard, hhmm, jourEntre, joursOuvrables, ouvrableApres, ouvrableAvant, plusJours, premierLundi,
  type Annee, type Contexte, type Eleve, type Horloge,
} from './fictif-outils.ts';

// ---------------------------------------------------------------- outils SQL
const uuid7 = (ms: number) => {
  const b = randomBytes(16);
  b.writeUIntBE(Math.max(0, Math.floor(ms)), 0, 6);
  b[6] = (b[6]! & 0x0f) | 0x70;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = b.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
};
const ts = (jour: string, h = '09:00') => `${jour}T${h}:00+01:00`;
const ms = (jour: string, h = '09:00') => new Date(ts(jour, h)).getTime();
const nomDe = (e: Eleve) => `${e.nom} ${e.prenoms}`;
const chiffres = (t: string) => t.replace(/\D/g, '');
/** Traite les éléments n par n (classes indépendantes : bulletins, conseils). */
async function parallele<T>(liste: readonly T[], n: number, fn: (x: T) => Promise<unknown>) {
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < liste.length) await fn(liste[i++]!); }));
}

async function main() {
  const config = lireOuCreerConfig();
  console.log(`Base « ${config.pg.base} » : école sur deux années, ${DEBUT - 1}/${DEBUT} et ${DEBUT}/${DEBUT + 1} (en cours).`);
  if (!drapeau('oui')) {
    const ok = await demander(`La base « ${config.pg.base} » sera effacée puis recréée. Tapez OUI pour continuer`);
    if (ok !== 'OUI') sortir('Rien n’a été modifié.', 0);
  }
  const t0 = Date.now();
  const etape = (t: string) => console.log(`${t}… (${Math.round((Date.now() - t0) / 1000)} s)`);
  const [A1, A2] = [DEBUT - 1, DEBUT].map((d): Annee => ({ debut: d, libelle: `${d}/${d + 1}`, rentree: premierLundi(d), fin: dernierVendredi(d), courante: d === DEBUT, periodes: [], classes: {} })) as [Annee, Annee];
  const ecole = genererEcole(false, 2);
  console.log(`${ecole.eleves.length} élèves, ${ecole.familles.length} familles ; ${elevesDe(ecole.eleves, A2.debut).length} élèves cette année dans ${CLASSES.length} classes.`);

  await creerBase(config.pg, config.pg.base, true);
  await migrer(config.pg, config.pg.base);
  const pool = creerPool(config.pg);
  const bd = new Bd(pool);
  const db = connexionProprietaire(config.pg);
  await db.connect();
  // Insertion directe : les déclencheurs (journal d'audit, contrôles) ne se déclenchent pas sur cette connexion.
  await db.query('SET session_replication_role = replica');
  const app = await construireApp({ bd, dossierWeb: '/inexistant', journal: false });
  await app.ready();
  const q = (sql: string, p: unknown[] = []) => db.query(sql, p);
  /** Insertion en masse, par paquets (les déclencheurs d'audit sont coupés : seules les données métier entrent). */
  const inserer = async (table: string, colonnes: string[], lignes: unknown[][]) => {
    const parPaquet = Math.floor(30000 / colonnes.length);
    for (let i = 0; i < lignes.length; i += parPaquet) {
      const paquet = lignes.slice(i, i + parPaquet);
      const params: unknown[] = [];
      const valeurs = paquet.map((l) => `(${l.map((v) => { params.push(v); return `$${params.length}`; }).join(',')})`);
      await q(`INSERT INTO ${table} (${colonnes.join(',')}) VALUES ${valeurs.join(',')}`, params);
    }
  };
  /** Ramène les lignes du journal écrites depuis un repère à une date plausible. */
  const marque = async () => (await q('SELECT clock_timestamp() AS t')).rows[0].t as string;
  const dater = async (depuis: string, du: string, au: string) => {
    await q(`UPDATE core.journal_audit SET horodatage = $2::timestamptz + random() * ($3::timestamptz - $2::timestamptz) WHERE horodatage >= $1`, [depuis, ts(du, '08:00'), ts(au, '17:00')]);
  };

  try {
    // ---------------------------------------------------------- 1. structure par l'API
    etape('Structure : établissement, classes, personnel, matières, grilles, emplois du temps');
    let m = await marque();
    await creerEtablissement(bd, { nomFr: 'Groupe scolaire bilingue La Ruche d’Or', nomEn: 'La Ruche d’Or Bilingual School',
      secretaire: { identifiant: 'secretaire', nomAffiche: 'Mme NDZANA Rose', motDePasse: 'demo-secretaire' },
      // La directrice gère les comptes et les rôles (D-46) : elle est créée avec l'établissement.
      directeur: { identifiant: 'directrice', nomAffiche: 'Mme ATEBA Marie-Claire', motDePasse: 'demo-directrice' } });
    const sec = await connecter(app, 'secretaire', 'demo-secretaire');
    const horloge: Horloge = { a: (_d, fn) => fn() };
    const ctx = { app, horloge, proprio: db, sec, comptes: {}, niveaux: {}, personnel: {}, matieres: {}, annees: [A1, A2], eleves: ecole.eleves, parents: {}, petit: false } as unknown as Contexte;
    ctx.parNom = (n: string) => ctx.eleves.find((e) => nomDe(e) === n) ?? sortir(`Élève introuvable : ${n}`);
    await fondation(ctx, A1);
    await lirePeriodes(ctx, A1);
    await grille(ctx, A1, new Date());
    await affectations(ctx, A1);
    await emploiDuTemps(ctx, A1, 6);
    await dater(m, plusJours(A1.rentree, -25), plusJours(A1.rentree, -2));

    const etab = (await q('SELECT id FROM structure.etablissement')).rows[0].id as string;
    const comptes = new Map<string, { id: string; personnel: string | null }>((await q('SELECT identifiant, id, personnel_id FROM core.compte')).rows.map((r) => [r.identifiant, { id: r.id, personnel: r.personnel_id }]));
    const compteDePersonnel = new Map([...comptes.values()].filter((c) => c.personnel).map((c) => [c.personnel!, c.id]));
    const econome = comptes.get('econome')!.id;
    const roleParent = (await q(`SELECT id FROM core.role WHERE code = 'parent'`)).rows[0].id as string;
    const principalCompte = (classe: string) => comptes.get(classeDe(classe).principal[0])!.id;
    const titulaireCompte = (a: Annee, classe: string, matiere: string): string | null => {
      const ex = matieresPar(a.debut).find(([, mt, cl]) => mt === matiere && cl.includes(classe));
      if (!ex) return principalCompte(classe);
      return compteDePersonnel.get(ctx.personnel[ex[0]]!) ?? null;
    };

    // ---------------------------------------------------------- 2. familles et élèves (SQL)
    etape('Familles, responsables, comptes parents, élèves');
    const premiereInscription = (e: Eleve) => {
      const a = Math.min(...Object.keys(e.parcours).map(Number));
      const rentree = a === A1.debut ? A1.rentree : A2.rentree;
      if (!e.inscritLe) e.inscritLe = e.parcours[a]!.type === 'nouvelle' || a === A1.debut && e.entree === A1.debut
        ? ouvrableApres(plusJours(rentree, hasard() < 0.9 ? -entier(1, 20) : entier(1, 15))) : ouvrableApres(plusJours(rentree, -15));
      return e.inscritLe;
    };
    const familles = [...new Set(ecole.eleves.map((e) => e.famille))];
    const idFamille = new Map(familles.map((f) => [f, uuid7(ms(premiereInscription(ecole.eleves.find((e) => e.famille === f)!)))]));
    await inserer('scolarite.famille', ['id', 'etablissement_id', 'nom', 'cree_le'], familles.map((f) => [idFamille.get(f), etab, f.nom, ts(premiereInscription(ecole.eleves.find((e) => e.famille === f)!))]));
    const responsables: unknown[][] = [];
    const idResp = new Map<string, string>();
    for (const f of familles) {
      for (const r of [{ nom: f.payeur, tel: f.telephone }, ...(f.second ? [{ nom: f.second.nom, tel: f.second.telephone }] : [])]) {
        const id = uuid7(ms(premiereInscription(ecole.eleves.find((e) => e.famille === f)!)));
        idResp.set(chiffres(r.tel), id);
        responsables.push([id, etab, idFamille.get(f), r.nom, chiffres(r.tel), f.langue]);
      }
    }
    await inserer('scolarite.responsable', ['id', 'etablissement_id', 'famille_id', 'nom', 'telephone', 'langue'], responsables);
    // Les mots de passe des parents (scrypt, coûteux) se calculent en parallèle du reste ; les comptes sont créés à la fin.
    const nomsFamille = [...new Set(familles.map((f) => f.nom))];
    const hachagesP = Promise.all(nomsFamille.map((n) => hacher(`demo-${n.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')}`)))
      .then((h) => new Map(nomsFamille.map((n, i) => [n, h[i]!])));
    hachagesP.catch(() => {});
    // Matricules : année d'entrée, section, ordre sans trou.
    const compteurs = new Map<string, number>();
    const eleves: unknown[][] = [];
    for (const e of ecole.eleves.sort((x, y) => premiereInscription(x).localeCompare(premiereInscription(y)))) {
      const premiere = e.parcours[Math.min(...Object.keys(e.parcours).map(Number))]!;
      const section = anglophone(classeDe(premiere.classe).niveau) ? 'ANG' : 'FR';
      const cle = cleCompteur.matricule(e.entree, section);
      const n = (compteurs.get(cle) ?? 0) + 1;
      compteurs.set(cle, n);
      e.matricule = FORMATS.matricule(e.entree, section, n);
      e.eleveId = uuid7(ms(premiereInscription(e)));
      eleves.push([e.eleveId, etab, e.matricule, e.nom, e.prenoms, e.sexe, e.naissance, e.lieu, idFamille.get(e.famille), ts(premiereInscription(e))]);
    }
    await inserer('scolarite.eleve', ['id', 'etablissement_id', 'matricule', 'nom', 'prenoms', 'sexe', 'date_naissance', 'lieu_naissance', 'famille_id', 'cree_le'], eleves);
    await inserer('scolarite.eleve_responsable', ['eleve_id', 'responsable_id', 'lien', 'payeur', 'recoit_sms', 'ordre'], ecole.eleves.flatMap((e) => [
      [e.eleveId, idResp.get(chiffres(e.famille.telephone)), e.famille.lien, true, true, 1],
      ...(e.famille.second ? [[e.eleveId, idResp.get(chiffres(e.famille.second.telephone)), e.famille.second.lien, false, hasard() < 0.5, 2]] : []),
    ]));

    // ---------------------------------------------------------- 3. inscriptions, échéanciers, versements, caisse (SQL)
    let recu = 0, bordereau = 5000;
    const recus = new Map<number, number>();
    /** Crée inscriptions et échéanciers (copiés de la grille) pour ces élèves. */
    const inscrire = async (a: Annee, liste: Eleve[]) => {
      const lignes = liste.map((e) => {
        const p = e.parcours[a.debut]!;
        p.inscriptionId = uuid7(ms(e.inscritLe && e.inscritLe >= plusJours(a.rentree, -40) ? e.inscritLe : plusJours(a.rentree, -15)));
        const jour = e.inscritLe && e.inscritLe >= plusJours(a.rentree, -40) ? e.inscritLe : ouvrableApres(plusJours(a.rentree, -15));
        return [p.inscriptionId, etab, a.id, e.eleveId, a.classes[p.classe], p.type, p.type === 'nouvelle' ? 'nouveau' : 'ancien', 'attente', ts(jour, hhmm(entier(8 * 60, 16 * 60))), ts(jour)];
      });
      await inserer('scolarite.inscription', ['id', 'etablissement_id', 'annee_id', 'eleve_id', 'classe_id', 'type', 'tarif', 'statut', 'inscrit_le', 'cree_le'], lignes);
      await q(`INSERT INTO finances.ligne_echeance (etablissement_id, inscription_id, rubrique_id, libelle_fr, libelle_en, ordre, prix_unitaire, date_limite, cree_le)
        SELECT i.etablissement_id, i.id, l.rubrique_id, l.libelle_fr, l.libelle_en, l.ordre, l.montant, l.date_limite, i.inscrit_le
          FROM scolarite.inscription i JOIN structure.classe c ON c.id = i.classe_id
          JOIN finances.grille_frais g ON g.annee_id = i.annee_id AND g.niveau_id = c.niveau_id AND g.statut_eleve = i.tarif
          JOIN finances.ligne_grille l ON l.grille_id = g.id WHERE i.id = ANY($1::uuid[])`, [lignes.map((l) => l[0])]);
    };
    /** Réductions de l'année (fratrie, enfant du personnel), portées sur l'échéancier. */
    const reduire = async (a: Annee) => {
      for (const e of elevesDe(ecole.eleves, a.debut).filter((x) => x.reductions && x.parcours[a.debut]!.inscriptionId)) {
        for (const r of e.reductions!) await q(`UPDATE finances.ligne_echeance SET reduction = $3, motif_reduction = $4 WHERE inscription_id = $1 AND ordre = $2`, [e.parcours[a.debut]!.inscriptionId, r.ordre, r.montant, r.motif]);
      }
    };
    /** Versements de l'année : plan par profil, répartition dans l'ordre des lignes, reçus numérotés, journées de caisse. */
    const encaisser = async (a: Annee) => {
      const liste = elevesDe(ecole.eleves, a.debut).filter((e) => e.parcours[a.debut]!.inscriptionId);
      const lignes = (await q(`SELECT l.id, l.inscription_id, l.ordre, l.prix_unitaire - l.reduction AS du FROM finances.ligne_echeance l JOIN scolarite.inscription i ON i.id = l.inscription_id
        WHERE i.annee_id = $1 ORDER BY l.ordre`, [a.id])).rows as { id: string; inscription_id: string; ordre: number; du: string }[];
      const parInscription = new Map<string, { id: string; ordre: number; reste: number }[]>();
      for (const l of lignes) { if (!parInscription.has(l.inscription_id)) parInscription.set(l.inscription_id, []); parInscription.get(l.inscription_id)!.push({ id: l.id, ordre: l.ordre, reste: Number(l.du) }); }
      const D = a.debut;
      const fin = a.courante ? plusJours(AUJ, -1) : `${D + 1}-05-29`;
      type V = { e: Eleve; jour: string; minute: number; montant: number; mode: string };
      const plan: V[] = [];
      for (const e of liste) {
        const p = e.parcours[a.debut]!;
        const ls = parInscription.get(p.inscriptionId!) ?? [];
        const du = (o: number) => ls.find((l) => l.ordre === o)?.reste ?? 0;
        const ajouter = (jour: string | null, montant: number) => {
          if (!jour || montant <= 0 || jour > fin || jour >= AUJ) return;
          const r = hasard();
          plan.push({ e, jour, minute: entier(7 * 60 + 50, 16 * 60 + 10), montant, mode: r < 0.88 ? 'especes' : r < 0.97 ? 'versement_bancaire' : r < 0.985 ? 'virement' : 'cheque' });
        };
        const debut = ouvrableApres(e.inscritLe && e.inscritLe >= plusJours(a.rentree, -40) ? e.inscritLe : plusJours(a.rentree, -15));
        const profil = p.profil === 'fixe' ? 'bon' : p.profil;
        if (profil === 'attente') continue;
        ajouter(debut, du(0) + du(1));
        const arr = (x: number) => Math.round(x / 1000) * 1000;
        if (!a.courante) {
          const finDepart = p.fin === 'depart' || p.fin === 'exclu' ? `${D + 1}-03-30` : fin;
          ajouter(jourEntre(plusJours(a.rentree, 3), `${D}-11-30`), du(2));
          if (profil === 'arriere') { if (hasard() < 0.6) ajouter(jourEntre(`${D}-12-01`, `${D + 1}-02-28`), arr(du(3) / 2)); continue; }
          ajouter(jourEntre(`${D}-12-01`, `${D + 1}-02-28`), du(3));
          ajouter(jourEntre(`${D + 1}-03-01`, finDepart), du(4));
          continue;
        }
        if (profil === 'solde') { ajouter(jourEntre(plusJours(a.rentree, 3), `${D}-09-30`), du(2)); ajouter(jourEntre(`${D}-10-05`, `${D}-10-31`), du(3)); ajouter(jourEntre(`${D}-11-01`, fin), du(4)); }
        else if (profil === 'bon') { ajouter(jourEntre(plusJours(a.rentree, 3), `${D}-09-30`), du(2)); ajouter(jourEntre(`${D}-10-12`, fin), arr(du(3) * choisir([0, 0, 0.25, 0.5, 1]))); }
        else if (profil === 'moyen') ajouter(jourEntre(plusJours(a.rentree, 3), `${D}-10-25`), arr(du(2) * choisir([0.4, 0.5, 0.6, 0.7])));
        else if (profil === 'tardif') ajouter(jourEntre(`${D}-10-06`, fin), du(2));
      }
      plan.sort((x, y) => x.jour.localeCompare(y.jour) || x.minute - y.minute);
      const annee = a.debut; // année civile de la rentrée : R2025-…, R2026-…
      recu = 0;
      const versements: unknown[][] = [], imputations: unknown[][] = [], mouvements: unknown[][] = [], sessions: unknown[][] = [];
      const sessionDuJour = new Map<string, { id: string; especes: number }>();
      for (const v of plan) {
        const p = v.e.parcours[a.debut]!;
        const ls = parInscription.get(p.inscriptionId!) ?? [];
        let reste = Math.min(v.montant, ls.reduce((s, l) => s + l.reste, 0));
        if (reste <= 0) continue;
        const montant = reste;
        const id = uuid7(ms(v.jour, hhmm(v.minute)));
        const numero = FORMATS.recu(annee, ++recu);
        let s = sessionDuJour.get(v.jour);
        if (!s) { s = { id: uuid7(ms(v.jour, '07:35')), especes: 0 }; sessionDuJour.set(v.jour, s); }
        if (v.mode === 'especes') s.especes += montant;
        const bancaire = v.mode === 'versement_bancaire';
        versements.push([id, etab, a.id, p.inscriptionId, numero, ts(v.jour, hhmm(v.minute)), montant, v.mode, bancaire ? 'Banque de Yaoundé' : null, bancaire ? `BV-00${bordereau += entier(3, 9)}` : null,
          bancaire ? v.jour : null, 'valide', econome, `donnees-${id}`, ts(v.jour, hhmm(v.minute))]);
        for (const l of ls) {
          if (reste <= 0) break;
          const x = Math.min(l.reste, reste);
          if (x <= 0) continue;
          l.reste -= x; reste -= x;
          imputations.push([etab, id, l.id, x]);
        }
        mouvements.push([etab, s.id, id, 'entree', 'versement', `${numero} · ${nomDe(v.e)} · ${p.classe}`, v.mode, montant, ts(v.jour, hhmm(v.minute)), econome]);
      }
      for (const [jour, s] of sessionDuJour) sessions.push([s.id, etab, 'principale', econome, ts(jour, '07:35'), ts(jour, '16:45'), 20000, 20000 + s.especes, 0, ts(jour, '07:35')]);
      await inserer('caisse.session', ['id', 'etablissement_id', 'caisse', 'caissier_id', 'ouverte_le', 'cloturee_le', 'fonds_initial', 'montant_compte', 'ecart', 'cree_le'], sessions);
      await inserer('finances.versement', ['id', 'etablissement_id', 'annee_id', 'inscription_id', 'numero_recu', 'encaisse_le', 'montant', 'mode', 'banque', 'bordereau', 'date_bordereau', 'statut', 'caissier_id', 'cle_idempotence', 'cree_le'], versements);
      await inserer('finances.imputation', ['etablissement_id', 'versement_id', 'ligne_echeance_id', 'montant'], imputations);
      await inserer('caisse.mouvement', ['etablissement_id', 'session_id', 'versement_id', 'sens', 'nature', 'libelle', 'mode', 'montant', 'horodatage', 'cree_par'], mouvements);
      recus.set(annee, recu);
      // Inscription validée dès que l'arriéré et l'inscription sont payés (cycle de vie 7.1).
      await q(`UPDATE scolarite.inscription i SET statut = 'validee' WHERE i.annee_id = $1 AND i.statut = 'attente'
        AND NOT EXISTS (SELECT 1 FROM finances.ligne_echeance l WHERE l.inscription_id = i.id AND l.ordre <= 1
                          AND l.prix_unitaire - l.reduction > COALESCE((SELECT sum(im.montant) FROM finances.imputation im WHERE im.ligne_echeance_id = l.id), 0))`, [a.id]);
      console.log(`  ${a.libelle} : ${versements.length} versements, ${sessions.length} journées de caisse`);
    };

    // ---------------------------------------------------------- 4. notes (SQL) et appels
    const noter = async (a: Annee, sequences: { id: string; numero: number; du: string; au: string; part: number }[]) => {
      const evaluations: unknown[][] = [], notes: unknown[][] = [];
      const decal = new Map<string, number>();
      for (const s of sequences) {
        for (const c of CLASSES) {
          if (s.part < 1 && hasard() < 0.35) continue;
          const inscrits = elevesDe(ecole.eleves, a.debut).filter((e) => e.parcours[a.debut]!.classe === c.nom && e.parcours[a.debut]!.inscriptionId);
          const jour = jourEntre(s.du, s.au) ?? s.du;
          for (const mt of matieresDuNiveau(c.niveau)) {
            const auteur = titulaireCompte(a, c.nom, mt.libelle);
            if (!auteur) continue;
            const id = uuid7(ms(jour, '15:00'));
            evaluations.push([id, etab, s.id, a.classes[c.nom], ctx.matieres[mt.libelle], jour, 20, auteur, ts(jour, '17:00')]);
            for (const e of inscrits) {
              if (s.part < 1 && hasard() > s.part) continue;
              const k = `${nomDe(e)}|${mt.libelle}`;
              if (!decal.has(k)) decal.set(k, (hasard() - 0.5) * 5);
              const v = Math.max(1, Math.min(19.5, Math.round((e.niveauScolaire + decal.get(k)! + (hasard() - 0.5) * 3) * 2) / 2));
              const absent = hasard() < 0.02;
              notes.push([etab, id, e.parcours[a.debut]!.inscriptionId, absent ? null : v, absent ? 'absent_justifie' : 'present', auteur, ts(jour, '17:00')]);
            }
          }
        }
      }
      await inserer('pedagogie.evaluation', ['id', 'etablissement_id', 'sequence_id', 'classe_id', 'matiere_id', 'fait_le', 'bareme', 'cree_par', 'cree_le'], evaluations);
      await inserer('pedagogie.note', ['etablissement_id', 'evaluation_id', 'inscription_id', 'valeur', 'statut', 'saisie_par', 'cree_le'], notes);
      console.log(`  ${a.libelle} : ${evaluations.length} évaluations, ${notes.length} notes`);
    };
    const appeler = async (a: Annee, jours: string[]) => {
      // Les fiches du jour viennent de l'emploi du temps publié : un créneau de cours = une fiche (règle RG-38).
      await q(`INSERT INTO vie_scolaire.fiche_appel (etablissement_id, classe_id, jour, debut, fin, libelle, personnel_id)
        SELECT co.etablissement_id, co.classe_id, d::date, cr.debut, cr.fin, COALESCE(m.libelle_fr, co.libelle), co.personnel_id
          FROM unnest($1::date[]) d JOIN pedagogie.cours co ON co.jour = extract(isodow FROM d)::int
          JOIN structure.classe k ON k.id = co.classe_id AND k.annee_id = $2
          JOIN pedagogie.emploi_du_temps e ON e.classe_id = co.classe_id AND (e.statut = 'publie' OR e.publie_le IS NOT NULL)
          JOIN pedagogie.creneau cr ON cr.id = co.creneau_id LEFT JOIN pedagogie.matiere m ON m.id = co.matiere_id
        ON CONFLICT (classe_id, jour, debut) DO NOTHING`, [jours, a.id]);
      await q(`INSERT INTO vie_scolaire.presence (etablissement_id, fiche_id, inscription_id, statut, retard_minutes)
        SELECT etab, fiche, insc, CASE WHEN r < 0.025 THEN 'absent' WHEN r < 0.035 AND debut = '07:30' THEN 'retard' ELSE 'present' END,
               CASE WHEN r >= 0.025 AND r < 0.035 AND debut = '07:30' THEN 5 + floor(random() * 20)::int END
          FROM (SELECT f.etablissement_id AS etab, f.id AS fiche, i.id AS insc, f.debut, random() AS r
                  FROM vie_scolaire.fiche_appel f JOIN scolarite.inscription i ON i.classe_id = f.classe_id AND i.statut IN ('attente', 'validee', 'cloturee')
                 WHERE f.jour = ANY($1::date[]) AND f.statut = 'a_faire') z`, [jours]);
      await q(`INSERT INTO vie_scolaire.absence (etablissement_id, inscription_id, fiche_id, jour, debut, duree_minutes, statut, motif, justifiee_le, cree_le)
        SELECT f.etablissement_id, p.inscription_id, f.id, f.jour, f.debut, (extract(epoch FROM f.fin - f.debut) / 60)::int,
               CASE WHEN j THEN 'justifiee' ELSE 'non_justifiee' END, CASE WHEN j THEN 'Certificat médical remis' END,
               CASE WHEN j THEN (f.jour + time '16:10') AT TIME ZONE 'Africa/Douala' END, (f.jour + f.debut + interval '10 minutes') AT TIME ZONE 'Africa/Douala'
          FROM vie_scolaire.presence p JOIN vie_scolaire.fiche_appel f ON f.id = p.fiche_id CROSS JOIN LATERAL (SELECT random() < 0.5 AND f.jour < $2::date - 3 AS j) z
         WHERE p.statut = 'absent' AND f.jour = ANY($1::date[])`, [jours, AUJ]);
      await q(`UPDATE vie_scolaire.fiche_appel f SET statut = 'faite', faite_le = (f.jour + f.debut + interval '8 minutes') AT TIME ZONE 'Africa/Douala',
                 faite_par = COALESCE((SELECT c.id FROM core.compte c WHERE c.personnel_id = f.personnel_id), $2)
               WHERE f.jour = ANY($1::date[]) AND f.statut = 'a_faire' AND (f.jour < $3::date)`, [jours, comptes.get('secretaire')!.id, AUJ]);
    };
    const fenetre = (a: Annee, n: number): [string, string] => ([
      [`${a.debut}-10-05`, `${a.debut}-10-16`], [`${a.debut}-11-18`, `${a.debut}-11-29`], [`${a.debut + 1}-01-19`, `${a.debut + 1}-01-30`],
      [`${a.debut + 1}-03-02`, `${a.debut + 1}-03-13`], [`${a.debut + 1}-04-20`, `${a.debut + 1}-04-30`], [`${a.debut + 1}-06-01`, `${a.debut + 1}-06-11`],
    ] as [string, string][])[n - 1]!;
    const joursAppel = (du: string, au: string, parSemaine: number[]) => joursOuvrables(du, au).filter((j) => parSemaine.includes(new Date(ts(j)).getUTCDay()));

    // ---------------------------------------------------------- 5. année 2025/2026 complète
    etape(`${A1.libelle} : inscriptions, échéanciers, versements, caisse`);
    await inscrire(A1, elevesDe(ecole.eleves, A1.debut));
    await reduire(A1);
    await encaisser(A1);
    etape(`${A1.libelle} : notes, appels`);
    await noter(A1, A1.periodes.flatMap((p) => p.sequences.map((s) => { const [du, au] = fenetre(A1, s.numero); return { id: s.id, numero: s.numero, du, au, part: 1 }; })));
    await q(`UPDATE pedagogie.sequence SET statut = 'fermee' WHERE annee_id = $1`, [A1.id]);
    await appeler(A1, joursAppel(plusJours(A1.rentree, 1), `${A1.debut + 1}-06-20`, [2]).filter((_, i) => i % 2 === 0));

    etape(`${A1.libelle} : bulletins, conseils de classe, décisions (calculés par l'application)`);
    m = await marque();
    const pre = ctx.pre, dir = ctx.dir;
    for (const p of A1.periodes) {
      await parallele(CLASSES, 6, async (c) => {
        const principal = ctx.comptes[classeDe(c.nom).principal[0]]!;
        await principal.post('/pedagogie/fusion/calcul', { classeId: A1.classes[c.nom], periodeId: p.id });
        await principal.post('/pedagogie/fusion/transmission', { classeId: A1.classes[c.nom], periodeId: p.id });
        await pre.post('/pedagogie/bulletins/publication', { classeId: A1.classes[c.nom], periodeId: p.id });
        const moyennes = (await q(`SELECT b.inscription_id, b.moyenne FROM pedagogie.bulletin b JOIN scolarite.inscription i ON i.id = b.inscription_id
          WHERE b.periode_id = $1 AND i.classe_id = $2 AND b.statut = 'publie'`, [p.id, A1.classes[c.nom]])).rows as { inscription_id: string; moyenne: string | null }[];
        await pre.put('/pedagogie/conseil/distinctions', { classeId: A1.classes[c.nom], periodeId: p.id, items: moyennes.map((x) => {
          const v = Number(x.moyenne ?? 10);
          return { inscriptionId: x.inscription_id, distinction: v >= 14 ? 'tableau_honneur' : v >= 12 ? 'encouragements' : v < 8 ? 'avertissement_travail' : 'aucune' };
        }) });
        if (p.ordre === A1.periodes.length) {
          const decisions = elevesDe(ecole.eleves, A1.debut).filter((e) => e.parcours[A1.debut]!.classe === c.nom).map((e) => ({ inscriptionId: e.parcours[A1.debut]!.inscriptionId!,
            finAnnee: e.parcours[A1.debut]!.fin === 'redouble' ? 'redouble' : e.parcours[A1.debut]!.fin === 'exclu' ? 'exclu' : 'admis' }));
          await dir.put('/pedagogie/conseil/decisions', { classeId: A1.classes[c.nom], periodeId: p.id, items: decisions });
        }
      });
      await q(`UPDATE pedagogie.bulletin SET publie_le = $2 WHERE periode_id = $1`, [p.id, ts(ouvrableApres(plusJours(p.dateFin, 6)), '10:00')]);
    }
    await parallele(CLASSES, 6, async (c) => {
      await pre.post('/pedagogie/bulletins/calcul', { classeId: A1.classes[c.nom], periodeId: null });
      await pre.post('/pedagogie/bulletins/publication', { classeId: A1.classes[c.nom], periodeId: null });
    });
    await q(`UPDATE pedagogie.bulletin b SET publie_le = $2 FROM scolarite.inscription i WHERE i.id = b.inscription_id AND i.annee_id = $1 AND b.periode_id IS NULL`, [A1.id, ts(plusJours(A1.fin, -2), '11:00')]);
    await dater(m, plusJours(A1.periodes[0]!.dateFin, 5), plusJours(A1.fin, -1));

    // Départs de l'année (transferts), puis année suivante en préparation et clôture.
    etape(`${A1.libelle} : départs et clôture de l'année`);
    m = await marque();
    const partis = elevesDe(ecole.eleves, A1.debut).filter((e) => ['depart', 'exclu'].includes(e.parcours[A1.debut]!.fin ?? ''));
    for (const e of partis) {
      const p = e.parcours[A1.debut]!;
      const jour = jourEntre(`${A1.debut + 1}-06-02`, plusJours(A1.fin, -1)) ?? A1.fin;
      await q(`UPDATE scolarite.inscription SET statut = 'sortie' WHERE id = $1`, [p.inscriptionId]);
      await q(`INSERT INTO scolarite.mouvement (etablissement_id, annee_id, inscription_id, survenu_le, type, classe_avant_id, motif, cree_le, cree_par)
               VALUES ($1, $2, $3, $4, 'depart', $5, $6, $7, $8)`, [etab, A1.id, p.inscriptionId, jour, A1.classes[p.classe],
        `Transfert · ${choisir(['Déménagement de la famille', 'Mutation du père', 'Rapprochement du domicile', 'Changement d’école à la demande des parents'])}`, ts(jour, '11:00'), comptes.get('secretaire')!.id]);
    }
    await creerAnnee(ctx, A2, new Date(), false);
    await grille(ctx, A2, new Date());
    const r = await ctx.dir.post<{ reinscrits: number; reportes: number }>('/scolarite/cloture', { passages: CLASSES.map((c) => ({ classeId: A1.classes[c.nom]!, accueilClasseIds: classesSuivantes(c.nom).map((n) => A2.classes[n]!) })) });
    console.log(`  clôture : ${r.reinscrits} réinscrits, ${r.reportes} arriérés reportés`);
    await dater(m, `${A1.debut + 1}-05-12`, `${A1.debut + 1}-07-08`);
    await q(`UPDATE scolarite.inscription SET inscrit_le = $2::timestamptz::date, cree_le = $2::timestamptz WHERE annee_id = $1`, [A2.id, ts(`${A1.debut + 1}-07-08`, '09:00')]);
    await q(`UPDATE finances.ligne_echeance l SET cree_le = $2 FROM scolarite.inscription i WHERE i.id = l.inscription_id AND i.annee_id = $1`, [A2.id, ts(`${A1.debut + 1}-07-08`, '09:00')]);

    // ---------------------------------------------------------- 6. année 2026/2027 jusqu'à aujourd'hui
    etape(`${A2.libelle} : rentrée, nouveaux élèves, versements, caisse`);
    m = await marque();
    await ctx.arriveeVacataire(A2);
    await lirePeriodes(ctx, A2);
    await affectations(ctx, A2);
    await emploiDuTemps(ctx, A2, 6);
    await dater(m, plusJours(A2.rentree, -15), plusJours(A2.rentree, -2));
    // Élèves réinscrits par la clôture : leur classe réelle vient de la base.
    const reinscrits = new Map(((await q(`SELECT i.id, i.eleve_id, c.nom FROM scolarite.inscription i JOIN structure.classe c ON c.id = i.classe_id WHERE i.annee_id = $1`, [A2.id])).rows as { id: string; eleve_id: string; nom: string }[]).map((x) => [x.eleve_id, x]));
    for (const e of elevesDe(ecole.eleves, A2.debut)) {
      const p = e.parcours[A2.debut]!;
      const x = reinscrits.get(e.eleveId!);
      if (x) { p.inscriptionId = x.id; p.classe = x.nom; }
    }
    const nouveaux = elevesDe(ecole.eleves, A2.debut).filter((e) => !e.parcours[A2.debut]!.inscriptionId);
    for (const e of nouveaux) if (!e.inscritLe || e.inscritLe < plusJours(A2.rentree, -40)) e.inscritLe = ouvrableApres(plusJours(A2.rentree, hasard() < 0.9 ? -entier(1, 20) : entier(1, 15)));
    await inscrire(A2, nouveaux);
    // La clôture répartit les réinscrits entre classes parallèles sans regarder les effectifs : on rééquilibre (25 à 30 par classe).
    for (const niveau of new Set(CLASSES.map((c) => c.niveau))) {
      const classes = CLASSES.filter((c) => c.niveau === niveau).map((c) => c.nom);
      if (classes.length < 2) continue;
      const de = (n: string) => elevesDe(ecole.eleves, A2.debut).filter((e) => e.parcours[A2.debut]!.classe === n);
      for (;;) {
        const tri = classes.map((n) => ({ n, l: de(n) })).sort((x, y) => y.l.length - x.l.length);
        const grand = tri[0]!, petit = tri[tri.length - 1]!;
        if (grand.l.length - petit.l.length < 2 || (grand.l.length <= 30 && petit.l.length >= 25)) break;
        const e = grand.l.find((x) => x.parcours[A2.debut]!.type === 'nouvelle') ?? grand.l[0]!;
        e.parcours[A2.debut]!.classe = petit.n;
        await q('UPDATE scolarite.inscription SET classe_id = $2 WHERE id = $1', [e.parcours[A2.debut]!.inscriptionId, A2.classes[petit.n]]);
      }
    }
    await reduire(A2);
    await encaisser(A2);
    etape(`${A2.libelle} : notes de la séquence 1, séquence 2 en cours, appels`);
    const t1 = A2.periodes.find((p) => p.ordre === 1)!;
    const s1 = t1.sequences.find((s) => s.numero === 1)!, s2 = t1.sequences.find((s) => s.numero === 2)!;
    await noter(A2, [{ id: s1.id, numero: 1, du: `${A2.debut}-10-05`, au: `${A2.debut}-10-16`, part: 1 }]);
    await noter(A2, [{ id: s2.id, numero: 2, du: ouvrableAvant(7), au: ouvrableAvant(1), part: 0.85 }]);
    await q(`UPDATE pedagogie.sequence SET statut = 'fermee' WHERE id = $1`, [s1.id]);
    await q(`UPDATE pedagogie.sequence SET statut = 'ouverte', saisie_jusqua = $2 WHERE id = $1`, [s2.id, plusJours(AUJ, 9)]);
    await appeler(A2, [...new Set([...joursAppel(plusJours(A2.rentree, 1), ouvrableAvant(11), [1, 4]), ...Array.from({ length: 10 }, (_, i) => ouvrableAvant(10 - i))])].sort());

    etape('Annonces, compteurs, finitions');
    m = await marque();
    for (const [qui, titre, fr, en, cible] of [
      [ctx.sec, `Rentrée des classes le ${A2.rentree.split('-').reverse().join('/')}`, 'La rentrée a lieu à 7 h 30. Tenue complète et fournitures de la liste remise à l’inscription.', 'School resumes at 7:30 a.m. Full uniform and the supplies listed at registration.', 'ecole'],
      [ctx.sec, 'Réunion des parents', 'Les parents sont invités à la réunion de rentrée, samedi à 10 h, dans la grande salle.', 'Parents are invited to the first meeting of the year, on Saturday at 10 a.m., in the main hall.', 'ecole'],
      [ctx.pre, 'Compositions du 1er trimestre', 'Les compositions du 1er trimestre commencent fin novembre. Les élèves révisent toutes les leçons depuis la rentrée.', 'First-term examinations start at the end of November. Pupils should revise all lessons since the start of the year.', 'ecole'],
      [ctx.eco, 'Rappel : tranche 2 avant le 30 novembre', 'La tranche 2 des frais de scolarité est à régler avant le 30 novembre, à la caisse ou à la banque.', 'The second instalment of school fees is due before 30 November.', 'debiteurs'],
    ] as const) await qui.post('/communication/annonces', { titre, texteFr: fr, texteEn: en, cible, publier: true });
    await dater(m, plusJours(A2.rentree, -7), plusJours(AUJ, -1));
    const hachages = await hachagesP;
    const comptesFamille = familles.map((f) => [uuid7(ms(premiereInscription(ecole.eleves.find((e) => e.famille === f)!))), etab, chiffres(f.telephone), `Famille ${f.nom}`, hachages.get(f.nom), 'famille', idFamille.get(f), ts(premiereInscription(ecole.eleves.find((e) => e.famille === f)!))]);
    await inserer('core.compte', ['id', 'etablissement_id', 'identifiant', 'nom_affiche', 'mot_de_passe', 'type', 'famille_id', 'cree_le'], comptesFamille);
    await inserer('core.compte_role', ['etablissement_id', 'compte_id', 'role_id'], comptesFamille.map((c) => [etab, c[0], roleParent]));
    for (const [cle, n] of [...compteurs, [cleCompteur.recu(A1.debut), recus.get(A1.debut) ?? 0], [cleCompteur.recu(A2.debut), recus.get(A2.debut) ?? 0]] as [string, number][]) {
      await q(`INSERT INTO core.compteur (etablissement_id, cle, valeur) VALUES ($1, $2, $3) ON CONFLICT (etablissement_id, cle) DO UPDATE SET valeur = GREATEST(core.compteur.valeur, EXCLUDED.valeur)`, [etab, cle, n]);
    }
    await q(`UPDATE core.compte SET mot_de_passe = $1 WHERE type = 'famille' AND identifiant = '600000055'`, [await hacher('demo-kenfack')]);
    await q(`UPDATE core.compte SET derniere_activite = now() - (random() * interval '30 hours') WHERE type = 'personnel'`);
    await q('ANALYZE');
    const c = (await q(`SELECT (SELECT count(*) FROM scolarite.eleve) e, (SELECT count(*) FROM core.compte WHERE type = 'famille') f,
      (SELECT count(*) FROM scolarite.inscription WHERE annee_id = $1 AND statut IN ('attente', 'validee')) i, (SELECT count(*) FROM finances.versement) v, (SELECT count(*) FROM pedagogie.note) n`, [A2.id])).rows[0];
    console.log(`\nBase prête en ${Math.round((Date.now() - t0) / 1000)} s : ${c.e} élèves, ${c.f} comptes parents, ${c.i} inscrits cette année, ${c.v} versements, ${c.n} notes.`);
    console.log('Comptes : directrice / demo-directrice, secretaire / demo-secretaire, econome / demo-econome, prefet / demo-prefet,');
    console.log('          instituteurs (onana.b / demo-onana, eyenga.s / demo-eyenga…), parents : téléphone et demo-<nom de famille> (600 000 055 / demo-kenfack).');
  } finally {
    await app.close();
    await db.end();
    await pool.end();
  }
}

await main();
