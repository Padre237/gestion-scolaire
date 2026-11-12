// Tableau de bord personnalisable (D-41) : jusqu'à six cartes propres à chaque utilisateur. Chaque carte choisit son indicateur,
// son regroupement, ses filtres et sa forme (barres, courbe, anneau, tableau), indépendamment des autres.
// La connexion est dans mobile.tsx (charte Sekou).
import { useState } from 'react';
import type { RouteEcran } from '../App.tsx';
import { api } from '../core/api.ts';
import { Coque } from '../core/coque.tsx';
import { Anneau, Barres, Courbe, TableauPoints, type Point } from '../core/graphiques.tsx';
import { agir, Bascules, Bouton, Chargement, confirmer, Doux, Erreur, Icone, Liste, ouvrirFormulaire, Panneau, PiedFenetre, TitrePanneau, useDonnees } from '../core/ui.tsx';

type Forme = 'barres' | 'courbe' | 'anneau' | 'tableau';
type Section = 'toutes' | 'francophone' | 'anglophone';
type Duree = '7j' | '30j' | '90j' | 'annee';
interface Carte { id: string; indicateur: string; par: string; forme: Forme; section: Section; classeId: string | null; duree: Duree; periodeId: string | null }
interface Indicateur { code: string; libelle: string; unite: string; periode: 'duree' | 'periode' | null; par: { code: string; libelle: string }[] }
interface Config { personnalise: boolean; cartes: Carte[]; catalogue: Indicateur[]; classes: { id: string; nom: string; section: Section }[]; periodes: { id: string; libelle: string }[] }

const MAX = 6;
const FORMES: [Forme, string][] = [['barres', 'Barres'], ['courbe', 'Courbe'], ['anneau', 'Anneau'], ['tableau', 'Tableau']];
const SECTIONS: [Section, string][] = [['toutes', 'Toutes'], ['francophone', 'Francophone'], ['anglophone', 'Anglophone']];
const DUREES: [Duree, string][] = [['7j', '7 jours'], ['30j', '30 jours'], ['90j', '3 mois'], ['annee', 'Depuis la rentrée']];
/** Les regroupements qui n'ont pas de sens avec un filtre de classe (la classe est déjà le regroupement). */
const SANS_CLASSE = ['classe', 'niveau', 'section'];

function FenetreCarte({ carte, cfg, fermer }: { carte: Carte; cfg: Config; fermer: (c?: Carte) => void }) {
  const [c, setC] = useState<Carte>(carte);
  const ind = cfg.catalogue.find((i) => i.code === c.indicateur) ?? cfg.catalogue[0]!;
  const maj = (x: Partial<Carte>) => setC((v) => ({ ...v, ...x }));
  const classes = cfg.classes.filter((k) => c.section === 'toutes' || k.section === c.section);
  return (
    <>
      <Liste libelle="Donnée affichée" value={c.indicateur} options={cfg.catalogue.map((i): [string, string] => [i.code, i.libelle])}
        onChange={(x) => { const n = cfg.catalogue.find((i) => i.code === x)!; maj({ indicateur: x, par: n.par.some((p) => p.code === c.par) ? c.par : n.par[0]!.code }); }} />
      <Liste libelle="Regrouper par" value={c.par} options={ind.par.map((p): [string, string] => [p.code, p.libelle])}
        onChange={(x) => maj({ par: x, classeId: SANS_CLASSE.includes(x) ? null : c.classeId, forme: (x === 'jour' || x === 'mois') && c.forme === 'anneau' ? 'courbe' : c.forme })} />
      <div className="champ-groupe"><span className="libelle">Forme</span><Bascules options={FORMES} valeur={c.forme} onChange={(x) => maj({ forme: x })} /></div>
      <div className="champ-groupe"><span className="libelle">Section</span><Bascules options={SECTIONS} valeur={c.section} onChange={(x) => maj({ section: x, classeId: null })} /></div>
      {!SANS_CLASSE.includes(c.par) && (
        <Liste libelle="Classe" value={c.classeId} options={[[null, 'Toutes les classes'], ...classes.map((k): [string, string] => [k.id, k.nom])]} onChange={(x) => maj({ classeId: x })} />
      )}
      {ind.periode === 'duree' && <div className="champ-groupe"><span className="libelle">Période</span><Bascules options={DUREES} valeur={c.duree} onChange={(x) => maj({ duree: x })} /></div>}
      {ind.periode === 'periode' && (
        <Liste libelle="Période d’évaluation" value={c.periodeId} options={[[null, 'Dernière période publiée'], ...cfg.periodes.map((p): [string, string] => [p.id, p.libelle])]} onChange={(x) => maj({ periodeId: x })} />
      )}
      <PiedFenetre fermer={() => fermer()} action="Enregistrer la carte" onAction={() => fermer(c)} />
    </>
  );
}

