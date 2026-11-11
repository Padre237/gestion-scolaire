// Composants communs, au style des maquettes (classes de styles.css) : panneau, étiquette, pastille, boutons, champs,
// tableaux, fenêtres, messages, chargement des données. Les écrans les composent ; aucune couleur n'est écrite en dur.
import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { ICONES, type NomIcone } from './icones-traces.ts';
import { ErreurApi } from './api.ts';
import { initiale } from './format.ts';

export type Ton = 'neutre' | 'accent' | 'succes' | 'attention' | 'danger';

export function Icone({ nom, taille = 18, style, className }: { nom: NomIcone; taille?: number; style?: CSSProperties; className?: string }) {
  return <svg aria-hidden="true" width={taille} height={taille} viewBox="0 0 24 24" className={`icone ${className ?? ''}`} style={style} dangerouslySetInnerHTML={{ __html: ICONES[nom] }} />;
}

export function Panneau({ children, reperes, ecart, marge, style, className }: { children: ReactNode; reperes?: boolean; ecart?: number; marge?: number; style?: CSSProperties; className?: string }) {
  return (
    <section className={`panneau ${className ?? ''}`} style={{ ...(ecart !== undefined ? { gap: ecart } : {}), ...(marge !== undefined ? { padding: marge } : {}), ...style }}>
      {reperes && <><span className="repere hg" /><span className="repere hd" /><span className="repere bg" /><span className="repere bd" /></>}
      {children}
    </section>
  );
}

export function TitrePanneau({ titre, sous, action }: { titre: ReactNode; sous?: ReactNode; action?: ReactNode }) {
  return (
    <div className="titre-panneau">
      <div><h2 className="etiquette">{titre}</h2>{sous && <span className="doux petit">{sous}</span>}</div>
      {action}
    </div>
  );
}

export const Etiquette = ({ children, style }: { children: ReactNode; style?: CSSProperties }) => <span className="etiquette" style={style}>{children}</span>;
export const Doux = ({ children, petit = true, style }: { children: ReactNode; petit?: boolean; style?: CSSProperties }) => <span className={`doux ${petit ? 'petit' : ''}`} style={style}>{children}</span>;

export function Pastille({ children, ton = 'neutre', icone }: { children: ReactNode; ton?: Ton; icone?: NomIcone }) {
  return <span className={`pastille ${ton === 'neutre' ? '' : ton}`}>{icone && <Icone nom={icone} taille={14} />}{children}</span>;
}

export type Variante = 'secondaire' | 'principal' | 'lien' | 'danger';
export function Bouton({ children, variante = 'secondaire', icone, touches, onClick, disabled, charge, pleine, petit, title, type = 'button' }: {
  children?: ReactNode; variante?: Variante; icone?: NomIcone; touches?: string[]; onClick?: () => void; disabled?: boolean; charge?: boolean;
  pleine?: boolean; petit?: boolean; title?: string; type?: 'button' | 'submit';
}) {
  return (
    <button type={type} title={title} className={`bouton ${variante === 'secondaire' ? '' : variante} ${pleine ? 'pleine' : ''} ${petit ? 'petit' : ''}`}
      disabled={disabled || charge} onClick={onClick}>
      {charge ? <span className="chargement" style={{ padding: 0 }}><span style={{ width: 16, height: 16 }} /></span> : icone && <Icone nom={icone} />}
      {children !== undefined && <span>{children}</span>}
      {touches?.map((t) => <kbd key={t}>{t}</kbd>)}
    </button>
  );
}

export const Lien = ({ children, onClick, danger }: { children: ReactNode; onClick?: () => void; danger?: boolean }) =>
  <button type="button" className={`lien-texte ${danger ? 'danger' : ''}`} onClick={onClick}>{children}</button>;

let compteurChamps = 0;
const useId = () => useRef(`c${++compteurChamps}`).current;

