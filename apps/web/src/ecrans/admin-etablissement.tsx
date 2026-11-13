// Configuration de l'établissement, en assistant par rubriques (lot 1, D-40) : identité et logo, année scolaire et périodes,
// sections et classes, documents. Une rubrique s'ouvre quand les champs obligatoires des précédentes sont remplis.
import { useState, type CSSProperties, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ErreurApi, url } from '../core/api.ts';
import { Coque } from '../core/coque.tsx';
import { PanneauFormulaire } from './formulaire-inscription.tsx';
import { PanneauGabarits } from './gabarits.tsx';
import { useMoi, useSession } from '../core/session.tsx';
import { choisirFichier } from '../core/documents.ts';
import { jjmmaaaa, pluriel, versEntier, versIso } from '../core/format.ts';
import {
  agir, Bascules, Bouton, Cel2, Champ, Chargement, confirmer, Doux, Erreur, Etiquette, Grille, Icone, LigneListe, Liste, Note,
  ouvrirFormulaire, Panneau, Pastille, PiedFenetre, signaler, Tableau, TitrePanneau, useDonnees, useRaccourci, type Ton,
} from '../core/ui.tsx';

interface Identite {
  id: string; nomFr: string; nomEn: string; devise: string | null; villeBp: string | null; telephone: string | null; signataire: string | null;
  banque: string | null; numeroCompte: string | null; seuilReduction: number | null; aLogo: boolean; aCachet: boolean; aSignature: boolean; version: number;
}
interface Annee { id: string; libelle: string; dateDebut: string; dateFin: string; statut: 'preparation' | 'ouverte' | 'cloturee' }
interface Periode {
  id: string; ordre: number; libelleFr: string; libelleEn: string; dateDebut: string; dateFin: string; sequences: string | null; trancheOrdre: number | null; statut: string;
}
interface ClasseCycle { id: string; nom: string; niveauId: string; effectifMax: number; effectif: number }
type SousSysteme = 'francophone' | 'anglophone';
type Ordre = 'maternelle' | 'primaire' | 'secondaire';
interface Cycle { id: string; sousSysteme: SousSysteme; ordreEnseignement: Ordre; libelle: string; codeSection: string; classes: ClasseCycle[] }
interface Niveau { id: string; cycleId: string; code: string; libelle: string; rang: number }
interface Structure {
  identite: Identite; annees: Annee[]; anneePeriodes: string | null; periodes: Periode[]; cycles: Cycle[]; niveaux: Niveau[];
  numerotation: { document: string; format: string; prochain: string }[];
}

