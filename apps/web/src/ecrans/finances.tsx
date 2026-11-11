// Module Frais et caisse : maquettes Caisse, Encaissement, Recu, Impayes, Depenses, Comptes, Frais, Validations, Releve.
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import type { RouteEcran } from '../App.tsx';
import { api, ErreurApi, requete } from '../core/api.ts';
import { Coque } from '../core/coque.tsx';
import { choisirFichier, imprimerDocument, ouvrirApres, ouvrirDocument, ouvrirDocumentPost, telecharger } from '../core/documents.ts';
import {
  aujourdhuiIso, enLettres, fcfa, heure, jjmm, jjmmaaaa, libelleMois, montant, pluriel, versEntier, versIso,
} from '../core/format.ts';
import { useMoi } from '../core/session.tsx';
import {
  agir, Bandeau, Bascules, Bouton, CarteChiffre, CaseACocher, Cel2, Champ, Chargement, Colonnes, confirmer, Doux, Erreur, Etapes, Etiquette, Filtres,
  Grille, InfoCaps, Jauge, Lien, LigneListe, Liste, Note, ouvrirFormulaire, Panneau, Pastille, PiedFenetre, Rangee, signaler, Tableau,
  TitrePanneau, useDonnees, useRaccourci, type Ton,
} from '../core/ui.tsx';

const libelleCaisse = (c: string | null | undefined) => (c === 'ape' ? 'Caisse APE' : 'Caisse principale');
const moisCourant = () => aujourdhuiIso().slice(0, 7);
const cleIdempotence = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');

/** Raccourci prioritaire sur celui de la coque (Ctrl K de la recherche globale). */
function useRaccourciPrioritaire(touche: string, action: () => void, actif = true) {
  const ref = useRef(action);
  ref.current = action;
  useEffect(() => {
    if (!actif) return;
    const ecoute = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== touche || document.querySelector('.voile')) return;
      e.preventDefault();
      e.stopPropagation();
      ref.current();
    };
    window.addEventListener('keydown', ecoute, true);
    return () => window.removeEventListener('keydown', ecoute, true);
  }, [touche, actif]);
}

// ===================================================================== sélecteur d'élève (Encaisser un élève, relevé bancaire)

interface EleveTrouve { inscriptionId: string; eleveId: string; matricule: string; nom: string; classe: string }

function SelecteurEleve({ fermer }: { fermer: (v?: EleveTrouve) => void }) {
  const [q, setQ] = useState('');
  const [res, setRes] = useState<EleveTrouve[]>([]);
  const [cherche, setCherche] = useState(false);
  useEffect(() => {
    if (!q.trim()) { setRes([]); setCherche(false); return; }
    const t = setTimeout(async () => {
      try { setRes(await api.get<EleveTrouve[]>(`/scolarite/recherche${requete({ q: q.trim() })}`)); } catch { setRes([]); }
      setCherche(true);
    }, 250);
    return () => clearTimeout(t);
  }, [q]);
  return (
    <>
      <Champ value={q} onChange={setQ} autoFocus placeholder="Nom, matricule ou téléphone du responsable" ariaLabel="Rechercher un élève"
        onEnter={() => { if (res[0]) fermer(res[0]); }} />
      <div>
        {res.map((e) => (
          <LigneListe key={e.inscriptionId} onClick={() => fermer(e)}>
            <span className="gras" style={{ flex: 1 }}>{e.nom}</span>
            <Doux petit={false}>{e.classe} · {e.matricule}</Doux>
          </LigneListe>
        ))}
        {cherche && res.length === 0 && <Doux>Aucun élève trouvé</Doux>}
      </div>
      <div className="pied"><Bouton onClick={() => fermer()}>Annuler</Bouton></div>
    </>
  );
}
const choisirEleve = (titre = 'Rechercher un élève') => ouvrirFormulaire<EleveTrouve>(titre, SelecteurEleve, 520);

// ===================================================================== fenêtres de caisse

function FenetreEntreeDiverse({ fermer }: { fermer: (v?: boolean) => void }) {
  const [libelle, setLibelle] = useState('');
  const [m, setM] = useState('');
  const [charge, setCharge] = useState(false);
  const valider = async () => {
    setCharge(true);
    const r = await agir(() => api.post('/caisse/entrees', { libelle: libelle.trim(), montant: versEntier(m) ?? 0 }), 'Entrée enregistrée.');
    setCharge(false);
    if (r) fermer(true);
  };
  return (
    <>
      <Champ libelle="Libellé" value={libelle} onChange={setLibelle} autoFocus placeholder="Vente de carnets de correspondance…" />
      <Champ libelle="Montant (FCFA)" value={m} onChange={setM} droite inputMode="numeric" onEnter={valider} />
      <Note>L’entrée est enregistrée en espèces dans votre session de caisse.</Note>
      <PiedFenetre fermer={() => fermer()} action="Enregistrer" onAction={valider} charge={charge} />
    </>
  );
}

function FenetreVerserBanque({ fermer }: { fermer: (v?: boolean) => void }) {
  const [m, setM] = useState('');
  const [banque, setBanque] = useState('');
  const [bordereau, setBordereau] = useState('');
  const [date, setDate] = useState(jjmmaaaa(aujourdhuiIso()));
  const [charge, setCharge] = useState(false);
  const valider = async () => {
    const le = versIso(date);
    if (!le) { signaler('Date du bordereau au format JJ/MM/AAAA.', true); return; }
    setCharge(true);
    const r = await agir(() => api.post('/caisse/depots', { montant: versEntier(m) ?? 0, banque: banque.trim(), bordereau: bordereau.trim(), deposeLe: le }),
      'Versement à la banque enregistré.');
    setCharge(false);
    if (r) fermer(true);
  };
  return (
    <>
      <Champ libelle="Montant (FCFA)" value={m} onChange={setM} droite inputMode="numeric" autoFocus />
      <Champ libelle="Banque" value={banque} onChange={setBanque} />
      <Rangee>
        <div style={{ flex: '1 1 180px' }}><Champ libelle="N° du bordereau" value={bordereau} onChange={setBordereau} /></div>
        <div style={{ flex: '1 1 150px' }}><Champ libelle="Date du bordereau" value={date} onChange={setDate} placeholder="JJ/MM/AAAA" /></div>
      </Rangee>
      <Note>Le montant sort des espèces de votre session ; le bordereau sert au rapprochement du relevé bancaire.</Note>
      <PiedFenetre fermer={() => fermer()} action="Enregistrer le versement" onAction={valider} charge={charge} />
    </>
  );
}

async function demanderSortie(): Promise<boolean> {
  let categories: { id: string; libelle: string }[] = [];
  try { categories = (await api.get('/caisse/sorties')).categories; } catch (e) { signaler(e instanceof ErreurApi ? e.message : String(e), true); return false; }
  const ok = await ouvrirFormulaire<boolean>('Nouvelle demande de sortie', ({ fermer }) => {
    const [objet, setObjet] = useState('');
    const [cat, setCat] = useState<string | null>(categories[0]?.id ?? null);
    const [m, setM] = useState('');
    const [motif, setMotif] = useState('');
    const [charge, setCharge] = useState(false);
    const valider = async () => {
      setCharge(true);
      const r = await agir(() => api.post<{ numero: string }>('/caisse/sorties', { objet: objet.trim(), categorieId: cat, montant: versEntier(m) ?? 0, motif: motif.trim() }));
      setCharge(false);
      if (r) { signaler(`Demande ${r.numero} envoyée au directeur.`); fermer(true); }
    };
    return (
      <>
        <Champ libelle="Objet" value={objet} onChange={setObjet} autoFocus placeholder="Réparation du photocopieur…" />
        <Rangee>
          <div style={{ flex: '1 1 200px' }}><Liste<string | null> libelle="Catégorie" value={cat} options={categories.map((c) => [c.id, c.libelle])} onChange={setCat} /></div>
          <div style={{ flex: '1 1 160px' }}><Champ libelle="Montant (FCFA)" value={m} onChange={setM} droite inputMode="numeric" /></div>
        </Rangee>
        <Champ libelle="Motif" value={motif} onChange={setMotif} lignes={2} />
        <Note ton="accent">Le directeur valide la demande ; l’économe décaisse ensuite et joint la pièce justificative.</Note>
        <PiedFenetre fermer={() => fermer()} action="Envoyer la demande" onAction={valider} charge={charge} disabled={!cat} />
      </>
    );
  });
  return ok === true;
}

const tonOperation = (o: string): Ton => (o === 'Versement' ? 'accent' : o === 'Sortie' ? 'attention' : o === 'Annulation' ? 'danger' : 'neutre');

// ===================================================================== caisse du jour