export function Champ({ libelle, value, onChange, placeholder, type = 'text', droite, erreur, lignes, petit, style, largeur, readOnly, autoFocus, onEnter, inputMode, ariaLabel }: {
  libelle?: string; value: string; onChange?: (v: string) => void; placeholder?: string; type?: string; droite?: boolean; erreur?: string | null;
  lignes?: number; petit?: boolean; style?: CSSProperties; largeur?: number | string; readOnly?: boolean; autoFocus?: boolean; onEnter?: () => void;
  inputMode?: 'numeric' | 'decimal' | 'tel' | 'text'; ariaLabel?: string;
}) {
  const id = useId();
  const classe = `champ ${droite ? 'droite' : ''} ${erreur ? 'erreur' : ''} ${petit ? 'petit' : ''}`;
  const champ = lignes
    ? <textarea id={id} className={classe} rows={lignes} value={value} placeholder={placeholder} readOnly={readOnly} aria-label={ariaLabel} onChange={(e) => onChange?.(e.target.value)} />
    : <input id={id} className={classe} type={type} value={value} placeholder={placeholder} readOnly={readOnly} autoFocus={autoFocus} inputMode={inputMode} aria-label={ariaLabel}
        style={style} onChange={(e) => onChange?.(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && onEnter) { e.preventDefault(); onEnter(); } }} />;
  if (!libelle && !erreur) return largeur ? <div className="champ-cadre" style={{ width: largeur }}>{champ}</div> : champ;
  return (
    <div className="champ-groupe" style={{ width: largeur }}>
      {libelle && <label htmlFor={id} className="libelle">{libelle}</label>}
      {champ}
      {erreur && <span className="erreur-champ">{erreur}</span>}
    </div>
  );
}

export function Liste<T extends string | number | null>({ libelle, value, options, onChange, largeur, petit, disabled, ariaLabel, vide = '–' }: {
  libelle?: string; value: T; options: [T, string][]; onChange?: (v: T) => void; largeur?: number | string; petit?: boolean; disabled?: boolean; ariaLabel?: string; vide?: string;
}) {
  const id = useId();
  const index = options.findIndex(([v]) => v === value);
  const select = (
    <select id={id} className={`champ ${petit ? 'petit' : ''}`} value={index < 0 ? '' : String(index)} disabled={disabled || !onChange} aria-label={ariaLabel ?? libelle}
      onChange={(e) => onChange?.(options[Number(e.target.value)]![0])}>
      {index < 0 && <option value="">{vide}</option>}
      {options.map(([, l], i) => <option key={i} value={String(i)}>{l}</option>)}
    </select>
  );
  if (!libelle) return largeur ? <div className="champ-cadre" style={{ width: largeur }}>{select}</div> : select;
  return <div className="champ-groupe" style={{ width: largeur }}><label htmlFor={id} className="libelle">{libelle}</label>{select}</div>;
}

/* La case native reste la cible réelle (44 × 44 px, invisible) ; la boîte dessinée (.case-boite) reprend le rendu natif des maquettes. */
export const CaseACocher = ({ libelle, valeur, onChange, disabled }: { libelle?: ReactNode; valeur: boolean; onChange?: (v: boolean) => void; disabled?: boolean }) => (
  <label className={`case ${disabled || !onChange ? 'inactive' : ''}`}>
    <span className="case-zone"><input type="checkbox" checked={valeur} disabled={disabled || !onChange} onChange={(e) => onChange?.(e.target.checked)} /><span className="case-boite" aria-hidden="true" /></span>
    {libelle !== undefined && libelle !== null && <span>{libelle}</span>}
  </label>
);
export const Radio = ({ libelle, actif, onChange, nom }: { libelle: ReactNode; actif: boolean; onChange: () => void; nom: string }) => (
  <label className="case">
    <span className="case-zone"><input type="radio" name={nom} checked={actif} onChange={onChange} /><span className="case-boite ronde" aria-hidden="true" /></span>
    <span>{libelle}</span>
  </label>
);

export function Bascules<T extends string>({ options, valeur, onChange, petites }: { options: [T, string][]; valeur: T; onChange?: (v: T) => void; petites?: boolean }) {
  return (
    <div className={`bascules ${petites ? 'petites' : ''}`}>
      {options.map(([v, l]) => <button key={v} type="button" className={v === valeur ? 'actif' : ''} aria-pressed={v === valeur} disabled={!onChange} onClick={() => onChange?.(v)}>{l}</button>)}
    </div>
  );
}

export const BarreProgression = ({ valeur, couleur, epaisse }: { valeur: number; couleur?: string; epaisse?: boolean }) => (
  <div className={`barre ${epaisse ? 'epaisse' : ''}`}><div style={{ width: `${Math.max(0, Math.min(1, valeur)) * 100}%`, ...(couleur ? { background: couleur } : {}) }} /></div>
);