const STATUT_ANNEE: Record<Annee['statut'], [string, Ton]> = { cloturee: ['Clôturée', 'neutre'], ouverte: ['Ouverte', 'succes'], preparation: ['En préparation', 'accent'] };
const SOUS_SYSTEMES: [SousSysteme, string][] = [['francophone', 'Francophone'], ['anglophone', 'Anglophone']];
const ORDRES: [Ordre, string][] = [['maternelle', 'Maternelle'], ['primaire', 'Primaire'], ['secondaire', 'Secondaire']];
interface TexteModele { entete: string; mentions: string }
interface Modele { type: string; libelle: string; fr: TexteModele; en: TexteModele }
const rempli = (t: TexteModele) => !!(t.entete.trim() || t.mentions.trim());
/** Texte lu par les lecteurs d'écran sans être affiché. */
const INVISIBLE: CSSProperties = { position: 'absolute', width: 1, height: 1, margin: -1, padding: 0, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap', border: 0 };

/** En-tête et mentions d'un document, en français et en anglais, imprimés sur ses PDF. */
function FenetreModele({ modele, modifiable, fermer }: { modele: Modele; modifiable: boolean; fermer: (v?: boolean) => void }) {
  const [v, setV] = useState({ ...modele.fr, enteteEn: modele.en.entete, mentionsEn: modele.en.mentions });
  const [charge, setCharge] = useState(false);
  const champ = (cle: keyof typeof v, libelle: string, lignes: number, aide: string) => (
    <Champ libelle={libelle} value={v[cle]} onChange={(x) => setV((o) => ({ ...o, [cle]: x }))} lignes={lignes} placeholder={aide} readOnly={!modifiable} />
  );
  const valider = async () => {
    setCharge(true);
    const r = await agir(() => api.put(`/structure/modeles/${modele.type}`, {
      fr: { entete: v.entete, mentions: v.mentions }, en: { entete: v.enteteEn, mentions: v.mentionsEn } }), 'Modèle enregistré.');
    setCharge(false);
    if (r) fermer(true);
  };
  return (
    <>
      <Doux>L’en-tête s’imprime au-dessus du nom de l’établissement ; les mentions, en bas du document. Deux lignes d’en-tête au plus par langue.</Doux>
      {champ('entete', 'En-tête (français)', 2, 'RÉPUBLIQUE DU CAMEROUN · Paix – Travail – Patrie')}
      {champ('mentions', 'Mentions (français)', 3, 'Les frais versés ne sont ni remboursables ni transférables.')}
      {champ('enteteEn', 'Header (English)', 2, 'REPUBLIC OF CAMEROON · Peace – Work – Fatherland')}
      {champ('mentionsEn', 'Notes (English)', 3, 'Fees paid are neither refundable nor transferable.')}
      {modifiable ? <PiedFenetre fermer={() => fermer()} action="Enregistrer" onAction={valider} charge={charge} />
        : <div className="pied"><Bouton variante="principal" onClick={() => fermer()}>Fermer</Bouton></div>}
    </>
  );
}

function PanneauModeles({ modifiable }: { modifiable: boolean }) {
  const { d, erreur, recharger } = useDonnees<Modele[]>(() => api.get('/structure/modeles'));
  const ouvrir = async (m: Modele) => {
    if (await ouvrirFormulaire<boolean>(`Modèle · ${m.libelle}`, (p) => <FenetreModele {...p} modele={m} modifiable={modifiable} />, 560)) recharger();
  };
  return (
    <Panneau>
      <TitrePanneau titre="Modèles de documents" sous="En-têtes, mentions, signatures" />
      {erreur && <div role="alert"><Note ton="danger">{erreur}</Note></div>}
      <div>
        {(d ?? []).map((m) => (
          <LigneListe key={m.type}>
            <span className="gras" style={{ flex: '1 1 140px', minWidth: 0 }}>{m.libelle}</span>
            <Pastille ton={rempli(m.fr) ? 'accent' : undefined}>FR<span style={INVISIBLE}>{rempli(m.fr) ? ' renseigné' : ' vide'}</span></Pastille>
            <Pastille ton={rempli(m.en) ? 'accent' : undefined}>EN<span style={INVISIBLE}>{rempli(m.en) ? ' renseigné' : ' vide'}</span></Pastille>
            <Bouton onClick={() => void ouvrir(m)} title={`${modifiable ? 'Modifier' : 'Voir'} le modèle ${m.libelle}`}>{modifiable ? 'Modifier' : 'Voir'}</Bouton>
          </LigneListe>
        ))}
        {!d && !erreur && <Chargement />}
      </div>
    </Panneau>
  );
}
const IMAGES: { type: 'logo' | 'cachet' | 'signature'; libelle: string; cle: 'aLogo' | 'aCachet' | 'aSignature' }[] = [
  { type: 'logo', libelle: 'Logo', cle: 'aLogo' }, { type: 'cachet', libelle: 'Cachet', cle: 'aCachet' }, { type: 'signature', libelle: 'Signature du directeur', cle: 'aSignature' },
];
const vide = (x: string) => (x.trim() ? x.trim() : null);
const libelleCycle = (c: Cycle) => `${SOUS_SYSTEMES.find(([v]) => v === c.sousSysteme)?.[1] ?? c.sousSysteme} · ${c.libelle}`;
const erreurDe = (e: unknown) => (e instanceof ErreurApi ? e.message : String(e));

// ---------------------------------------------------------------- identité

function PanneauIdentite({ identite, modifiable, apres }: { identite: Identite; modifiable: boolean; apres: () => void }) {
  const [v, setV] = useState({
    nomFr: identite.nomFr, nomEn: identite.nomEn, devise: identite.devise ?? '', villeBp: identite.villeBp ?? '', telephone: identite.telephone ?? '',
    signataire: identite.signataire ?? '', banque: identite.banque ?? '', numeroCompte: identite.numeroCompte ?? '',
    seuil: identite.seuilReduction === null || identite.seuilReduction === undefined ? '' : String(identite.seuilReduction),
  });
  const [erreurs, setErreurs] = useState<Record<string, string>>({});
  const [charge, setCharge] = useState(false);
  const [rafraichi, setRafraichi] = useState(Date.now());
  const maj = (k: keyof typeof v) => (x: string) => setV((f) => ({ ...f, [k]: x }));
  const enregistrer = async () => {
    if (!modifiable || charge) return;
    const e: Record<string, string> = {};
    if (v.nomFr.trim().length < 2) e['nomFr'] = 'Nom requis.';
    if (v.nomEn.trim().length < 2) e['nomEn'] = 'Name required.';
    if (v.villeBp.trim().length < 2) e['villeBp'] = 'Ville requise.';
    if (v.telephone.replace(/\D/g, '').length < 8) e['telephone'] = 'Téléphone requis.';
    const seuil = v.seuil.trim() ? versEntier(v.seuil) : null;
    if (v.seuil.trim() && (seuil === null || seuil < 0)) e['seuil'] = 'Montant entier en FCFA.';
    setErreurs(e);
    if (Object.keys(e).length) return;
    setCharge(true);
    const ok = await agir(() => api.put('/structure/etablissement', {
      nomFr: v.nomFr.trim(), nomEn: v.nomEn.trim(), devise: vide(v.devise), villeBp: vide(v.villeBp), telephone: vide(v.telephone),
      signataire: vide(v.signataire), banque: vide(v.banque), numeroCompte: vide(v.numeroCompte), seuilReduction: seuil,
    }), 'Établissement enregistré');
    setCharge(false);
    if (ok) apres();
  };
  useRaccourci('ctrl+s', () => { void enregistrer(); }, modifiable);
  const deposer = async (type: 'logo' | 'cachet' | 'signature', libelle: string) => {
    const f = await choisirFichier('image/png,image/jpeg');
    if (!f) return;
    if (f.octets.length > 1_000_000) { signaler('Image trop lourde : 1 Mo au plus.', true); return; }
    if (await agir(() => api.put(`/structure/etablissement/images/${type}`, { base64: f.base64 }), `${libelle} enregistré`)) {
      setRafraichi(Date.now());
      apres();
    }
  };
  const champ = (k: keyof typeof v, libelle: string, placeholder?: string) => (
    <Champ libelle={libelle} value={v[k]} onChange={modifiable ? maj(k) : undefined} readOnly={!modifiable} placeholder={placeholder} erreur={erreurs[k]} />
  );
  return (
    <Panneau>
      <TitrePanneau titre="Identité" sous="* champ obligatoire" action={modifiable && <span className="pleine-mobile" style={{ display: 'inline-flex' }}><Bouton variante="principal" pleine touches={['Ctrl', 'S']} charge={charge} onClick={enregistrer}>Enregistrer</Bouton></span>} />
      {Object.keys(erreurs).length > 0 && <span role="alert" style={INVISIBLE}>{Object.values(erreurs).join(' ')}</span>}
      {/* Une seule colonne sur téléphone (.pile-mobile), grille souple ailleurs. */}
      <div className="grille pile-mobile" style={{ ['--min' as string]: '240px', gap: 14 }}>
        {champ('nomFr', 'Nom (français) *')}
        {champ('nomEn', 'Name (English) *')}
        {champ('villeBp', 'Ville et boîte postale *', 'Ville · BP')}
        {champ('telephone', 'Téléphone *')}
        {champ('devise', 'Devise', 'Devise de l’établissement')}
        {champ('seuil', 'Réductions sans validation jusqu’à (FCFA)')}
      </div>
      <div className="grille pile-mobile" style={{ ['--min' as string]: '180px', gap: 14 }}>
        {IMAGES.map((im) => (
          <div key={im.type} style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'stretch' }}>
            <Etiquette>{im.libelle}</Etiquette>
            <div className="signature" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none', height: 72 }}>
              {identite[im.cle]
                ? <img src={`${url(`/structure/etablissement/images/${im.type}`)}?v=${rafraichi}`} alt={im.libelle} style={{ maxHeight: 56, maxWidth: '100%', objectFit: 'contain' }} />
                : <span>Aucune image</span>}
            </div>
            {modifiable && <Bouton onClick={() => deposer(im.type, im.libelle)} title={`${identite[im.cle] ? 'Remplacer' : 'Choisir'} l’image : ${im.libelle}`}>{identite[im.cle] ? 'Remplacer' : 'Choisir une image'}</Bouton>}
          </div>
        ))}
      </div>
      <div className="grille pile-mobile" style={{ ['--min' as string]: '200px', gap: 14 }}>
        {champ('signataire', 'Signataire des documents')}
        {champ('banque', 'Banque')}
        {champ('numeroCompte', 'Numéro de compte')}
      </div>
      <Doux>Les coordonnées bancaires figurent sur les avis de paiement. Images PNG ou JPEG, 1 Mo au plus.</Doux>
    </Panneau>
  );
}