function EcranCaisse() {
  const moi = useMoi();
  const naviguer = useNavigate();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [caisse, setCaisse] = useState<string>('principale');
  const [sansSession, setSansSession] = useState(false);
  const [compte, setCompte] = useState('');
  const [motif, setMotif] = useState('');
  const [fonds, setFonds] = useState('0');
  const [charge, setCharge] = useState(false);
  const { d, erreur, recharger } = useDonnees(() => api.get(`/caisse/journee${requete({ sessionId })}`), [sessionId]);
  // Le comptage saisi survit aux rechargements de la même session, pas au changement de session.
  const sessionVue = useRef<string | null>(null);
  useEffect(() => {
    if (!d?.session) return;
    setCaisse(d.session.caisse);
    setSansSession(false);
    if (sessionVue.current !== d.session.id) {
      sessionVue.current = d.session.id;
      setCompte(d.session.montantCompte !== null && d.session.montantCompte !== undefined ? montant(d.session.montantCompte) : '');
      setMotif('');
    }
  }, [d]);

  const encaisser = async () => {
    const e = await choisirEleve('Encaisser un élève');
    if (e) naviguer(`/finances/encaissement/${e.inscriptionId}`);
  };
  useRaccourciPrioritaire('k', () => { void encaisser(); }, moi.a('finances.versement.encaisser'));

  const choisirCaisse = (c: string) => {
    setCaisse(c);
    const s = ((d?.sessionsOuvertes ?? []) as any[]).find((x) => x.caisse === c);
    if (s) { setSansSession(false); setSessionId(s.id); } else setSansSession(true);
  };
  const ouvrir = async () => {
    setCharge(true);
    const r = await agir(() => api.post('/caisse/sessions', { caisse, fondsInitial: versEntier(fonds) ?? 0 }), 'Session ouverte.');
    setCharge(false);
    if (r) { setSansSession(false); setSessionId(null); await recharger(); }
  };
  const cloturer = async () => {
    const s = d?.session;
    if (!s) return;
    const c = versEntier(compte);
    if (c === null) { signaler('Saisissez les espèces comptées.', true); return; }
    if (!(await confirmer('Clôturer la session', 'Une session clôturée ne se modifie plus. Confirmez-vous la clôture ?', 'Clôturer la session'))) return;
    const r = await agir(() => api.post(`/caisse/sessions/${s.id}/cloture`, { montantCompte: c, motifEcart: motif.trim() || null }), 'Session clôturée.');
    if (r) await recharger();
  };

  const s = sansSession ? null : d?.session;
  const ouvertes = (d?.sessionsOuvertes ?? []) as any[];
  const listeCaisse = (
    <div style={{ flex: '1 1 190px', maxWidth: 240 }}>
      <Liste<string> libelle="Caisse" value={caisse} options={[['principale', 'Caisse principale'], ['ape', 'Caisse APE']]} onChange={choisirCaisse} />
    </div>
  );
  let contenu: ReactNode;
  if (erreur) contenu = <Erreur message={erreur} recharger={recharger} />;
  else if (!d) contenu = <Chargement />;
  else if (!s) {
    const dejaOuverte = (d.session?.estMienne && !d.session.clotureeLe) || ouvertes.some((x) => x.caissier === moi.nom);
    // Le serveur ne renvoie « ouvrable » que s'il n'a aucune session à montrer (après une session close, la permission décide).
    const ouvrable = (d.ouvrable as boolean | undefined) ?? moi.a('caisse.session.gerer');
    contenu = (
      <Panneau reperes>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <h2 style={{ fontSize: 20, fontWeight: 700 }}>{libelleCaisse(caisse)}</h2>
            <span className="doux">Aucune session ouverte</span>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' }}>{listeCaisse}</div>
        </div>
        {ouvrable && !dejaOuverte && (
          <>
            <Rangee>
              <Champ libelle="Fonds initial (FCFA)" value={fonds} onChange={setFonds} droite inputMode="numeric" largeur={220} />
              <Bouton icone="coche" variante="principal" charge={charge} onClick={ouvrir}>Ouvrir la session</Bouton>
            </Rangee>
            <Doux>Chaque personne qui encaisse ouvre sa session le matin et la clôture le jour même.</Doux>
          </>
        )}
        {ouvrable && dejaOuverte && <Note>Votre session est ouverte dans l’autre caisse : clôturez-la avant d’en ouvrir une nouvelle.</Note>}
      </Panneau>
    );
  } else {
    const k = d.kpi;
    contenu = (
      <>
        <Panneau reperes>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <h2 style={{ fontSize: 20, fontWeight: 700 }}>{libelleCaisse(s.caisse)}</h2>
              <span className="doux">{s.clotureeLe
                ? `Session clôturée le ${jjmmaaaa(s.clotureeLe)} à ${heure(s.clotureeLe)} · ${s.caissier}`
                : `Session ouverte le ${jjmmaaaa(s.ouverteLe)} à ${heure(s.ouverteLe)} par ${s.caissier}`}</span>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' }}>
              {/* Le matin, la dernière session affichée est celle de la veille, clôturée : on en ouvre une nouvelle. */}
              {s.clotureeLe && moi.a('caisse.session.gerer') && !ouvertes.some((x) => x.caissier === moi.nom) && (
                <Bouton icone="coche" onClick={() => setSansSession(true)}>Ouvrir une nouvelle session</Bouton>
              )}
              {listeCaisse}
            </div>
          </div>
        </Panneau>
        <Grille min={220} ecart={16}>
          <CarteChiffre etiquette="Scolarité encaissée" valeur={montant(k.scolarite)} unite="FCFA" sous={pluriel(k.nbVersements, 'versement')} />
          <CarteChiffre etiquette="Autres entrées" valeur={montant(k.autres)} unite="FCFA" sous={pluriel(k.nbAutres, 'entrée')} />
          <CarteChiffre etiquette="Sorties" valeur={montant(k.sorties)} unite="FCFA" couleur="var(--attention)" sous={pluriel(k.nbSorties, 'décaissement')} />
          <CarteChiffre etiquette="Espèces attendues" valeur={montant(k.attendues)} unite="FCFA" sous="fonds initial compris" />
        </Grille>
        <Colonnes colonnes={[
          { flex: 2, min: 600, enfants: <Operations d={d} recharger={recharger} naviguer={naviguer} /> },
          { flex: 1, min: 340, enfants: <ClotureSession d={d} compte={compte} setCompte={setCompte} motif={motif} setMotif={setMotif} cloturer={cloturer} recharger={recharger} /> },
        ]} />
      </>
    );
  }
  return (
    <Coque module="frais">
      {moi.a('finances.versement.encaisser') && (
        <Rangee fin centre ecart={10}>
          <Bouton icone="fraisCaisse" variante="principal" touches={['Ctrl', 'K']} onClick={encaisser}>Encaisser un élève</Bouton>
        </Rangee>
      )}
      {contenu}
    </Coque>
  );
}

function Operations({ d, recharger, naviguer }: { d: any; recharger: () => Promise<void>; naviguer: (r: string) => void }) {
  const moi = useMoi();
  const s = d.session;
  const ops = d.operations as any[];
  const mienne = s.estMienne && !s.clotureeLe;
  return (
    <Panneau>
      <TitrePanneau titre="Opérations de la session" sous={pluriel(ops.length, 'opération')} action={
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          {mienne && moi.a('caisse.entree.enregistrer') && (
            <Bouton icone="ajouter" onClick={async () => { if (await ouvrirFormulaire<boolean>('Entrée diverse', FenetreEntreeDiverse)) await recharger(); }}>Entrée diverse</Bouton>
          )}
          {moi.a('caisse.sortie.demander') && <Bouton icone="sortie" onClick={() => naviguer('/finances/depenses')}>Demande de sortie</Bouton>}
        </div>
      } />
      <Tableau
        colonnes={[{ titre: 'Heure' }, { titre: 'Opération' }, { titre: 'Libellé' }, { titre: 'Mode' }, { titre: 'Montant', droite: true }]}
        lignes={ops.map((o) => [
          <span className="doux">{heure(o.horodatage)}</span>,
          <Pastille ton={tonOperation(o.operation)}>{o.operation}</Pastille>,
          o.libelle,
          o.mode,
          <span className="gras" style={o.montant < 0 ? { color: 'var(--attention)' } : undefined}>{montant(o.montant)}</span>,
        ])}
      />
    </Panneau>
  );
}

function ClotureSession({ d, compte, setCompte, motif, setMotif, cloturer, recharger }: {
  d: any; compte: string; setCompte: (v: string) => void; motif: string; setMotif: (v: string) => void; cloturer: () => void; recharger: () => Promise<void>;
}) {
  const moi = useMoi();
  const s = d.session;
  const c = d.cloture;
  const close = !!s.clotureeLe;
  const attendues = c.especes as number;
  const compteN = close ? (s.montantCompte as number | null) : versEntier(compte);
  const ecart = close ? (s.ecart as number | null) : compteN === null ? null : compteN - attendues;
  const peutClore = !close && ((s.estMienne && moi.a('caisse.session.gerer')) || moi.a('caisse.session.forcer'));
  const nb = (x: number, mot: string, motPluriel?: string) => (!x ? '–' : pluriel(x, mot, motPluriel));
  return (
    <Panneau reperes>
      <TitrePanneau titre="Clôture de la session" />
      <Tableau
        colonnes={[{ titre: 'Mode' }, { titre: 'Attendu', droite: true }, { titre: 'Compté', droite: true }]}
        lignes={[
          ['Espèces', <span className="gras">{montant(attendues)}</span>, close
            ? <span className="gras">{montant(compteN)}</span>
            : <Champ value={compte} onChange={setCompte} petit droite inputMode="numeric" readOnly={!peutClore} ariaLabel="Espèces comptées" largeur={120} />],
          ['Versements bancaires', <span className={c.bancaires ? '' : 'doux'}>{montant(c.bancaires)}</span>, <span className="doux">{nb(c.nbBancaires, 'bordereau', 'bordereaux')}</span>],
          ['Virements', <span className={c.virements ? '' : 'doux'}>{montant(c.virements)}</span>, <span className="doux">{nb(c.nbVirements, 'virement')}</span>],
          ['Chèques', <span className={c.cheques ? '' : 'doux'}>{montant(c.cheques)}</span>, <span className="doux">{nb(c.nbCheques, 'chèque')}</span>],
        ]}
      />
      {ecart !== null && ecart !== undefined && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, justifyContent: 'space-between', alignItems: 'center' }}>
          <span className="gras doux">Écart sur les espèces</span>
          {ecart === 0 ? <Pastille ton="succes" icone="coche">0 FCFA</Pastille> : <Pastille ton="attention" icone="alerte">{fcfa(ecart)}</Pastille>}
        </div>
      )}
      {close && s.motifEcart && <InfoCaps libelle="Motif de l’écart" valeur={s.motifEcart} />}
      {!close && ecart !== null && ecart !== 0 && <Champ libelle="Motif de l'écart" value={motif} onChange={setMotif} />}
      <Doux>Espèces attendues = fonds initial + versements et entrées en espèces − sorties.</Doux>
      {!close && (
        <Rangee fin centre ecart={10}>
          {s.estMienne && moi.a('caisse.banque.verser') && (
            <Bouton icone="banque" onClick={async () => { if (await ouvrirFormulaire<boolean>('Verser à la banque', FenetreVerserBanque)) await recharger(); }}>Verser à la banque</Bouton>
          )}
          {peutClore && <Bouton icone="bouclier" variante="principal" onClick={cloturer}>Clôturer la session</Bouton>}
        </Rangee>
      )}
      <Doux>Une session clôturée ne se modifie plus. Chaque personne qui encaisse clôture la sienne le jour même.</Doux>
    </Panneau>
  );
}

