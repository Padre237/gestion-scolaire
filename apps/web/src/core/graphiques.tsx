// Graphiques du tableau de bord personnalisable (D-41) : barres, courbe, anneau et tableau, en SVG et HTML écrits à la main.
// Une série seule prend le bleu savoir (charte) ; l'anneau prend quatre teintes validées (jour et nuit) puis « Autres » en gris.
// Survol : info-bulle sur chaque barre, point ou part ; la forme « Tableau » sert de vue tabulaire.
import { useCallback, useRef, useState, type ReactNode } from 'react';
import { decimal, montant } from './format.ts';

export interface Point { cle: string; libelle: string; valeur: number | null }

/** Valeur dans l'unité de l'indicateur : « 125 000 FCFA », « 53 % », « 12,45 / 20 », « 28 élèves ». */
export function enUnite(v: number | null, unite: string): string {
  if (v === null) return '–';
  if (unite === 'FCFA') return `${montant(v)} FCFA`;
  if (unite === '%') return `${montant(v)} %`;
  if (unite === '/20') return `${decimal(v, 2)} / 20`;
  return `${montant(v)} ${unite}`;
}
/** Graduation courte de l'axe : 1,2 M ; 350 k ; 12. */
const court = (v: number) => (v >= 1_000_000 ? `${decimal(Math.round(v / 100_000) / 10)} M` : v >= 10_000 ? `${montant(Math.round(v / 1000))} k` : montant(Math.round(v)));
/** Pas « rond » pour trois lignes de repère. */
function echelle(max: number) {
  if (max <= 0) return [0, 1];
  const brut = max / 3;
  const p = 10 ** Math.floor(Math.log10(brut));
  const pas = [1, 2, 2.5, 5, 10].map((k) => k * p).find((k) => k >= brut)!;
  return [pas, pas * 3];
}

function Bulle({ x, y, children }: { x: number; y: number; children: ReactNode }) {
  return <div className="graphe-bulle" role="status" style={{ left: x, top: y }}>{children}</div>;
}

export const vide = (points: Point[]) => points.length === 0 || points.every((p) => !p.valeur);
export const Vide = ({ texte = 'Aucune donnée pour ces filtres.' }: { texte?: string }) => <div className="graphe-vide doux">{texte}</div>;