// ---------------------------------------------------------------- fenêtres

function FenetreAnnee({ fermer, derniere }: { fermer: (ok?: boolean) => void; derniere: Annee | undefined }) {
  const debutSuivant = (iso: string | undefined, plus: number) => (iso ? `${jjmmaaaa(iso).slice(0, 6)}${Number(iso.slice(0, 4)) + plus}` : '');
  const an = derniere ? Number(derniere.dateDebut.slice(0, 4)) + 1 : new Date().getFullYear();
  const [libelle, setLibelle] = useState(`${an}/${an + 1}`);
  const [du, setDu] = useState(debutSuivant(derniere?.dateDebut, 1));
  const [au, setAu] = useState(debutSuivant(derniere?.dateFin, 1));
  const [erreur, setErreur] = useState<string | null>(null);
  const [charge, setCharge] = useState(false);
  const valider = async () => {
    const d = versIso(du), f = versIso(au);
    if (!/^\d{4}\/\d{4}$/.test(libelle.trim())) return setErreur('Libellé au format AAAA/AAAA.');
    if (!d || !f) return setErreur('Dates au format JJ/MM/AAAA.');
    if (f <= d) return setErreur('La fin doit suivre le début.');
    setCharge(true);
    try {
      await api.post('/structure/annees', { libelle: libelle.trim(), dateDebut: d, dateFin: f, ouvrir: false });
      fermer(true);
    } catch (e) { setErreur(erreurDe(e)); setCharge(false); }
  };
  return (
    <>
      <p>{derniere ? 'L’année est créée en préparation, avec trois trimestres modifiables. Elle s’ouvre à la clôture de l’année en cours.'
        : 'L’année est créée avec trois trimestres modifiables. Ouvrez-la ensuite : inscriptions, caisse et notes s’y rattachent.'}</p>
      <Grille min={140} ecart={12}>
        <Champ libelle="Année scolaire" value={libelle} onChange={setLibelle} autoFocus />
        <Champ libelle="Du" placeholder="JJ/MM/AAAA" value={du} onChange={setDu} />
        <Champ libelle="Au" placeholder="JJ/MM/AAAA" value={au} onChange={setAu} />
      </Grille>
      {erreur && <div role="alert"><Note ton="danger">{erreur}</Note></div>}
      <PiedFenetre fermer={() => fermer()} action="Créer l’année" onAction={valider} charge={charge} />
    </>
  );
}