// ===================================================================== encaissement (panneau de 640 px)

function EcranEncaissement() {
  const { inscriptionId = '' } = useParams();
  const [params] = useSearchParams();
  const moi = useMoi();
  const naviguer = useNavigate();
  const ligneReleveId = params.get('releve');
  const montantInitial = versEntier(params.get('montant') ?? '');
  const [mode, setMode] = useState<string>(params.get('mode') ?? 'especes');
  const [saisie, setSaisie] = useState(montantInitial !== null ? montant(montantInitial) : '');
  const [banque, setBanque] = useState('');
  const [bordereau, setBordereau] = useState('');
  const [dateBordereau, setDateBordereau] = useState(jjmmaaaa(aujourdhuiIso()));
  const [noteBordereau, setNoteBordereau] = useState<string | null>(null);
  const [charge, setCharge] = useState(false);
  // Une clé par chargement de l'écran : un double envoi ne crée qu'un versement.
  const cle = useMemo(cleIdempotence, []);
  const envoi = useRef(false);
  const champ = useRef<HTMLInputElement>(null);
  const { d, erreur, recharger } = useDonnees(async () => {
    const [e, n] = await Promise.all([api.get(`/finances/inscriptions/${inscriptionId}/echeancier`), api.get('/finances/recu-suivant').catch(() => ({ numero: null }))]);
    return { e, numero: n.numero as string | null };
  }, [inscriptionId]);
  useEffect(() => { if (d) champ.current?.focus(); }, [d]);

  const lignes = useMemo(() => ([...((d?.e.lignes ?? []) as any[])].sort((a, b) => a.ordre - b.ordre)), [d]);
  const reste = (d?.e.totaux.reste ?? 0) as number;
  const saisi = versEntier(saisie) ?? 0;
  const trop = saisi > reste;
  const enCours = lignes.find((l) => l.reste > 0);
  let aImputer = trop ? 0 : saisi;
  const repartition = lignes.map((l) => { const part = Math.min(l.reste, aImputer); aImputer -= part; return { l, part }; });

  const annuler = () => {
    const eleveId = d?.e.inscription?.eleveId;
    naviguer(eleveId ? `/scolarite/eleves/${eleveId}` : '/finances/caisse');
  };
  const valider = async () => {
    if (!d || saisi <= 0 || trop || envoi.current) return;
    if (mode === 'versement_bancaire' && (!banque.trim() || !bordereau.trim() || !versIso(dateBordereau))) {
      signaler('Banque, numéro et date du bordereau (JJ/MM/AAAA) sont exigés.', true);
      return;
    }
    envoi.current = true;
    setCharge(true);
    let versementId: string | null = null;
    let refus: string | null = null;
    // La fenêtre du reçu s'ouvre pendant le clic, puis reçoit le PDF (deux exemplaires).
    await ouvrirApres(async () => {
      try {
        const r = await api.post<{ id: string }>('/finances/versements', {
          inscriptionId, montant: saisi, mode,
          ...(mode === 'versement_bancaire' ? { banque: banque.trim(), bordereau: bordereau.trim(), dateBordereau: versIso(dateBordereau) } : {}),
          ...(ligneReleveId ? { ligneReleveId } : {}),
        }, { 'idempotency-key': cle });
        versementId = r.id;
        return moi.a('finances.recu.imprimer') ? `/finances/versements/${r.id}/recu?format=pdf` : null;
      } catch (e) {
        refus = e instanceof ErreurApi ? e.message : String(e);
        return null;
      }
    });
    envoi.current = false;
    setCharge(false);
    if (refus) { signaler(refus, true); return; }
    if (versementId) naviguer(`/finances/recus/${versementId}`);
  };
  // Entrée valide le versement ; sur un bouton qui a le focus (Annuler, mode de paiement…), elle garde son effet habituel.
  useRaccourci('entree', () => {
    const focus = document.activeElement;
    if (focus instanceof HTMLButtonElement) focus.click(); else void valider();
  }, !!d);
  useRaccourci('echap', annuler, !!d);

  const lirePhoto = async () => {
    const f = await choisirFichier('image/png,image/jpeg');
    if (!f) return;
    const r = await agir(() => api.post('/assistant/taches', { type: 'IA-03', objet: 'Lecture d’un bordereau' }));
    if (r) setNoteBordereau(`Photo « ${f.nom} » : la lecture attend l’assistant. Saisissez les trois champs.`);
  };

  let contenu: ReactNode;
  if (erreur) contenu = <><Note ton="danger">{erreur}</Note><div><Bouton onClick={() => naviguer('/finances/caisse')}>Retour</Bouton></div></>;
  else if (!d) contenu = <Chargement />;
  else {
    const insc = d.e.inscription;
    contenu = (
      <>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <h1 style={{ fontSize: 20, fontWeight: 700 }}>Encaissement</h1>
            <span className="doux">{insc.eleve} · {insc.classe} · {insc.matricule}</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
            <Etiquette>Reste dû</Etiquette>
            <span style={{ fontSize: 22, fontWeight: 700, color: reste > 0 ? 'var(--attention)' : 'var(--succes)' }}>
              {montant(reste)}<span style={{ fontSize: 12, fontWeight: 600, color: 'var(--doux)' }}> FCFA</span>
            </span>
          </div>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-start' }}>
          <div className="champ-groupe" style={{ flex: '1 1 200px' }}>
            <label htmlFor="montant-verse" className="libelle">Montant versé (FCFA)</label>
            <input id="montant-verse" ref={champ} className={`champ droite ${trop ? 'erreur' : ''}`} inputMode="numeric" value={saisie} placeholder="0"
              style={{ height: 56, fontSize: 24, fontWeight: 700 }} onChange={(e) => setSaisie(e.target.value.replace(/[^\d\s  ]/g, ''))} />
            {trop && <span className="erreur-champ">Le montant dépasse le reste dû.</span>}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {enCours && <Bouton onClick={() => setSaisie(montant(enCours.reste))}>Solder la tranche en cours · {montant(enCours.reste)}</Bouton>}
            {reste > 0 && <Bouton onClick={() => setSaisie(montant(reste))}>Tout solder · {montant(reste)}</Bouton>}
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <Etiquette>Mode de paiement</Etiquette>
          <Bascules<string> options={[['especes', 'Espèces'], ['versement_bancaire', 'Versement bancaire'], ['virement', 'Virement'], ['cheque', 'Chèque']]} valeur={mode} onChange={setMode} />
        </div>
        {mode === 'versement_bancaire' && (
          <div className="bloc-assistant">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
              <div style={{ flex: '1 1 180px' }}><Champ libelle="Banque" value={banque} onChange={setBanque} /></div>
              <div style={{ flex: '1 1 130px' }}><Champ libelle="N° du bordereau" value={bordereau} onChange={setBordereau} /></div>
              <div style={{ flex: '1 1 130px' }}><Champ libelle="Date du bordereau" value={dateBordereau} onChange={setDateBordereau} placeholder="JJ/MM/AAAA" /></div>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
              {moi.a('assistant.proposition.bordereau') && <Bouton icone="photo" onClick={lirePhoto}>Lire une photo du bordereau</Bouton>}
              <Doux>{noteBordereau ?? 'Banque, numéro et date du bordereau sont exigés.'}</Doux>
            </div>
          </div>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <Etiquette>Répartition · toujours dans l’ordre des tranches</Etiquette>
          <Tableau
            colonnes={[{ titre: 'Rubrique' }, { titre: 'Reste avant', droite: true }, { titre: 'Ce versement', droite: true }, { titre: 'Reste après', droite: true }]}
            lignes={repartition.map(({ l, part }) => [
              l.libelleFr,
              <span className={l.reste === 0 ? 'doux' : ''}>{montant(l.reste)}</span>,
              part > 0 ? <span className="gras">{montant(part)}</span> : <span className="doux">–</span>,
              <span className={l.reste - part === 0 ? 'doux' : ''}>{montant(l.reste - part)}</span>,
            ])}
          />
        </div>
        <Doux>Reçu {d.numero ?? '–'} · imprimante de caisse, en 2 exemplaires</Doux>
        <Rangee fin centre ecart={10}>
          <Bouton touches={['Échap']} onClick={annuler}>Annuler</Bouton>
          <Bouton icone="imprimer" variante="principal" touches={['Entrée']} charge={charge} disabled={saisi <= 0 || trop} onClick={valider}>Valider et imprimer</Bouton>
        </Rangee>
      </>
    );
  }
  return (
    <div style={{ minHeight: '100vh', padding: 20 }}>
      <div style={{ maxWidth: 600 }}>
        <Panneau marge={24} ecart={18}>{contenu}</Panneau>
      </div>
    </div>
  );
}

// ===================================================================== reçu bilingue (240 × 140 mm)

function Logo({ present = true }: { present?: boolean }) {
  const [erreur, setErreur] = useState(false);
  if (erreur || !present) {
    return (
      <div style={{ flex: 'none', width: 64, height: 64, border: '1px dashed var(--doux)', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: 'var(--doux)', padding: 4 }}>Logo</div>
    );
  }
  return <img src="/api/v1/structure/etablissement/images/logo" alt="Logo" style={{ width: 64, height: 64, objectFit: 'contain', flex: 'none' }} onError={() => setErreur(true)} />;
}

function EcranRecu() {
  const { id = '' } = useParams();
  const moi = useMoi();
  const naviguer = useNavigate();
  const { d: r, erreur, recharger } = useDonnees(() => api.get(`/finances/versements/${id}/recu?format=json`), [id]);
  if (erreur) return <div style={{ padding: 20 }}><Erreur message={erreur} recharger={recharger} /></div>;
  if (!r) return <Chargement />;
  const e = r.etablissement;
  const lignes = r.lignes as any[];
  const aPayer = lignes.reduce((s, l) => s + l.aPayer, 0);
  const verse = lignes.reduce((s, l) => s + l.verse, 0);
  const reste = lignes.reduce((s, l) => s + l.reste, 0);
  const th = (droite = false): CSSProperties => ({ padding: '6px 8px', textAlign: droite ? 'right' : 'left', fontSize: 11, fontWeight: 700, borderBottom: '1.5px solid var(--texte)', whiteSpace: 'nowrap' });
  const td = (droite = false, gras = false): CSSProperties => ({ padding: '6px 8px', textAlign: droite ? 'right' : 'left', borderBottom: '1px solid var(--bord-fort)', whiteSpace: 'nowrap', fontWeight: gras ? 700 : 400 });
  const adresse = [e.ville_bp, e.telephone ? `Tél. ${e.telephone}` : null].filter(Boolean).join(' · ');
  const champ = (l: string, v: string) => <span>{l} : <span style={{ fontWeight: 700 }}>{v}</span></span>;
  return (
    <div style={{ minHeight: '100vh', background: 'var(--panneau)' }}>
      <div style={{ maxWidth: 1130, fontSize: 13, position: 'relative' }}>
        <div style={{ height: 8, background: 'var(--accent)' }} />
        <div style={{ padding: '22px 34px 24px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <Logo present={r.aLogo !== false} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                <span style={{ fontSize: 17, fontWeight: 700 }}>{`${e.nom_fr}`.toUpperCase()} · {`${e.nom_en}`.toUpperCase()}</span>
                <span className="doux">{adresse}</span>
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 1, alignItems: 'flex-end' }}>
              <span style={{ fontSize: 15, fontWeight: 700 }}>REÇU DE PAIEMENT · PAYMENT RECEIPT</span>
              <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--accent)' }}>N° {r.numero}</span>
              <span className="doux">{r.date} à {r.heure}</span>
            </div>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 28px', padding: '8px 12px', border: '1px solid var(--bord-fort)', borderRadius: 6 }}>
            {champ('Élève / Student', r.eleve)}{champ('Matricule / Reg. no.', r.matricule)}{champ('Classe / Class', r.classe)}{champ('Année / Year', r.annee)}
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={th()}>Rubrique / Item</th><th style={th(true)}>Prix / Price</th><th style={th(true)}>Réduction / Discount</th><th style={th(true)}>À payer / To pay</th>
                <th style={th(true)}>Versé / Paid</th><th style={th(true)}>Reste / Balance</th><th style={th()}>Date limite / Deadline</th>
              </tr>
            </thead>
            <tbody>
              {lignes.map((l, i) => (
                <tr key={i}>
                  <td style={td()}>{l.libelleFr} / {l.libelleEn}</td><td style={td(true)}>{montant(l.prix)}</td><td style={td(true)}>{l.reduction > 0 ? montant(l.reduction) : '–'}</td>
                  <td style={td(true)}>{montant(l.aPayer)}</td><td style={td(true)}>{montant(l.verse)}</td><td style={td(true)}>{montant(l.reste)}</td><td style={td()}>{l.dateLimite}</td>
                </tr>
              ))}
              <tr>
                <td style={td(false, true)}>Total</td><td style={td()} /><td style={td()} /><td style={td(true, true)}>{montant(aPayer)}</td>
                <td style={td(true, true)}>{montant(verse)}</td><td style={td(true, true)}>{montant(reste)}</td><td style={td()} />
              </tr>
            </tbody>
          </table>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 24, justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0, flex: 1 }}>
              <span>Montant versé / Amount paid : <span style={{ fontSize: 18, fontWeight: 700 }}>{fcfa(r.montant)}</span></span>
              <span>{r.montantLettresFr} · {r.montantLettresEn}</span>
              <span className="doux">Mode / Method : {r.modeFr} / {r.modeEn}{r.bordereau ? ` · bordereau ${r.bordereau}` : ''}</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
              {champ('Encaissé par / Received by', r.caissier)}
              <div style={{ flex: 'none', width: 230, height: 70, border: '1px dashed var(--doux)', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center', fontSize: 10, color: 'var(--doux)', padding: 4 }}>
                Signature et cachet · Signature and stamp
              </div>
            </div>
          </div>
        </div>
        {r.annule && (
          <div style={{ position: 'absolute', right: 34, top: 120, transform: 'rotate(-7deg)', padding: '4px 12px', borderRadius: 6, fontSize: 16, fontWeight: 700,
            border: '2px solid var(--danger)', color: 'var(--danger)' }}>ANNULÉ · CANCELLED</div>
        )}
      </div>
      <div className="pas-imprime" style={{ maxWidth: 1130, padding: '8px 34px 24px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {r.duplicata && !r.annule && <Doux>Reçu déjà imprimé : une nouvelle impression porte la mention « Duplicata ».</Doux>}
        <Rangee centre>
          {moi.a('finances.recu.imprimer') && (
            <Bouton icone="imprimer" variante="principal" onClick={() => {
              imprimerDocument(`/finances/versements/${id}/recu?format=pdf`);
              // Après une impression, toute nouvelle impression est un duplicata : l'écran se met à jour.
              setTimeout(() => { void recharger(); }, 1000);
            }}>{r.duplicata ? 'Imprimer un duplicata' : 'Imprimer'}</Bouton>
          )}
          {moi.a('finances.recu.imprimer') && <Bouton icone="exporter" onClick={() => telecharger(`/finances/versements/${id}/recu?format=escp`)}>Imprimante de caisse (ESC/P)</Bouton>}
          {moi.a('scolarite.eleve.consulter') && r.eleveId && <Bouton icone="eleves" onClick={() => naviguer(`/scolarite/eleves/${r.eleveId}`)}>Fiche de l’élève</Bouton>}
          {moi.a('finances.versement.encaisser') && <Bouton icone="fraisCaisse" onClick={() => naviguer('/finances/caisse')}>Caisse du jour</Bouton>}
        </Rangee>
      </div>
    </div>
  );
}

// ===================================================================== impayés

const premieresMinuscules = (s: string) => s.split(', ').map((x, i) => (i === 0 ? x : x.toLowerCase())).join(', ');

function EcranImpayes() {
  const moi = useMoi();
  const naviguer = useNavigate();
  const [niveau, setNiveau] = useState<string | null>(null);
  const [classe, setClasse] = useState<string | null>(null);
  const [echeance, setEcheance] = useState<number | null>(null);
  const [retard, setRetard] = useState<number>(7);
  const [page, setPage] = useState(1);
  const [coches, setCoches] = useState<Set<string>>(new Set());
  const filtres = { niveauId: niveau, classeId: classe, echeance, retard };
  const { d, erreur, recharger } = useDonnees(() => api.get(`/finances/impayes${requete({ ...filtres, page, taille: 10 })}`), [niveau, classe, echeance, retard, page]);
  const filtrer = (f: () => void) => { f(); setPage(1); setCoches(new Set()); };
  const basculer = (id: string, v: boolean) => setCoches((c) => { const n = new Set(c); if (v) n.add(id); else n.delete(id); return n; });

  const avis = async () => {
    if (coches.size === 0) { signaler('Cochez les élèves à qui remettre un avis.', true); return; }
    const refus = await ouvrirDocumentPost('/finances/avis', { inscriptionIds: [...coches] });
    if (refus) signaler(refus, true);
    await recharger();
  };
  const relancer = async () => {
    let modele: any;
    try { modele = ((await api.get('/communication/sms')).modeles as any[]).find((m) => m.code === 'relance'); } catch (e) { signaler(e instanceof ErreurApi ? e.message : String(e), true); return; }
    if (!modele) { signaler('Modèle de relance introuvable.', true); return; }
    const corps = { cible: 'selection', inscriptionIds: [...coches], modele: 'relance', texteFr: modele.fr, texteEn: modele.en };
    const est = await agir(() => api.post('/communication/sms/estimation', corps));
    if (!est) return;
    const ok = await confirmer('Relancer par SMS',
      `${pluriel(est.destinataires, 'responsable')} (${est.fr} en français, ${est.en} en anglais), ${est.smsParMessage} SMS par message. Les SMS sont mis en file d’attente et partent dès que la connexion le permet.`,
      'Mettre en file');
    if (!ok) return;
    const r = await agir(() => api.post('/communication/sms', corps), 'Relances mises en file.');
    if (r) { setCoches(new Set()); await recharger(); }
  };
  const assistant = () => agir(() => api.post('/assistant/taches', { type: 'IA-02', objet: 'Relances d’impayés' }), 'Demande en file : l’assistant préparera les relances.');

  const kpi = d?.kpi;
  const classes = ((d?.classes ?? []) as any[]).filter((c) => !niveau || c.niveauId === niveau);
  return (
    <Coque module="frais">
      {erreur ? <Erreur message={erreur} recharger={recharger} /> : !d ? <Chargement /> : (
        <>
          <Grille min={220} ecart={16}>
            <CarteChiffre etiquette="Échéances dépassées" valeur={montant(kpi.montant)} unite="FCFA" couleur="var(--attention)" sous={`au ${jjmmaaaa(aujourdhuiIso())}`} />
            <CarteChiffre etiquette="Élèves en retard" valeur={montant(kpi.eleves)} sous={`sur ${kpi.inscrits} inscrits`} />
            <CarteChiffre etiquette="Retard le plus ancien" valeur={kpi.jours ?? '–'} unite={kpi.jours !== null && kpi.jours !== undefined ? 'jours' : undefined} couleur="var(--danger)"
              sous={kpi.ligne ? `${kpi.ligne} due le ${jjmmaaaa(kpi.date)}` : 'aucune échéance dépassée'} />
            <CarteChiffre etiquette="Relances envoyées" valeur={montant(kpi.relances)} sous={kpi.relancesDepuis ? `depuis le ${jjmmaaaa(kpi.relancesDepuis)}` : 'aucune pour l’instant'} />
          </Grille>
          <Filtres
            champs={<>
              <div style={{ flex: '1 1 160px' }}>
                <Liste<string | null> libelle="Niveau" value={niveau} options={[[null, 'Tous les niveaux'], ...((d.niveaux as any[]).map((n) => [n.id, n.code] as [string, string]))]}
                  onChange={(v) => filtrer(() => { setNiveau(v); setClasse(null); })} />
              </div>
              <div style={{ flex: '1 1 160px' }}>
                <Liste<string | null> libelle="Classe" value={classe} options={[[null, 'Toutes les classes'], ...classes.map((c) => [c.id, c.nom] as [string, string])]}
                  onChange={(v) => filtrer(() => setClasse(v))} />
              </div>
              <div style={{ flex: '1 1 140px' }}>
                <Liste<number | null> libelle="Échéance" value={echeance}
                  options={[[null, 'Toutes'], [1, 'Inscription'], [2, 'Tranche 1'], [3, 'Tranche 2'], [4, 'Tranche 3']]} onChange={(v) => filtrer(() => setEcheance(v))} />
              </div>
              <div style={{ flex: '1 1 150px' }}>
                <Liste<number> libelle="Retard" value={retard} options={[[7, 'Plus de 7 jours'], [30, 'Plus de 30 jours'], [0, 'Tous les retards']]} onChange={(v) => filtrer(() => setRetard(v))} />
              </div>
            </>}
            actions={<>
              <Bouton icone="exporter" onClick={() => telecharger(`/finances/impayes/export${requete(filtres)}`)}>Exporter</Bouton>
              {moi.a('finances.avis.emettre') && <Bouton icone="lire" onClick={avis}>Avis de paiement</Bouton>}
              {moi.a('assistant.proposition.relance') && <Bouton icone="assistant" onClick={assistant}>Préparer avec l'assistant</Bouton>}
              {moi.a('communication.sms.envoyer') && (
                <Bouton icone="envoyer" variante="principal" disabled={coches.size === 0} onClick={relancer}>Relancer par SMS · {coches.size}</Bouton>
              )}
            </>}
          />
          <Panneau>
            <TitrePanneau titre="Impayés à la date du jour" sous="Seules les échéances dont la date limite est passée" />
            <Tableau
              colonnes={[{ titre: '' }, { titre: 'Élève' }, { titre: 'Classe' }, { titre: 'Échéances dépassées' }, { titre: 'En retard', droite: true }, { titre: 'Depuis' },
                { titre: 'Responsable payeur' }, { titre: 'Dernière relance' }]}
              vide="Aucun impayé à cette date"
              cles={(d.lignes as any[]).map((l) => l.inscriptionId)}
              lignes={(d.lignes as any[]).map((l) => [
                <input type="checkbox" aria-label={l.eleve} checked={coches.has(l.inscriptionId)} style={{ width: 18, height: 18, accentColor: 'var(--accent)' }}
                  onChange={(e) => basculer(l.inscriptionId, e.target.checked)} />,
                <Lien onClick={() => naviguer(`/scolarite/eleves/${l.eleveId}`)}>{l.eleve}</Lien>,
                l.classe,
                premieresMinuscules(`${l.echeances}`),
                <span className="gras">{montant(l.montant)}</span>,
                <Pastille ton={l.jours >= 60 ? 'danger' : 'attention'}>{l.jours} jours</Pastille>,
                l.payeur ? <Cel2 haut={l.payeur} bas={l.telephone} /> : <span className="doux">–</span>,
                l.relanceCanal ? `${l.relanceCanal === 'sms' ? 'SMS' : l.relanceCanal === 'avis' ? 'Avis' : 'Appel'} le ${jjmm(l.relanceLe)}` : <span className="doux">Aucune</span>,
              ])}
            />
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, justifyContent: 'space-between', alignItems: 'center' }}>
              <Doux>{pluriel(d.total, 'élève')} · {fcfa(kpi.montant)} · lignes {d.total === 0 ? 0 : (page - 1) * 10 + 1} à {(page - 1) * 10 + (d.lignes as any[]).length}</Doux>
              <div style={{ display: 'flex', gap: 8 }}>
                <Bouton disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Précédent</Bouton>
                <Bouton disabled={page * 10 >= d.total} onClick={() => setPage((p) => p + 1)}>Suivant</Bouton>
              </div>
            </div>
          </Panneau>
        </>
      )}
    </Coque>
  );
}

// ===================================================================== dépenses

function FenetreCategories({ fermer, d }: { fermer: (v?: boolean) => void; d: any }) {
  const budgets = d.budgets as any[];
  const [montants, setMontants] = useState<Record<string, string>>(() => Object.fromEntries(budgets.map((b) => [b.id, b.budget === null ? '' : montant(b.budget)])));
  const [nom, setNom] = useState('');
  const [budget, setBudget] = useState('');
  const [charge, setCharge] = useState(false);
  const valider = async () => {
    setCharge(true);
    for (const b of budgets) {
      const v = versEntier(montants[b.id] ?? '');
      if (v !== null && v !== b.budget) {
        if (await agir(() => api.put(`/caisse/categories/${b.id}/budget`, { montant: v })) === null) { setCharge(false); return; }
      }
    }
    if (nom.trim() && await agir(() => api.post('/caisse/categories', { libelle: nom.trim(), budget: versEntier(budget) })) === null) { setCharge(false); return; }
    setCharge(false);
    signaler('Catégories enregistrées.');
    fermer(true);
  };
  return (
    <>
      <Doux petit={false}>Budget de la période : {d.periode?.libelle ?? '–'}</Doux>
      {budgets.map((b) => (
        <div key={b.id} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span className="gras" style={{ flex: 1 }}>{b.libelle}</span>
          <Champ value={montants[b.id] ?? ''} onChange={(v) => setMontants((m) => ({ ...m, [b.id]: v }))} petit droite inputMode="numeric" placeholder="Budget (FCFA)" largeur={160} ariaLabel={`Budget ${b.libelle}`} />
        </div>
      ))}
      <Etiquette>Nouvelle catégorie</Etiquette>
      <div style={{ display: 'flex', gap: 12 }}>
        <div style={{ flex: 1 }}><Champ value={nom} onChange={setNom} placeholder="Libellé" ariaLabel="Libellé de la catégorie" /></div>
        <Champ value={budget} onChange={setBudget} droite inputMode="numeric" placeholder="Budget (FCFA)" largeur={160} ariaLabel="Budget de la nouvelle catégorie" />
      </div>
      <PiedFenetre fermer={() => fermer()} action="Enregistrer" onAction={valider} charge={charge} />
    </>
  );
}

const PASTILLE_SORTIE: Record<string, [string, Ton]> = { demandee: ['À valider', 'attention'], validee: ['Validée', 'accent'], decaissee: ['Décaissée', 'succes'], refusee: ['Refusée', 'danger'] };

function EcranDepenses() {
  const moi = useMoi();
  const { d, erreur, recharger } = useDonnees(() => api.get('/caisse/sorties'));
  const decaisser = async (s: any) => {
    if (!(await confirmer(`Décaisser ${s.numero}`, `${s.objet} · ${fcfa(s.montant)}. Le montant sort des espèces de votre session de caisse.`, 'Décaisser'))) return;
    if (await agir(() => api.post(`/caisse/sorties/${s.id}/decaissement`), 'Sortie décaissée.')) await recharger();
  };
  const joindre = async (s: any) => {
    const f = await choisirFichier('application/pdf,image/png,image/jpeg');
    if (!f) return;
    if (await agir(() => api.put(`/caisse/sorties/${s.id}/piece`, { nom: f.nom.slice(0, 60), base64: f.base64, type: (f.type || 'application/octet-stream').slice(0, 60) }), 'Pièce justificative jointe.')) await recharger();
  };
  return (
    <Coque module="frais">
      {moi.a('caisse.sortie.demander') && (
        <Rangee fin centre ecart={10}>
          <Bouton icone="ajouter" variante="principal" onClick={async () => { if (await demanderSortie()) await recharger(); }}>Nouvelle demande de sortie</Bouton>
        </Rangee>
      )}
      {erreur ? <Erreur message={erreur} recharger={recharger} /> : !d ? <Chargement /> : (
        <Colonnes colonnes={[
          { flex: 5, min: 640, enfants: (
            <Panneau>
              <TitrePanneau titre="Demandes de sortie de caisse" sous={libelleMois(moisCourant())} />
              <Etapes etapes={[['Demande', 'faite'], ['Validation', 'faite'], ['Décaissement', 'faite'], ['Pièce justificative', 'faite']]} />
              <Tableau
                colonnes={[{ titre: 'Demande' }, { titre: 'Objet et demandeur' }, { titre: 'Catégorie' }, { titre: 'Montant', droite: true }, { titre: 'État' }, { titre: 'Pièce' }]}
                vide="Aucune demande de sortie pour l’instant"
                cles={(d.sorties as any[]).map((s) => s.id)}
                lignes={(d.sorties as any[]).map((s) => {
                  const [lib, ton] = PASTILLE_SORTIE[s.statut] ?? ['–', 'neutre'];
                  return [
                    <Cel2 haut={s.numero} bas={jjmmaaaa(s.demandeLe)} gras />,
                    <Cel2 haut={s.objet} bas={s.demandeur} />,
                    s.categorie,
                    <span className="gras">{montant(s.montant)}</span>,
                    <Pastille ton={ton}>{lib}</Pastille>,
                    s.piece ? <Lien onClick={() => ouvrirDocument(`/caisse/sorties/${s.id}/piece`)}>{s.piece}</Lien>
                      : s.statut === 'validee' && moi.a('caisse.sortie.decaisser') ? <Lien onClick={() => decaisser(s)}>Décaisser</Lien>
                      : s.statut === 'decaissee' && moi.a('caisse.sortie.decaisser') ? <Lien onClick={() => joindre(s)}>Joindre</Lien>
                      : <span className="doux">–</span>,
                  ];
                })}
              />
              <Doux>Une sortie validée se décaisse depuis la caisse du jour ; la pièce justificative se joint ensuite.</Doux>
            </Panneau>
          ) },
          { flex: 2, min: 300, enfants: (
            <Panneau ecart={16}>
              <TitrePanneau titre="Budget par catégorie" sous={d.periode?.libelle} action={moi.a('caisse.categorie.gerer') ? (
                <Bouton variante="lien" icone="parametres" onClick={async () => {
                  if (await ouvrirFormulaire<boolean>('Catégories', ({ fermer }) => <FenetreCategories fermer={fermer} d={d} />, 560)) await recharger();
                }}>Catégories</Bouton>
              ) : undefined} />
              {(d.budgets as any[]).map((b) => (
                <Jauge key={b.id} libelle={b.libelle} valeur={b.pourcentage === null ? '–' : `${b.pourcentage} %`}
                  part={!b.budget ? 0 : b.consomme / b.budget} couleur={(b.pourcentage ?? 0) >= 80 ? 'var(--attention)' : undefined}
                  sous={b.budget === null ? `${montant(b.consomme)} FCFA engagés · aucun budget fixé` : `${montant(b.consomme)} sur ${montant(b.budget)} FCFA`} />
              ))}
              {(d.budgets as any[]).length === 0 && <Doux>Aucune période en cours : les budgets se fixent par trimestre.</Doux>}
            </Panneau>
          ) },
        ]} />
      )}
    </Coque>
  );
}

// ===================================================================== état des comptes

function EcranComptes() {
  const auj = aujourdhuiIso();
  const [du, setDu] = useState(jjmmaaaa(`${auj.slice(0, 8)}01`));
  const [au, setAu] = useState(jjmmaaaa(auj));
  const [caisse, setCaisse] = useState<string | null>(null);
  // La période ne change qu'une fois les deux dates complètes et valides (pas de rechargement à chaque frappe).
  const [periode, setPeriode] = useState({ du: versIso(du), au: versIso(au) });
  useEffect(() => {
    const a = versIso(du);
    const b = versIso(au);
    if (a && b) setPeriode((p) => (p.du === a && p.au === b ? p : { du: a, au: b }));
  }, [du, au]);
  const filtres = () => ({ ...periode, caisse });
  const { d, erreur, recharger } = useDonnees(() => api.get(`/finances/comptes${requete(filtres())}`), [periode, caisse]);
  const rubriques = (d?.rubriques ?? []) as any[];
  const cats = (d?.categories ?? []) as any[];
  const maxR = Math.max(0, ...rubriques.map((x) => x.montant));
  const maxC = Math.max(0, ...cats.map((x) => x.montant));
  return (
    <Coque module="frais">
      <Filtres
        champs={<>
          <div style={{ flex: '1 1 130px' }}><Champ libelle="Du" value={du} onChange={setDu} placeholder="JJ/MM/AAAA" erreur={du.trim() && !versIso(du) ? 'Date au format JJ/MM/AAAA.' : null} /></div>
          <div style={{ flex: '1 1 130px' }}><Champ libelle="Au" value={au} onChange={setAu} placeholder="JJ/MM/AAAA" erreur={au.trim() && !versIso(au) ? 'Date au format JJ/MM/AAAA.' : null} /></div>
          <div style={{ flex: '1 1 190px' }}>
            <Liste<string | null> libelle="Caisse" value={caisse} options={[[null, 'Toutes les caisses'], ['principale', 'Caisse principale'], ['ape', 'Caisse APE']]} onChange={setCaisse} />
          </div>
        </>}
        actions={<>
          <Bouton icone="exporter" onClick={() => telecharger(`/finances/comptes/document${requete({ ...filtres(), format: 'csv' })}`)}>Exporter</Bouton>
          <Bouton icone="lire" onClick={() => telecharger(`/finances/comptes/document${requete({ ...filtres(), format: 'ecritures' })}`)}>Export comptable</Bouton>
          <Bouton icone="imprimer" onClick={() => imprimerDocument(`/finances/comptes/document${requete({ ...filtres(), format: 'pdf' })}`)}>Imprimer</Bouton>
        </>}
      />
      {erreur ? <Erreur message={erreur} recharger={recharger} /> : !d ? <Chargement /> : (
        <>
          <Grille min={220} ecart={16}>
            <CarteChiffre etiquette="Recettes" valeur={montant(d.kpi.recettes)} unite="FCFA" sous="scolarité et autres entrées" />
            <CarteChiffre etiquette="Dépenses" valeur={montant(d.kpi.depenses)} unite="FCFA" couleur="var(--attention)" sous={pluriel(d.kpi.nbDepenses, 'décaissement')} />
            <CarteChiffre etiquette="Versé à la banque" valeur={montant(d.kpi.banque)} unite="FCFA" sous={pluriel(d.kpi.nbBordereaux, 'bordereau', 'bordereaux')} />
            <CarteChiffre etiquette="Solde des caisses" valeur={montant(d.kpi.solde)} unite="FCFA" sous={`au ${jjmmaaaa(d.au)}`} />
          </Grille>
          <Panneau>
            <TitrePanneau titre="Par caisse" />
            <Tableau
              colonnes={[{ titre: 'Caisse' }, { titre: 'Solde initial', droite: true }, { titre: 'Recettes', droite: true }, { titre: 'Dépenses', droite: true },
                { titre: 'Versé à la banque', droite: true }, { titre: 'Solde', droite: true }]}
              lignes={(d.parCaisse as any[]).map((c) => [
                <span className="gras">{libelleCaisse(c.caisse)}</span>, montant(c.initial), montant(c.recettes),
                <span className={c.depenses ? '' : 'doux'}>{montant(c.depenses)}</span>, <span className={c.banque ? '' : 'doux'}>{montant(c.banque)}</span>,
                <span className="gras">{montant(c.solde)}</span>,
              ])}
              total={['Total', montant(d.total.initial), montant(d.total.recettes), montant(d.total.depenses), montant(d.total.banque), montant(d.total.solde)]}
            />
          </Panneau>
          <Colonnes colonnes={[
            { flex: 1, min: 320, enfants: (
              <Panneau>
                <TitrePanneau titre="Recettes par rubrique" />
                {rubriques.map((x) => <Jauge key={x.libelle} libelle={x.libelle} grasLibelle={false} valeur={montant(x.montant)} part={maxR ? x.montant / maxR : 0} />)}
                {rubriques.length === 0 && <Doux>Aucune recette sur la période</Doux>}
              </Panneau>
            ) },
            { flex: 1, min: 320, enfants: (
              <Panneau>
                <TitrePanneau titre="Dépenses par catégorie" />
                {cats.map((x) => <Jauge key={x.libelle} libelle={x.libelle} grasLibelle={false} valeur={montant(x.montant)} part={maxC ? x.montant / maxC : 0} couleur="var(--attention)" />)}
                {cats.length === 0 && <Doux>Aucune dépense sur la période</Doux>}
              </Panneau>
            ) },
            { flex: 1, min: 320, enfants: (
              <Panneau ecart={6}>
                <TitrePanneau titre="Versements à la banque" />
                {(d.depots as any[]).map((v, i) => (
                  <LigneListe key={i}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                      <span className="gras">{jjmmaaaa(v.date)} · {fcfa(v.montant)}</span>
                      <Doux>{libelleCaisse(v.caisse)} · bordereau {v.bordereau} · saisi par {v.saisiPar}</Doux>
                    </div>
                  </LigneListe>
                ))}
                {(d.depots as any[]).length === 0 && <Doux>Aucun versement à la banque sur la période</Doux>}
                <Doux>Chaque versement de la caisse à la banque garde son bordereau.</Doux>
              </Panneau>
            ) },
          ]} />
        </>
      )}
    </Coque>
  );
}

// ===================================================================== grille des frais

function FenetreRubrique({ fermer }: { fermer: (v?: boolean) => void }) {
  const [fr, setFr] = useState('');
  const [en, setEn] = useState('');
  const [precision, setPrecision] = useState('');
  const [obligatoire, setObligatoire] = useState(false);
  const [caisse, setCaisse] = useState<string>('principale');
  const [charge, setCharge] = useState(false);
  const valider = async () => {
    setCharge(true);
    const r = await agir(() => api.post('/finances/rubriques', { libelleFr: fr.trim(), libelleEn: en.trim(), obligatoire, precision: precision.trim() || null, caisse }), 'Rubrique ajoutée.');
    setCharge(false);
    if (r) fermer(true);
  };
  return (
    <>
      <Rangee>
        <div style={{ flex: '1 1 200px' }}><Champ libelle="Libellé en français" value={fr} onChange={setFr} autoFocus /></div>
        <div style={{ flex: '1 1 200px' }}><Champ libelle="Libellé en anglais" value={en} onChange={setEn} /></div>
      </Rangee>
      <Champ libelle="Précision" value={precision} onChange={setPrecision} placeholder="CM2 et Class 6…" />
      <Rangee centre>
        <CaseACocher libelle="Obligatoire" valeur={obligatoire} onChange={setObligatoire} />
        <div style={{ flex: '1 1 200px' }}><Liste<string> value={caisse} options={[['principale', 'Caisse principale'], ['ape', 'Caisse APE']]} onChange={setCaisse} ariaLabel="Caisse" /></div>
      </Rangee>
      <PiedFenetre fermer={() => fermer()} action="Ajouter" onAction={valider} charge={charge} />
    </>
  );
}

function EcranGrille() {
  const moi = useMoi();
  const modif = moi.a('finances.grille.modifier');
  const [anneeId, setAnneeId] = useState<string | null>(null);
  const [tarif, setTarif] = useState<string>('nouveau');
  const [dates, setDates] = useState<string[]>(['', '', '', '']);
  const [montants, setMontants] = useState<Record<string, string[]>>({});
  const [charge, setCharge] = useState(false);
  const { d, erreur, recharger } = useDonnees(() => api.get(`/finances/grille${requete({ anneeId, tarif })}`), [anneeId, tarif]);
  useEffect(() => {
    if (!d) return;
    setDates([0, 1, 2, 3].map((i) => (d.dates[i] ? jjmmaaaa(d.dates[i]) : '')));
    setMontants(Object.fromEntries((d.niveaux as any[]).map((n) => [n.niveauId, (n.montants as (number | null)[]).map((m) => (m === null ? '' : montant(m)))])));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d]);
  const libelleAnnee = ((d?.annees ?? []) as any[]).find((a) => a.id === (anneeId ?? d?.anneeId))?.libelle ?? '';
  const enregistrer = async () => {
    if (!modif || !d?.anneeId) return;
    const iso = dates.map((x) => versIso(x));
    if (iso.some((x) => !x)) { signaler('Dates limites au format JJ/MM/AAAA.', true); return; }
    setCharge(true);
    await agir(() => api.put('/finances/grille', {
      anneeId: d.anneeId, tarif, dates: iso,
      lignes: Object.entries(montants).map(([niveauId, m]) => ({ niveauId, montants: m.map((x) => versEntier(x)) })),
    }), 'Grille enregistrée.');
    setCharge(false);
    await recharger();
  };
  useRaccourci('ctrl+s', () => { void enregistrer(); }, modif);
  const copier = async () => {
    const s = d?.suivante;
    if (!s) return;
    if (!(await confirmer(`Copier vers ${s.libelle}`, `Les grilles de ${libelleAnnee} sont copiées vers ${s.libelle}, dates limites décalées d’un an. Les montants existants de ${s.libelle} sont remplacés.`, 'Copier'))) return;
    await agir(() => api.post('/finances/grille/copie', { deAnneeId: d.anneeId, versAnneeId: s.id }), 'Grille copiée.');
  };
  const saisie = (valeur: string, maj: (v: string) => void, etiquette: string, date = false) => (
    <Champ value={valeur} onChange={maj} petit droite={!date} readOnly={!modif} inputMode={date ? 'text' : 'numeric'} largeur={date ? 112 : 96} ariaLabel={etiquette} />
  );
  const TRANCHES = ['Inscription', 'Tranche 1', 'Tranche 2', 'Tranche 3'];
  return (
    <Coque module="frais">
      <Filtres
        champs={<>
          <div style={{ flex: '1 1 200px', maxWidth: 260 }}>
            <Liste<string | null> libelle="Année scolaire" value={anneeId ?? d?.anneeId ?? null}
              options={((d?.annees ?? []) as any[]).map((a) => [a.id, a.statut === 'ouverte' ? a.libelle : `${a.libelle} · en préparation`] as [string, string])}
              onChange={(v) => setAnneeId(v)} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span className="libelle">Tarif</span>
            <Bascules<string> options={[['nouveau', 'Nouveaux élèves'], ['ancien', 'Anciens élèves']]} valeur={tarif} onChange={setTarif} />
          </div>
        </>}
        actions={modif ? <>
          {d?.suivante && <Bouton onClick={copier}>Copier vers {d.suivante.libelle}</Bouton>}
          <Bouton variante="principal" touches={['Ctrl', 'S']} charge={charge} onClick={enregistrer}>Enregistrer</Bouton>
        </> : undefined}
      />
      {erreur ? <Erreur message={erreur} recharger={recharger} /> : !d ? <Chargement /> : (
        <>
          <Bandeau icone="bouclier">La grille appartient à l’année {libelleAnnee}. La modifier ne change ni les années passées ni les échéanciers déjà créés : elle vaut pour les inscriptions à venir.</Bandeau>
          <Colonnes colonnes={[
            { flex: 5, min: 640, enfants: (
              <Panneau>
                <TitrePanneau titre={`Grille ${libelleAnnee} · ${tarif === 'nouveau' ? 'nouveaux élèves' : 'anciens élèves'}`} sous="Montants en FCFA" />
                <Tableau serre
                  colonnes={[{ titre: 'Niveau' }, ...TRANCHES.map((t) => ({ titre: t, droite: true })), { titre: 'Total', droite: true }]}
                  lignes={[
                    [<span className="gras">Date limite</span>, ...dates.map((v, i) => saisie(v, (x) => setDates((ds) => ds.map((y, k) => (k === i ? x : y))), `Date limite ${i + 1}`, true)),
                      <span className="doux">–</span>],
                    ...(d.niveaux as any[]).map((n) => {
                      const v = montants[n.niveauId] ?? ['', '', '', ''];
                      const nombres = v.map((x) => versEntier(x));
                      return [
                        <span className="gras">{n.code}</span>,
                        ...v.map((x, i) => saisie(x, (val) => setMontants((m) => ({ ...m, [n.niveauId]: (m[n.niveauId] ?? ['', '', '', '']).map((y, k) => (k === i ? val : y)) })), `${n.code} · ${TRANCHES[i]}`)),
                        nombres.every((x) => x === null) ? <span className="doux">–</span> : <span className="gras">{montant(nombres.reduce<number>((s, x) => s + (x ?? 0), 0))}</span>,
                      ];
                    }),
                  ]}
                />
                {(d.niveaux as any[]).length === 0 && <Doux>Aucun niveau : créez cycles et classes dans Paramètres · Établissement.</Doux>}
              </Panneau>
            ) },
            { flex: 2, min: 280, enfants: (
              <Panneau ecart={0}>
                <TitrePanneau titre="Rubriques de frais" action={modif ? (
                  <Bouton variante="lien" icone="ajouter" onClick={async () => { if (await ouvrirFormulaire<boolean>('Ajouter une rubrique', FenetreRubrique)) await recharger(); }}>Ajouter</Bouton>
                ) : undefined} />
                {(d.rubriques as any[]).map((r) => (
                  <LigneListe key={r.id}>
                    <span className="gras">{r.libelle}</span>
                    {r.obligatoire
                      ? <Pastille ton="accent">{['Obligatoire', r.precision].filter(Boolean).join(' · ')}</Pastille>
                      : <Pastille>{r.precision ?? 'Facultatif'}</Pastille>}
                  </LigneListe>
                ))}
              </Panneau>
            ) },
          ]} />
        </>
      )}
    </Coque>
  );
}

// ===================================================================== à valider

function FenetreRefus({ fermer }: { fermer: (v?: string) => void }) {
  const [motif, setMotif] = useState('');
  return (
    <>
      <Champ libelle="Motif du refus" value={motif} onChange={setMotif} autoFocus onEnter={() => fermer(motif.trim() || '')} />
      <PiedFenetre fermer={() => fermer()} action="Refuser" onAction={() => fermer(motif.trim() || '')} />
    </>
  );
}

function CarteDemande({ pastille, ton, titre, montantDemande, demandeur, le, motif, note, onRefus, onValider, enAttente }: {
  pastille: string; ton: Ton; titre: string; montantDemande: number | null; demandeur: string; le: string; motif: string; note: string;
  onRefus?: () => void; onValider?: () => void; enAttente: boolean;
}) {
  return (
    <Panneau ecart={12}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}><Pastille ton={ton}>{pastille}</Pastille><span className="gras">{titre}</span></div>
        {montantDemande !== null && <span style={{ fontWeight: 600, fontSize: 16 }}>{fcfa(montantDemande)}</span>}
      </div>
      <Grille min={170} ecart={14}>
        <InfoCaps libelle="Demandée par" valeur={demandeur} />
        <InfoCaps libelle="Le" valeur={`${jjmmaaaa(le)} à ${heure(le)}`} />
        <InfoCaps libelle="Motif" valeur={motif || '–'} />
      </Grille>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, justifyContent: 'space-between', alignItems: 'center' }}>
        <span className="doux petit" style={{ flex: '1 1 240px' }}>{note}</span>
        {!enAttente ? (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
            <Bouton variante="danger" icone="fermer" onClick={onRefus}>Refuser</Bouton>
            <Bouton variante="principal" icone="coche" onClick={onValider}>Valider</Bouton>
          </div>
        ) : <Pastille ton="attention">En attente de décision</Pastille>}
      </div>
    </Panneau>
  );
}

