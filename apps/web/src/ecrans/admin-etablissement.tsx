// Maquette Etablissement : identité et coordonnées, logo, cachet et signature, années scolaires, périodes d'évaluation,
// cycles, niveaux et classes, numérotation des documents, modèles de documents.
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ErreurApi, url } from '../core/api.ts';
import { Coque } from '../core/coque.tsx';
import { useMoi } from '../core/session.tsx';
import { choisirFichier } from '../core/documents.ts';
import { jjmmaaaa, pluriel, versEntier, versIso } from '../core/format.ts';
import {
  agir, Bascules, Bouton, Cel2, Champ, Chargement, Colonnes, confirmer, Doux, Erreur, Etiquette, Grille, LigneListe, Liste, Note,
  ouvrirFormulaire, Panneau, Pastille, PiedFenetre, Rangee, signaler, Tableau, TitrePanneau, useDonnees, useRaccourci, type Ton,
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
      {erreur && <Note ton="danger">{erreur}</Note>}
      <div>
        {(d ?? []).map((m) => (
          <LigneListe key={m.type}>
            <span className="gras" style={{ flex: 1 }}>{m.libelle}</span>
            <Pastille ton={rempli(m.fr) ? 'accent' : undefined}>FR</Pastille><Pastille ton={rempli(m.en) ? 'accent' : undefined}>EN</Pastille>
            <Bouton petit onClick={() => void ouvrir(m)}>{modifiable ? 'Modifier' : 'Voir'}</Bouton>
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
      <TitrePanneau titre="Identité" action={modifiable && <Bouton variante="principal" touches={['Ctrl', 'S']} charge={charge} onClick={enregistrer}>Enregistrer</Bouton>} />
      <Grille min={240} ecart={14}>
        {champ('nomFr', 'Nom (français)')}
        {champ('nomEn', 'Name (English)')}
        {champ('devise', 'Devise', 'Devise de l’établissement')}
        {champ('villeBp', 'Ville et boîte postale', 'Ville · BP')}
        {champ('telephone', 'Téléphone')}
        {champ('seuil', 'Réductions sans validation jusqu’à (FCFA)')}
      </Grille>
      <Grille min={180} ecart={14}>
        {IMAGES.map((im) => (
          <div key={im.type} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <Etiquette>{im.libelle}</Etiquette>
            <div className="signature" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none', height: 72 }}>
              {identite[im.cle]
                ? <img src={`${url(`/structure/etablissement/images/${im.type}`)}?v=${rafraichi}`} alt={im.libelle} style={{ maxHeight: 56, maxWidth: '100%', objectFit: 'contain' }} />
                : <span>Aucune image</span>}
            </div>
            {modifiable && <Bouton petit onClick={() => deposer(im.type, im.libelle)}>{identite[im.cle] ? 'Remplacer' : 'Choisir une image'}</Bouton>}
          </div>
        ))}
      </Grille>
      <Grille min={200} ecart={14}>
        {champ('signataire', 'Signataire des documents')}
        {champ('banque', 'Banque')}
        {champ('numeroCompte', 'Numéro de compte')}
      </Grille>
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
      <p>L’année est créée en préparation, avec trois trimestres modifiables. Elle s’ouvre à la clôture de l’année en cours.</p>
      <Grille min={140} ecart={12}>
        <Champ libelle="Année scolaire" value={libelle} onChange={setLibelle} autoFocus />
        <Champ libelle="Du" placeholder="JJ/MM/AAAA" value={du} onChange={setDu} />
        <Champ libelle="Au" placeholder="JJ/MM/AAAA" value={au} onChange={setAu} />
      </Grille>
      {erreur && <Note ton="danger">{erreur}</Note>}
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
      {erreur && <Note ton="danger">{erreur}</Note>}
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
      {erreur && <Note ton="danger">{erreur}</Note>}
      <PiedFenetre fermer={() => fermer()} action="Ajouter le cycle" onAction={valider} charge={charge} disabled={deja} />
    </>
  );
}

function FenetreClasse({ fermer, s }: { fermer: (ok?: boolean) => void; s: Structure }) {
  const annees = s.annees.filter((a) => a.statut !== 'cloturee');
  const optionsNiveaux: [string, string][] = s.cycles.flatMap((c) => s.niveaux.filter((n) => n.cycleId === c.id).sort((a, b) => a.rang - b.rang)
    .map((n): [string, string] => [n.id, `${libelleCycle(c)} · ${n.libelle}`]));
  const [anneeId, setAnneeId] = useState<string | null>(annees.find((a) => a.statut === 'ouverte')?.id ?? annees[0]?.id ?? null);
  const [niveauId, setNiveauId] = useState<string | null>(optionsNiveaux[0]?.[0] ?? null);
  // Les classes connues ici sont celles de l'année affichée ; pour une autre année, la première lettre est proposée.
  const nomPropose = (id: string | null, annee: string | null) => {
    const n = s.niveaux.find((x) => x.id === id);
    if (!n) return '';
    const prises = new Set(annee === s.anneePeriodes ? s.cycles.flatMap((c) => c.classes).map((k) => k.nom) : []);
    const lettre = 'ABCDEFGHIJ'.split('').find((l) => !prises.has(`${n.code} ${l}`)) ?? 'A';
    return /^(Class|Form|Nursery)\b/.test(n.code) ? n.code : `${n.code} ${lettre}`;
  };
  const [nom, setNom] = useState(nomPropose(niveauId, anneeId));
  const [effectif, setEffectif] = useState('40');
  const [erreur, setErreur] = useState<string | null>(null);
  const [charge, setCharge] = useState(false);
  const valider = async () => {
    const max = versEntier(effectif);
    if (!niveauId || !anneeId) return setErreur('Choisissez l’année et le niveau.');
    if (!nom.trim()) return setErreur('Nom de la classe requis.');
    if (max === null || max < 1 || max > 200) return setErreur('Effectif maximal entre 1 et 200.');
    setCharge(true);
    try {
      await api.post('/structure/classes', { niveauId, nom: nom.trim(), effectifMax: max, anneeId });
      fermer(true);
    } catch (e) { setErreur(erreurDe(e)); setCharge(false); }
  };
  if (!optionsNiveaux.length) {
    return <><Note ton="attention">Ajoutez d’abord un cycle : ses niveaux permettent de créer les classes.</Note><div className="pied"><Bouton onClick={() => fermer()}>Fermer</Bouton></div></>;
  }
  return (
    <>
      <Liste libelle="Année scolaire" value={anneeId} options={annees.map((a): [string, string] => [a.id, `${a.libelle} · ${STATUT_ANNEE[a.statut][0].toLowerCase()}`])}
        onChange={(x) => { setAnneeId(x); setNom(nomPropose(niveauId, x)); }} />
      <Liste libelle="Niveau" value={niveauId} options={optionsNiveaux} onChange={(x) => { setNiveauId(x); setNom(nomPropose(x, anneeId)); }} />
      <Grille min={160} ecart={12}>
        <Champ libelle="Nom de la classe" value={nom} onChange={setNom} />
        <Champ libelle="Effectif maximal" inputMode="numeric" value={effectif} onChange={setEffectif} droite />
      </Grille>
      {erreur && <Note ton="danger">{erreur}</Note>}
      <PiedFenetre fermer={() => fermer()} action="Ajouter la classe" onAction={valider} charge={charge} />
    </>
  );
}

function FenetreModifierClasse({ fermer, classe }: { fermer: (ok?: boolean) => void; classe: ClasseCycle }) {
  const [nom, setNom] = useState(classe.nom);
  const [effectif, setEffectif] = useState(String(classe.effectifMax));
  const [erreur, setErreur] = useState<string | null>(null);
  const [charge, setCharge] = useState(false);
  const valider = async () => {
    const max = versEntier(effectif);
    if (!nom.trim()) return setErreur('Nom de la classe requis.');
    if (max === null || max < 1 || max > 200) return setErreur('Effectif maximal entre 1 et 200.');
    setCharge(true);
    try {
      await api.patch(`/structure/classes/${classe.id}`, { nom: nom.trim(), effectifMax: max });
      fermer(true);
    } catch (e) { setErreur(erreurDe(e)); setCharge(false); }
  };
  return (
    <>
      <Doux>{pluriel(classe.effectif, 'élève inscrit', 'élèves inscrits')} cette année.</Doux>
      <Grille min={160} ecart={12}>
        <Champ libelle="Nom de la classe" value={nom} onChange={setNom} autoFocus />
        <Champ libelle="Effectif maximal" inputMode="numeric" value={effectif} onChange={setEffectif} droite />
      </Grille>
      {erreur && <Note ton="danger">{erreur}</Note>}
      <PiedFenetre fermer={() => fermer()} action="Enregistrer" onAction={valider} charge={charge} />
    </>
  );
}

// ---------------------------------------------------------------- écran

export function EcranEtablissement() {
  const moi = useMoi();
  const naviguer = useNavigate();
  const st = useDonnees(() => api.get<Structure>('/structure/etablissement'));
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
      if (await agir(() => api.post(`/structure/annees/${a.id}/ouverture`), `Année ${a.libelle} ouverte`)) recharger();
    };
    const preparer = async () => {
      if (await ouvrirFormulaire<boolean>('Préparer l’année suivante', ({ fermer }) => <FenetreAnnee fermer={fermer} derniere={s.annees[s.annees.length - 1]} />, 520)) recharger();
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
    return (
      <Colonnes colonnes={[
        { flex: 3, min: 600, enfants: <>
          <PanneauIdentite key={s.identite.version} identite={s.identite} modifiable={moi.a('structure.etablissement.modifier')} apres={recharger} />
          <Panneau>
            <TitrePanneau titre="Années scolaires" action={moi.a('structure.annee.cloturer') && <Bouton variante="lien" onClick={() => naviguer('/parametres/cloture')}>Clôture d'année</Bouton>} />
            <div>
              {s.annees.map((a) => (
                <LigneListe key={a.id}>
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 160 }}>
                    <span className="gras">{a.libelle}</span>
                    <Doux>Du {jjmmaaaa(a.dateDebut)} au {jjmmaaaa(a.dateFin)}{a.statut === 'preparation' ? ' · grille des frais et classes à préparer' : ''}</Doux>
                  </div>
                  {a.statut === 'preparation' && gererAnnees && !ouverte && <Bouton petit onClick={() => ouvrir(a)}>Ouvrir</Bouton>}
                  <Pastille ton={STATUT_ANNEE[a.statut][1]}>{STATUT_ANNEE[a.statut][0]}</Pastille>
                </LigneListe>
              ))}
              {s.annees.length === 0 && <Doux>Aucune année scolaire pour l’instant.</Doux>}
            </div>
            {gererAnnees && !s.annees.some((a) => a.statut === 'preparation') && <div><Bouton icone="ajouter" onClick={preparer}>Préparer l’année suivante</Bouton></div>}
          </Panneau>
          <Panneau>
            <TitrePanneau titre={`Périodes d'évaluation${anneePeriodes ? ` · ${anneePeriodes.libelle}` : ''}`}
              action={moi.a('structure.periode.modifier') && s.periodes.length > 0 && <Bouton petit onClick={modifierPeriodes}>Modifier</Bouton>} />
            <Tableau
              colonnes={[{ titre: 'Période' }, { titre: 'Du' }, { titre: 'Au' }, { titre: 'Séquences' }]}
              cles={s.periodes.map((p) => p.id)}
              vide="Aucune période : elles sont créées avec l’année scolaire."
              lignes={s.periodes.map((p) => [`${p.libelleFr} · ${p.libelleEn}`, jjmmaaaa(p.dateDebut), jjmmaaaa(p.dateFin), p.sequences || '–'])}
            />
          </Panneau>
        </> },
        { flex: 2, min: 380, enfants: <>
          <Panneau>
            <TitrePanneau titre="Cycles, niveaux et classes" sous={anneePeriodes ? `Classes de ${anneePeriodes.libelle}` : undefined} />
            {s.cycles.map((c) => (
              <div key={c.id} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: '4px 12px' }}>
                  <span className="gras">{libelleCycle(c)}</span>
                  <Doux>{pluriel(c.classes.length, 'classe')} · {pluriel(c.classes.reduce((t, k) => t + k.effectif, 0), 'élève')}</Doux>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {c.classes.map((k) => (gererClasses
                    ? <button key={k.id} type="button" className="pastille" style={{ border: 0, cursor: 'pointer', font: 'inherit', fontSize: 12, fontWeight: 600 }}
                        title={`${k.nom} · ${k.effectif} élèves pour ${k.effectifMax} places`} onClick={() => modifierClasse(k)}>{k.nom}</button>
                    : <Pastille key={k.id}>{k.nom}</Pastille>))}
                  {c.classes.length === 0 && <Doux>Aucune classe</Doux>}
                </div>
              </div>
            ))}
            {s.cycles.length === 0 && <Doux>Aucun cycle pour l’instant.</Doux>}
            {gererClasses && (
              <Rangee>
                <Bouton icone="ajouter" onClick={ajouterCycle}>Ajouter un cycle</Bouton>
                <Bouton icone="ajouter" onClick={ajouterClasse}>Ajouter une classe</Bouton>
              </Rangee>
            )}
            <Doux>Cycles disponibles : maternelle, primaire et secondaire, dans les deux sous-systèmes.</Doux>
          </Panneau>
          <Panneau>
            <TitrePanneau titre="Numérotation" />
            <Tableau
              colonnes={[{ titre: 'Document et format' }, { titre: 'Prochain numéro', droite: true }]}
              lignes={s.numerotation.map((n) => [<Cel2 gras haut={n.document} bas={n.format} />, <span className="gras">{n.prochain}</span>])}
            />
            <Doux>Numéros attribués sans trou ni doublon, même si deux postes enregistrent en même temps.</Doux>
          </Panneau>
          <PanneauModeles modifiable={moi.a('core.modele.modifier')} />
        </> },
      ]} />
    );
  })();
  return <Coque module="parametres">{contenu}</Coque>;
}