export const Avatar = ({ nom, taille = 36 }: { nom: string; taille?: number }) =>
  <span className="avatar" aria-hidden="true" style={{ width: taille, height: taille, fontSize: Math.round(taille * 0.39) }}>{initiale(nom)}</span>;

export function CarteChiffre({ etiquette, valeur, unite, sous, couleur, reperes, taille }: { etiquette: string; valeur: ReactNode; unite?: string; sous?: ReactNode; couleur?: string; reperes?: boolean; taille?: number }) {
  return (
    <Panneau reperes={reperes} ecart={8} className="carte-chiffre">
      <Etiquette>{etiquette}</Etiquette>
      <span className="valeur" style={{ ...(couleur ? { color: couleur } : {}), ...(taille ? { fontSize: taille } : {}) }}>{valeur}{unite && <span className="unite"> {unite}</span>}</span>
      {sous !== undefined && sous !== null && <Doux>{sous}</Doux>}
    </Panneau>
  );
}

export const Grille = ({ children, min = 220, ecart = 16 }: { children: ReactNode; min?: number; ecart?: number }) =>
  <div className="grille" style={{ ['--min' as string]: `${min}px`, gap: ecart }}>{children}</div>;

/** Colonnes souples des maquettes (« flex: 2 1 600px » et « flex: 1 1 300px ») : elles passent l'une sous l'autre quand la place manque. */
export function Colonnes({ colonnes, ecart = 20 }: { colonnes: { flex: number; min: number; enfants: ReactNode }[]; ecart?: number }) {
  return (
    <div className="colonnes" style={{ gap: ecart }}>
      {colonnes.map((c, i) => <div key={i} className="colonne" style={{ flex: `${c.flex} 1 min(${c.min}px, 100%)`, gap: ecart }}>{c.enfants}</div>)}
    </div>
  );
}

export const Rangee = ({ children, fin, entre, centre, ecart, style }: { children: ReactNode; fin?: boolean; entre?: boolean; centre?: boolean; ecart?: number; style?: CSSProperties }) =>
  <div className={`rangee ${fin ? 'fin' : ''} ${entre ? 'entre' : ''} ${centre ? 'centre' : ''}`} style={{ ...(ecart !== undefined ? { gap: ecart } : {}), ...style }}>{children}</div>;

/** Barre de filtres des maquettes : champs à gauche, actions à droite. */
export const Filtres = ({ champs, actions }: { champs: ReactNode; actions?: ReactNode }) =>
  <div className="filtres"><div className="champs">{champs}</div>{actions && <div className="actions">{actions}</div>}</div>;

/** `mobile` : sous 640 px, chaque ligne devient une carte ; 'entete' = la cellule sert de titre de carte, 'cachee' = cellule omise sur téléphone. */
export interface Colonne { titre: ReactNode; droite?: boolean; largeur?: number | string; mobile?: 'entete' | 'cachee' }
export function Tableau({ colonnes, lignes, total, vide, onLigne, serre, cles }: {
  colonnes: Colonne[]; lignes: ReactNode[][]; total?: ReactNode[]; vide?: string; onLigne?: (i: number) => void; serre?: boolean; cles?: string[];
}) {
  return (
    <div className="tableau-cadre">
      <table className={`tableau ${serre ? 'serre' : ''}`}>
        <thead><tr>{colonnes.map((c, i) => <th key={i} scope="col" className={c.droite ? 'droite' : ''} style={c.largeur ? { width: c.largeur } : undefined}>{c.titre}</th>)}</tr></thead>
        <tbody>
          {lignes.map((l, r) => (
            <tr key={cles?.[r] ?? r} className={onLigne ? 'cliquable' : ''} onClick={onLigne ? () => onLigne(r) : undefined} tabIndex={onLigne ? 0 : undefined}
              onKeyDown={onLigne ? (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) { e.preventDefault(); onLigne(r); } } : undefined}>
              {l.map((c, i) => <td key={i} className={`${colonnes[i]?.droite ? 'droite' : ''} ${colonnes[i]?.mobile === 'entete' || (i === 0 && !colonnes.some((x) => x.mobile === 'entete')) ? 'carte-titre' : ''} ${colonnes[i]?.mobile === 'cachee' ? 'cache-mobile' : ''}`}
                data-titre={typeof colonnes[i]?.titre === 'string' ? (colonnes[i]!.titre as string) : undefined}>{c}</td>)}
            </tr>
          ))}
        </tbody>
        {total && <tfoot><tr>{total.map((c, i) => <td key={i} className={`${colonnes[i]?.droite ? 'droite' : ''} ${i === 0 ? 'carte-titre' : ''} ${colonnes[i]?.mobile === 'cachee' ? 'cache-mobile' : ''}`}
          data-titre={i > 0 && typeof colonnes[i]?.titre === 'string' ? (colonnes[i]!.titre as string) : undefined}>{c}</td>)}</tr></tfoot>}
      </table>
      {lignes.length === 0 && vide && <p className="doux" style={{ padding: 12, fontSize: 13 }}>{vide}</p>}
    </div>
  );
}

