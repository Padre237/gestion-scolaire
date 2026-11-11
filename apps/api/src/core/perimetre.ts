// Périmètre des instituteurs (RG-34, ADR-11) : il se lit dans les affectations
// du module pédagogie, qui fournit la fonction au démarrage. Le socle ne lit pas
// les tables d'un module (ADR-01) ; il passe par ce fournisseur.
import type { Bd } from './bd.ts';
import type { Contexte } from './contexte.ts';

export interface PerimetreEnseignant {
  /** Classes dont il est principal ; `exceptions` : matières de la classe confiées à d'autres (RG-34). */
  classesPrincipal: { id: string; nom: string; exceptions?: { fr: string; en: string }[] }[];
  matieres: { classeId: string; classeNom: string; matiereId: string; matiereLibelle: string; matiereAbrege: string }[];
}

type Fournisseur = (bd: Bd, etablissementId: string, personnelId: string) => Promise<PerimetreEnseignant>;
let fournisseur: Fournisseur | null = null;

export function enregistrerFournisseurPerimetre(f: Fournisseur) {
  fournisseur = f;
}

const cache = new WeakMap<Contexte, Promise<PerimetreEnseignant>>();

export function perimetreDePersonnel(bd: Bd, etablissementId: string, personnelId: string): Promise<PerimetreEnseignant> {
  return fournisseur ? fournisseur(bd, etablissementId, personnelId) : Promise.resolve({ classesPrincipal: [], matieres: [] });
}

export function perimetreEnseignant(bd: Bd, ctx: Contexte): Promise<PerimetreEnseignant> {
  if (!ctx.personnelId || !fournisseur) return Promise.resolve({ classesPrincipal: [], matieres: [] });
  let p = cache.get(ctx);
  if (!p) {
    p = fournisseur(bd, ctx.etablissementId, ctx.personnelId);
    cache.set(ctx, p);
  }
  return p;
}

/** Classes accessibles pour une permission : 'toutes', ou la liste des classes du périmètre. */
export async function classesAccessibles(bd: Bd, ctx: Contexte, permission: string): Promise<'toutes' | string[]> {
  const portee = ctx.portee(permission);
  if (portee === 'etablissement') return 'toutes';
  if (portee === 'affectations') {
    const p = await perimetreEnseignant(bd, ctx);
    return [...new Set([...p.classesPrincipal.map((c) => c.id), ...p.matieres.map((m) => m.classeId)])];
  }
  return [];
}

/** Texte du périmètre affiché sous le nom, dans l'en-tête : « Instituteur principal · CM2 A ». */
export async function libelleRoles(bd: Bd, ctx: Contexte): Promise<string> {
  const p = ctx.roles.some((r) => r.perimetre === 'affectations') ? await perimetreEnseignant(bd, ctx) : null;
  return ctx.roles.map((r) => {
    if (r.code === 'instituteur_principal' && p?.classesPrincipal.length) {
      return `${r.libelleFr} · ${p.classesPrincipal.map((c) => c.nom).join(', ')}`;
    }
    if (r.code === 'instituteur_matiere' && p?.matieres.length) {
      return `${r.libelleFr} · ${[...new Set(p.matieres.map((m) => m.matiereAbrege))].join(', ')}`;
    }
    return r.libelleFr;
  }).join(', ');
}
