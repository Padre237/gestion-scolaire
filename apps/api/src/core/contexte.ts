// Contexte de la personne connectée : rôles, permissions et périmètres (conception § 8, ADR-12).
import type { PerimetreType } from '@gs/shared';

export type Portee = PerimetreType; // 'etablissement' | 'affectations' | 'famille'

export interface RoleActif {
  code: string;
  libelleFr: string;
  libelleEn: string;
  perimetre: Portee;
}

export class Contexte {
  constructor(
    readonly sessionId: string,
    readonly compteId: string,
    readonly etablissementId: string,
    readonly nomAffiche: string,
    readonly type: 'personnel' | 'famille',
    readonly personnelId: string | null,
    readonly familleId: string | null,
    readonly roles: RoleActif[],
    /** permission → portées par lesquelles elle est accordée */
    private readonly droits: Map<string, Set<Portee>>,
  ) {}

  a(permission: string): boolean {
    return this.droits.has(permission);
  }

  /** Portée la plus large qui accorde la permission, ou null. */
  portee(permission: string): Portee | null {
    const p = this.droits.get(permission);
    if (!p) return null;
    if (p.has('etablissement')) return 'etablissement';
    if (p.has('affectations')) return 'affectations';
    return 'famille';
  }

  permissions(): string[] {
    return [...this.droits.keys()].sort();
  }
}
