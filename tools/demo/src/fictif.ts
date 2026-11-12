// pnpm demo:fictif — base de répétition : une école complète sur trois années scolaires (les deux dernières achevées et
// clôturées, l'année en cours jusqu'à aujourd'hui), 25 à 30 élèves par classe, familles, versements, notes, bulletins,
// appels, annonces. Tout passe par l'API (règles de gestion, numérotation sans trou, journal d'audit) ; une « horloge »
// ramène chaque opération à sa date. Noms inventés, téléphones dans la plage 600 000 xxx. Option --petit : effectifs réduits.
import { creerBase, lireOuCreerConfig, migrer, connexionProprietaire } from '@gs/db';
import { Bd, creerPool } from '@gs/api/src/core/bd.ts';
import { construireApp } from '@gs/api/src/app.ts';
import { creerEtablissement } from '@gs/api/src/core/etablissement.ts';
import { connecter } from './client.ts';
import { demander, drapeau, sortir } from './commun.ts';
import { CLASSES, elevesDe, genererEcole } from './fictif-ecole.ts';
import {
  ECOLE, affectations, aujourdhui, cloture, communicationAnnee, departs, emploiDuTemps, finaliser, financesAnnee, fondation, grille, guichet,
  inscriptionsInitiales, lirePeriodes, pedagogieAnneeCourante, pedagogieAnneePassee, synchroniser, vieScolaireAnnee,
} from './fictif-annee.ts';
import { AUJ, DEBUT, Horloge, aLHeure, dernierVendredi, plusJours, premierLundi, type Annee, type Contexte } from './fictif-outils.ts';

async function main() {
  const config = lireOuCreerConfig();
  const petit = drapeau('petit');
  console.log(`Base de répétition « ${config.pg.base} » : l’école sur trois années, ${DEBUT - 2}/${DEBUT - 1} à ${DEBUT}/${DEBUT + 1}${petit ? ' (effectifs réduits)' : ''}.`);
  if (!drapeau('oui')) {
    const ok = await demander(`La base « ${config.pg.base} » sera effacée puis recréée. Tapez OUI pour continuer`);
    if (ok !== 'OUI') sortir('Rien n’a été modifié.', 0);
  }
  const annees: Annee[] = [DEBUT - 2, DEBUT - 1, DEBUT].map((d) => ({ debut: d, libelle: `${d}/${d + 1}`, rentree: premierLundi(d), fin: dernierVendredi(d), courante: d === DEBUT, periodes: [], classes: {} }));
  if (AUJ < plusJours(annees[2]!.rentree, 45)) console.warn('Attention : la rentrée est récente, l’historique de l’année en cours sera court.');
  const ecole = genererEcole(petit);
  console.log(`${ecole.eleves.length} élèves et ${ecole.familles.length} familles sur les trois années ; ${elevesDe(ecole.eleves, DEBUT).length} élèves cette année dans ${CLASSES.length} classes.`);

  await creerBase(config.pg, config.pg.base, true);
  await migrer(config.pg, config.pg.base, (m) => console.log(`  ${m}`));
  const pool = creerPool(config.pg);
  const bd = new Bd(pool);
  const proprio = connexionProprietaire(config.pg);
  await proprio.connect();
  const horloge = new Horloge(proprio);
  await horloge.preparer();
  const app = await construireApp({ bd, dossierWeb: '/inexistant', journal: false });
  await app.ready();
  const debut = Date.now();
  const etape = (t: string) => console.log(`${t}… (${Math.round((Date.now() - debut) / 1000)} s)`);
  try {
    const premiere = annees[0]!;
    await horloge.a(aLHeure(plusJours(premiere.rentree, -21), '08:30'), () => creerEtablissement(bd, { ...ECOLE, secretaire: { identifiant: 'secretaire', nomAffiche: 'Mme NDZANA Rose', motDePasse: 'demo-secretaire' } }));
    const sec = await connecter(app, 'secretaire', 'demo-secretaire');
    const ctx = { app, horloge, proprio, sec, comptes: {}, niveaux: {}, personnel: {}, matieres: {}, annees, eleves: ecole.eleves, parents: {}, petit } as unknown as Contexte;
    ctx.parNom = (nom: string) => ctx.eleves.find((e) => `${e.nom} ${e.prenoms}` === nom) ?? sortir(`Élève introuvable : ${nom}`);

    etape(`Établissement, personnel, année ${premiere.libelle}`);
    await fondation(ctx, premiere);
    for (const [i, a] of annees.entries()) {
      console.log(`\n=== Année ${a.libelle}${a.courante ? ' (en cours)' : ''}`);
      if (i > 0) await ctx.arriveeVacataire(a);
      await lirePeriodes(ctx, a);
      if (i === 0) {
        etape('Grille des frais');
        await grille(ctx, a, aLHeure(plusJours(a.rentree, -18), '11:20'));
      }
      etape('Affectations et emploi du temps');
      await affectations(ctx, a);
      await emploiDuTemps(ctx, a);
      etape(i === 0 ? 'Inscriptions : import des anciens, puis nouveaux élèves' : 'Inscriptions des nouveaux élèves');
      if (i === 0) await inscriptionsInitiales(ctx, a); else await guichet(ctx, a);
      await synchroniser(ctx, a);
      etape('Versements, caisse et dépenses');
      await financesAnnee(ctx, a);
      etape(a.courante ? 'Notes de la séquence 1, séquence 2 en cours, cahier de textes' : 'Notes, bulletins et conseils de classe');
      if (a.courante) await pedagogieAnneeCourante(ctx, a); else await pedagogieAnneePassee(ctx, a);
      etape('Appels, absences et observations');
      await vieScolaireAnnee(ctx, a);
      etape('Annonces et messagerie');
      await communicationAnnee(ctx, a);
      if (!a.courante) {
        etape('Départs et clôture de l’année');
        await departs(ctx, a);
        await cloture(ctx, a, annees[i + 1]!);
      }
    }
    etape('Caisse du jour et relevé bancaire');
    await aujourdhui(ctx, annees[2]!);
    await finaliser(ctx);
    await horloge.terminer();
    console.log(`\nBase de répétition prête en ${Math.round((Date.now() - debut) / 60_000)} min. Comptes de répétition (jamais ceux de la démonstration) :`);
    for (const [i, m] of [['directrice', 'demo-directrice'], ['secretaire', 'demo-secretaire'], ['econome', 'demo-econome'], ['prefet', 'demo-prefet'],
      ['onana.b', 'demo-onana'], ['eyenga.s', 'demo-eyenga'], ['essama.l', 'demo-essama'], ['600 000 055 (parent)', 'demo-kenfack']] as [string, string][]) console.log(`  ${i.padEnd(22)} ${m}`);
    console.log('Lancez ensuite : pnpm demo:lancer');
  } finally {
    await app.close();
    await proprio.end();
    await pool.end();
  }
}

await main();
