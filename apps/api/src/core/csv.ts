// Export CSV (séparateur point-virgule, lisible par Excel en français ; BOM UTF-8).
export function versCsv(lignes: Record<string, unknown>[]): string {
  if (!lignes.length) return '﻿';
  const colonnes = Object.keys(lignes[0]!);
  const cellule = (v: unknown) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[";\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
  };
  return '﻿' + [colonnes.join(';'), ...lignes.map((l) => colonnes.map((c) => cellule(l[c])).join(';'))].join('\r\n') + '\r\n';
}