/** Barres : verticales jusqu'à 14 points, horizontales au-delà (libellés lisibles, défilement dans la carte). */
export function Barres({ points, unite }: { points: Point[]; unite: string }) {
  const [survol, setSurvol] = useState<number | null>(null);
  if (vide(points)) return <Vide />;
  // Un taux se lit sur 100, une moyenne sur 20 : la barre pleine garde son sens.
  const max = unite === '%' ? Math.max(100, ...points.map((p) => p.valeur ?? 0)) : unite === '/20' ? 20 : Math.max(...points.map((p) => p.valeur ?? 0));
  if (points.length > 14) {
    return (
      <div className="barres-h" role="list">
        {points.map((p) => (
          <div key={p.cle} className="barre-h" role="listitem" title={`${p.libelle} · ${enUnite(p.valeur, unite)}`}>
            <span className="barre-h-libelle">{p.libelle}</span>
            <span className="barre-h-piste"><span style={{ width: `${max ? ((p.valeur ?? 0) / max) * 100 : 0}%` }} /></span>
            <span className="barre-h-valeur">{enUnite(p.valeur, unite).replace(` ${unite}`, unite === 'FCFA' || unite === 'élèves' || unite === 'absences' ? '' : ` ${unite}`)}</span>
          </div>
        ))}
      </div>
    );
  }
  const [pas, haut] = echelle(max);
  return (
    <div className="graphe" onMouseLeave={() => setSurvol(null)}>
      <div className="barres-v">
        <div className="graphe-axe" aria-hidden="true">{[3, 2, 1, 0].map((k) => <span key={k}>{court(pas * k)}</span>)}</div>
        <div className="barres-v-zone">
          {[1, 2, 3].map((k) => <span key={k} className="graphe-repere" style={{ bottom: `${(k * pas / haut) * 100}%` }} />)}
          {points.map((p, i) => (
            <div key={p.cle} className="barre-v" onMouseEnter={() => setSurvol(i)} onFocus={() => setSurvol(i)} onBlur={() => setSurvol(null)} tabIndex={0}
              aria-label={`${p.libelle} : ${enUnite(p.valeur, unite)}`}>
              <span className={`barre-v-trait${survol === i ? ' actif' : ''}`} style={{ height: `${haut ? ((p.valeur ?? 0) / haut) * 100 : 0}%` }} />
              <span className="barre-v-libelle">{p.libelle}</span>
              {survol === i && <Bulle x={0} y={-6}><b>{p.libelle}</b> · {enUnite(p.valeur, unite)}</Bulle>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Taille réelle d'un conteneur (le dessin se fait en pixels : textes lisibles à toute largeur, graphique qui remplit sa carte). */
function useTaille() {
  const [t, setT] = useState({ l: 0, h: 0 });
  const obs = useRef<ResizeObserver | null>(null);
  const ref = useCallback((el: HTMLDivElement | null) => {
    obs.current?.disconnect();
    if (!el) return;
    obs.current = new ResizeObserver(([e]) => setT({ l: Math.round(e!.contentRect.width), h: Math.round(e!.contentRect.height) }));
    obs.current.observe(el);
  }, []);
  return [ref, t] as const;
}

/** Courbe : trait de 2 px, aire légère, repère et info-bulle au survol (évolution dans le temps). Elle occupe toute la hauteur de sa carte. */
export function Courbe({ points, unite }: { points: Point[]; unite: string }) {
  const [survol, setSurvol] = useState<number | null>(null);
  const [ref, t] = useTaille();
  if (vide(points)) return <Vide />;
  const L = Math.max(t.l, 200), H = Math.max(t.h, 160), g = 44, b = 22;
  const [pas, haut] = echelle(Math.max(...points.map((p) => p.valeur ?? 0)));
  const x = (i: number) => g + (points.length === 1 ? (L - g) / 2 : (i / (points.length - 1)) * (L - g - 8));
  const y = (v: number | null) => 8 + (1 - (v ?? 0) / haut) * (H - b - 8);
  const ligne = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.valeur).toFixed(1)}`).join(' ');
  const aire = `${ligne} L${x(points.length - 1).toFixed(1)},${H - b} L${x(0).toFixed(1)},${H - b} Z`;
  const tous = Math.ceil(points.length / Math.max(2, Math.floor((L - g) / 64)));
  const s = survol === null ? null : points[survol]!;
  return (
    <div className="graphe graphe-plein" ref={ref} onMouseLeave={() => setSurvol(null)}>
      {t.l > 0 && <svg viewBox={`0 0 ${L} ${H}`} width={L} height={H} className="courbe" role="img" aria-label={`Courbe : ${points.map((p) => `${p.libelle} ${enUnite(p.valeur, unite)}`).join(', ')}`}
        onMouseMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const px = ((e.clientX - r.left) / r.width) * L;
          setSurvol(Math.max(0, Math.min(points.length - 1, Math.round(((px - g) / (L - g - 8)) * (points.length - 1)))));
        }}>
        {[0, 1, 2, 3].map((k) => (
          <g key={k}>
            <line x1={g} x2={L} y1={y(pas * k)} y2={y(pas * k)} className="graphe-repere-svg" />
            <text x={g - 6} y={y(pas * k) + 4} textAnchor="end" className="graphe-texte">{court(pas * k)}</text>
          </g>
        ))}
        <path d={aire} className="courbe-aire" />
        <path d={ligne} className="courbe-trait" />
        {points.map((p, i) => ((i % tous === 0 && points.length - 1 - i >= tous * 0.6) || i === points.length - 1) && (
          <text key={p.cle} x={x(i)} y={H - 4} textAnchor="middle" className="graphe-texte">{p.libelle}</text>
        ))}
        {s && survol !== null && <>
          <line x1={x(survol)} x2={x(survol)} y1={8} y2={H - b} className="courbe-viseur" />
          <circle cx={x(survol)} cy={y(s.valeur)} r={5} className="courbe-point" />
        </>}
      </svg>}
      {s && survol !== null && <Bulle x={x(survol)} y={y(s.valeur) - 8}><b>{s.libelle}</b> · {enUnite(s.valeur, unite)}</Bulle>}
    </div>
  );
}

/** Anneau : quatre parts au plus, puis « Autres » ; la légende porte la valeur et la part (l'identité ne repose pas sur la couleur seule). */
export function Anneau({ points, unite }: { points: Point[]; unite: string }) {
  const [survol, setSurvol] = useState<number | null>(null);
  if (vide(points)) return <Vide />;
  const tries = [...points].filter((p) => (p.valeur ?? 0) > 0);
  const parts = tries.length > 5 ? [...[...tries].sort((a, b) => (b.valeur ?? 0) - (a.valeur ?? 0)).slice(0, 4),
    { cle: 'autres', libelle: 'Autres', valeur: [...tries].sort((a, b) => (b.valeur ?? 0) - (a.valeur ?? 0)).slice(4).reduce((t, p) => t + (p.valeur ?? 0), 0) }] : tries;
  const total = parts.reduce((t, p) => t + (p.valeur ?? 0), 0);
  const R = 70, r = 46, c = 80;
  let angle = -Math.PI / 2;
  const arcs = parts.map((p, i) => {
    const a = ((p.valeur ?? 0) / total) * Math.PI * 2;
    const a0 = angle, a1 = angle + a;
    angle = a1;
    const pt = (rr: number, t: number) => `${(c + rr * Math.cos(t)).toFixed(2)},${(c + rr * Math.sin(t)).toFixed(2)}`;
    const grand = a > Math.PI ? 1 : 0;
    const d = parts.length === 1
      ? `M${pt(R, 0)} A${R},${R} 0 1 1 ${pt(R, Math.PI)} A${R},${R} 0 1 1 ${pt(R, 0)} M${pt(r, 0)} A${r},${r} 0 1 0 ${pt(r, Math.PI)} A${r},${r} 0 1 0 ${pt(r, 0)} Z`
      : `M${pt(R, a0)} A${R},${R} 0 ${grand} 1 ${pt(R, a1)} L${pt(r, a1)} A${r},${r} 0 ${grand} 0 ${pt(r, a0)} Z`;
    return { p, d, classe: p.cle === 'autres' ? 'part-autres' : `part-${i + 1}` };
  });
  const s = survol === null ? null : parts[survol]!;
  return (
    <div className="anneau">
      <svg viewBox="0 0 160 160" className="anneau-svg" role="img" aria-label={parts.map((p) => `${p.libelle} ${enUnite(p.valeur, unite)}`).join(', ')}>
        {arcs.map((x, i) => <path key={x.p.cle} d={x.d} className={`${x.classe}${survol === i ? ' actif' : ''}`} fillRule="evenodd" onMouseEnter={() => setSurvol(i)} onMouseLeave={() => setSurvol(null)} />)}
        <text x={c} y={c - 2} textAnchor="middle" className="anneau-total">{s ? `${Math.round(((s.valeur ?? 0) / total) * 100)} %` : unite === '%' || unite === '/20' ? '' : court(total)}</text>
        <text x={c} y={c + 16} textAnchor="middle" className="graphe-texte">{s ? s.libelle : unite === '%' || unite === '/20' ? '' : unite === 'FCFA' ? 'FCFA' : 'au total'}</text>
      </svg>
      <ul className="legende">
        {arcs.map((x, i) => (
          <li key={x.p.cle} onMouseEnter={() => setSurvol(i)} onMouseLeave={() => setSurvol(null)}>
            <span className={`legende-pastille ${x.classe}`} aria-hidden="true" />
            <span className="legende-libelle">{x.p.libelle}</span>
            <span className="legende-valeur">{enUnite(x.p.valeur, unite)}</span>
            <span className="doux petit">{Math.round(((x.p.valeur ?? 0) / total) * 100)} %</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Tableau : la vue tabulaire de la série, avec le total quand il a un sens. */
export function TableauPoints({ points, unite, entete }: { points: Point[]; unite: string; entete: string }) {
  if (vide(points)) return <Vide />;
  const additif = unite !== '%' && unite !== '/20';
  return (
    <div className="tableau-points">
      <table>
        <thead><tr><th>{entete}</th><th className="droite">{unite === '/20' ? 'Moyenne' : unite === '%' ? 'Taux' : unite === 'FCFA' ? 'Montant' : 'Nombre'}</th></tr></thead>
        <tbody>{points.map((p) => <tr key={p.cle}><td>{p.libelle}</td><td className="droite">{enUnite(p.valeur, unite)}</td></tr>)}</tbody>
        {additif && <tfoot><tr><td>Total</td><td className="droite">{enUnite(points.reduce((t, p) => t + (p.valeur ?? 0), 0), unite)}</td></tr></tfoot>}
      </table>
    </div>
  );
}
