// Maquette Cloture : vérifications, passage des élèves d'après les décisions du conseil, report des soldes impayés,
// ouverture de l'année suivante. Le bouton de clôture ne s'active que lorsque le serveur déclare l'année prête.
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../core/api.ts';
import { Coque } from '../core/coque.tsx';
import { useMoi, useSession } from '../core/session.tsx';
import { fcfa, montant, pluriel } from '../core/format.ts';
import {
  agir, Bandeau, Bouton, Chargement, Colonnes, confirmer, Doux, Erreur, Etapes, Icone, InfoCaps, LigneListe, Liste, ouvrirFenetre, Panneau,
  Pastille, Tableau, TitrePanneau, useDonnees, type EtatEtape,
} from '../core/ui.tsx';
import { dateAHeure, useLargeurConteneur } from './admin-commun.tsx';

interface Verification { code: string; libelle: string; detail: string; ok: boolean }
interface Passage { classeId: string; classe: string; effectif: number; admis: number; redoublent: number; sortants: number; accueil: string; accueilIds: string[] }
interface EtatCloture {
  annee: { id: string; libelle: string }; suivante: { id: string; libelle: string; statut: string } | null;
  verifications: Verification[]; passage: Passage[]; totaux: { effectif: number; admis: number; redoublent: number; sortants: number };
  soldes: { eleves: number; montant: number }; pret: boolean; etape: number; classesSuivantes: { id: string; nom: string }[];
}

const PROPOSEE = '__proposee';
const AUCUNE = '__aucune';
const majuscule = (x: string) => x.charAt(0).toUpperCase() + x.slice(1);
/** Classe d'accueil encore absente de l'année suivante (hors fin de cycle). */
const aCreer = (p: Passage) => p.accueilIds.length === 0 && p.accueil === 'classe à créer';