interface SaisiePeriode { id: string; libelleFr: string; libelleEn: string; du: string; au: string; sequences: string; tranche: number | null }

function FenetrePeriodes({ fermer, periodes }: { fermer: (ok?: boolean) => void; periodes: Periode[] }) {
  const initiales: SaisiePeriode[] = periodes.map((p) => ({
    id: p.id, libelleFr: p.libelleFr, libelleEn: p.libelleEn, du: jjmmaaaa(p.dateDebut), au: jjmmaaaa(p.dateFin), sequences: p.sequences ?? '', tranche: p.trancheOrdre,
  }));
  const [lignes, setLignes] = useState(initiales);
  const [erreur, setErreur] = useState<string | null>(null);
  const [charge, setCharge] = useState(false);
  const maj = (i: number, k: keyof SaisiePeriode, x: string | number | null) => setLignes((l) => l.map((p, j) => (j === i ? { ...p, [k]: x } : p)));
  const tranches: [number | null, string][] = [[null, 'Aucune'], ...[1, 2, 3, 4, 5, 6].map((n): [number, string] => [n, `Tranche ${n}`])];
  const valider = async () => {
    for (const p of lignes) {
      const d = versIso(p.du), f = versIso(p.au);
      if (p.libelleFr.trim().length < 2 || p.libelleEn.trim().length < 2) return setErreur('Chaque période a un nom en français et en anglais.');
      if (!d || !f) return setErreur(`${p.libelleFr} : dates au format JJ/MM/AAAA.`);
      if (f <= d) return setErreur(`${p.libelleFr} : la fin doit suivre le début.`);
    }
    setCharge(true);
    try {
      for (const [i, p] of lignes.entries()) {
        const a = initiales[i]!;
        if (JSON.stringify(a) === JSON.stringify(p)) continue;
        await api.put(`/structure/periodes/${p.id}`, {
          libelleFr: p.libelleFr.trim(), libelleEn: p.libelleEn.trim(), dateDebut: versIso(p.du), dateFin: versIso(p.au),
          sequences: vide(p.sequences), trancheOrdre: p.tranche,
        });
      }
      fermer(true);
    } catch (e) { setErreur(erreurDe(e)); setCharge(false); }
  };
  return (
    <>
      {lignes.map((p, i) => (
        <div key={p.id} style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingBottom: 12, borderBottom: '1px solid var(--bord)' }}>
          <Grille min={180} ecart={10}>
            <Champ libelle="Période" value={p.libelleFr} onChange={(x) => maj(i, 'libelleFr', x)} />
            <Champ libelle="Term (English)" value={p.libelleEn} onChange={(x) => maj(i, 'libelleEn', x)} />
          </Grille>
          <Grille min={110} ecart={10}>
            <Champ libelle="Du" placeholder="JJ/MM/AAAA" value={p.du} onChange={(x) => maj(i, 'du', x)} />
            <Champ libelle="Au" placeholder="JJ/MM/AAAA" value={p.au} onChange={(x) => maj(i, 'au', x)} />
            <Champ libelle="Séquences" value={p.sequences} onChange={(x) => maj(i, 'sequences', x)} />
            <Liste libelle="Tranche de frais" value={p.tranche} options={tranches} onChange={(x) => maj(i, 'tranche', x)} />
          </Grille>
        </div>
      ))}
      {erreur && <div role="alert"><Note ton="danger">{erreur}</Note></div>}
      <PiedFenetre fermer={() => fermer()} action="Enregistrer les périodes" onAction={valider} charge={charge} />
    </>
  );
}

