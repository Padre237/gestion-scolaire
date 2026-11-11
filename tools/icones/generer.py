"""Reprend les icônes SVG des maquettes pour l'application web (décision D-05).

Usage : python3 -I tools/icones/generer.py <dossier des maquettes html> apps/web/src/core/icones-traces.ts
Chaque icône garde son tracé exact (viewBox 24 × 24, trait de 1,8, extrémités arrondies) ; l'application les dessine
dans un <svg> commun (composant Icone de apps/web/src/core/ui.tsx).
"""
import glob, json, re, sys

NOMS = ['logo', 'tableauDeBord', 'eleves', 'fraisCaisse', 'notes', 'emploiDuTemps', 'vieScolaire', 'messages', 'personnel',
        'pilotage', 'assistant', 'parametres', 'appParent', 'recherche', 'lune', 'envoyer', 'coche', 'chevron', 'lire',
        'horsLigne', 'bouclier', 'exporter', 'recalculer', 'imprimer', 'fermer', 'ajouter', 'sortie', 'alerte', 'banque',
        'colonnes', 'photo', 'ajouterEleve', 'famille', 'wifi', 'soleil', 'journal']

def main(dossier, sortie):
    vus = []
    for fichier in sorted(glob.glob(dossier + '/*.html')):
        s = open(fichier, encoding='utf-8').read()
        for m in re.finditer(r'<svg([^>]*)>(.*?)</svg>', s, re.S):
            inner = re.sub(r'\s+', ' ', m.group(2)).strip()
            if inner not in vus: vus.append(inner)
    assert len(vus) == len(NOMS), f'{len(vus)} icônes trouvées, {len(NOMS)} noms'
    lignes = ['// Icônes des maquettes, tracé exact (viewBox 24 × 24, trait de 1,8).', 'export const ICONES = {']
    lignes += [f'  {nom}: {json.dumps(inner, ensure_ascii=False)},' for nom, inner in zip(NOMS, vus)]
    lignes += ['} as const;', 'export type NomIcone = keyof typeof ICONES;']
    open(sortie, 'w', encoding='utf-8').write('\n'.join(lignes) + '\n')
    print(f'{len(NOMS)} icônes écrites dans {sortie}')

if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
