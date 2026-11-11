// Module Élèves : maquettes Eleves (liste), Fiche-eleve, Inscription et Classes.
// Les fenêtres (ouvrirFormulaire) sont rendues hors des fournisseurs React : elles ne lisent ni la session ni la
// navigation ; ce dont elles ont besoin leur est passé en paramètre, et l'écran recharge ses données à leur fermeture.
import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import type { RouteEcran } from '../App.tsx';
import { api, ErreurApi, requete, url } from '../core/api.ts';
import { Coque } from '../core/coque.tsx';
import { useMoi } from '../core/session.tsx';
import { choisirFichier, ouvrirDocument, ouvrirDocumentPost, telecharger } from '../core/documents.ts';
import { decimal, enLettres, fcfa, heure, jjmmaaaa, montant, pluriel, versEntier, versIso } from '../core/format.ts';
import {
  agir, Avatar, Bandeau, BarreProgression, Bouton, CaseACocher, Cel2, Champ, Chargement, Choix, Colonnes, Doux, Erreur, Etiquette, Filtres,
  Grille, InfoCaps, Lien, Liste, Note, ouvrirFenetre, ouvrirFormulaire, Panneau, Pastille, PiedFenetre, Radio, Rangee, signaler, Tableau,
  TitrePanneau, useDonnees, useRaccourci, type Ton,
} from '../core/ui.tsx';

// ===================================================================== commun

/** Horodatage du serveur (« 2026-11-10 08:02:00.010803+00 ») au format ISO que tous les navigateurs lisent ; une date seule reste telle quelle. */
function horo(s: string | null | undefined): string {
  if (!s) return '';
  const m = s.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)(\.\d+)?(Z|[+-]\d{2}(?::?\d{2})?)?$/);
  if (!m) return s;
  const [, date, temps, fraction, zone] = m;
  const z = !zone || zone === 'Z' ? (zone ?? '') : zone.length === 3 ? `${zone}:00` : zone.includes(':') ? zone : `${zone.slice(0, 3)}:${zone.slice(3)}`;
  return `${date}T${temps}${fraction ? fraction.slice(0, 4) : ''}${z}`;
}

const SITUATIONS: Record<string, [string, Ton]> = { a_jour: ['À jour', 'neutre'], en_retard: ['En retard', 'attention'], solde: ['Soldé', 'succes'] };
const FILTRE_SITUATION: [string | null, string][] = [[null, 'Toutes'], ['a_jour', 'À jour'], ['en_retard', 'En retard'], ['solde', 'Soldé']];
const LIENS: [string, string][] = [['mere', 'Mère'], ['pere', 'Père'], ['tuteur', 'Tuteur']];
const LANGUES: [string, string][] = [['fr', 'Français'], ['en', 'English']];
const SOUS_SYSTEMES: [string, string][] = [['francophone', 'Francophone'], ['anglophone', 'Anglophone']];
const TYPES: [string, string][] = [['nouvelle', 'Nouvelle inscription'], ['reinscription', 'Réinscription'], ['redoublement', 'Redoublement']];
const TARIFS: [string, string][] = [['nouveau', 'Nouvel élève'], ['ancien', 'Ancien élève']];
const MOUVEMENTS: [string, string][] = [['transfert', 'Transfert vers un autre établissement'], ['abandon', 'Abandon'], ['exclusion', 'Exclusion']];
const RUBRIQUES = ['Inscription', 'Tranche 1', 'Tranche 2', 'Tranche 3'];
const PERMISSIONS_FINANCES = ['finances.recu.consulter', 'finances.versement.encaisser', 'finances.impaye.consulter'];

/** Inscription en cours dans l'année (en attente du premier versement, ou validée). */
const active = (statut: unknown) => statut === 'attente' || statut === 'validee';
const sousSysteme = (s: unknown) => (s === 'anglophone' ? 'Anglophone' : 'Francophone');
const chiffres = (s: string) => s.replace(/\D/g, '');

/* Styles propres au module sur téléphone (préfixe elv-) : le CSS global reste celui de la coque ; rien ne change au-dessus de 640 px. */
const CSS_ELV = `
@media (max-width: 639px) {
  .elv-reste { align-items: flex-start !important; }
  .elv-entete-fiche h2 { font-size: 19px !important; }
}`;
const StyleElv = () => <style>{CSS_ELV}</style>;

/** Rangée d'actions : même rendu que Rangee, mais les boutons s'empilent pleine largeur sous 640 px (classe utilitaire pile-mobile). */
const RangeePile = ({ children, fin, centre, ecart = 10 }: { children: ReactNode; fin?: boolean; centre?: boolean; ecart?: number }) =>
  <div className={`rangee ${fin ? 'fin' : ''} ${centre ? 'centre' : ''} pile-mobile`} style={{ gap: ecart }}>{children}</div>;

/** Actions d'une barre de filtres : transparent au-dessus de 640 px (display: contents, les boutons restent des enfants directs de la barre) ;
 *  sous 640 px, les boutons s'empilent pleine largeur au lieu d'être coupés par la grille à deux colonnes. */
const ActionsFiltres = ({ children }: { children: ReactNode }) =>
  <div className="pile-mobile" style={{ display: 'contents', gridColumn: '1 / -1' }}>{children}</div>;

/** Saisie d'une date au clavier numérique (téléphone) : les barres de JJ/MM/AAAA se placent d'elles-mêmes, la touche « / » reste acceptée. */
function dateSaisie(v: string): string {
  const d = v.replace(/\D/g, '').slice(0, 8);
  let s = d.slice(0, 2);
  if (d.length > 2) s += `/${d.slice(2, 4)}`;
  if (d.length > 4) s += `/${d.slice(4, 8)}`;
  return s;
}

/** Rangée de champs qui passent à la ligne ; chaque case garde la base des maquettes (« flex: 1 1 180px »). */
const Champs = ({ children, bas }: { children: ReactNode; bas?: boolean }) =>
  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: bas ? 'flex-end' : 'flex-start' }}>{children}</div>;
const Case = ({ flex, children }: { flex: string; children: ReactNode }) => <div style={{ flex, minWidth: 0 }}>{children}</div>;
const Gris = ({ children }: { children: ReactNode }) => <Doux petit={false}>{children}</Doux>;

// ===================================================================== liste

const TAILLE = 12;