function FenetreCycle({ fermer, existants }: { fermer: (ok?: boolean) => void; existants: Cycle[] }) {
  const [ss, setSs] = useState<SousSysteme>('francophone');
  const [ordre, setOrdre] = useState<Ordre>('maternelle');
  const [erreur, setErreur] = useState<string | null>(null);
  const [charge, setCharge] = useState(false);
  const deja = existants.some((c) => c.sousSysteme === ss && c.ordreEnseignement === ordre);
  const valider = async () => {
    if (deja) return;
    setCharge(true);
    try {
      await api.post('/structure/cycles', { sousSysteme: ss, ordreEnseignement: ordre });
      fermer(true);
    } catch (e) { setErreur(erreurDe(e)); setCharge(false); }
  };
  return (
    <>
      <div className="champ-groupe"><span className="libelle">Sous-système</span><Bascules options={SOUS_SYSTEMES} valeur={ss} onChange={setSs} /></div>
      <div className="champ-groupe"><span className="libelle">Ordre d’enseignement</span><Bascules options={ORDRES} valeur={ordre} onChange={setOrdre} /></div>
      {deja ? <Note ton="attention">Ce cycle existe déjà.</Note> : <Doux>Les niveaux du cycle sont créés avec lui ; les classes s’ajoutent ensuite, niveau par niveau.</Doux>}
      {erreur && <div role="alert"><Note ton="danger">{erreur}</Note></div>}
      <PiedFenetre fermer={() => fermer()} action="Ajouter le cycle" onAction={valider} charge={charge} disabled={deja} />
    </>
  );
}

/** Nom que l'application attribuera (même règle que le serveur) : « CM2 », puis « CM2 A » et « CM2 B », et ainsi de suite. */
function nomAttribue(n: Niveau, existants: string[]): { nom: string; renomme: string | null } {
  if (existants.length === 0) return { nom: n.code, renomme: null };
  const seule = existants.length === 1 && existants[0] === n.code;
  const pris = new Set(seule ? [`${n.code} A`] : existants);
  const lettre = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').find((l) => !pris.has(`${n.code} ${l}`)) ?? String(existants.length + 1);
  return { nom: `${n.code} ${lettre}`, renomme: seule ? `${n.code} A` : null };
}

