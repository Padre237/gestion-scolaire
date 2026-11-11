// Maquette Personnel : liste du personnel de l'établissement, fiche, compte utilisateur lié, heures de vacation.
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ErreurApi, requete } from '../core/api.ts';
import { Coque } from '../core/coque.tsx';
import { useMoi } from '../core/session.tsx';
import { telecharger } from '../core/documents.ts';
import { decimal, jjmmaaaa, libelleMois, versIso } from '../core/format.ts';
import {
  agir, Avatar, Bandeau, Bascules, Bouton, Cel2, Champ, Chargement, Colonnes, Doux, Erreur, Etiquette, Filtres, Grille, InfoCaps,
  Liste, Note, ouvrirFormulaire, Panneau, PiedFenetre, Tableau, TitrePanneau, useDonnees,
} from '../core/ui.tsx';
import { creerCompte, Pagination, useDiffere, type Role } from './admin-commun.tsx';

const FONCTIONS: [string, string][] = [
  ['directeur', 'Directeur'], ['secretaire', 'Secrétaire'], ['econome', 'Économe'], ['prefet', 'Préfet des études'],
  ['instituteur_principal', 'Instituteur principal'], ['instituteur_matiere', 'Instituteur de matière'], ['autre', 'Autre'],
];
const STATUTS: [string, string][] = [['permanent', 'Permanent'], ['vacataire', 'Vacataire']];
const libelleStatut = (s: string) => STATUTS.find(([v]) => v === s)?.[1] ?? s;
const TAILLE = 10;

interface LignePersonnel {
  id: string; nomAffiche: string; fonction: string; fonctionLibelle: string; statut: string; classesMatieres: string; telephone: string | null; compte: string | null;
}
interface FichePersonnel {
  id: string; nomAffiche: string; fonction: string; fonctionLibelle: string; statut: string; telephone: string | null; diplome: string | null;
  entreeLe: string | null; compte: string | null; compteId: string | null; classes: string[]; matieres: string[];
  vacations: { mois: string; prevues: number; effectuees: number }[];
}

const minusculeInitiale = (x: string) => x.charAt(0).toLowerCase() + x.slice(1);

// ---------------------------------------------------------------- fenêtre de la fiche

function FenetreFiche({ fermer, fiche }: { fermer: (id?: string) => void; fiche?: FichePersonnel }) {
  const [nom, setNom] = useState(fiche?.nomAffiche ?? '');
  const [fonction, setFonction] = useState<string>(fiche?.fonction ?? 'instituteur_principal');
  const [statut, setStatut] = useState<string>(fiche?.statut ?? 'permanent');
  const [telephone, setTelephone] = useState(fiche?.telephone ?? '');
  const [diplome, setDiplome] = useState(fiche?.diplome ?? '');
  const [entree, setEntree] = useState(fiche?.entreeLe ? jjmmaaaa(fiche.entreeLe) : '');
  const [erreurs, setErreurs] = useState<Record<string, string>>({});
  const [general, setGeneral] = useState<string | null>(null);
  const [charge, setCharge] = useState(false);
  const valider = async () => {
    const e: Record<string, string> = {};
    if (nom.trim().length < 2) e['nom'] = 'Nom requis (2 caractères au moins).';
    const iso = entree.trim() ? versIso(entree) : null;
    if (entree.trim() && !iso) e['entree'] = 'Date au format JJ/MM/AAAA.';
    setErreurs(e);
    if (Object.keys(e).length) return;
    const corps = { nomAffiche: nom.trim(), fonction, statut, telephone: telephone.trim() || null, diplome: diplome.trim() || null, entreeLe: iso };
    setCharge(true);
    setGeneral(null);
    try {
      const r = fiche ? await api.patch<{ id: string }>(`/personnel/${fiche.id}`, corps) : await api.post<{ id: string }>('/personnel', corps);
      fermer(r.id);
    } catch (x) {
      setGeneral(x instanceof ErreurApi ? x.message : String(x));
      setCharge(false);
    }
  };
  return (
    <>
      <Champ libelle="Nom affiché" placeholder="Civilité, NOM et prénom" value={nom} onChange={setNom} autoFocus erreur={erreurs['nom']} />
      <Grille min={200} ecart={12}>
        <Liste libelle="Fonction" value={fonction} options={FONCTIONS} onChange={setFonction} />
        <div className="champ-groupe"><span className="libelle">Statut</span><Bascules options={STATUTS} valeur={statut} onChange={setStatut} /></div>
        <Champ libelle="Téléphone" inputMode="tel" value={telephone} onChange={setTelephone} />
        <Champ libelle="Date d’entrée" placeholder="JJ/MM/AAAA" value={entree} onChange={setEntree} erreur={erreurs['entree']} />
      </Grille>
      <Champ libelle="Diplôme" value={diplome} onChange={setDiplome} />
      {general && <Note ton="danger">{general}</Note>}
      <PiedFenetre fermer={() => fermer()} action={fiche ? 'Enregistrer' : 'Créer la fiche'} onAction={valider} charge={charge} />
    </>
  );
}

