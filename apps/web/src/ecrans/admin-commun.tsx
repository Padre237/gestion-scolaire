// Éléments communs aux écrans d'administration : dates du serveur, mot de passe affiché une seule fois,
// création d'un compte (Personnel et Utilisateurs), modèles de documents attendus de l'établissement.
import { useCallback, useEffect, useLayoutEffect, useState, type ReactNode } from 'react';
import { api, ErreurApi } from '../core/api.ts';
import { heure, jjmm, jjmmaaaa, pluriel } from '../core/format.ts';
import { Bouton, CaseACocher, Champ, Doux, Icone, InfoCaps, Liste, Note, ouvrirFenetre, ouvrirFormulaire, PiedFenetre, signaler } from '../core/ui.tsx';
import type { NomIcone } from '../core/icones-traces.ts';

/** Horodatage au format texte de PostgreSQL (« 2026-11-10 10:44:19.811912+00 ») → ISO lisible par Date. */
export function isoPg(s: string | null | undefined): string | null {
  if (!s) return null;
  const t = s.trim();
  if (!/\d{2}:\d{2}/.test(t)) return t;
  return t.replace(' ', 'T').replace(/(\.\d{3})\d+/, '$1').replace(/([+-]\d{2})$/, '$1:00');
}
/** « 07/11/2026 15:35 ». */
export const dateHeure = (s: string | null | undefined) => { const i = isoPg(s); return i && jjmmaaaa(i) ? `${jjmmaaaa(i)} ${heure(i)}` : '–'; };
/** « 07/11/2026 à 18:00 ». */
export const dateAHeure = (s: string | null | undefined) => { const i = isoPg(s); return i && jjmmaaaa(i) ? `${jjmmaaaa(i)} à ${heure(i)}` : '–'; };
/** « 07/11 07:55 ». */
export const jourHeure = (s: string | null | undefined) => { const i = isoPg(s); return i && jjmm(i) ? `${jjmm(i)} ${heure(i)}` : ''; };

export const sansAccent = (x: string) => x.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/** Valeur saisie appliquée après une courte pause de frappe (recherche). */
export function useDiffere<T>(valeur: T, delai = 300): T {
  const [v, setV] = useState(valeur);
  useEffect(() => { const t = setTimeout(() => setV(valeur), delai); return () => clearTimeout(t); }, [valeur, delai]);
  return v;
}

/** Vrai quand la fenêtre ne dépasse pas `max` pixels de large (téléphone sous 640 px par défaut) ; suit les changements d'orientation. */
export function useEtroit(max = 640): boolean {
  const [etroit, setEtroit] = useState(() => typeof window !== 'undefined' && window.matchMedia(`(max-width: ${max}px)`).matches);
  useEffect(() => {
    const m = window.matchMedia(`(max-width: ${max}px)`);
    const suivre = () => setEtroit(m.matches);
    suivre();
    m.addEventListener('change', suivre);
    return () => m.removeEventListener('change', suivre);
  }, [max]);
  return etroit;
}

/** Largeur réelle d'un conteneur (pour savoir si des colonnes se sont empilées) : la référence s'attache même à un élément monté plus tard. */
export function useLargeurConteneur<T extends HTMLElement>(): [(el: T | null) => void, number] {
  const [el, setEl] = useState<T | null>(null);
  const [largeur, setLargeur] = useState(0);
  useLayoutEffect(() => {
    if (!el) return;
    setLargeur(el.clientWidth);
    const o = new ResizeObserver((entrees) => { const e = entrees[0]; if (e) setLargeur(e.contentRect.width); });
    o.observe(el);
    return () => o.disconnect();
  }, [el]);
  const ref = useCallback((x: T | null) => setEl(x), []);
  return [ref, largeur];
}

/** Bouton d'action d'une ligne : icône seule sur grand écran (44 × 44, nom accessible), icône et libellé court sur téléphone. */
export function BoutonAction({ icone, libelle, court, onClick, danger, disabled }: { icone: NomIcone; libelle: string; court: string; onClick: () => void; danger?: boolean; disabled?: boolean }) {
  return (
    <button type="button" className={`bouton pleine-mobile ${danger ? 'danger' : ''}`} aria-label={libelle} title={libelle} disabled={disabled} onClick={onClick}
      style={{ width: 44, padding: 0, borderColor: 'var(--bord)', background: 'transparent', color: danger ? 'var(--danger)' : 'var(--doux)' }}>
      <Icone nom={icone} /><span className="cache-bureau">{court}</span>
    </button>
  );
}