/** Cellule sur deux lignes : texte principal et précision douce. */
export const Cel2 = ({ haut, bas, gras }: { haut: ReactNode; bas: ReactNode; gras?: boolean }) =>
  <div style={{ display: 'flex', flexDirection: 'column' }}><span className={gras ? 'gras' : ''}>{haut}</span><span className="doux petit">{bas}</span></div>;

export const InfoCaps = ({ libelle, valeur }: { libelle: string; valeur: ReactNode }) =>
  <div className="info-caps"><span className="etiquette">{libelle}</span><span className="valeur">{valeur}</span></div>;

export function Bandeau({ children, icone, ton = 'accent', action }: { children: ReactNode; icone: NomIcone; ton?: 'accent' | 'attention' | 'succes'; action?: ReactNode }) {
  return <div className={`bandeau ${ton === 'accent' ? '' : ton}`}><Icone nom={icone} /><span className="texte">{children}</span>{action}</div>;
}

export const Note = ({ children, ton = 'neutre' }: { children: ReactNode; ton?: Ton }) => <div className={`note ${ton === 'neutre' ? '' : ton}`}>{children}</div>;

export function Jauge({ libelle, valeur, part, sous, couleur, grasLibelle = true }: { libelle: ReactNode; valeur: ReactNode; part: number; sous?: ReactNode; couleur?: string; grasLibelle?: boolean }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <span className={grasLibelle ? 'gras' : ''}>{libelle}</span><span className="gras">{valeur}</span>
      </div>
      <BarreProgression valeur={part} couleur={couleur} />
      {sous && <Doux>{sous}</Doux>}
    </div>
  );
}

export type EtatEtape = 'faite' | 'courante' | 'avenir';
export const Etapes = ({ etapes }: { etapes: [string, EtatEtape][] }) => (
  <div className="etapes">
    {etapes.map(([nom, etat], i) => (
      <div key={nom} className={`etape ${etat}`}><span className="rond">{etat === 'faite' ? <Icone nom="coche" taille={14} /> : i + 1}</span><span className="nom">{nom}</span></div>
    ))}
  </div>
);

export const LigneListe = ({ children, onClick, style }: { children: ReactNode; onClick?: () => void; style?: CSSProperties }) =>
  <div className={`ligne-liste ${onClick ? 'cliquable' : ''}`} onClick={onClick} style={style} tabIndex={onClick ? 0 : undefined}
    onKeyDown={onClick ? (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) { e.preventDefault(); onClick(); } } : undefined}>{children}</div>;

export const Choix = ({ children, actif, onClick, style }: { children: ReactNode; actif: boolean; onClick: () => void; style?: CSSProperties }) =>
  <button type="button" className={`choix ${actif ? 'actif' : ''}`} aria-current={actif ? 'true' : undefined} onClick={onClick} style={style}>{children}</button>;

export const Chargement = () => <div className="chargement" role="status" aria-label="Chargement"><span /></div>;

export function Erreur({ message, recharger }: { message: string; recharger?: () => void }) {
  return <Panneau><Note ton="danger">{message}</Note>{recharger && <div><Bouton onClick={recharger}>Réessayer</Bouton></div>}</Panneau>;
}

// ---------------------------------------------------------------- données