// ---------------------------------------------------------------- fiche

function PanneauFiche({ f, gerer, peutCreerCompte, modifier, creerSonCompte }: {
  f: FichePersonnel; gerer: boolean; peutCreerCompte: boolean; modifier: () => void; creerSonCompte: () => void;
}) {
  const instituteur = f.fonction.startsWith('instituteur');
  const precision = [f.fonctionLibelle, ...(f.matieres.length ? [f.matieres.map(minusculeInitiale).join(', ')] : []), libelleStatut(f.statut).toLowerCase()].join(' · ');
  return (
    <Panneau>
      <TitrePanneau titre="Fiche" action={gerer && <Bouton petit onClick={modifier}>Modifier</Bouton>} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <Avatar nom={f.nomAffiche} taille={52} />
        <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <span className="gras" style={{ fontSize: 17 }}>{f.nomAffiche}</span>
          <Doux>{precision}</Doux>
        </div>
      </div>
      <Grille min={130} ecart={14}>
        <InfoCaps libelle="Diplôme" valeur={f.diplome || '–'} />
        <InfoCaps libelle="Entrée" valeur={f.entreeLe ? jjmmaaaa(f.entreeLe) : '–'} />
        <InfoCaps libelle="Téléphone" valeur={f.telephone || '–'} />
        <InfoCaps libelle="Classes" valeur={f.classes.length ? f.classes.join(', ') : '–'} />
        {f.compte && <InfoCaps libelle="Compte" valeur={f.compte} />}
      </Grille>
      {!f.compte && (
        <Bandeau ton="attention" icone="alerte" action={peutCreerCompte && <Bouton petit onClick={creerSonCompte}>Créer son compte</Bouton>}>
          {instituteur ? 'Aucun compte utilisateur lié : cette personne ne peut pas saisir ses notes.' : 'Aucun compte utilisateur lié : cette personne ne peut pas se connecter.'}
        </Bandeau>
      )}
      {(f.statut === 'vacataire' || f.vacations.length > 0) && (
        <>
          <Etiquette>Heures de vacation</Etiquette>
          <Tableau serre colonnes={[{ titre: 'Mois' }, { titre: 'Prévues', droite: true }, { titre: 'Effectuées', droite: true }]}
            lignes={f.vacations.map((v) => [libelleMois(v.mois), `${decimal(Number(v.prevues))} h`, `${decimal(Number(v.effectuees))} h`])}
            vide="Aucune heure relevée pour l’instant." />
          <Doux>Relevé des heures ; le calcul des vacations et de la paie se fait en dehors de l’application.</Doux>
        </>
      )}
    </Panneau>
  );
}

// ---------------------------------------------------------------- écran