function FenetreClasse({ fermer, s }: { fermer: (ok?: boolean) => void; s: Structure }) {
  const annees = s.annees.filter((a) => a.statut !== 'cloturee');
  const [anneeId, setAnneeId] = useState<string | null>(annees.find((a) => a.statut === 'ouverte')?.id ?? annees[0]?.id ?? null);
  const [section, setSection] = useState<SousSysteme>('francophone');
  const niveauxSection = s.cycles.filter((c) => c.sousSysteme === section)
    .flatMap((c) => s.niveaux.filter((n) => n.cycleId === c.id).sort((a, b) => a.rang - b.rang));
  const [niveauId, setNiveauId] = useState<string | null>(niveauxSection[0]?.id ?? null);
  const [effectif, setEffectif] = useState('40');
  const [erreur, setErreur] = useState<string | null>(null);
  const [charge, setCharge] = useState(false);
  const niveau = s.niveaux.find((n) => n.id === niveauId);
  // Les classes connues ici sont celles de l'année affichée à l'écran.
  const existants = anneeId === s.anneePeriodes ? s.cycles.flatMap((c) => c.classes).filter((k) => k.niveauId === niveauId).map((k) => k.nom) : null;
  const apercu = niveau && existants ? nomAttribue(niveau, existants) : null;
  const valider = async () => {
    const max = versEntier(effectif);
    if (!niveauId || !anneeId) return setErreur('Choisissez l’année et le niveau.');
    if (max === null || max < 1 || max > 200) return setErreur('Effectif maximal entre 1 et 200.');
    setCharge(true);
    try {
      await api.post('/structure/classes', { niveauId, effectifMax: max, anneeId });
      fermer(true);
    } catch (e) { setErreur(erreurDe(e)); setCharge(false); }
  };
  if (!s.niveaux.length) {
    return <><Note ton="attention">Aucune section n’est installée : ajoutez d’abord un cycle.</Note><div className="pied"><Bouton onClick={() => fermer()}>Fermer</Bouton></div></>;
  }
  return (
    <>
      <Liste libelle="Année scolaire" value={anneeId} options={annees.map((a): [string, string] => [a.id, `${a.libelle} · ${STATUT_ANNEE[a.statut][0].toLowerCase()}`])} onChange={setAnneeId} />
      <div className="champ-groupe"><span className="libelle">Section</span>
        <Bascules options={SOUS_SYSTEMES} valeur={section} onChange={(x) => {
          setSection(x);
          const premier = s.cycles.filter((c) => c.sousSysteme === x).flatMap((c) => s.niveaux.filter((n) => n.cycleId === c.id).sort((a, b) => a.rang - b.rang))[0];
          setNiveauId(premier?.id ?? null);
        }} />
      </div>
      <Liste libelle="Niveau" value={niveauId} options={niveauxSection.map((n): [string, string] => [n.id, n.code === n.libelle ? n.code : `${n.code} · ${n.libelle}`])} onChange={setNiveauId} />
      <Champ libelle="Effectif maximal" inputMode="numeric" value={effectif} onChange={setEffectif} droite />
      {apercu && <Note ton="accent">La nouvelle classe s’appellera <b>{apercu.nom}</b>{apercu.renomme ? <> ; la classe {niveau!.code} devient <b>{apercu.renomme}</b></> : ''}.</Note>}
      {erreur && <div role="alert"><Note ton="danger">{erreur}</Note></div>}
      <PiedFenetre fermer={() => fermer()} action="Ajouter la classe" onAction={valider} charge={charge} />
    </>
  );
}

function FenetreModifierClasse({ fermer, classe }: { fermer: (ok?: boolean) => void; classe: ClasseCycle }) {
  const [effectif, setEffectif] = useState(String(classe.effectifMax));
  const [erreur, setErreur] = useState<string | null>(null);
  const [charge, setCharge] = useState(false);
  const valider = async () => {
    const max = versEntier(effectif);
    if (max === null || max < 1 || max > 200) return setErreur('Effectif maximal entre 1 et 200.');
    setCharge(true);
    try {
      await api.patch(`/structure/classes/${classe.id}`, { effectifMax: max });
      fermer(true);
    } catch (e) { setErreur(erreurDe(e)); setCharge(false); }
  };
  return (
    <>
      <Doux>{pluriel(classe.effectif, 'élève inscrit', 'élèves inscrits')} cette année.</Doux>
      <Champ libelle="Effectif maximal" inputMode="numeric" value={effectif} onChange={setEffectif} droite autoFocus />
      {erreur && <div role="alert"><Note ton="danger">{erreur}</Note></div>}
      <PiedFenetre fermer={() => fermer()} action="Enregistrer" onAction={valider} charge={charge} />
    </>
  );
}

// ---------------------------------------------------------------- écran

