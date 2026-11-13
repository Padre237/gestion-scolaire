// Maquettes Statistiques (pilotage) et Assistant. Les chiffres viennent du serveur ; l'assistant ne calcule rien
// et, tant qu'aucun fournisseur n'est relié, chaque demande reste en file sans réponse inventée.
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, requete } from '../core/api.ts';
import { Coque } from '../core/coque.tsx';
import { useMoi } from '../core/session.tsx';
import { ouvrirDocument, telecharger } from '../core/documents.ts';
import { aujourdhuiIso, fcfa, jjmmaaaa, montant, note2, pluriel } from '../core/format.ts';
import {
  agir, Bandeau, Bouton, CaseACocher, Champ, Chargement, Colonnes, Doux, Erreur, Filtres, Jauge, LigneListe, Liste, Panneau, Pastille, signaler, Tableau, TitrePanneau,
  useDonnees, type Ton,
} from '../core/ui.tsx';
import { dateHeure } from './admin-commun.tsx';

// ---------------------------------------------------------------- statistiques

interface Effectif { niveau: string; classes: number; garcons: number; filles: number; total: number; nouveaux: number; redoublants: number }
interface Resultat { classe: string; moyenne: number | string; reussite: number; forte: string | null; faible: string | null }
interface Statistiques {
  annees: { id: string; libelle: string; statut: string }[]; anneeId: string | null; sousSysteme: string | null; effectifs: Effectif[];
  sequence: string | null; resultats: Resultat[]; nbClasses: number; resteNiveau: { niveau: string; reste: number }[]; resteTotal: number;
  recouvrement: number | null;
  completude: { sequence: string | null; notes: number | null; appels: number | null; classes_appel: number | null; sessions_closes: number | null; sessions: number | null; periode: string | null; bulletins: number | null } | null;
}

const RAPPORTS: [string, string, string][] = [
  ['Fiche statistique de rentrée', 'Effectifs par classe, sexe et âge', 'rentree'],
  ['État des instituteurs', 'Par statut et par classe', 'instituteurs'],
  ['Rapport de fin de trimestre', 'Résultats, absences, recouvrement', 'trimestre'],
];
const SOUS_SYSTEMES: [string | null, string][] = [[null, 'Tous'], ['francophone', 'Francophone'], ['anglophone', 'Anglophone']];
const minuscule = (x: string) => x.charAt(0).toLowerCase() + x.slice(1);