function EcranValidations() {
  const moi = useMoi();
  const naviguer = useNavigate();
  const { d, erreur, recharger } = useDonnees(() => api.get('/finances/validations'));
  const decider = async (chemin: string, decision: 'validee' | 'refusee', titre: string) => {
    let motif: string | null = null;
    if (decision === 'refusee') {
      const m = await ouvrirFormulaire<string>(`Refuser · ${titre}`, FenetreRefus, 460);
      if (m === undefined) return;
      motif = m || null;
    }
    if (await agir(() => api.post(chemin, { decision, motif }), decision === 'validee' ? 'Demande validée.' : 'Demande refusée.')) await recharger();
  };
  let contenu: ReactNode;
  if (erreur) contenu = <Erreur message={erreur} recharger={recharger} />;
  else if (!d) contenu = <Chargement />;
  else {
    const peut = d.peut;
    const seuil = d.seuilReduction as number | null;
    let aDecider = 0;
    const enAttenteDeMoi = new Set<string>();
    const cartes: ReactNode[] = [];
    for (const x of d.demandes as any[]) {
      const type = `${x.type}`;
      const mienne = x.demandeurId === moi.compteId;
      const decide = peut[type] === true && (!mienne || type === 'annulation');
      if (decide) { aDecider++; enAttenteDeMoi.add(type); }
      const [pastille, ton]: [string, Ton] = type === 'reduction' ? ['Réduction', 'accent'] : type === 'annulation' ? ['Annulation', 'danger'] : ['Dérogation', 'neutre'];
      const note = type === 'reduction'
        ? (seuil === null ? 'Aucun seuil n’est fixé : toute réduction attend votre accord.' : `Au-delà du seuil de ${montant(seuil)} FCFA, la réduction attend votre accord.`)
        : type === 'annulation' ? 'Le reçu annulé reste dans la base, marqué « Annulé » ; le directeur en est notifié.'
        : `Versement minimal attendu : ${montant(x.versementMinimal ?? 0)} FCFA. Les dépassements d’effectif (${x.effectifMax ?? 40} par classe) arrivent ici aussi.`;
      cartes.push(
        <CarteDemande key={x.id} pastille={pastille} ton={ton} titre={`${x.eleve} · ${x.classe} · ${x.objet}`} montantDemande={type === 'derogation' ? null : x.montant}
          demandeur={x.demandeur} le={x.demandeLe} motif={x.motif ?? ''} note={note} enAttente={!decide}
          onRefus={() => decider(`/finances/demandes/${x.id}/decision`, 'refusee', pastille)}
          onValider={() => decider(`/finances/demandes/${x.id}/decision`, 'validee', pastille)} />,
      );
    }
    for (const s of d.sorties as any[]) {
      const decide = peut.sortie === true && s.demandeurId !== moi.compteId;
      if (decide) { aDecider++; enAttenteDeMoi.add('sortie'); }
      cartes.push(
        <CarteDemande key={s.id} pastille="Sortie de caisse" ton="attention" titre={`${s.numero} · ${s.objet}`} montantDemande={s.montant}
          demandeur={s.demandeur} le={s.demandeLe} motif={s.motif ?? ''} enAttente={!decide}
          note={`Une fois validée, l’économe décaisse et joint la pièce. Budget « ${s.categorie} » : ${s.budgetConsomme ?? 0} % consommés.`}
          onRefus={() => decider(`/caisse/sorties/${s.id}/decision`, 'refusee', 'Sortie de caisse')}
          onValider={() => decider(`/caisse/sorties/${s.id}/decision`, 'validee', 'Sortie de caisse')} />,
      );
    }
    const decideur = Object.values(peut).some((v) => v === true);
    // Genres des demandes qui attendent vraiment cette personne, dans l'ordre de la maquette.
    const genres = ([['reduction', 'réductions au-delà du seuil'], ['sortie', 'sorties de caisse'], ['derogation', 'dérogations'], ['annulation', 'annulations de reçus']] as const)
      .filter(([t]) => enAttenteDeMoi.has(t)).map(([, g]) => g);
    const bandeau = !decideur ? 'Vos demandes en attente : le directeur décide, vous suivez ici leur état.'
      : aDecider === 0 ? 'Aucune demande n’attend votre décision.'
      : `${enLettres(aDecider, true)} ${aDecider > 1 ? 'demandes attendent' : 'demande attend'} votre décision : ${genres.length > 1 ? `${genres.slice(0, -1).join(', ')} et ${genres.at(-1)}` : genres.join('')}. Vous validez ; vous ne saisissez pas à la place des autres.`;
    contenu = (
      <>
        <Bandeau icone="vieScolaire">{bandeau}</Bandeau>
        <Colonnes colonnes={[
          { flex: 3, min: 600, enfants: (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {cartes}
              {cartes.length === 0 && <Panneau><Doux>Rien à valider pour l’instant.</Doux></Panneau>}
            </div>
          ) },
          { flex: 2, min: 380, enfants: <>
            <Panneau ecart={0}>
              <TitrePanneau titre="Annulations notifiées" sous="Pour information" action={moi.a('core.audit.consulter')
                ? <Bouton variante="lien" icone="journal" onClick={() => naviguer('/parametres/audit')}>Journal</Bouton> : undefined} />
              {(d.annulations as any[]).map((a) => (
                <LigneListe key={a.id}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 1, flex: '1 1 180px' }}>
                    <span className="gras">Annulation {`${a.objet}`.replace('reçu ', '')} · {a.eleve} · {fcfa(a.montant)}</span>
                    <Doux>{jjmmaaaa(a.decideLe)} à {heure(a.decideLe)} · {`${a.motif}`.charAt(0).toLowerCase() + `${a.motif}`.slice(1)}</Doux>
                  </div>
                  <Pastille icone="coche">Validée par l’économe</Pastille>
                </LigneListe>
              ))}
              {(d.annulations as any[]).length === 0 && <LigneListe><Doux>Aucune annulation récente.</Doux></LigneListe>}
              <span className="doux petit" style={{ marginTop: 10 }}>L’économe valide les annulations, même pour un versement qu’il a encaissé. Chacune vous est notifiée et reste au journal d’audit ; le reçu annulé reste dans la base.</span>
            </Panneau>
            <Panneau>
              <TitrePanneau titre="Vos décisions récentes" />
              <Tableau
                colonnes={[{ titre: 'Demande' }, { titre: 'Décision' }]}
                vide="Aucune décision pour l’instant"
                lignes={(d.decisions as any[]).map((x) => [
                  <Cel2 gras haut={x.type === 'sortie' ? `Sortie ${x.numero} · ${montant(x.montant)}` : x.type === 'reduction' ? `Réduction ${x.eleve} · ${montant(x.montant)}` : `Dérogation ${x.eleve}`}
                    bas={`${jjmmaaaa(x.decideLe)} · ${x.decideur}`} />,
                  x.statut === 'refusee' ? <Pastille ton="danger">Refusée</Pastille> : <Pastille ton="succes">Validée</Pastille>,
                ])}
              />
            </Panneau>
          </> },
        ]} />
      </>
    );
  }
  return <Coque module="frais">{contenu}</Coque>;
}