export function EcranPersonnel() {
  const moi = useMoi();
  const naviguer = useNavigate();
  const gerer = moi.a('personnel.fiche.gerer');
  const [q, setQ] = useState('');
  const recherche = useDiffere(q.trim());
  const [fonction, setFonction] = useState<string | null>(null);
  const [statut, setStatut] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [choisi, setChoisi] = useState<string | null>(null);
  useEffect(() => { setPage(1); }, [recherche]);
  const liste = useDonnees(() => api.get<{ total: number; lignes: LignePersonnel[] }>(`/personnel${requete({ q: recherche, fonction, statut, page, taille: TAILLE })}`),
    [recherche, fonction, statut, page]);
  const fiche = useDonnees(() => (choisi ? api.get<FichePersonnel>(`/personnel/${choisi}`) : Promise.resolve(null)), [choisi]);
  useEffect(() => { if (!choisi && liste.d?.lignes[0]) setChoisi(liste.d.lignes[0].id); }, [liste.d, choisi]);

  const apres = (id?: string) => { void liste.recharger(); if (id && id !== choisi) setChoisi(id); else void fiche.recharger(); };
  const nouvelleFiche = async () => {
    const id = await ouvrirFormulaire<string>('Nouvelle fiche', ({ fermer }) => <FenetreFiche fermer={fermer} />, 560);
    if (id) apres(id);
  };
  const modifier = async (f: FichePersonnel) => {
    const id = await ouvrirFormulaire<string>(`Modifier · ${f.nomAffiche}`, ({ fermer }) => <FenetreFiche fermer={fermer} fiche={f} />, 560);
    if (id) apres(id);
  };
  const creerSonCompte = async (f: FichePersonnel) => {
    const roles = await agir(() => api.get<Role[]>('/core/roles'));
    if (roles && await creerCompte(roles, { nomAffiche: f.nomAffiche, personnelId: f.id, fonction: f.fonction })) apres();
  };

  const optionsFonction: [string | null, string][] = [[null, 'Toutes'], ...FONCTIONS];
  const optionsStatut: [string | null, string][] = [[null, 'Tous'], ...STATUTS];
  const d = liste.d;
  return (
    <Coque module="personnel">
      <Filtres
        champs={<>
          <Champ libelle="Rechercher" placeholder="Nom ou téléphone" value={q} onChange={setQ} largeur={260} />
          <Liste libelle="Fonction" value={fonction} options={optionsFonction} onChange={(v) => { setFonction(v); setPage(1); }} largeur={220} />
          <Liste libelle="Statut" value={statut} options={optionsStatut} onChange={(v) => { setStatut(v); setPage(1); }} largeur={160} />
        </>}
        actions={<>
          {moi.a('scolarite.import.executer') && <Bouton icone="sortie" onClick={() => naviguer('/parametres/donnees')}>Importer</Bouton>}
          {moi.a('personnel.fiche.consulter') && <Bouton icone="exporter" onClick={() => telecharger('/personnel/export')}>Exporter</Bouton>}
          {gerer && <Bouton variante="principal" icone="ajouter" onClick={nouvelleFiche}>Nouvelle fiche</Bouton>}
        </>}
      />
      <Colonnes colonnes={[
        { flex: 5, min: 640, enfants: (
          <Panneau>
            <TitrePanneau titre="Personnel de l’établissement" />
            {liste.erreur && !d ? <Erreur message={liste.erreur} recharger={liste.recharger} /> : !d ? <Chargement /> : (
              <>
                <Tableau
                  colonnes={[{ titre: 'Nom et fonction' }, { titre: 'Statut' }, { titre: 'Classes et matières' }, { titre: 'Téléphone' }, { titre: 'Compte' }]}
                  cles={d.lignes.map((l) => l.id)}
                  onLigne={(i) => setChoisi(d.lignes[i]!.id)}
                  vide="Aucune personne ne correspond à ces critères."
                  lignes={d.lignes.map((l) => [
                    <Cel2 gras haut={<span style={l.id === choisi ? { color: 'var(--accent)' } : undefined}>{l.nomAffiche}</span>} bas={l.fonctionLibelle} />,
                    libelleStatut(l.statut),
                    l.classesMatieres,
                    <span style={{ whiteSpace: 'nowrap' }}>{l.telephone || '–'}</span>,
                    l.compte ?? <span className="doux">Sans compte</span>,
                  ])}
                />
                <Pagination total={d.total} page={page} taille={TAILLE} nombre={d.lignes.length} mot="personne" changer={setPage} />
              </>
            )}
          </Panneau>
        ) },
        { flex: 2, min: 320, enfants: (
          choisi && fiche.erreur && (!fiche.d || fiche.d.id !== choisi) ? <Erreur message={fiche.erreur} recharger={fiche.recharger} />
            : fiche.d && fiche.d.id === choisi ? <PanneauFiche f={fiche.d} gerer={gerer} peutCreerCompte={moi.a('core.compte.gerer') && moi.a('core.compte.consulter')}
                modifier={() => modifier(fiche.d!)} creerSonCompte={() => creerSonCompte(fiche.d!)} />
              : d && d.lignes.length === 0 ? <Panneau><TitrePanneau titre="Fiche" /><Doux>Choisissez une personne dans la liste.</Doux></Panneau>
                : <Panneau><TitrePanneau titre="Fiche" /><Chargement /></Panneau>
        ) },
      ]} />
    </Coque>
  );
}