export function EcranStatistiques() {
  const [anneeId, setAnneeId] = useState<string | null>(null);
  const [sousSysteme, setSousSysteme] = useState<string | null>(null);
  const st = useDonnees(() => api.get<Statistiques>(`/pilotage/statistiques${requete({ anneeId, sousSysteme })}`), [anneeId, sousSysteme]);
  const d = st.d;
  const filtre = { anneeId: anneeId ?? d?.anneeId, sousSysteme };
  const adresse = (format: 'csv' | 'pdf', section: 'tout' | 'effectifs') => `/pilotage/statistiques/document${requete({ ...filtre, format, section })}`;

  const contenu = (() => {
    if (st.erreur && !d) return <Erreur message={st.erreur} recharger={st.recharger} />;
    if (!d) return <Chargement />;
    const t = d.effectifs.reduce((s, e) => ({ classes: s.classes + e.classes, garcons: s.garcons + e.garcons, filles: s.filles + e.filles, total: s.total + e.total,
      nouveaux: s.nouveaux + e.nouveaux, redoublants: s.redoublants + e.redoublants }), { classes: 0, garcons: 0, filles: 0, total: 0, nouveaux: 0, redoublants: 0 });
    const maxReste = Math.max(1, ...d.resteNiveau.map((x) => Number(x.reste)));
    const c = d.completude;
    const jauges: { libelle: string; fait: number; sur: number; texte: string }[] = [];
    if (c?.sequence && c.notes !== null) jauges.push({ libelle: `Notes de la ${minuscule(c.sequence)} saisies`, fait: c.notes, sur: d.nbClasses, texte: `${pluriel(c.notes, 'classe')} sur ${d.nbClasses}` });
    if (c && c.classes_appel) jauges.push({ libelle: 'Appels du jour faits', fait: c.appels ?? 0, sur: c.classes_appel, texte: `${pluriel(c.appels ?? 0, 'classe')} sur ${c.classes_appel}` });
    if (c && c.sessions) jauges.push({ libelle: 'Sessions de caisse clôturées hier', fait: c.sessions_closes ?? 0, sur: c.sessions, texte: `${c.sessions_closes ?? 0} sur ${c.sessions}` });
    if (c?.periode) jauges.push({ libelle: `Bulletins du ${c.periode} publiés`, fait: c.bulletins ?? 0, sur: d.nbClasses, texte: `${c.bulletins ?? 0} sur ${d.nbClasses}` });
    return (
      <Colonnes colonnes={[
        { flex: 3, min: 620, enfants: <>
          <Panneau>
            <TitrePanneau titre="Effectifs par niveau, sexe et statut" action={<Bouton icone="exporter" title="Exporter les effectifs" onClick={() => telecharger(adresse('csv', 'effectifs'))}>Exporter</Bouton>} />
            <Tableau
              /* Sur téléphone, chaque niveau devient une carte ; le nombre de classes, secondaire, y est omis. */
              colonnes={['Niveau', 'Classes', 'Garçons', 'Filles', 'Total', 'Nouveaux', 'Redoublants'].map((x, i) => ({ titre: x, droite: i > 0, mobile: i === 0 ? 'entete' as const : i === 1 ? 'cachee' as const : undefined }))}
              cles={d.effectifs.map((e) => e.niveau)}
              vide="Aucune classe pour cette année."
              lignes={d.effectifs.map((e) => [<span className="gras">{e.niveau}</span>, e.classes, e.garcons, e.filles, <span className="gras">{montant(e.total)}</span>, e.nouveaux, e.redoublants])}
              total={d.effectifs.length ? ['Établissement', t.classes, t.garcons, t.filles, montant(t.total), t.nouveaux, t.redoublants] : undefined}
            />
          </Panneau>
          <Panneau>
            <TitrePanneau titre="Résultats par classe" sous={d.sequence ? `${d.sequence} · ${d.resultats.length} classes sur ${d.nbClasses} affichées` : undefined} />
            <Tableau
              colonnes={[{ titre: 'Classe', mobile: 'entete' }, { titre: 'Moyenne', droite: true }, { titre: 'Réussite', droite: true }, { titre: 'Matière la plus forte' }, { titre: 'Matière la plus faible' }]}
              cles={d.resultats.map((r) => r.classe)}
              vide="Aucune note validée pour l’instant."
              lignes={d.resultats.map((r) => [<span className="gras">{r.classe}</span>, note2(Number(r.moyenne)), `${r.reussite} %`, r.forte ?? '–', r.faible ?? '–'])}
            />
            <Doux>Calculées par l’application à partir des notes validées.</Doux>
          </Panneau>
        </> },
        { flex: 2, min: 340, enfants: <>
          <Panneau>
            <TitrePanneau titre="Reste dû par niveau" sous={`${fcfa(d.resteTotal)} au ${jjmmaaaa(aujourdhuiIso())}${d.recouvrement !== null ? ` · recouvrement ${d.recouvrement} %` : ''}`} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {d.resteNiveau.map((x) => <Jauge key={x.niveau} libelle={x.niveau} valeur={montant(Number(x.reste))} part={Number(x.reste) / maxReste} grasLibelle={false} />)}
              {d.resteNiveau.length === 0 && <Doux>Aucun échéancier pour cette année.</Doux>}
            </div>
          </Panneau>
          <Panneau>
            <TitrePanneau titre="Complétude" sous="Ce qui manque encore" />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {jauges.map((j) => <Jauge key={j.libelle} libelle={j.libelle} valeur={<span style={{ whiteSpace: 'nowrap' }}>{j.texte}</span>} part={j.sur ? j.fait / j.sur : 0} grasLibelle={false}
                sous={j.sur && j.fait >= j.sur ? 'Complet' : undefined} couleur={j.sur && j.fait >= j.sur ? 'var(--succes)' : undefined} />)}
              {jauges.length === 0 && <Doux>Rien à suivre pour cette année.</Doux>}
            </div>
          </Panneau>
          <Panneau>
            <TitrePanneau titre="Rapports pour la tutelle" />
            <div>
              {RAPPORTS.map(([titre, detail, type]) => (
                <LigneListe key={titre}>
                  <div style={{ flex: '1 1 160px', display: 'flex', flexDirection: 'column', minWidth: 0 }}><span className="gras">{titre}</span><Doux>{detail}</Doux></div>
                  <div className="pleine-mobile"><Bouton pleine icone="exporter" title={`Générer : ${titre}`} onClick={() => ouvrirDocument(`/pilotage/rapports/${type}`)}>Générer</Bouton></div>
                </LigneListe>
              ))}
            </div>
          </Panneau>
        </> },
      ]} />
    );
  })();

  const optionsAnnees: [string | null, string][] = (d?.annees ?? []).map((a): [string, string] => [a.id, a.libelle]);
  return (
    <Coque module="pilotage">
      <Filtres
        champs={<>
          <Liste libelle="Année scolaire" value={anneeId ?? d?.anneeId ?? null} options={optionsAnnees} onChange={setAnneeId} largeur={180} />
          <Liste libelle="Sous-système" value={sousSysteme} options={SOUS_SYSTEMES} onChange={setSousSysteme} largeur={180} />
        </>}
        actions={<div className="pile-mobile" style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
          <Bouton icone="exporter" disabled={!d} onClick={() => telecharger(adresse('csv', 'tout'))}>Exporter tout</Bouton>
          <Bouton icone="imprimer" disabled={!d} onClick={() => ouvrirDocument(adresse('pdf', 'effectifs'))}>Imprimer</Bouton>
        </div>}
      />
      {contenu}
    </Coque>
  );
}