// ===================================================================== relevé bancaire

function EcranReleve() {
  const moi = useMoi();
  const naviguer = useNavigate();
  const [mois, setMois] = useState<string | null>(null);
  const { d, erreur, recharger } = useDonnees(() => api.get(`/finances/releve${requete({ mois })}`), [mois]);
  const moisChoisi = (mois ?? d?.mois ?? moisCourant()) as string;
  const liste = [...new Set<string>([...((d?.mois_disponibles ?? []) as string[]), moisChoisi, moisCourant()])].sort((a, b) => b.localeCompare(a));
  const importer = async () => {
    const f = await choisirFichier('.csv,text/csv,text/plain');
    if (!f) return;
    const r = await agir(() => api.post<{ lignes: number }>('/finances/releve', { mois: moisChoisi, csv: f.texte }));
    if (r) { signaler(`${pluriel(r.lignes, 'ligne importée', 'lignes importées')}.`); await recharger(); }
  };
  const enregistrer = async (l: any) => {
    const e = await choisirEleve(`Versement de ${montant(l.montant)} FCFA · choisir l’élève`);
    if (e) naviguer(`/finances/encaissement/${e.inscriptionId}${requete({ releve: l.id, montant: l.montant, mode: 'virement' })}`);
  };
  const p = d?.pointage;
  const compte = [d?.banque ?? 'Banque à renseigner', d?.numeroCompte ?? 'numéro de compte à renseigner'].join(' · ');
  return (
    <Coque module="frais">
      <Filtres
        champs={<>
          <div style={{ flex: '1 1 320px' }}><Liste<string> libelle="Compte" value="c" options={[['c', compte]]} onChange={() => undefined} /></div>
          <div style={{ flex: '1 1 170px' }}><Liste<string> libelle="Mois" value={moisChoisi} options={liste.map((m) => [m, libelleMois(m)] as [string, string])} onChange={setMois} /></div>
        </>}
        actions={<>
          <Bouton icone="sortie" onClick={importer}>Importer un relevé</Bouton>
          <Bouton icone="exporter" onClick={() => telecharger(`/finances/releve/export?mois=${moisChoisi}`)}>Exporter</Bouton>
        </>}
      />
      {erreur ? <Erreur message={erreur} recharger={recharger} /> : !d ? <Chargement /> : (
        <Colonnes colonnes={[
          { flex: 3, min: 640, enfants: (
            <Panneau>
              <TitrePanneau titre={`Relevé de ${libelleMois(moisChoisi, false)}`}
                sous={d.importeLe
                  ? `${d.banque ?? ''} · ${pluriel((d.lignes as any[]).length, 'ligne importée', 'lignes importées')} le ${jjmmaaaa(d.importeLe)}`
                  : 'Aucun relevé importé pour ce mois'} />
              <Tableau
                colonnes={[{ titre: 'Ligne du relevé' }, { titre: 'Montant', droite: true }, { titre: 'Bordereau et reçu' }, { titre: 'État' }]}
                vide="Importez le relevé du mois : fichier CSV « date;libellé;montant;référence »."
                cles={(d.lignes as any[]).map((l) => l.id)}
                lignes={(d.lignes as any[]).map((l) => [
                  <div style={{ display: 'flex', flexDirection: 'column' }}><span className="doux">{jjmmaaaa(l.date)}</span><span className="doux">{l.libelle}</span></div>,
                  <span className="gras">{montant(l.montant)}</span>,
                  l.recu ? <Cel2 gras haut={`${l.recu} · ${l.eleve}${l.etat === 'ecart' ? ` · ${montant(l.montantRecu)} au reçu` : ''}`} bas={l.bordereau ?? ''} />
                    : l.depot ? <Cel2 gras haut={l.depot} bas={l.bordereau ?? ''} /> : <span className="doux">–</span>,
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
                    {l.etat === 'rapproche' ? <Pastille ton="succes">Rapproché</Pastille> : l.etat === 'ecart' ? <Pastille ton="danger">Écart</Pastille> : <Pastille ton="attention">Sans bordereau</Pastille>}
                    {l.etat === 'sans_bordereau' && moi.a('finances.versement.encaisser') && <Lien onClick={() => enregistrer(l)}>Enregistrer le versement</Lien>}
                    {l.etat === 'ecart' && l.eleveId && <Lien onClick={() => naviguer(`/scolarite/eleves/${l.eleveId}`)}>Examiner</Lien>}
                  </div>,
                ])}
              />
            </Panneau>
          ) },
          { flex: 1, min: 300, enfants: (
            <Panneau reperes>
              <TitrePanneau titre="Pointage" />
              <Grille min={140} ecart={14}>
                <InfoCaps libelle="Rapprochées" valeur={pluriel(p.rapprochees, 'ligne')} />
                <InfoCaps libelle="Sans bordereau" valeur={`${pluriel(p.sansBordereau, 'ligne')} · ${fcfa(p.montantSansBordereau)}`} />
                <InfoCaps libelle="Écart" valeur={`${pluriel(p.ecarts, 'ligne')} · ${fcfa(p.montantEcarts)}`} />
              </Grille>
              <Doux>Un versement reçu sur le compte sans que le parent ait apporté le bordereau s’enregistre ici : le reçu est émis et le versement réparti comme au guichet.</Doux>
            </Panneau>
          ) },
        ]} />
      )}
    </Coque>
  );
}

export const routes: RouteEcran[] = [
  { path: '/finances/caisse', element: <EcranCaisse /> },
  { path: '/finances/encaissement/:inscriptionId', element: <EcranEncaissement /> },
  { path: '/finances/recus/:id', element: <EcranRecu /> },
  { path: '/finances/impayes', element: <EcranImpayes /> },
  { path: '/finances/depenses', element: <EcranDepenses /> },
  { path: '/finances/comptes', element: <EcranComptes /> },
  { path: '/finances/grille', element: <EcranGrille /> },
  { path: '/finances/validations', element: <EcranValidations /> },
  { path: '/finances/releve', element: <EcranReleve /> },
];