/** Copie un texte dans le presse-papiers, avec repli sur la sélection quand l'accès direct n'est pas disponible (adresse en http). */
export async function copierTexte(texte: string, element?: HTMLElement | null): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(texte); return true; }
  } catch { /* repli ci-dessous */ }
  try {
    const zone = document.createElement('textarea');
    zone.value = texte;
    zone.setAttribute('readonly', '');
    zone.style.position = 'fixed';
    zone.style.opacity = '0';
    document.body.append(zone);
    zone.select();
    const ok = document.execCommand('copy');
    zone.remove();
    if (!ok && element) { const sel = window.getSelection(); sel?.removeAllRanges(); const r = document.createRange(); r.selectNodeContents(element); sel?.addRange(r); }
    return ok;
  } catch { return false; }
}

/** Pagination des listes : « 23 personnes · lignes 1 à 10 », Précédent, Suivant (boutons de 44 px, côte à côte sur toute la largeur du téléphone). */
export function Pagination({ total, page, taille, nombre, mot, motPluriel, changer }: {
  total: number; page: number; taille: number; nombre: number; mot: string; motPluriel?: string; changer: (p: number) => void;
}) {
  const debut = total === 0 ? 0 : (page - 1) * taille + 1;
  return (
    <nav aria-label="Pages de la liste" style={{ display: 'flex', flexWrap: 'wrap', gap: 12, justifyContent: 'space-between', alignItems: 'center' }}>
      <Doux>{pluriel(total, mot, motPluriel)} · lignes {debut} à {total === 0 ? 0 : debut + nombre - 1}</Doux>
      <div className="pleine-mobile" style={{ display: 'flex', gap: 8 }}>
        <div style={{ flex: '1 1 auto' }}><Bouton pleine disabled={page <= 1} onClick={() => changer(page - 1)}>Précédent</Bouton></div>
        <div style={{ flex: '1 1 auto' }}><Bouton pleine disabled={page * taille >= total} onClick={() => changer(page + 1)}>Suivant</Bouton></div>
      </div>
    </nav>
  );
}

// ---------------------------------------------------------------- mot de passe et modèles

/** Mot de passe créé ou réinitialisé : affiché une seule fois, dans cette fenêtre. */
export function montrerMotDePasse(titre: string, identifiant: string, motDePasse: string, consigne: ReactNode) {
  let zone: HTMLElement | null = null;
  const copier = async () => {
    if (await copierTexte(motDePasse, zone)) signaler('Mot de passe copié');
    else signaler('Copie impossible sur ce poste : le mot de passe est sélectionné, recopiez-le.', true);
  };
  return ouvrirFenetre<void>(titre, (fermer) => (
    <>
      <p>{consigne}</p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px 32px' }}>
        <InfoCaps libelle="Identifiant" valeur={<span style={{ overflowWrap: 'anywhere', userSelect: 'all' }}>{identifiant}</span>} />
        <div className="info-caps" style={{ minWidth: 0, maxWidth: '100%' }}>
          <span className="etiquette">Mot de passe</span>
          <span ref={(el) => { zone = el; }} className="valeur" style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', fontSize: 20, letterSpacing: '0.06em', userSelect: 'all', overflowWrap: 'anywhere' }}>{motDePasse}</span>
        </div>
      </div>
      <Note ton="attention">Ce mot de passe ne s’affichera plus : notez-le maintenant et remettez-le en main propre.</Note>
      <div className="pied pile-mobile">
        <Bouton onClick={() => void copier()}>Copier le mot de passe</Bouton>
        <Bouton variante="principal" onClick={() => fermer()}>J’ai noté le mot de passe</Bouton>
      </div>
    </>
  ), 480);
}

// ---------------------------------------------------------------- comptes

export interface Role { id: string; code: string; libelle: string; libelleEn: string; systeme: boolean; perimetre: string; permissions: string[] }
export interface PersonnelSansCompte { id: string; nomAffiche: string; fonction: string }

/** Rôle proposé d'après la fonction inscrite sur la fiche du personnel. */
export const ROLE_DE_FONCTION: Record<string, string> = {
  directeur: 'directeur', secretaire: 'secretaire', econome: 'econome', prefet: 'prefet',
  instituteur_principal: 'instituteur_principal', instituteur_matiere: 'instituteur_matiere',
};

/** « M. ONANA Bertrand » → « onana.b ». */
export function identifiantPropose(nom: string): string {
  const mots = sansAccent(nom.replace(/^(M\.|Mme|Mlle|Mr|Mrs|Ms|Miss|Dr|Pr)\s+/i, ''))
    .split(/\s+/).map((m) => m.replace(/[^a-z0-9-]/g, '')).filter(Boolean);
  const id = mots.length > 1 ? `${mots[0]}.${mots[1]![0]}` : mots[0] ?? '';
  return id.slice(0, 40);
}

export const rolesAttribuables = (roles: Role[]) => roles.filter((r) => r.code !== 'parent' && r.perimetre !== 'famille');