// ---------------------------------------------------------------- assistant

interface Question { id: string; question: string; remplacements: number | null; statut: string; creeLe: string; reponse: unknown }
interface ReglageIA { adresse: string; modele: string; actif: boolean; cleEnregistree: boolean; finCle: string | null }

/** Réglage du fournisseur (directeur) : adresse compatible OpenRouter, modèle, clé ; la clé enregistrée ne s'affiche jamais. */
function PanneauReglageIA({ apres }: { apres: () => void }) {
  const st = useDonnees(() => api.get<ReglageIA>('/assistant/reglage'));
  const [v, setV] = useState<{ adresse: string; modele: string; actif: boolean } | null>(null);
  const [cle, setCle] = useState('');
  const [charge, setCharge] = useState(false);
  const d = st.d;
  if (st.erreur && !d) return <Erreur message={st.erreur} recharger={st.recharger} />;
  if (!d) return <Panneau><Chargement /></Panneau>;
  const x = v ?? { adresse: d.adresse, modele: d.modele, actif: d.actif };
  const enregistrer = async () => {
    setCharge(true);
    const ok = await agir(() => api.put('/assistant/reglage', { ...x, ...(cle.trim() ? { cle: cle.trim() } : {}) }), 'Réglage de l’assistant enregistré');
    setCharge(false);
    if (ok) { setV(null); setCle(''); await st.recharger(); apres(); }
  };
  return (
    <Panneau>
      <TitrePanneau titre="Fournisseur de l’assistant" sous={d.actif && d.cleEnregistree ? 'Relié' : 'Non relié'} />
      <Champ libelle="Adresse du service" value={x.adresse} onChange={(a) => setV({ ...x, adresse: a })} placeholder="https://openrouter.ai/api/v1" />
      <Champ libelle="Modèle" value={x.modele} onChange={(m) => setV({ ...x, modele: m })} placeholder="anthropic/claude-sonnet-5.5" />
      <Champ libelle="Clé du fournisseur" type="password" value={cle} onChange={setCle}
        placeholder={d.cleEnregistree ? `Clé enregistrée (…${d.finCle}) : laisser vide pour la garder` : 'Clé fournie par OpenRouter'} />
      <CaseACocher libelle="Assistant activé" valeur={x.actif} onChange={(a) => setV({ ...x, actif: a })} />
      <div><Bouton variante="principal" charge={charge} onClick={enregistrer}>Enregistrer</Bouton></div>
      <Doux>Le nom exact du modèle se lit sur openrouter.ai/models. Seuls partent la question, nettoyée de tout nom, téléphone et adresse,
        et des chiffres par classe (effectifs, recouvrement, absences, moyennes). La clé reste sur le serveur de l’école.</Doux>
    </Panneau>
  );
}
interface Proposition { id: string; type: string; libelle: string; contenu: unknown; creeLe: string }
interface EtatAssistant { fournisseur: 'actif' | 'desactive'; questions: Question[]; propositions: Proposition[]; usage: { enFile: number; coutMois: number; plafond: number | null } }