/** Charge des données du serveur ; `recharger` relance l'appel après une action. */
export function useDonnees<T>(charger: () => Promise<T>, deps: unknown[] = []) {
  const [d, setD] = useState<T | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const appel = useRef(0);
  const recharger = useCallback(async () => {
    const n = ++appel.current;
    try {
      const r = await charger();
      if (n === appel.current) { setD(r); setErreur(null); }
    } catch (e) {
      if (n === appel.current) setErreur(e instanceof Error ? e.message : String(e));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => { void recharger(); }, [recharger]);
  return { d, erreur, recharger, setD };
}

// ---------------------------------------------------------------- messages brefs

let ajouterMessage: ((texte: string, erreur: boolean) => void) | null = null;
export function MessagesFlottants() {
  const [liste, setListe] = useState<{ id: number; texte: string; erreur: boolean }[]>([]);
  useEffect(() => {
    let n = 0;
    ajouterMessage = (texte, erreur) => {
      const id = ++n;
      setListe((l) => [...l, { id, texte, erreur }]);
      setTimeout(() => setListe((l) => l.filter((m) => m.id !== id)), erreur ? 6000 : 3000);
    };
    return () => { ajouterMessage = null; };
  }, []);
  return <div className="messages-flottants" role="status">{liste.map((m) => <div key={m.id} className={`message-flottant ${m.erreur ? 'erreur' : ''}`}>{m.texte}</div>)}</div>;
}
export const signaler = (texte: string, erreur = false) => ajouterMessage?.(texte, erreur);

/** Exécute une action serveur ; affiche le refus éventuel (message du serveur). */
export async function agir<T>(action: () => Promise<T>, succes?: string): Promise<T | null> {
  try {
    const r = await action();
    if (succes) signaler(succes);
    return r;
  } catch (e) {
    signaler(e instanceof ErreurApi ? e.message : String(e), true);
    return null;
  }
}

// ---------------------------------------------------------------- fenêtres

const SELECTEUR_FOCUSABLE = 'a[href], button:not(:disabled), input:not(:disabled):not([type="hidden"]), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';
export const focusables = (racine: HTMLElement) =>
  [...racine.querySelectorAll<HTMLElement>(SELECTEUR_FOCUSABLE)].filter((e) => e.offsetParent !== null || e === document.activeElement);

/** Piège le focus clavier dans `ref` (fenêtres, tiroir) : Tab et Maj+Tab bouclent ; le focus initial va au premier élément de saisie,
 *  sinon au premier bouton, sinon au conteneur. À la fermeture, le focus revient à l'élément qui avait le focus à l'ouverture. */
export function useFocusPiege(ref: { current: HTMLElement | null }, actif = true, retour?: HTMLElement | null) {
  useEffect(() => {
    if (!actif) return;
    const el = ref.current;
    if (!el) return;
    const precedent = retour ?? (document.activeElement as HTMLElement | null);
    const t = setTimeout(() => {
      if (el.contains(document.activeElement) && document.activeElement !== el) return;
      const liste = focusables(el);
      const cible = liste.find((e) => e.matches('input, select, textarea') && !e.matches('[readonly]')) ?? liste.find((e) => !e.matches('.pied *')) ?? liste[0] ?? el;
      cible.focus({ preventScroll: true });
    }, 0);
    const clavier = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const liste = focusables(el);
      if (liste.length === 0) { e.preventDefault(); el.focus(); return; }
      const premier = liste[0]!; const dernier = liste[liste.length - 1]!;
      if (e.shiftKey && (document.activeElement === premier || document.activeElement === el)) { e.preventDefault(); dernier.focus(); }
      else if (!e.shiftKey && document.activeElement === dernier) { e.preventDefault(); premier.focus(); }
    };
    el.addEventListener('keydown', clavier);
    return () => {
      clearTimeout(t);
      el.removeEventListener('keydown', clavier);
      if (precedent && document.contains(precedent) && !el.contains(precedent)) precedent.focus({ preventScroll: true });
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref, actif]);
}

let compteurFenetres = 0;
/** Ouvre une fenêtre de saisie ; `fermer(valeur)` la ferme et résout la promesse.
 *  Accessibilité : role="dialog", aria-modal, titre relié par aria-labelledby, focus piégé puis rendu à l'élément déclencheur, Échap ferme. */
export function ouvrirFenetre<T = void>(titre: string, contenu: (fermer: (v?: T) => void) => ReactNode, largeur = 520): Promise<T | undefined> {
  return new Promise((ok) => {
    const hote = document.createElement('div');
    document.body.append(hote);
    const racine = createRoot(hote);
    const idTitre = `fenetre-titre-${++compteurFenetres}`;
    const declencheur = document.activeElement as HTMLElement | null;
    let fermee = false;
    const fermer = (v?: T) => {
      if (fermee) return;
      fermee = true;
      racine.unmount();
      hote.remove();
      if (!document.querySelector('.voile')) document.body.classList.remove('fenetre-ouverte');
      ok(v);
    };
    const Fenetre = () => {
      const ref = useRef<HTMLDivElement>(null);
      useFocusPiege(ref, true, declencheur);
      useEffect(() => {
        document.body.classList.add('fenetre-ouverte');
        // Échap ne ferme que la fenêtre du dessus (une confirmation peut s'ouvrir par-dessus un formulaire).
        const echap = (e: KeyboardEvent) => {
          if (e.key !== 'Escape' || e.defaultPrevented) return;
          const voiles = document.querySelectorAll('.voile');
          if (hote.contains(voiles[voiles.length - 1] ?? null)) { e.preventDefault(); fermer(); }
        };
        window.addEventListener('keydown', echap);
        return () => window.removeEventListener('keydown', echap);
      }, []);
      return (
        <div className="voile" onMouseDown={(e) => { if (e.target === e.currentTarget) fermer(); }}>
          <div ref={ref} className="fenetre" role="dialog" aria-modal="true" aria-labelledby={idTitre} tabIndex={-1} style={{ maxWidth: largeur }}>
            <h2 id={idTitre}>{titre}</h2>
            {contenu(fermer)}
          </div>
        </div>
      );
    };
    racine.render(<Fenetre />);
  });
}

export const PiedFenetre = ({ fermer, action, onAction, charge, annuler = 'Annuler', disabled }: { fermer: () => void; action: string; onAction: () => void; charge?: boolean; annuler?: string; disabled?: boolean }) => (
  <div className="pied"><Bouton onClick={fermer}>{annuler}</Bouton><Bouton variante="principal" onClick={onAction} charge={charge} disabled={disabled}>{action}</Bouton></div>
);

export function confirmer(titre: string, texte: ReactNode, action = 'Confirmer'): Promise<boolean> {
  return ouvrirFenetre<boolean>(titre, (fermer) => (
    <>
      <p>{texte}</p>
      <div className="pied"><Bouton onClick={() => fermer(false)}>Annuler</Bouton><Bouton variante="principal" onClick={() => fermer(true)}>{action}</Bouton></div>
    </>
  ), 440).then((v) => v === true);
}

/** Fenêtre au contenu à état propre (saisie, choix) : le composant reçoit `fermer`. */
export function ouvrirFormulaire<T = void>(titre: string, Composant: (p: { fermer: (v?: T) => void }) => ReactNode, largeur = 520) {
  return ouvrirFenetre<T>(titre, (fermer) => <Composant fermer={fermer} />, largeur);
}

// ---------------------------------------------------------------- raccourcis clavier

/** Raccourci clavier d'un écran : « ctrl+s », « ctrl+e », « ctrl+k », « ctrl+entree », « entree », « echap ». */
export function useRaccourci(combo: string, action: () => void, actif = true) {
  const ref = useRef(action);
  ref.current = action;
  useEffect(() => {
    if (!actif) return;
    const [mod, touche] = combo.includes('+') ? combo.split('+') : ['', combo];
    const nomTouche = ({ entree: 'Enter', echap: 'Escape' } as Record<string, string>)[touche!] ?? touche!;
    const ecoute = (e: KeyboardEvent) => {
      if (mod === 'ctrl' && !(e.ctrlKey || e.metaKey)) return;
      if (!mod && (e.ctrlKey || e.metaKey)) return;
      if (e.key.toLowerCase() !== nomTouche.toLowerCase()) return;
      if (document.querySelector('.voile')) return;
      if (!mod && nomTouche === 'Enter' && (e.target as HTMLElement)?.tagName === 'TEXTAREA') return;
      e.preventDefault();
      ref.current();
    };
    window.addEventListener('keydown', ecoute);
    return () => window.removeEventListener('keydown', ecoute);
  }, [combo, actif]);
}