function FenetreCompte({ fermer, roles, initial, personnels }: {
  fermer: (v?: { identifiant: string; motDePasse: string }) => void; roles: Role[];
  initial: { nomAffiche?: string; personnelId?: string | null; fonction?: string }; personnels: PersonnelSansCompte[];
}) {
  const roleInitial = roles.find((r) => r.code === ROLE_DE_FONCTION[initial.fonction ?? '']);
  const [nom, setNom] = useState(initial.nomAffiche ?? '');
  const [identifiant, setIdentifiant] = useState(initial.nomAffiche ? identifiantPropose(initial.nomAffiche) : '');
  const [personnelId, setPersonnelId] = useState<string | null>(initial.personnelId ?? null);
  const [choisis, setChoisis] = useState<string[]>(roleInitial ? [roleInitial.id] : []);
  const [erreur, setErreur] = useState<{ champ?: string; message: string } | null>(null);
  const [charge, setCharge] = useState(false);
  const options: [string | null, string][] = [[null, 'Aucune fiche liée'], ...personnels.map((p): [string, string] => [p.id, p.nomAffiche])];
  const choisirPersonnel = (id: string | null) => {
    setPersonnelId(id);
    const p = personnels.find((x) => x.id === id);
    if (!p) return;
    setNom(p.nomAffiche);
    setIdentifiant(identifiantPropose(p.nomAffiche));
    const r = roles.find((x) => x.code === ROLE_DE_FONCTION[p.fonction]);
    if (r) setChoisis([r.id]);
  };
  const valider = async () => {
    const id = identifiant.trim().toLowerCase();
    if (nom.trim().length < 2) return setErreur({ champ: 'nomAffiche', message: 'Nom à afficher requis (2 caractères au moins).' });
    if (!/^[a-z0-9._-]{3,40}$/.test(id)) return setErreur({ champ: 'identifiant', message: 'De 3 à 40 caractères : lettres minuscules, chiffres, point, tiret.' });
    if (!choisis.length) return setErreur({ champ: 'roles', message: 'Choisissez au moins un rôle.' });
    setCharge(true);
    setErreur(null);
    try {
      const r = await api.post<{ identifiant: string; motDePasse: string }>('/core/comptes',
        { identifiant: id, nomAffiche: nom.trim(), personnelId, roles: choisis.map((roleId) => ({ roleId })) });
      fermer({ identifiant: r.identifiant, motDePasse: r.motDePasse });
    } catch (e) {
      setErreur(e instanceof ErreurApi ? { champ: e.champ, message: e.message } : { message: String(e) });
      setCharge(false);
    }
  };
  const surChamp = (c: string) => (erreur && erreur.champ === c ? erreur.message : null);
  return (
    <>
      {personnels.length > 0 && <Liste libelle="Fiche du personnel" value={personnelId} options={options} onChange={choisirPersonnel} />}
      <Champ libelle="Nom affiché" value={nom} onChange={setNom} autoFocus erreur={surChamp('nomAffiche')} />
      <Champ libelle="Identifiant de connexion" value={identifiant} onChange={(v) => setIdentifiant(v.toLowerCase())} erreur={surChamp('identifiant')} />
      <div className="champ-groupe">
        <span className="libelle">Rôles</span>
        <div className="pile-mobile" style={{ display: 'flex', flexWrap: 'wrap', columnGap: 18 }}>
          {rolesAttribuables(roles).map((r) => (
            <CaseACocher key={r.id} libelle={r.libelle} valeur={choisis.includes(r.id)}
              onChange={(v) => setChoisis((c) => (v ? [...c, r.id] : c.filter((x) => x !== r.id)))} />
          ))}
        </div>
        {surChamp('roles') && <span className="erreur-champ" role="alert">{surChamp('roles')}</span>}
      </div>
      <Doux>Le mot de passe est créé par l’application ; il s’affiche une seule fois, juste après la création.</Doux>
      {erreur && !['nomAffiche', 'identifiant', 'roles'].includes(erreur.champ ?? '') && <div role="alert"><Note ton="danger">{erreur.message}</Note></div>}
      <PiedFenetre fermer={() => fermer()} action="Créer le compte" onAction={valider} charge={charge} />
    </>
  );
}

/** Nouveau compte : fenêtre de saisie, puis mot de passe affiché une seule fois. Renvoie vrai si le compte est créé. */
export async function creerCompte(roles: Role[], initial: { nomAffiche?: string; personnelId?: string | null; fonction?: string } = {},
  personnels: PersonnelSansCompte[] = []): Promise<boolean> {
  const r = await ouvrirFormulaire<{ identifiant: string; motDePasse: string }>('Nouveau compte',
    ({ fermer }) => <FenetreCompte fermer={fermer} roles={roles} initial={initial} personnels={personnels} />, 560);
  if (!r) return false;
  await montrerMotDePasse('Compte créé', r.identifiant, r.motDePasse,
    `Le compte « ${r.identifiant} » est prêt. Remettez ce mot de passe à la personne concernée : la connexion est possible tout de suite.`);
  return true;
}