function CarteTableau({ carte, cfg, modifier, retirer }: { carte: Carte; cfg: Config; modifier: () => void; retirer: () => void }) {
  const ind = cfg.catalogue.find((i) => i.code === carte.indicateur);
  const par = ind?.par.find((p) => p.code === carte.par);
  const q = new URLSearchParams({ indicateur: carte.indicateur, par: carte.par, section: carte.section, duree: carte.duree });
  if (carte.classeId) q.set('classeId', carte.classeId);
  if (carte.periodeId) q.set('periodeId', carte.periodeId);
  const d = useDonnees(() => api.get<{ unite: string; sous: string; points: Point[] }>(`/pilotage/cartes/donnees?${q}`), [q.toString()]);
  const filtres = [carte.section !== 'toutes' ? SECTIONS.find(([v]) => v === carte.section)![1] : null, carte.classeId ? cfg.classes.find((k) => k.id === carte.classeId)?.nom : null, d.d?.sous]
    .filter(Boolean).join(' · ');
  const corps = !d.d ? (d.erreur ? <Doux>{d.erreur}</Doux> : <Chargement />)
    : carte.forme === 'barres' ? <Barres points={d.d.points} unite={d.d.unite} />
      : carte.forme === 'courbe' ? <Courbe points={d.d.points} unite={d.d.unite} />
        : carte.forme === 'anneau' ? <Anneau points={d.d.points} unite={d.d.unite} />
          : <TableauPoints points={d.d.points} unite={d.d.unite} entete={par?.libelle ?? ''} />;
  return (
    <Panneau className="carte-tableau">
      <TitrePanneau titre={`${ind?.libelle ?? ''}${par ? ` par ${par.libelle.toLowerCase()}` : ''}`} sous={filtres || undefined} action={
        <span style={{ display: 'inline-flex', gap: 4 }}>
          <button type="button" className="bouton bouton-icone petit-icone" aria-label="Modifier la carte" title="Modifier la carte" onClick={modifier}><Icone nom="parametres" /></button>
          <button type="button" className="bouton bouton-icone petit-icone" aria-label="Retirer la carte" title="Retirer la carte" onClick={retirer}><Icone nom="fermer" /></button>
        </span>} />
      {corps}
    </Panneau>
  );
}

export function EcranTableauDeBord() {
  const st = useDonnees(() => api.get<Config>('/pilotage/cartes'));
  const cfg = st.d;
  const enregistrer = async (cartes: Carte[]) => {
    if (await agir(() => api.put('/pilotage/cartes', { cartes }))) await st.recharger();
  };
  const contenu = (() => {
    if (st.erreur && !cfg) return <Erreur message={st.erreur} recharger={st.recharger} />;
    if (!cfg) return <Chargement />;
    const ouvrir = async (carte: Carte, titre: string) => ouvrirFormulaire<Carte>(titre, ({ fermer }) => <FenetreCarte carte={carte} cfg={cfg} fermer={fermer} />, 560);
    const ajouter = async () => {
      const ind = cfg.catalogue[0]!;
      const c = await ouvrir({ id: `c${Date.now()}`, indicateur: ind.code, par: ind.par[0]!.code, forme: 'barres', section: 'toutes', classeId: null, duree: '30j', periodeId: null }, 'Ajouter une carte');
      if (c) await enregistrer([...cfg.cartes, c]);
    };
    const modifier = async (carte: Carte) => {
      const c = await ouvrir(carte, 'Modifier la carte');
      if (c) await enregistrer(cfg.cartes.map((x) => (x.id === carte.id ? c : x)));
    };
    const retirer = async (carte: Carte) => { await enregistrer(cfg.cartes.filter((x) => x.id !== carte.id)); };
    const defaut = async () => {
      if (!(await confirmer('Cartes par défaut', 'Vos cartes sont remplacées par les six cartes proposées par l’application.', 'Rétablir'))) return;
      if (await agir(() => api.del('/pilotage/cartes'), 'Cartes par défaut rétablies')) await st.recharger();
    };
    if (!cfg.catalogue.length) return <Panneau><Doux>Aucune donnée du tableau de bord n’est ouverte à votre compte.</Doux></Panneau>;
    return (
      <>
        <div className="rangee" style={{ alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
          <Doux>{cfg.cartes.length} carte{cfg.cartes.length > 1 ? 's' : ''} sur {MAX} · chaque carte se règle avec son bouton <Icone nom="parametres" taille={14} /></Doux>
          <span style={{ flex: 1 }} />
          {cfg.personnalise && <Bouton onClick={defaut}>Cartes par défaut</Bouton>}
          {cfg.cartes.length < MAX && <Bouton variante="principal" icone="ajouter" onClick={ajouter}>Ajouter une carte</Bouton>}
        </div>
        {cfg.cartes.length === 0 && <Panneau><Doux>Aucune carte : ajoutez-en jusqu’à six.</Doux></Panneau>}
        <div className="cartes-grille">
          {cfg.cartes.map((c) => <CarteTableau key={c.id + JSON.stringify(c)} carte={c} cfg={cfg} modifier={() => modifier(c)} retirer={() => retirer(c)} />)}
        </div>
      </>
    );
  })();
  return <Coque module="tableau">{contenu}</Coque>;
}

export const routes: RouteEcran[] = [
  { path: '/', element: <EcranTableauDeBord /> },
  { path: '/tableau-de-bord', element: <EcranTableauDeBord /> },
];