function EcranEleves() {
  const moi = useMoi();
  const naviguer = useNavigate();
  const [params, setParams] = useSearchParams();
  const [saisie, setSaisie] = useState('');
  const [q, setQ] = useState('');
  const [classe, setClasse] = useState<string | null>(params.get('classeId'));
  const [situation, setSituation] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const zoneRecherche = useRef<HTMLDivElement>(null);
  const focaliser = () => zoneRecherche.current?.querySelector('input')?.focus();

  // Recherche au fil de la frappe, après 250 ms de pause.
  useEffect(() => {
    const t = setTimeout(() => { setQ(saisie.trim()); setPage(1); }, 250);
    return () => clearTimeout(t);
  }, [saisie]);

  // Ctrl K, ici ou depuis un autre écran (« ?recherche=1 ») : le curseur va dans la recherche.
  useEffect(() => {
    if (params.get('recherche') !== '1') return;
    focaliser();
    const p = new URLSearchParams(params);
    p.delete('recherche');
    setParams(p, { replace: true });
  }, [params, setParams]);
  useRaccourci('ctrl+k', focaliser);

  const filtres = { q, classeId: classe, situation };
  const { d, erreur, recharger } = useDonnees(() => api.get(`/scolarite/eleves${requete({ ...filtres, page, taille: TAILLE })}`), [q, classe, situation, page]);
  const classes: [string | null, string][] = [[null, 'Toutes les classes'], ...((d?.classes ?? []) as any[]).map((c): [string, string] => [c.id, c.nom])];
  const lignes: any[] = d?.lignes ?? [];
  const total: number = d?.total ?? 0;
  const filtre = Boolean(q || classe || situation);

  return (
    <Coque module="eleves" titre="Élèves">
      <StyleElv />
      <Filtres
        champs={<>
          <div ref={zoneRecherche} style={{ flex: '2 1 300px', minWidth: 0 }}>
            <Champ libelle="Rechercher" value={saisie} onChange={setSaisie} placeholder="Nom, matricule ou téléphone du responsable" />
          </div>
          <Case flex="1 1 170px"><Liste libelle="Classe" value={classe} options={classes} onChange={(v) => { setClasse(v); setPage(1); }} /></Case>
          <Case flex="1 1 150px"><Liste libelle="Situation" value={situation} options={FILTRE_SITUATION} onChange={(v) => { setSituation(v); setPage(1); }} /></Case>
        </>}
        actions={<ActionsFiltres>
          {moi.a('scolarite.import.executer') && <Bouton icone="sortie" onClick={() => naviguer('/parametres/donnees')}>Importer</Bouton>}
          {moi.a('scolarite.eleve.exporter') && <Bouton icone="exporter" onClick={() => telecharger(`/scolarite/eleves/export${requete(filtres)}`)}>Exporter</Bouton>}
          {moi.a('scolarite.eleve.exporter') && (
            <Bouton icone="imprimer" onClick={() => ouvrirDocument(`/scolarite/eleves/export${requete({ ...filtres, format: 'pdf' })}`)}>Imprimer la liste</Bouton>
          )}
          {moi.a('scolarite.inscription.creer') && <Bouton variante="principal" icone="ajouterEleve" onClick={() => naviguer('/scolarite/inscription')}>Nouvelle inscription</Bouton>}
        </ActionsFiltres>}
      />
      {erreur ? <Erreur message={erreur} recharger={recharger} /> : !d ? <Chargement /> : (
        <Panneau>
          <TitrePanneau titre={`Élèves inscrits en ${d.annee}`} sous="Réponse en moins d’une seconde, même sans réseau" />
          <Tableau
            colonnes={[{ titre: 'Matricule', mobile: 'cachee' }, { titre: 'Nom et prénoms', mobile: 'entete' }, { titre: 'Classe' }, { titre: 'Sexe', mobile: 'cachee' }, { titre: 'Né(e) le' },
              { titre: 'Responsable payeur' }, { titre: 'Situation' }, { titre: 'Reste dû', droite: true }]}
            vide={filtre ? 'Aucun élève ne correspond à ces critères' : 'Aucun élève inscrit pour l’instant'}
            cles={lignes.map((e) => e.inscriptionId)}
            lignes={lignes.map((e) => {
              const [libelle, ton] = SITUATIONS[e.situation] ?? SITUATIONS['a_jour']!;
              return [
                <Gris>{e.matricule}</Gris>,
                <Lien onClick={() => naviguer(`/scolarite/eleves/${e.eleveId}`)}>{e.nom}</Lien>,
                e.classe,
                e.sexe,
                jjmmaaaa(e.dateNaissance),
                e.payeur ? <Cel2 haut={e.payeur} bas={e.payeurTelephone ?? ''} /> : <Gris>–</Gris>,
                <Pastille ton={ton}>{libelle}</Pastille>,
                e.resteDu > 0 ? <span className="gras">{montant(e.resteDu)}</span> : <Gris>{montant(e.resteDu)}</Gris>,
              ];
            })}
          />
          <Rangee entre centre>
            <Doux>{`${pluriel(total, 'élève')} · lignes ${total === 0 ? 0 : (page - 1) * TAILLE + 1} à ${(page - 1) * TAILLE + lignes.length}`}</Doux>
            <Rangee centre ecart={8}>
              <Bouton disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Précédent</Bouton>
              <Bouton disabled={page * TAILLE >= total} onClick={() => setPage((p) => p + 1)}>Suivant</Bouton>
            </Rangee>
          </Rangee>
        </Panneau>
      )}
    </Coque>
  );
}

// ===================================================================== fiche élève

function EcranFicheEleve() {
  const { id = '' } = useParams();
  const moi = useMoi();
  const naviguer = useNavigate();
  const { d, erreur, recharger } = useDonnees(async () => {
    const e = await api.get(`/scolarite/eleves/${id}`);
    const insc = e.inscription;
    // L'échéancier reste consultable après un départ ; le suivi (notes, absences) ne vaut que pour l'année en cours.
    const [ech, suivi, histo] = await Promise.all([
      insc && moi.unParmi(PERMISSIONS_FINANCES) ? api.get(`/finances/inscriptions/${insc.id}/echeancier`) : Promise.resolve(null),
      insc && active(insc.statut) ? api.get(`/scolarite/inscriptions/${insc.id}/resume`).catch(() => null) : Promise.resolve(null),
      api.get<any[]>(`/scolarite/eleves/${id}/historique`).catch(() => null),
    ]);
    return { e, ech, suivi, histo };
  }, [id]);

  const insc = d?.e.inscription ?? null;
  const enCours = Boolean(insc && active(insc.statut));
  const peutEncaisser = enCours && moi.a('finances.versement.encaisser');
  const encaisser = () => { if (peutEncaisser) naviguer(`/finances/encaissement/${insc.id}`); };
  useRaccourci('ctrl+e', encaisser, peutEncaisser);

  if (erreur) return <Coque module="eleves" titre="Fiche élève"><Erreur message={erreur} recharger={recharger} /></Coque>;
  if (!d) return <Coque module="eleves" titre="Fiche élève"><Chargement /></Coque>;
  const { e, ech, suivi, histo } = d;
  const nom = `${e.nom} ${e.prenoms}`;
  const fille = e.sexe === 'F';
  const typeInsc = ({ nouvelle: 'nouvelle inscription', reinscription: 'réinscription', redoublement: 'redoublement' } as Record<string, string>)[insc?.type] ?? '';
  const ligne = [e.matricule, insc?.classe, fille ? 'Fille' : 'Garçon',
    `${fille ? 'née le' : 'né le'} ${jjmmaaaa(e.dateNaissance)}${e.lieuNaissance ? ` à ${e.lieuNaissance}` : ''}`, typeInsc].filter(Boolean).join(' · ');
  const reste: number | null = ech?.totaux?.reste ?? null;

  return (
    <Coque module="eleves" titre="Fiche élève">
      <StyleElv />
      <Panneau reperes marge={22} className="elv-entete-fiche">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', gap: 16, alignItems: 'center', minWidth: 0 }}>
            {e.aPhoto
              ? <img src={url(`/scolarite/eleves/${e.id}/photo`)} alt="" width={56} height={56} style={{ flex: 'none', borderRadius: 12, objectFit: 'cover', border: '1px solid var(--bord-fort)' }} />
              : <Avatar nom={e.nom} taille={56} />}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
              <h2 style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.01em' }}>{nom}</h2>
              <span className="doux">{ligne}</span>
            </div>
          </div>
          <div className="pile-mobile" style={{ display: 'flex', flexWrap: 'wrap', gap: 20, alignItems: 'center' }}>
            {reste !== null && (
              <div className="elv-reste" style={{ display: 'flex', flexDirection: 'column', gap: 2, alignItems: 'flex-end' }}>
                <Etiquette>Reste dû</Etiquette>
                <span style={{ fontSize: 28, fontWeight: 700, letterSpacing: '-0.02em', lineHeight: 1.1, color: reste > 0 ? 'var(--attention)' : 'var(--succes)' }}>
                  {montant(reste)}<span style={{ fontSize: 13, fontWeight: 600, color: 'var(--doux)' }}> FCFA</span>
                </span>
              </div>
            )}
            {peutEncaisser && <Bouton variante="principal" icone="fraisCaisse" touches={['Ctrl', 'E']} onClick={encaisser}>Encaisser</Bouton>}
          </div>
        </div>
      </Panneau>
      <Colonnes colonnes={[
        { flex: 2, min: 600, enfants: <>
          {ech && <Echeancier ech={ech} enCours={enCours} recharger={recharger} />}
          {ech && <Versements ech={ech} enCours={enCours} recharger={recharger} />}
          {!ech && insc && <Panneau><Note>Les informations financières relèvent de l’économe et du directeur.</Note></Panneau>}
        </> },
        { flex: 1, min: 320, enfants: <>
          <Responsables e={e} recharger={recharger} />
          {insc && <Scolarite e={e} insc={insc} recharger={recharger} />}
          {suivi && (
            <Panneau>
              <TitrePanneau titre="Suivi" />
              <Grille min={120} ecart={14}>
                <InfoCaps libelle={`Moyenne · ${String(suivi.sequence ?? 'séquence').toLowerCase()}`}
                  valeur={suivi.moyenneSequence === null || suivi.moyenneSequence === undefined ? '–' : `${decimal(suivi.moyenneSequence, 2)} / 20`} />
                <InfoCaps libelle="Absences" valeur={pluriel(suivi.absencesDemiJournees ?? 0, 'demi-journée')} />
              </Grille>
              {moi.unParmi(['pedagogie.note.lire', 'pedagogie.bulletin.calculer', 'pedagogie.bulletin.lever_blocage']) && (
                <div>
                  <Bouton variante="lien" icone="notes" onClick={() => naviguer(`/pedagogie/bulletins${requete({ classeId: insc.classeId, inscriptionId: insc.id })}`)}>
                    Voir les notes et le bulletin
                  </Bouton>
                </div>
              )}
            </Panneau>
          )}
          {histo && (
            <Panneau ecart={2}>
              <TitrePanneau titre="Historique" action={moi.a('core.audit.consulter') ? <Bouton variante="lien" onClick={() => naviguer('/parametres/audit')}>Tout voir</Bouton> : undefined} />
              {histo.slice(0, 6).map((h, i) => (
                <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 1, borderBottom: '1px solid var(--bord)', padding: '6px 0' }}>
                  <span className="gras">{libelleHistorique(h, nom)}</span>
                  <Doux>{jjmmaaaa(horo(h.horodatage))} · {h.utilisateur}</Doux>
                </div>
              ))}
              {histo.length === 0 && <Doux>Aucune opération enregistrée pour l’instant</Doux>}
            </Panneau>
          )}
        </> },
      ]} />
    </Coque>
  );
}