export function EcranCloture() {
  const moi = useMoi();
  const { charger } = useSession();
  const naviguer = useNavigate();
  const e = useDonnees(() => api.get<EtatCloture>('/scolarite/cloture'));
  const [choix, setChoix] = useState<Record<string, string>>({});
  const [charge, setCharge] = useState(false);
  // Sous 980 px les deux colonnes s'empilent : les étapes sont alors présentées dans l'ordre 1, 2, 3, 4.
  const [cadre, largeur] = useLargeurConteneur<HTMLDivElement>();
  const empile = largeur > 0 && largeur < 980;
  const d = e.d;

  const contenu = (() => {
    if (e.erreur && !d) return <Erreur message={e.erreur} recharger={e.recharger} />;
    if (!d) return <Chargement />;
    const annee = d.annee.libelle;
    const suivante = d.suivante?.libelle ?? 'l’année suivante';
    const toutVerifie = d.verifications.every((v) => v.ok);
    const valeur = (p: Passage) => choix[p.classeId] ?? PROPOSEE;
    const cibles = (p: Passage) => { const v = valeur(p); return v === PROPOSEE ? p.accueilIds : v === AUCUNE ? [] : [v]; };
    const manquantes = d.passage.filter((p) => p.admis > 0 && valeur(p) === PROPOSEE && aCreer(p));
    const peutCloturer = moi.a('structure.annee.cloturer');
    const actif = d.pret && manquantes.length === 0 && peutCloturer;
    const etapes: [string, EtatEtape][] = [
      ['Vérifications', d.etape > 1 ? 'faite' : 'courante'],
      ['Passage des élèves', d.etape > 1 ? 'courante' : 'avenir'],
      ['Soldes impayés', 'avenir'],
      [`Ouverture de ${suivante}`, 'avenir'],
    ];
    const sauvegarder = async () => {
      if (await agir(() => api.post('/core/sauvegardes'), 'Sauvegarde faite')) void e.recharger();
    };
    const cloturer = async () => {
      const ok = await confirmer(`Clôturer ${annee}`, <>
        L’année {annee} passe en lecture seule et {suivante} s’ouvre : {pluriel(d.totaux.admis, 'admis', 'admis')} réinscrits dans leur classe d’accueil,
        {' '}{pluriel(d.totaux.redoublent, 'redoublant', 'redoublants')} dans leur niveau, {pluriel(d.soldes.eleves, 'solde', 'soldes')} reportés.
        Une sauvegarde de fin d’année est faite juste avant.
      </>, 'Clôturer l’année');
      if (!ok) return;
      setCharge(true);
      const r = await agir(() => api.post<{ reinscrits: number; reportes: number; ouverte: string }>('/scolarite/cloture',
        { passages: d.passage.map((p) => ({ classeId: p.classeId, accueilClasseIds: cibles(p) })) }));
      setCharge(false);
      if (!r) return;
      await charger();
      await ouvrirFenetre<void>('Année clôturée', (fermer) => (
        <>
          <p>{annee} est clôturée et passe en lecture seule. {r.ouverte} est ouverte.</p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px 32px' }}>
            <InfoCaps libelle="Réinscriptions" valeur={montant(r.reinscrits)} />
            <InfoCaps libelle="Arriérés reportés" valeur={montant(r.reportes)} />
          </div>
          <div className="pied"><Bouton variante="principal" onClick={() => fermer()}>Fermer</Bouton></div>
        </>
      ), 460);
      naviguer('/parametres/etablissement');
    };
    const optionsAccueil = (p: Passage): [string, string][] => [
      [PROPOSEE, majuscule(p.accueil)],
      ...d.classesSuivantes.filter((k) => !(p.accueilIds.length === 1 && p.accueilIds[0] === k.id)).map((k): [string, string] => [k.id, k.nom]),
      ...(p.accueilIds.length ? [[AUCUNE, 'Aucune : quittent l’école'] as [string, string]] : []),
    ];
    const panneauPassage = (
      <Panneau>
        <TitrePanneau titre="2 · Passage des élèves" sous="D’après les décisions du conseil de classe" />
        <Tableau
          colonnes={[{ titre: 'Classe', mobile: 'entete' }, { titre: 'Effectif', droite: true }, { titre: 'Admis', droite: true }, { titre: 'Redoublent', droite: true },
            { titre: 'Sortants', droite: true }, { titre: `Classe d’accueil en ${suivante}`, largeur: 220 }]}
          cles={d.passage.map((p) => p.classeId)}
          vide="Aucune classe pour l’année en cours."
          lignes={d.passage.map((p) => [
            <span className="gras">{p.classe}</span>, p.effectif, p.admis, p.redoublent, p.sortants,
            peutCloturer && d.suivante
              ? <Liste ariaLabel={`Classe d’accueil de ${p.classe} en ${suivante}`} value={valeur(p)} options={optionsAccueil(p)} onChange={(v) => setChoix((c) => ({ ...c, [p.classeId]: v }))} />
              : <span className={aCreer(p) ? 'doux' : ''}>{majuscule(p.accueil)}</span>,
          ])}
          total={['Total', d.totaux.effectif, d.totaux.admis, d.totaux.redoublent, d.totaux.sortants, '']}
        />
        {manquantes.length > 0 && (
          <Bandeau ton="attention" icone="alerte" action={moi.a('structure.consulter') && <Bouton onClick={() => naviguer('/parametres/etablissement')}>Établissement</Bouton>}>
            Classes d’accueil à créer en {suivante} pour : {manquantes.map((p) => p.classe).join(', ')}.
          </Bandeau>
        )}
        <Doux>Les admis sont réinscrits dans la classe d’accueil ; les redoublants restent dans leur niveau. Chaque réinscription crée l’échéancier {suivante}.</Doux>
      </Panneau>
    );
    const panneauVerifications = (
      <Panneau>
        <TitrePanneau titre="1 · Vérifications" action={<Pastille ton={toutVerifie ? 'succes' : 'attention'} icone={toutVerifie ? 'coche' : 'alerte'}>{toutVerifie ? 'Tout est prêt' : 'À compléter'}</Pastille>} />
        <div>
          {d.verifications.map((v) => (
            <LigneListe key={v.code}>
              <Icone nom={v.ok ? 'coche' : 'alerte'} style={{ color: v.ok ? 'var(--succes)' : 'var(--attention)' }} />
              <div style={{ flex: '1 1 160px', display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                <span className="gras">{v.libelle}</span>
                <Doux>{v.ok ? 'Fait · ' : 'À faire · '}{v.code === 'sauvegarde' ? (v.detail === 'aucune' ? 'Aucune sauvegarde' : `Dernière : ${dateAHeure(v.detail)}`) : v.detail}</Doux>
              </div>
              {v.code === 'sauvegarde' && !v.ok && moi.a('core.sauvegarde.lancer') && <div className="pleine-mobile"><Bouton pleine onClick={sauvegarder}>Sauvegarder maintenant</Bouton></div>}
            </LigneListe>
          ))}
        </div>
      </Panneau>
    );
    const panneauSoldes = (
      <Panneau>
        <TitrePanneau titre="3 · Soldes impayés" />
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px 32px' }}>
          <InfoCaps libelle="Élèves avec un reste dû" valeur={montant(d.soldes.eleves)} />
          <InfoCaps libelle="Montant à reporter" valeur={fcfa(d.soldes.montant)} />
        </div>
        <Doux>Le reste dû devient une ligne « Arriéré {annee} », placée en tête du nouvel échéancier.</Doux>
      </Panneau>
    );
    const panneauOuverture = (
      <Panneau>
        <TitrePanneau titre={`4 · Ouverture de ${suivante}`} action={<Pastille ton={d.pret ? 'succes' : 'neutre'} icone={d.pret ? 'coche' : undefined}>{d.pret ? 'Prête' : 'En attente'}</Pastille>} />
        <p>L’année {annee} passe en lecture seule ; ses bulletins, ses reçus et son paramétrage ne changent plus. L’année {suivante} s’ouvre.</p>
        {!d.suivante && (
          <Bandeau ton="attention" icone="alerte" action={moi.a('structure.consulter') && <Bouton onClick={() => naviguer('/parametres/etablissement')}>Établissement</Bouton>}>
            Préparez d’abord l’année suivante, avec ses classes et sa grille des frais.
          </Bandeau>
        )}
        {peutCloturer && <Bouton variante="principal" pleine disabled={!actif} charge={charge} onClick={cloturer}>Clôturer {annee} et ouvrir {suivante}</Bouton>}
        {!d.pret && <Doux>La clôture s’active quand toutes les vérifications sont faites.</Doux>}
      </Panneau>
    );
    return (
      <div ref={cadre} style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        <Panneau><Etapes etapes={etapes} /></Panneau>
        {empile
          ? <>{panneauVerifications}{panneauPassage}{panneauSoldes}{panneauOuverture}</>
          : <Colonnes colonnes={[
            { flex: 3, min: 620, enfants: panneauPassage },
            { flex: 2, min: 340, enfants: <>{panneauVerifications}{panneauSoldes}{panneauOuverture}</> },
          ]} />}
      </div>
    );
  })();
  return <Coque module="parametres">{contenu}</Coque>;
}