const STATUT_TACHE: Record<string, [string, Ton]> = {
  en_file: ['En file', 'attention'], en_cours: ['En cours', 'accent'], proposee: ['À relire', 'accent'],
  validee: ['Validée', 'succes'], rejetee: ['Rejetée', 'danger'], expiree: ['Expirée', 'neutre'],
};
/** Écran où se relit chaque proposition, selon la tâche. */
const RELIRE: Record<string, string> = {
  'IA-01': '/messages/annonces', 'IA-02': '/finances/impayes', 'IA-03': '/finances/releve', 'IA-04': '/parametres/donnees',
  'IA-05': '/pedagogie/bulletins', 'IA-06': '/pedagogie/conseil',
};
const HORS_CHAMP = ['Moyennes', 'Rangs', 'Montants', 'Répartition des versements', 'Numéros de reçu', 'Validations'];

/** Texte d'une réponse ou d'une proposition enregistrée par le serveur. */
function texteDe(x: unknown): string | null {
  if (typeof x === 'string') return x;
  if (x && typeof x === 'object') {
    const o = x as Record<string, unknown>;
    for (const k of ['texte', 'reponse', 'resume', 'objet']) if (typeof o[k] === 'string') return o[k] as string;
  }
  return null;
}

export function EcranAssistant() {
  const moi = useMoi();
  const naviguer = useNavigate();
  const a = useDonnees(() => api.get<EtatAssistant>('/assistant'));
  const [question, setQuestion] = useState('');
  const [charge, setCharge] = useState(false);
  const demander = async () => {
    const q = question.trim();
    if (q.length < 5 || q.length > 500 || charge) return;
    setCharge(true);
    const r = await agir(() => api.post<{ id: string; statut: string; remplacements: number; erreur?: string }>('/assistant/questions', { question: q }));
    setCharge(false);
    if (r) {
      const retire = r.remplacements ? ` ; ${pluriel(r.remplacements, 'information personnelle retirée', 'informations personnelles retirées')} avant l’envoi` : '';
      signaler(r.statut === 'proposee' ? `Réponse reçue${retire}` : `Question en file${r.erreur ? ` (${r.erreur})` : ''}${retire}`, r.statut !== 'proposee' && !!r.erreur);
      setQuestion(''); void a.recharger();
    }
  };
  const envoyerFile = async () => {
    const r = await agir(() => api.post<{ traitees: number; restantes: number; erreur?: string }>('/assistant/file'));
    if (r) { signaler(r.traitees ? `${pluriel(r.traitees, 'question envoyée', 'questions envoyées')}` : `Aucune question envoyée${r.erreur ? ` : ${r.erreur}` : ''}`, !r.traitees); void a.recharger(); }
  };
  const d = a.d;
  const contenu = (() => {
    if (a.erreur && !d) return <Erreur message={a.erreur} recharger={a.recharger} />;
    if (!d) return <Chargement />;
    const relie = d.fournisseur === 'actif';
    return (
      <Colonnes colonnes={[
        { flex: 3, min: 600, enfants: (
          <Panneau>
            <TitrePanneau titre="Questions de la direction" />
            {!relie && <Bandeau ton="attention" icone="horsLigne">L’assistant n’est pas encore relié à un fournisseur : les demandes restent en file.</Bandeau>}
            <Champ libelle="Votre question" lignes={3} value={question} onChange={setQuestion} placeholder="Par exemple : quels niveaux ont le plus de frais restant à payer ?"
              erreur={question.trim().length > 500 ? `500 caractères au plus (${question.trim().length} saisis).` : null} />
            <div className="pile-mobile" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12, justifyContent: 'space-between' }}>
              <Doux style={{ flex: '1 1 260px' }}>Réponses tirées des chiffres de l’école. Ne partent que la question, sans nom, téléphone ni adresse, et des chiffres par classe ; tout est journalisé.</Doux>
              <Bouton variante="principal" icone="envoyer" charge={charge} disabled={question.trim().length < 5 || question.trim().length > 500} onClick={demander}>Demander</Bouton>
            </div>
            <div>
              {d.questions.map((q) => {
                const [statut, ton] = STATUT_TACHE[q.statut] ?? [q.statut, 'neutre' as Ton];
                const reponse = texteDe(q.reponse);
                return (
                  <LigneListe key={q.id}>
                    <div style={{ flex: '1 1 200px', display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
                      <span className="gras" style={{ overflowWrap: 'anywhere' }}>{q.question}</span>
                      {(q.remplacements ?? 0) > 0 && <Doux>Envoyée ainsi : {pluriel(q.remplacements!, 'information personnelle remplacée', 'informations personnelles remplacées')} ([personne], [numéro], [adresse]).</Doux>}
                      <Doux>Posée le {dateHeure(q.creeLe)}</Doux>
                      {reponse && (
                        <div className="bloc-assistant">
                          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: '4px 12px' }}>
                            <span className="gras">Réponse de l’assistant</span><Doux>À relire et à valider par une personne habilitée</Doux>
                          </div>
                          <span>{reponse}</span>
                        </div>
                      )}
                    </div>
                    <Pastille ton={ton}>{statut}</Pastille>
                  </LigneListe>
                );
              })}
              {d.questions.length === 0 && <Doux>Aucune question pour l’instant.</Doux>}
            </div>
            <Doux>Les montants sont lus dans la base ; l’assistant ne calcule ni montant, ni moyenne, ni rang.</Doux>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {moi.a('finances.impaye.consulter') && <Bouton variante="lien" onClick={() => naviguer('/finances/impayes')}>Ouvrir les impayés</Bouton>}
              {moi.a('pilotage.statistiques.consulter') && <Bouton variante="lien" onClick={() => naviguer('/pilotage/statistiques')}>Voir les statistiques</Bouton>}
            </div>
          </Panneau>
        ) },
        { flex: 2, min: 360, enfants: <>
          <Panneau>
            <TitrePanneau titre="Propositions à valider" sous="Rien ne change sans votre accord" />
            <div>
              {d.propositions.map((p) => (
                <LigneListe key={p.id}>
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 160 }}>
                    <span className="gras">{p.libelle}</span>
                    <Doux>{texteDe(p.contenu) ?? `Proposée le ${dateHeure(p.creeLe)}`}</Doux>
                  </div>
                  {RELIRE[p.type] && <div className="pleine-mobile"><Bouton pleine title={`Relire : ${p.libelle}`} onClick={() => naviguer(RELIRE[p.type]!)}>Relire</Bouton></div>}
                </LigneListe>
              ))}
              {d.propositions.length === 0 && <Doux>Aucune proposition en attente.</Doux>}
            </div>
          </Panneau>
          <Panneau>
            <TitrePanneau titre="Usage et confidentialité" />
            <div>
              <LigneListe><span style={{ flex: '1 1 140px' }}>Dépense du mois</span><span className="gras">{fcfa(d.usage.coutMois)}</span></LigneListe>
              <LigneListe><span style={{ flex: '1 1 140px' }}>Plafond mensuel</span><span className="gras">{d.usage.plafond === null ? 'Non fixé' : fcfa(d.usage.plafond)}</span></LigneListe>
              <LigneListe><span style={{ flex: '1 1 140px' }}>Demandes en file</span><span className="gras">{d.usage.enFile ? pluriel(d.usage.enFile, 'demande') : 'Aucune'}</span></LigneListe>
            </div>
            {d.usage.enFile > 0 && relie && <div><Bouton icone="envoyer" onClick={envoyerFile}>Envoyer les questions en file</Bouton></div>}
            <Doux>Noms, téléphones et adresses retirés avant chaque envoi ; chaque question est journalisée.</Doux>
          </Panneau>
          {moi.a('assistant.reglage.gerer') && <PanneauReglageIA apres={() => { void a.recharger(); }} />}
          <Panneau>
            <TitrePanneau titre="Hors du champ de l’assistant" />
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>{HORS_CHAMP.map((x) => <Pastille key={x}>{x}</Pastille>)}</div>
            <Doux>Ces calculs et ces décisions restent à l’application et aux personnes habilitées. Toute l’application fonctionne sans l’assistant.</Doux>
          </Panneau>
        </> },
      ]} />
    );
  })();
  return <Coque module="assistant">{contenu}</Coque>;
}