export function EcranEtablissement() {
  const moi = useMoi();
  const { charger } = useSession();
  const naviguer = useNavigate();
  const st = useDonnees(() => api.get<Structure>('/structure/etablissement'));
  const [etape, setEtape] = useState<number | null>(null);
  const recharger = () => { void st.recharger(); };
  const s = st.d;
  const contenu = (() => {
    if (st.erreur && !s) return <Erreur message={st.erreur} recharger={st.recharger} />;
    if (!s) return <Chargement />;
    const gererAnnees = moi.a('structure.annee.gerer');
    const gererClasses = moi.a('structure.classe.gerer');
    const anneePeriodes = s.annees.find((a) => a.id === s.anneePeriodes);
    const ouverte = s.annees.find((a) => a.statut === 'ouverte');
    const ouvrir = async (a: Annee) => {
      if (!(await confirmer(`Ouvrir ${a.libelle}`, `L’année ${a.libelle} devient l’année en cours : inscriptions, caisse et notes s’y rattachent.`, 'Ouvrir l’année'))) return;
      if (await agir(() => api.post(`/structure/annees/${a.id}/ouverture`), `Année ${a.libelle} ouverte`)) { recharger(); void charger(); }
    };
    const preparer = async () => {
      const titre = s.annees.length ? 'Préparer l’année suivante' : 'Créer l’année scolaire';
      if (await ouvrirFormulaire<boolean>(titre, ({ fermer }) => <FenetreAnnee fermer={fermer} derniere={s.annees[s.annees.length - 1]} />, 520)) recharger();
    };
    const modifierPeriodes = async () => {
      if (await ouvrirFormulaire<boolean>(`Périodes d'évaluation · ${anneePeriodes?.libelle ?? ''}`, ({ fermer }) => <FenetrePeriodes fermer={fermer} periodes={s.periodes} />, 640)) {
        signaler('Périodes enregistrées');
        recharger();
      }
    };
    const ajouterCycle = async () => {
      if (await ouvrirFormulaire<boolean>('Ajouter un cycle', ({ fermer }) => <FenetreCycle fermer={fermer} existants={s.cycles} />, 520)) { signaler('Cycle ajouté'); recharger(); }
    };
    const ajouterClasse = async () => {
      if (await ouvrirFormulaire<boolean>('Ajouter une classe', ({ fermer }) => <FenetreClasse fermer={fermer} s={s} />, 520)) { signaler('Classe ajoutée'); recharger(); }
    };
    const modifierClasse = async (k: ClasseCycle) => {
      if (await ouvrirFormulaire<boolean>(`Modifier · ${k.nom}`, ({ fermer }) => <FenetreModifierClasse fermer={fermer} classe={k} />, 460)) { signaler('Classe enregistrée'); recharger(); }
    };
    // Rubriques de l'assistant : une rubrique est terminée quand ses champs obligatoires sont enregistrés.
    const id = s.identite;
    const rubriques: { titre: string; sous: string; faite: boolean; contenu: ReactNode }[] = [
      { titre: 'Identité', sous: 'Nom, ville, téléphone, logo', faite: !!(id.nomFr && id.nomEn && id.villeBp && (id.telephone ?? '').replace(/\D/g, '').length >= 8),
        contenu: <PanneauIdentite key={s.identite.version} identite={s.identite} modifiable={moi.a('structure.etablissement.modifier')} apres={recharger} /> },
      { titre: 'Année scolaire', sous: 'Dates et périodes d’évaluation', faite: s.annees.some((a) => a.statut !== 'cloturee') && s.periodes.length > 0,
        contenu: <><Panneau>
            <TitrePanneau titre="Années scolaires" action={moi.a('structure.annee.cloturer') && <Bouton variante="lien" onClick={() => naviguer('/parametres/cloture')}>Clôture d'année</Bouton>} />
            <div>
              {s.annees.map((a) => (
                <LigneListe key={a.id}>
                  <div style={{ flex: '1 1 200px', display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                    <span className="gras">{a.libelle}</span>
                    <Doux>Du {jjmmaaaa(a.dateDebut)} au {jjmmaaaa(a.dateFin)}{a.statut === 'preparation' ? ' · grille des frais et classes à préparer' : ''}</Doux>
                  </div>
                  {a.statut === 'preparation' && gererAnnees && !ouverte && <Bouton onClick={() => ouvrir(a)} title={`Ouvrir l’année ${a.libelle}`}>Ouvrir</Bouton>}
                  <Pastille ton={STATUT_ANNEE[a.statut][1]}>{STATUT_ANNEE[a.statut][0]}</Pastille>
                </LigneListe>
              ))}
              {s.annees.length === 0 && <Doux>Aucune année scolaire pour l’instant.</Doux>}
            </div>
            {gererAnnees && !s.annees.some((a) => a.statut === 'preparation') && <div><Bouton icone="ajouter" onClick={preparer}>{s.annees.length ? 'Préparer l’année suivante' : 'Créer l’année scolaire'}</Bouton></div>}
          </Panneau>
          <Panneau>
            <TitrePanneau titre={`Périodes d'évaluation${anneePeriodes ? ` · ${anneePeriodes.libelle}` : ''}`}
              action={moi.a('structure.periode.modifier') && s.periodes.length > 0 && <Bouton onClick={modifierPeriodes} title="Modifier les périodes d’évaluation">Modifier</Bouton>} />
            <Tableau
              colonnes={[{ titre: 'Période', mobile: 'entete' }, { titre: 'Du' }, { titre: 'Au' }, { titre: 'Séquences' }]}
              cles={s.periodes.map((p) => p.id)}
              vide="Aucune période : elles sont créées avec l’année scolaire."
              lignes={s.periodes.map((p) => [<Cel2 gras haut={p.libelleFr} bas={p.libelleEn} />, jjmmaaaa(p.dateDebut), jjmmaaaa(p.dateFin), p.sequences || '–'])}
            />
          </Panneau></> },
      { titre: 'Sections et classes', sous: 'Classes et effectifs', faite: s.cycles.some((c) => c.classes.length > 0),
        contenu: <Panneau>
            <TitrePanneau titre="Cycles, niveaux et classes" sous={anneePeriodes ? `Classes de ${anneePeriodes.libelle}` : undefined} />
            {s.cycles.map((c) => (
              <div key={c.id} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: '4px 12px' }}>
                  <span className="gras">{libelleCycle(c)}</span>
                  <Doux>{pluriel(c.classes.length, 'classe')} · {pluriel(c.classes.reduce((t, k) => t + k.effectif, 0), 'élève')}</Doux>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: gererClasses ? '0 6px' : 6, alignItems: 'center' }}>
                  {c.classes.map((k) => (gererClasses
                    /* La zone tactile fait 40 px de haut ; la pastille visible garde ses 22 px, comme sur la maquette. */
                    ? <button key={k.id} type="button" style={{ border: 0, background: 'none', padding: '9px 0', margin: 0, cursor: 'pointer', font: 'inherit', minHeight: 40, minWidth: 40, display: 'inline-flex', alignItems: 'center' }}
                        aria-label={`Modifier la classe ${k.nom} : ${k.effectif} élèves pour ${k.effectifMax} places`} title={`${k.nom} · ${k.effectif} élèves pour ${k.effectifMax} places`} onClick={() => modifierClasse(k)}>
                        <span className="pastille" style={{ pointerEvents: 'none' }}>{k.nom}</span>
                      </button>
                    : <Pastille key={k.id}>{k.nom}</Pastille>))}
                  {c.classes.length === 0 && <Doux>Aucune classe</Doux>}
                </div>
              </div>
            ))}
            {s.cycles.length === 0 && <Doux>Aucun cycle pour l’instant.</Doux>}
            {gererClasses && (
              <div className="rangee pile-mobile">
                <Bouton icone="ajouter" onClick={ajouterCycle}>Ajouter un cycle</Bouton>
                <Bouton icone="ajouter" onClick={ajouterClasse}>Ajouter une classe</Bouton>
              </div>
            )}
            <Doux>Cycles disponibles : maternelle, primaire et secondaire, dans les deux sous-systèmes.</Doux>
          </Panneau> },
      { titre: 'Formulaire d’inscription', sous: 'Questions posées à l’inscription', faite: true,
        contenu: <PanneauFormulaire modifiable={moi.a('core.modele.modifier')} /> },
      { titre: 'Documents', sous: 'Modèles d’impression, numérotation, en-têtes et mentions', faite: true,
        contenu: <><PanneauGabarits modifiable={moi.a('core.modele.modifier')} />
          <Panneau>
            <TitrePanneau titre="Numérotation" />
            <Tableau
              colonnes={[{ titre: 'Document et format', mobile: 'entete' }, { titre: 'Prochain numéro', droite: true }]}
              lignes={s.numerotation.map((n) => [<Cel2 gras haut={n.document} bas={n.format} />, <span className="gras">{n.prochain}</span>])}
            />
            <Doux>Numéros attribués sans trou ni doublon, même si deux postes enregistrent en même temps.</Doux>
          </Panneau>
          <PanneauModeles modifiable={moi.a('core.modele.modifier')} /></> },
    ];
    const accessible = (k: number) => rubriques.slice(0, k).every((x) => x.faite);
    const premiere = rubriques.findIndex((r) => !r.faite);
    const i = Math.min(etape ?? (premiere < 0 ? 0 : premiere), rubriques.length - 1);
    const r = rubriques[i]!;
    return (
      <>
        <nav className="etapes" aria-label="Rubriques de la configuration">
          {rubriques.map((x, k) => (
            <button key={x.titre} type="button" className={`etape${k === i ? ' actif' : ''}${x.faite ? ' fait' : ''}`} disabled={!accessible(k)}
              aria-current={k === i ? 'step' : undefined} onClick={() => setEtape(k)}>
              <span className="etape-numero" aria-hidden="true">{x.faite && k !== i ? <Icone nom="coche" taille={16} /> : k + 1}</span>
              <span className="etape-texte"><span className="gras">{x.titre}</span>
                <span className="doux petit">{x.faite ? 'Terminée' : accessible(k) ? 'À compléter' : 'Après la rubrique précédente'}</span></span>
            </button>
          ))}
        </nav>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>{r.contenu}</div>
        <div className="etapes-pied">
          {i > 0 && <Bouton onClick={() => setEtape(i - 1)}>Rubrique précédente</Bouton>}
          <span className="doux petit" style={{ flex: 1, textAlign: 'right' }}>{r.faite ? '' : 'Remplissez et enregistrez les champs obligatoires pour passer à la suite.'}</span>
          {i < rubriques.length - 1 && <Bouton variante="principal" disabled={!r.faite} onClick={() => { setEtape(i + 1); window.scrollTo({ top: 0 }); }}>Rubrique suivante · {rubriques[i + 1]!.titre}</Bouton>}
        </div>
      </>
    );
  })();
  return <Coque module="parametres">{contenu}</Coque>;
}