/** Lignes « métier » du journal (maquette : « Versement de 10 000 FCFA », « Réduction « Fratrie » de 5 000 FCFA », « Inscription en CE2 B »). */
function libelleHistorique(h: any, nomEleve: string): string {
  const action = String(h.action);
  const apres = String(h.apres ?? '');
  const parts = apres.split(' · ');
  const premier = parts[0] ?? '';
  const maj = (x: string) => (x ? x[0]!.toUpperCase() + x.slice(1) : x);
  switch (String(h.objetType)) {
    case 'Versement':
      return `Versement de ${premier}`;
    case 'Réduction':
      if (action === 'Demande') return `Réduction de ${premier} demandée`;
      if (action === 'Refus') return 'Réduction refusée';
      return parts.length > 1 ? `Réduction « ${maj(parts[parts.length - 1] ?? '')} » de ${premier}` : `Réduction de ${premier}`;
    case 'Élève':
      if (action === 'Création') return premier;
  }
  const objet = String(h.objet ?? '').split(' · ').filter((x) => x !== nomEleve).join(' · ');
  return apres === '' || apres === '–' ? objet : `${objet} : ${apres}`;
}

function Echeancier({ ech, enCours, recharger }: { ech: any; enCours: boolean; recharger: () => unknown }) {
  const moi = useMoi();
  const lignes: any[] = ech.lignes ?? [];
  const tot = ech.totaux;
  const reduction = enCours && moi.unParmi(['finances.reduction.accorder', 'finances.reduction.demander']) && lignes.length > 0;
  const avis = enCours && moi.a('finances.avis.emettre') && tot.reste > 0;
  const accorder = async () => {
    const seuil: number | null = ech.seuilReduction ?? null;
    if (await ouvrirFormulaire<boolean>('Accorder une réduction', (p) => <FenetreReduction {...p} lignes={lignes} seuil={seuil} />)) await recharger();
  };
  const emettreAvis = async () => {
    // L'avis est numéroté et produit en PDF par le serveur.
    const refus = await ouvrirDocumentPost('/finances/avis', { inscriptionIds: [ech.inscription.id] });
    if (refus) signaler(refus, true);
    await recharger();
  };
  return (
    <Panneau>
      <TitrePanneau titre="Échéancier" sous={`${montant(tot.verse)} versés sur ${fcfa(tot.aPayer)} · ${tot.pourcentage} %`} />
      {lignes.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${lignes.length},minmax(0,1fr))`, gap: 6 }}>
          {lignes.map((l) => (
            <div key={l.id} style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
              <BarreProgression valeur={l.aPayer > 0 ? l.verse / l.aPayer : 1} />
              <span className="doux" style={{ fontSize: 11 }}>{l.libelleFr}</span>
            </div>
          ))}
        </div>
      )}
      <Tableau
        colonnes={[{ titre: 'Rubrique', mobile: 'entete' }, { titre: 'Prix', droite: true, mobile: 'cachee' }, { titre: 'Réduction', droite: true }, { titre: 'À payer', droite: true },
          { titre: 'Versé', droite: true }, { titre: 'Reste', droite: true }, { titre: 'Date limite' }]}
        cles={lignes.map((l) => l.id)}
        lignes={lignes.map((l) => [
          l.libelleFr,
          montant(l.prix),
          l.reduction > 0
            ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>{montant(l.reduction)}{l.motifReduction && <Pastille ton="accent">{l.motifReduction}</Pastille>}</span>
            : <Gris>–</Gris>,
          montant(l.aPayer),
          l.verse > 0 ? montant(l.verse) : <Gris>0</Gris>,
          l.reste > 0 ? <span className="gras">{montant(l.reste)}</span> : <Gris>0</Gris>,
          <span style={{ display: 'inline-flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>
            {jjmmaaaa(l.dateLimite)}{l.reste === 0 && <Pastille ton="succes" icone="coche">Soldé</Pastille>}
          </span>,
        ])}
        total={['Total', '', '', montant(tot.aPayer), montant(tot.verse), montant(tot.reste), '']}
      />
      {((ech.demandes ?? []) as any[]).map((dm) => (
        <Note key={dm.id} ton="attention">
          {dm.type === 'reduction' ? `Réduction de ${montant(dm.montant)} FCFA demandée au directeur : ${dm.objet}.`
            : dm.type === 'annulation' ? `Annulation demandée : ${dm.objet}.` : `Dérogation demandée : ${dm.objet}.`}
        </Note>
      ))}
      {(reduction || avis) && (
        <RangeePile centre>
          {reduction && <Bouton icone="colonnes" onClick={accorder}>Accorder une réduction</Bouton>}
          {avis && <Bouton icone="lire" onClick={emettreAvis}>Avis de paiement</Bouton>}
        </RangeePile>
      )}
    </Panneau>
  );
}

function FenetreReduction({ fermer, lignes, seuil }: { fermer: (v?: boolean) => void; lignes: any[]; seuil: number | null }) {
  const [ligne, setLigne] = useState<string>(() => (lignes.find((l) => l.ordre > 1 && l.reste > 0) ?? lignes[0])?.id ?? '');
  const [valeur, setValeur] = useState('');
  const [motif, setMotif] = useState('');
  const [erreurs, setErreurs] = useState<Record<string, string | null>>({});
  const [charge, setCharge] = useState(false);
  const valider = async () => {
    const m = versEntier(valeur);
    const e = { montant: m === null || m <= 0 ? 'Montant invalide' : null, motif: motif.trim().length < 2 ? 'Indiquez le motif de la réduction.' : null };
    setErreurs(e);
    if (e.montant || e.motif) return;
    setCharge(true);
    const r = await agir(() => api.post('/finances/reductions', { ligneEcheanceId: ligne, montant: m, motif: motif.trim() }));
    setCharge(false);
    if (r) {
      signaler(r.appliquee ? 'Réduction accordée.' : 'Demande envoyée au directeur.');
      fermer(true);
    }
  };
  return (
    <>
      <Liste libelle="Rubrique" value={ligne} options={lignes.map((l): [string, string] => [l.id, `${l.libelleFr} · ${fcfa(l.prix)}`])} onChange={setLigne} />
      <Champ libelle="Montant de la réduction (FCFA)" value={valeur} onChange={setValeur} droite inputMode="numeric" erreur={erreurs['montant']} autoFocus onEnter={valider} />
      <Champ libelle="Motif" value={motif} onChange={setMotif} placeholder="Fratrie, personnel, cas social…" erreur={erreurs['motif']} onEnter={valider} />
      <Note ton="accent">
        {seuil === null ? 'Aucun seuil n’est fixé : toute réduction attend la validation du directeur.'
          : `Au-delà de ${montant(seuil)} FCFA, la réduction part au directeur pour validation.`}
      </Note>
      <PiedFenetre fermer={() => fermer()} action="Valider" onAction={valider} charge={charge} />
    </>
  );
}

function Versements({ ech, enCours, recharger }: { ech: any; enCours: boolean; recharger: () => unknown }) {
  const moi = useMoi();
  const naviguer = useNavigate();
  const versements: any[] = ech.versements ?? [];
  const annuler = async (v: any) => {
    if (await ouvrirFormulaire<boolean>(`Annuler le reçu ${v.numeroRecu}`, (p) => <FenetreAnnulation {...p} v={v} />)) await recharger();
  };
  return (
    <Panneau>
      <TitrePanneau titre="Versements" />
      <Tableau
        colonnes={[{ titre: 'Reçu', mobile: 'entete' }, { titre: 'Date' }, { titre: 'Montant', droite: true }, { titre: 'Mode' }, { titre: 'Encaissé par', mobile: 'cachee' }, { titre: 'Actions' }]}
        vide="Aucun versement"
        cles={versements.map((v) => v.id)}
        lignes={versements.map((v) => {
          const annule = v.statut === 'annule';
          const barre = annule ? { textDecoration: 'line-through' } : undefined;
          const t = horo(v.encaisseLe);
          return [
            <span className="gras" style={barre}>{v.numeroRecu}</span>,
            <Gris>{jjmmaaaa(t)} {heure(t)}</Gris>,
            <span style={barre}>{montant(v.montant)}</span>,
            v.modeLibelle,
            v.caissier,
            annule
              ? <span style={{ color: 'var(--danger)' }}>Annulé · {v.motifAnnulation ?? ''}</span>
              : (
                <span style={{ display: 'inline-flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px 24px' }}>
                  {moi.a('finances.recu.imprimer') && <Lien onClick={() => naviguer(`/finances/recus/${v.id}`)}>Duplicata</Lien>}
                  {enCours && moi.a('finances.versement.annuler') && v.statut === 'valide' && <Lien danger onClick={() => annuler(v)}>Annuler</Lien>}
                  {v.statut === 'annulation_demandee' && <Pastille ton="attention">Annulation demandée</Pastille>}
                </span>
              ),
          ];
        })}
      />
      <Doux>Un reçu annulé reste dans la liste, barré, avec son motif. L’économe valide les annulations, même pour un versement qu’il a encaissé.</Doux>
    </Panneau>
  );
}

function FenetreAnnulation({ fermer, v }: { fermer: (v?: boolean) => void; v: any }) {
  const [motif, setMotif] = useState('');
  const [erreur, setErreur] = useState<string | null>(null);
  const [charge, setCharge] = useState(false);
  const valider = async () => {
    if (motif.trim().length < 3) { setErreur('Indiquez le motif de l’annulation.'); return; }
    setCharge(true);
    const r = await agir(() => api.post(`/finances/versements/${v.id}/annulation`, { motif: motif.trim() }), 'Annulation demandée.');
    setCharge(false);
    if (r) fermer(true);
  };
  return (
    <>
      <p>Versement de {fcfa(v.montant)} du {jjmmaaaa(horo(v.encaisseLe))}. Le reçu reste dans la base, marqué « Annulé ».</p>
      <Champ libelle="Motif" value={motif} onChange={setMotif} placeholder="Versement saisi sur le mauvais élève…" erreur={erreur} autoFocus onEnter={valider} />
      <Note ton="accent">La demande se valide dans l’onglet « À valider » ; le directeur en est notifié.</Note>
      <PiedFenetre fermer={() => fermer()} action="Demander l’annulation" onAction={valider} charge={charge} />
    </>
  );
}

function Responsables({ e, recharger }: { e: any; recharger: () => unknown }) {
  const moi = useMoi();
  const responsables: any[] = e.responsables ?? [];
  const ajouter = async () => {
    if (await ouvrirFormulaire<boolean>('Ajouter un responsable', (p) => <FenetreResponsable {...p} eleveId={e.id} />)) await recharger();
  };
  return (
    <Panneau>
      <TitrePanneau titre="Responsables" action={moi.a('scolarite.responsable.gerer') ? <Bouton variante="lien" icone="ajouter" onClick={ajouter}>Ajouter</Bouton> : undefined} />
      {responsables.map((r) => (
        <div key={r.id} style={{ display: 'flex', gap: 12 }}>
          <Avatar nom={r.nom} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1, minWidth: 0 }}>
            <span className="gras">{r.nom}</span>
            <Doux>{r.lienLibelle} · {r.telephone}</Doux>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
              {r.payeur && <Pastille ton="accent">Payeur</Pastille>}
              {r.recoitSms && <Pastille>Reçoit les SMS</Pastille>}
              <Pastille>{r.langue === 'en' ? 'English' : 'Français'}</Pastille>
            </div>
          </div>
        </div>
      ))}
      {responsables.length === 0 && <Doux>Aucun responsable enregistré</Doux>}
    </Panneau>
  );
}

function FenetreResponsable({ fermer, eleveId }: { fermer: (v?: boolean) => void; eleveId: string }) {
  const [nom, setNom] = useState('');
  const [lien, setLien] = useState('pere');
  const [tel, setTel] = useState('');
  const [langue, setLangue] = useState('fr');
  const [payeur, setPayeur] = useState(false);
  const [sms, setSms] = useState(true);
  const [erreurs, setErreurs] = useState<Record<string, string | null>>({});
  const [charge, setCharge] = useState(false);
  const valider = async () => {
    const n = chiffres(tel).length;
    const e = { nom: nom.trim().length < 2 ? 'Obligatoire' : null, tel: n < 8 || n > 12 ? 'Numéro incomplet' : null };
    setErreurs(e);
    if (e.nom || e.tel) return;
    setCharge(true);
    const r = await agir(() => api.post(`/scolarite/eleves/${eleveId}/responsables`, { nom: nom.trim(), lien, telephone: tel, langue, payeur, recoitSms: sms }), 'Responsable ajouté.');
    setCharge(false);
    if (r) fermer(true);
  };
  return (
    <>
      <Champ libelle="Nom du responsable" value={nom} onChange={setNom} erreur={erreurs['nom']} autoFocus />
      <Champs>
        <Case flex="1 1 140px"><Liste libelle="Lien" value={lien} options={LIENS} onChange={setLien} /></Case>
        <Case flex="1 1 160px"><Champ libelle="Téléphone" value={tel} onChange={setTel} inputMode="tel" erreur={erreurs['tel']} onEnter={valider} /></Case>
      </Champs>
      <Liste libelle="Langue des messages" value={langue} options={LANGUES} onChange={setLangue} />
      <Rangee centre ecart={20}>
        <CaseACocher libelle="Payeur" valeur={payeur} onChange={setPayeur} />
        <CaseACocher libelle="Reçoit les SMS" valeur={sms} onChange={setSms} />
      </Rangee>
      <PiedFenetre fermer={() => fermer()} action="Ajouter" onAction={valider} charge={charge} />
    </>
  );
}

function Scolarite({ e, insc, recharger }: { e: any; insc: any; recharger: () => unknown }) {
  const moi = useMoi();
  const fille = e.sexe === 'F';
  const enCours = active(insc.statut);
  const type = insc.type === 'nouvelle' ? (fille ? 'nouvelle' : 'nouveau') : insc.type === 'redoublement' ? (fille ? 'redoublante' : 'redoublant') : (fille ? 'ancienne' : 'ancien');
  const statut = ({
    validee: `${fille ? 'Active' : 'Actif'} · ${type}`,
    attente: `En attente du premier versement · ${type}`,
    sortie: fille ? 'Sortie' : 'Sorti',
  } as Record<string, string>)[insc.statut] ?? String(insc.statut);
  const derogation = async () => {
    if (await ouvrirFormulaire<boolean>('Demander une dérogation', (p) => <FenetreDerogation {...p} inscriptionId={insc.id} />)) await recharger();
  };
  return (
    <Panneau>
      <TitrePanneau titre="Scolarité" />
      <Grille min={120} ecart={14}>
        <InfoCaps libelle="Classe" valeur={insc.classe} />
        <InfoCaps libelle="Sous-système" valeur={sousSysteme(insc.sousSysteme)} />
        <InfoCaps libelle="Inscrit le" valeur={jjmmaaaa(insc.inscritLe)} />
        <InfoCaps libelle="Statut" valeur={statut} />
      </Grille>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {moi.a('scolarite.document.imprimer') && <Bouton icone="lire" pleine onClick={() => ouvrirDocument(`/scolarite/eleves/${e.id}/certificat`)}>Certificat de scolarité</Bouton>}
        {enCours && moi.a('scolarite.inscription.changer_classe') && (
          <Bouton icone="eleves" pleine onClick={() => changerDeClasse(insc.id, insc.classeId, recharger)}>Changer de classe</Bouton>
        )}
        {enCours && moi.a('scolarite.inscription.radier') && (
          <Bouton icone="fermer" pleine onClick={() => enregistrerDepart(insc.id, `${e.nom} ${e.prenoms}`, recharger)}>Enregistrer un départ</Bouton>
        )}
        {insc.statut === 'attente' && moi.a('scolarite.derogation.demander') && <Bouton icone="envoyer" pleine onClick={derogation}>Demander une dérogation</Bouton>}
      </div>
    </Panneau>
  );
}

function FenetreDerogation({ fermer, inscriptionId }: { fermer: (v?: boolean) => void; inscriptionId: string }) {
  const [motif, setMotif] = useState('');
  const [erreur, setErreur] = useState<string | null>(null);
  const [charge, setCharge] = useState(false);
  const valider = async () => {
    if (motif.trim().length < 3) { setErreur('Indiquez le motif de la demande.'); return; }
    setCharge(true);
    const r = await agir(() => api.post('/finances/derogations', { inscriptionId, motif: motif.trim() }), 'Demande envoyée au directeur.');
    setCharge(false);
    if (r) fermer(true);
  };
  return (
    <>
      <p>Inscription sans premier versement : la demande part au directeur.</p>
      <Champ libelle="Motif" value={motif} onChange={setMotif} placeholder="Versement bancaire annoncé pour…" erreur={erreur} autoFocus onEnter={valider} />
      <PiedFenetre fermer={() => fermer()} action="Envoyer" onAction={valider} charge={charge} />
    </>
  );
}

// ------------------------------------------------- changement de classe et départ (fiche et écran Classes)

async function changerDeClasse(inscriptionId: string, classeActuelle: string, recharger: () => unknown) {
  const d = await agir(() => api.get('/scolarite/classes'));
  if (!d) return;
  const classes: any[] = d.classes ?? [];
  const actuelle = classes.find((c) => c.id === classeActuelle);
  const memeNiveau = classes.filter((c) => actuelle && c.niveauId === actuelle.niveauId && c.id !== classeActuelle);
  if (await ouvrirFormulaire<boolean>('Changer de classe', (p) => <FenetreChangement {...p} inscriptionId={inscriptionId} classes={memeNiveau} />)) await recharger();
}

function FenetreChangement({ fermer, inscriptionId, classes }: { fermer: (v?: boolean) => void; inscriptionId: string; classes: any[] }) {
  const [cible, setCible] = useState<string | null>(classes[0]?.id ?? null);
  const [motif, setMotif] = useState('');
  const [charge, setCharge] = useState(false);
  const valider = async () => {
    if (!cible) return;
    setCharge(true);
    const r = await agir(() => api.post(`/scolarite/inscriptions/${inscriptionId}/changement-classe`, { classeId: cible, motif: motif.trim() || null }),
      'Changement de classe enregistré.');
    setCharge(false);
    if (r) fermer(true);
  };
  return (
    <>
      {classes.length === 0 ? <Note>Aucune autre classe dans ce niveau.</Note> : (
        <Liste libelle="Nouvelle classe" value={cible} options={classes.map((k): [string, string] => [k.id, `${k.nom} · ${k.effectif} élèves sur ${k.effectifMax}`])} onChange={setCible} />
      )}
      <Champ libelle="Motif" value={motif} onChange={setMotif} />
      <PiedFenetre fermer={() => fermer()} action="Changer de classe" onAction={valider} charge={charge} disabled={!cible} />
    </>
  );
}

async function enregistrerDepart(inscriptionId: string, nom: string, recharger: () => unknown) {
  if (await ouvrirFormulaire<boolean>(`Enregistrer un départ · ${nom}`, (p) => <FenetreDepart {...p} inscriptionId={inscriptionId} />)) await recharger();
}

function FenetreDepart({ fermer, inscriptionId }: { fermer: (v?: boolean) => void; inscriptionId: string }) {
  const [type, setType] = useState('transfert');
  const [motif, setMotif] = useState('');
  const [erreur, setErreur] = useState<string | null>(null);
  const [charge, setCharge] = useState(false);
  const valider = async () => {
    if (motif.trim().length < 2) { setErreur('Indiquez le motif du départ.'); return; }
    setCharge(true);
    const r = await agir(() => api.post(`/scolarite/inscriptions/${inscriptionId}/depart`, { type, motif: motif.trim() }));
    setCharge(false);
    if (r) {
      signaler(r.exeat ? `Exeat ${r.exeat} enregistré.` : 'Départ enregistré.');
      fermer(true);
    }
  };
  return (
    <>
      <Liste libelle="Mouvement" value={type} options={MOUVEMENTS} onChange={setType} />
      <Champ libelle="Motif" value={motif} onChange={setMotif} erreur={erreur} autoFocus onEnter={valider} />
      <Note>Un transfert reçoit un numéro d’exeat. L’élève quitte la classe ; son échéancier reste consultable.</Note>
      <PiedFenetre fermer={() => fermer()} action="Enregistrer le départ" onAction={valider} charge={charge} />
    </>
  );
}

// ===================================================================== nouvelle inscription

interface Resp { nom: string; tel: string; lien: string; langue: string; sms: boolean }
const nouveauResp = (lien: string): Resp => ({ nom: '', tel: '', lien, langue: 'fr', sms: true });

/** Compte famille : le mot de passe ne s'affiche qu'une fois et s'imprime sur la fiche d'inscription. */
function fenetreInscrit(r: any) {
  const cf = r.compteFamille ?? null;
  return ouvrirFenetre(`Élève inscrit · matricule ${r.matricule}`, (fermer) => (
    <>
      {r.derogationDemandee && <Note ton="attention">La classe est complète : une dérogation du directeur est demandée.</Note>}
      {cf?.cree ? (
        <>
          <p>Compte famille créé. Remettez la fiche d’inscription au parent : le mot de passe n’est affiché qu’une fois.</p>
          <Grille min={160} ecart={14}>
            <InfoCaps libelle="Téléphone" valeur={cf.telephone} />
            <InfoCaps libelle="Mot de passe" valeur={<span className="gras" style={{ letterSpacing: '0.04em' }}>{cf.motDePasse}</span>} />
          </Grille>
        </>
      ) : cf ? <p>L’élève rejoint le compte famille du {cf.telephone}.</p> : null}
      <div className="pied">
        <Bouton icone="imprimer" onClick={async () => {
          // Le mot de passe repart au serveur le temps de produire le PDF ; il n'est pas conservé.
          const refus = await ouvrirDocumentPost(`/scolarite/inscriptions/${r.inscriptionId}/fiche`, { motDePasse: cf?.motDePasse ?? null });
          if (refus) signaler(refus, true);
        }}>Imprimer la fiche d’inscription</Bouton>
        <Bouton variante="principal" onClick={() => fermer()}>Continuer</Bouton>
      </div>
    </>
  ));
}

function EcranInscription() {
  const moi = useMoi();
  const naviguer = useNavigate();
  const [nom, setNom] = useState('');
  const [prenoms, setPrenoms] = useState('');
  const [naissance, setNaissance] = useState('');
  const [lieu, setLieu] = useState('');
  const [sexe, setSexe] = useState('M');
  const [photo, setPhoto] = useState<{ nom: string; base64: string } | null>(null);
  const [resps, setResps] = useState<Resp[]>([nouveauResp('mere')]);
  const [payeur, setPayeur] = useState(0);
  const [ss, setSs] = useState('francophone');
  const [niveau, setNiveau] = useState<string | null>(null);
  const [classe, setClasse] = useState<string | null>(null);
  const [type, setType] = useState('nouvelle');
  const [tarif, setTarif] = useState('nouveau');
  const [grille, setGrille] = useState<any>(undefined);
  const [matricule, setMatricule] = useState<string | null>(null);
  const [doublons, setDoublons] = useState<any[]>([]);
  const [doublonEcarte, setDoublonEcarte] = useState(false);
  const [famille, setFamille] = useState<any>(null);
  const [erreurs, setErreurs] = useState<Record<string, string | null>>({});
  const [charge, setCharge] = useState(false);
  const liste = useDonnees(() => api.get('/scolarite/classes'));
  const classes: any[] = liste.d?.classes ?? [];

  // Niveau et classe : valeurs choisies si elles existent dans le sous-système, sinon les premières de la liste.
  const niveaux = useMemo(() => {
    const vus = new Map<string, string>();
    for (const c of classes) if (c.sousSysteme === ss) vus.set(c.niveauId, c.niveauCode);
    return [...vus.entries()] as [string, string][];
  }, [classes, ss]);
  const niveauId = niveau && niveaux.some(([n]) => n === niveau) ? niveau : niveaux[0]?.[0] ?? null;
  const classesNiveau = classes.filter((c) => c.niveauId === niveauId);
  const classeId: string | null = classe && classesNiveau.some((c) => c.id === classe) ? classe : classesNiveau[0]?.id ?? null;
  const classeChoisie = classesNiveau.find((c) => c.id === classeId);

  useEffect(() => {
    let actif = true;
    setGrille(undefined);
    api.get(`/finances/grille${requete({ tarif })}`).then((g) => { if (actif) setGrille(g); }).catch(() => { if (actif) setGrille(null); });
    return () => { actif = false; };
  }, [tarif]);

  useEffect(() => {
    if (!classeId) { setMatricule(null); return; }
    let actif = true;
    api.get(`/scolarite/matricule-suivant${requete({ classeId })}`).then((m) => { if (actif) setMatricule(m.matricule); }).catch(() => { if (actif) setMatricule(null); });
    return () => { actif = false; };
  }, [classeId]);

  // Élève déjà connu (même date de naissance, nom très proche) : vérifié 400 ms après la frappe.
  useEffect(() => {
    const iso = versIso(naissance);
    if (!nom.trim() || !prenoms.trim() || !iso) { setDoublons([]); return; }
    let actif = true;
    const t = setTimeout(() => {
      api.get<any[]>(`/scolarite/doublons${requete({ nom: nom.trim(), prenoms: prenoms.trim(), dateNaissance: iso })}`)
        .then((d) => { if (actif) { setDoublons(d); setDoublonEcarte(false); } }).catch(() => undefined);
    }, 400);
    return () => { actif = false; clearTimeout(t); };
  }, [nom, prenoms, naissance]);

  // Famille déjà connue par le téléphone du payeur : les enfants sont rattachés au même compte.
  const telPayeur = chiffres(resps[payeur]?.tel ?? '');
  useEffect(() => {
    if (telPayeur.length < 8) { setFamille(null); return; }
    let actif = true;
    const t = setTimeout(() => {
      api.get(`/scolarite/familles/telephone/${telPayeur}`).then((f) => { if (actif) setFamille(f.famille ?? null); }).catch(() => undefined);
    }, 300);
    return () => { actif = false; clearTimeout(t); };
  }, [telPayeur]);

  const majResp = (i: number, p: Partial<Resp>) => setResps((l) => l.map((r, j) => (j === i ? { ...r, ...p } : r)));
  const choisirPhoto = async () => {
    const f = await choisirFichier('image/png,image/jpeg');
    if (!f) return;
    if (f.base64.length > 1_400_000) { signaler('Photo trop lourde : 1 Mo au plus.', true); return; }
    setPhoto({ nom: f.nom, base64: f.base64 });
  };

  const peutEncaisser = moi.a('finances.versement.encaisser');
  const enregistrer = async (encaisser: boolean) => {
    if (charge) return;
    const iso = versIso(naissance);
    const e = {
      nom: nom.trim() ? null : 'Obligatoire',
      prenoms: prenoms.trim() ? null : 'Obligatoire',
      naissance: iso ? null : 'Date au format JJ/MM/AAAA',
      resp0: resps.some((r) => r.nom.trim()) ? null : 'Obligatoire',
    };
    setErreurs(e);
    if (Object.values(e).some(Boolean)) return;
    if (!classeId) { signaler('Choisissez une classe.', true); return; }
    setCharge(true);
    try {
      const r = await api.post('/scolarite/inscriptions', {
        eleve: { nom: nom.trim(), prenoms: prenoms.trim(), sexe, dateNaissance: iso, lieuNaissance: lieu.trim() || null, ...(photo ? { photo: photo.base64 } : {}) },
        responsables: resps.map((r, i) => ({ r, i })).filter(({ r }) => r.nom.trim())
          .map(({ r, i }) => ({ nom: r.nom.trim(), lien: r.lien, telephone: r.tel, langue: r.langue, payeur: i === payeur, recoitSms: r.sms })),
        classeId, type, tarif, doublonEcarte,
      });
      await fenetreInscrit(r);
      naviguer(encaisser ? `/finances/encaissement/${r.inscriptionId}` : `/scolarite/eleves/${r.eleveId}`);
    } catch (x) {
      signaler(x instanceof ErreurApi ? x.message : String(x), true);
    } finally {
      setCharge(false);
    }
  };
  useRaccourci('echap', () => naviguer('/scolarite/eleves'));
  useRaccourci('ctrl+entree', () => { void enregistrer(peutEncaisser); });

  const doublon = doublons.length > 0 && !doublonEcarte ? doublons[0] : null;
  const niveauGrille = grille?.niveaux?.find((x: any) => x.niveauId === niveauId) ?? null;
  const montants: (number | null)[] | null = niveauGrille?.montants ?? null;
  const dates: string[] = grille?.dates ?? [];
  const enfants: any[] = famille?.enfants ?? [];

  if (liste.erreur) return <Coque module="eleves" titre="Nouvelle inscription"><Erreur message={liste.erreur} recharger={liste.recharger} /></Coque>;
  return (
    <Coque module="eleves" titre="Nouvelle inscription">
      <StyleElv />
      <Colonnes colonnes={[
        { flex: 2, min: 600, enfants: <>
          <Panneau>
            <TitrePanneau titre="Identité" />
            <Champs>
              <Case flex="1 1 180px"><Champ libelle="Nom" value={nom} onChange={setNom} erreur={erreurs['nom']} autoFocus /></Case>
              <Case flex="1 1 180px"><Champ libelle="Prénoms" value={prenoms} onChange={setPrenoms} erreur={erreurs['prenoms']} /></Case>
              <Case flex="1 1 120px"><Liste libelle="Sexe" value={sexe} options={[['M', 'Garçon'], ['F', 'Fille']]} onChange={setSexe} /></Case>
            </Champs>
            <Champs>
              <Case flex="1 1 150px">
                <Champ libelle="Date de naissance" value={naissance} onChange={(v) => setNaissance(dateSaisie(v))} placeholder="JJ/MM/AAAA" inputMode="numeric" erreur={erreurs['naissance']} />
              </Case>
              <Case flex="1 1 180px"><Champ libelle="Lieu de naissance" value={lieu} onChange={setLieu} /></Case>
              <Case flex="1 1 180px">
                <div className="champ-groupe">
                  <span className="libelle">Photo</span>
                  <Bouton icone="photo" pleine onClick={choisirPhoto} title={photo?.nom}>
                    {photo ? (photo.nom.length > 22 ? `${photo.nom.slice(0, 20)}…` : photo.nom) : 'Choisir une photo'}
                  </Bouton>
                </div>
              </Case>
            </Champs>
            {doublon && (
              <Bandeau ton="attention" icone="alerte" action={
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                  <Bouton onClick={() => naviguer(`/scolarite/eleves/${doublon.id}`)}>Ouvrir sa fiche</Bouton>
                  <Bouton variante="lien" onClick={() => setDoublonEcarte(true)}>Ce n'est pas lui</Bouton>
                </div>
              }>
                Un élève très proche existe déjà : <span className="gras">{doublon.nom} {doublon.prenoms}</span>, né le {jjmmaaaa(doublon.dateNaissance)}
                {doublon.classe ? `, inscrit en ${doublon.classe}` : ''} ({doublon.matricule}).
              </Bandeau>
            )}
          </Panneau>
          <Panneau>
            <TitrePanneau titre="Responsables" action={resps.length < 4
              ? <Bouton variante="lien" icone="ajouter" onClick={() => setResps((l) => [...l, nouveauResp('pere')])}>Ajouter un responsable</Bouton> : undefined} />
            {resps.map((r, i) => (
              <Champs key={i} bas>
                <Case flex="2 1 180px">
                  <Champ libelle={`Nom du responsable ${i + 1}`} value={r.nom} onChange={(v) => majResp(i, { nom: v })} erreur={i === 0 ? erreurs['resp0'] : null} />
                </Case>
                <Case flex="1 1 110px"><Liste libelle="Lien" value={r.lien} options={LIENS} onChange={(v) => majResp(i, { lien: v })} /></Case>
                <Case flex="1 1 140px"><Champ libelle="Téléphone" value={r.tel} onChange={(v) => majResp(i, { tel: v })} inputMode="tel" /></Case>
                <Case flex="1 1 150px"><Liste libelle="Langue des messages" value={r.langue} options={LANGUES} onChange={(v) => majResp(i, { langue: v })} /></Case>
                <div style={{ display: 'flex', gap: 16 }}>
                  <Radio nom="payeur" libelle="Payeur" actif={payeur === i} onChange={() => setPayeur(i)} />
                  <CaseACocher libelle="Reçoit les SMS" valeur={r.sms} onChange={(v) => majResp(i, { sms: v })} />
                </div>
              </Champs>
            ))}
            {famille ? (
              <>
                {enfants.length > 0 && (
                  <Doux>
                    Le numéro {famille.telephone} est déjà celui du responsable de {enfants.map((x) => `${x.nom}${x.classe ? ` (${x.classe})` : ''}`).join(', ')} :
                    les {enLettres(enfants.length + 1)} enfants seront rattachés à la même famille.
                  </Doux>
                )}
                <Bandeau icone="famille">
                  Compte famille : <span className="gras">{famille.compte ? 'déjà créé' : 'à créer'}</span> pour le {famille.telephone} ; {prenoms.trim() || 'l’élève'} y
                  sera ajouté. Pour une nouvelle famille, le compte est créé à l’enregistrement et le mot de passe est imprimé sur la fiche d’inscription.
                </Bandeau>
              </>
            ) : (
              <Bandeau icone="famille">Pour une nouvelle famille, le compte est créé à l’enregistrement et le mot de passe est imprimé sur la fiche d’inscription.</Bandeau>
            )}
          </Panneau>
          <Panneau>
            <TitrePanneau titre={`Classe · année ${moi.annee ?? ''}`} />
            {!liste.d ? <Chargement /> : (
              <>
                <Champs>
                  <Case flex="1 1 180px"><Liste libelle="Sous-système" value={ss} options={SOUS_SYSTEMES} onChange={(v) => { setSs(v); setNiveau(null); setClasse(null); }} /></Case>
                  <Case flex="1 1 180px"><Liste libelle="Niveau" value={niveauId} options={niveaux} onChange={(v) => { setNiveau(v); setClasse(null); }} /></Case>
                  <Case flex="1 1 220px">
                    <Liste libelle="Classe" value={classeId} onChange={setClasse}
                      options={classesNiveau.map((c): [string, string] => [c.id, `${c.nom} · ${c.effectif} élèves sur ${c.effectifMax}`])} />
                  </Case>
                </Champs>
                <Champs>
                  <Case flex="1 1 180px">
                    <Liste libelle="Type" value={type} options={TYPES} onChange={(v) => { setType(v); setTarif(v === 'nouvelle' ? 'nouveau' : 'ancien'); }} />
                  </Case>
                  <Case flex="1 1 180px"><Liste libelle="Tarif" value={tarif} options={TARIFS} onChange={setTarif} /></Case>
                </Champs>
                <Doux>Au-delà de {classeChoisie?.effectifMax ?? 40} élèves, la classe est complète : une dérogation du directeur est demandée.</Doux>
              </>
            )}
          </Panneau>
        </> },
        { flex: 1, min: 320, enfants: <>
          <Panneau reperes>
            <TitrePanneau titre="Frais dus" />
            {grille === undefined || !liste.d ? <Chargement />
              : grille === null ? <Note>La grille des frais n’a pas pu être chargée.</Note>
              : !montants ? <Note ton="attention">Aucune grille des frais pour ce niveau et ce tarif : l’inscription sera refusée.</Note>
              : (
                <Tableau
                  colonnes={[{ titre: 'Rubrique', mobile: 'entete' }, { titre: 'Montant', droite: true }, { titre: 'Date limite' }]}
                  lignes={RUBRIQUES.map((l, i) => [l, montant(montants[i] ?? 0), jjmmaaaa(dates[i])])}
                  total={['Total', montant(montants.reduce<number>((s, m) => s + (m ?? 0), 0)), '']}
                />
              )}
            {niveauGrille && <Doux>Copie de la grille du niveau {niveauGrille.code}. Une réduction s’accorde ensuite depuis la fiche.</Doux>}
            {montants && (montants[0] ?? 0) > 0 && (
              <Bandeau icone="fraisCaisse">L’inscription sera validée après un premier versement d’au moins {montant(montants[0])} FCFA.</Bandeau>
            )}
          </Panneau>
          <Panneau ecart={8}>
            <InfoCaps libelle="Matricule attribué à l’enregistrement" valeur={<span className="gras">{matricule ?? '–'}</span>} />
            <Doux>Année d’entrée, code de section, numéro d’ordre : sans trou ni doublon.</Doux>
          </Panneau>
        </> },
      ]} />
      <RangeePile fin centre>
        <Bouton touches={['Échap']} onClick={() => naviguer('/scolarite/eleves')}>Annuler</Bouton>
        <Bouton charge={charge} onClick={() => enregistrer(false)}>Enregistrer l'inscription</Bouton>
        <Bouton variante="principal" icone="fraisCaisse" touches={['Ctrl', 'Entrée']} charge={charge} onClick={() => enregistrer(peutEncaisser)}>Enregistrer et encaisser</Bouton>
      </RangeePile>
    </Coque>
  );
}

// ===================================================================== classes

function FenetreChoixEleve({ fermer, eleves }: { fermer: (v?: any) => void; eleves: any[] }) {
  const [choix, setChoix] = useState<string>(eleves[0]?.inscriptionId ?? '');
  return (
    <>
      <Liste libelle="Élève" value={choix} options={eleves.map((e): [string, string] => [e.inscriptionId, e.nom])} onChange={setChoix} />
      <PiedFenetre fermer={() => fermer()} action="Continuer" onAction={() => fermer(eleves.find((e) => e.inscriptionId === choix))} disabled={!choix} />
    </>
  );
}

const choisirEleve = (eleves: any[]) => ouvrirFormulaire<any>('Choisir l’élève', (p) => <FenetreChoixEleve {...p} eleves={eleves} />, 420);

function EcranClasses() {
  const moi = useMoi();
  const naviguer = useNavigate();
  const [params, setParams] = useSearchParams();
  const liste = useDonnees(() => api.get('/scolarite/classes'));
  const classes: any[] = liste.d?.classes ?? [];
  const demandee = params.get('classeId');
  const id: string | null = demandee && classes.some((c) => c.id === demandee) ? demandee : classes[0]?.id ?? null;
  const detail = useDonnees(async () => (id ? { ...(await api.get(`/scolarite/classes/${id}`)), id } : null), [id]);
  const d = detail.d && detail.d.id === id ? detail.d : null;
  const total = classes.reduce((s, c) => s + (c.effectif ?? 0), 0);
  const rechargerTout = async () => { await Promise.all([liste.recharger(), detail.recharger()]); };
  const doc = (type: string) => `/scolarite/classes/${id}/document${requete({ type })}`;

  const gauche = (
    <Panneau ecart={6}>
      <TitrePanneau titre={`${pluriel(classes.length, 'classe')} · ${pluriel(total, 'élève')}`} />
      {['francophone', 'anglophone'].map((s) => {
        const du = classes.filter((c) => c.sousSysteme === s);
        if (du.length === 0) return null;
        return (
          <Fragment key={s}>
            <Etiquette style={{ marginTop: 6 }}>{sousSysteme(s)}</Etiquette>
            {du.map((c) => (
              <Choix key={c.id} actif={c.id === id} onClick={() => setParams({ classeId: c.id }, { replace: true })}
                style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6, padding: '10px 12px' }}>
                <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                  <span className="gras">{c.nom}</span><Gris>{c.effectif} sur {c.effectifMax}</Gris>
                </span>
                <BarreProgression valeur={c.effectifMax ? c.effectif / c.effectifMax : 0} />
              </Choix>
            ))}
          </Fragment>
        );
      })}
      {classes.length === 0 && <Gris>Aucune classe pour l’instant : créez-les dans Paramètres · Établissement.</Gris>}
    </Panneau>
  );

  const droite = detail.erreur ? <Erreur message={detail.erreur} recharger={detail.recharger} /> : !d ? (id ? <Chargement /> : null) : (
    <>
      <Panneau reperes>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
            <h2 style={{ fontSize: 20, fontWeight: 700 }}>{d.nom}</h2>
            <span className="doux">{sousSysteme(d.sousSysteme)} · cycle {d.ordreEnseignement}{d.principal ? ` · instituteur principal : ${d.principal}` : ''}</span>
          </div>
          <RangeePile centre ecart={8}>
            <Bouton icone="imprimer" onClick={() => ouvrirDocument(doc('liste'))}>Liste de classe</Bouton>
            {moi.a('scolarite.document.imprimer') && <Bouton icone="lire" onClick={() => ouvrirDocument(doc('certificats'))}>Certificats de scolarité</Bouton>}
            {moi.a('scolarite.document.imprimer') && <Bouton icone="personnel" onClick={() => ouvrirDocument(doc('cartes'))}>Cartes scolaires</Bouton>}
            {moi.a('scolarite.eleve.exporter') && <Bouton icone="exporter" onClick={() => telecharger(doc('csv'))}>Exporter</Bouton>}
          </RangeePile>
        </div>
        <Grille min={110} ecart={14}>
          <InfoCaps libelle="Effectif" valeur={`${d.effectif} sur ${d.effectifMax}`} />
          <InfoCaps libelle="Garçons" valeur={d.garcons} />
          <InfoCaps libelle="Filles" valeur={d.filles} />
          <InfoCaps libelle="Nouveaux" valeur={d.nouveaux} />
          <InfoCaps libelle="Anciens" valeur={d.anciens} />
          <InfoCaps libelle="Redoublants" valeur={d.redoublants} />
        </Grille>
      </Panneau>
      <Panneau>
        <TitrePanneau titre="Élèves de la classe" action={moi.a('scolarite.inscription.changer_classe') && d.eleves.length > 0 ? (
          <Bouton variante="lien" icone="eleves" onClick={async () => {
            const e = await choisirEleve(d.eleves);
            if (e) await changerDeClasse(e.inscriptionId, id!, rechargerTout);
          }}>Changer un élève de classe</Bouton>
        ) : undefined} />
        <Tableau
          colonnes={[{ titre: 'N°', mobile: 'cachee' }, { titre: 'Matricule', mobile: 'cachee' }, { titre: 'Nom et prénoms', mobile: 'entete' }, { titre: 'Sexe' }, { titre: 'Statut' }]}
          vide="Aucun élève dans cette classe"
          cles={(d.eleves as any[]).map((e) => e.inscriptionId)}
          lignes={(d.eleves as any[]).map((e) => {
            const statut = String(e.statut ?? '');
            const ton: Ton = statut.startsWith('Redoubl') ? 'attention' : statut.startsWith('Nouv') ? 'accent' : 'neutre';
            return [
              <Gris>{e.numero}</Gris>,
              <Gris>{e.matricule}</Gris>,
              <Lien onClick={() => naviguer(`/scolarite/eleves/${e.eleveId}`)}>{e.nom}</Lien>,
              e.sexe,
              <Pastille ton={ton}>{statut}</Pastille>,
            ];
          })}
        />
      </Panneau>
      <Panneau>
        <TitrePanneau titre="Mouvements de l’année" action={moi.a('scolarite.inscription.radier') && d.eleves.length > 0 ? (
          <Bouton variante="lien" icone="fermer" onClick={async () => {
            const e = await choisirEleve(d.eleves);
            if (e) await enregistrerDepart(e.inscriptionId, e.nom, rechargerTout);
          }}>Enregistrer un départ</Bouton>
        ) : undefined} />
        <Tableau
          colonnes={[{ titre: 'Date' }, { titre: 'Élève', mobile: 'entete' }, { titre: 'Mouvement' }, { titre: 'Pièce' }, { titre: 'Auteur' }]}
          vide="Aucun mouvement cette année"
          lignes={(d.mouvements as any[]).map((m) => [
            jjmmaaaa(m.date),
            <span className="gras">{m.eleve}</span>,
            m.mouvement,
            !m.piece || m.piece === '–' ? <Gris>–</Gris> : <span className="gras">Exeat {m.piece}</span>,
            m.auteur,
          ])}
        />
      </Panneau>
    </>
  );

  return (
    <Coque module="eleves" titre="Classes">
      <StyleElv />
      {liste.erreur ? <Erreur message={liste.erreur} recharger={liste.recharger} /> : !liste.d ? <Chargement /> : (
        <Colonnes colonnes={[{ flex: 1, min: 280, enfants: gauche }, { flex: 3, min: 620, enfants: droite }]} />
      )}
    </Coque>
  );
}

// ===================================================================== routes

export const routes: RouteEcran[] = [
  { path: '/scolarite/eleves', element: <EcranEleves /> },
  { path: '/scolarite/eleves/:id', element: <EcranFicheEleve /> },
  { path: '/scolarite/inscription', element: <EcranInscription /> },
  { path: '/scolarite/classes', element: <EcranClasses /> },
];
