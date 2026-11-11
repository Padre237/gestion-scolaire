"""Plan d'une maquette : texte visible, icônes, mise en page et couleurs ramenées aux jetons de la charte.

Sert à construire un écran sans relire tout le HTML, et au contrôle « texte » (liste des libellés de structure).
Usage : python3 -I tools/controle/plan.py <maquette .dc.html> [--tout] [--textes]
  --tout    garde la barre latérale, l'en-tête et les onglets du module ;
  --textes  n'imprime que les libellés, un par ligne (contrôle de fidélité du texte).
"""
import glob, html, os, re, sys
from html.parser import HTMLParser

ICI = os.path.dirname(os.path.abspath(__file__))
NOMS = ['logo', 'tableauDeBord', 'eleves', 'fraisCaisse', 'notes', 'emploiDuTemps', 'vieScolaire', 'messages', 'personnel',
        'pilotage', 'assistant', 'parametres', 'appParent', 'recherche', 'lune', 'envoyer', 'coche', 'chevron', 'lire',
        'horsLigne', 'bouclier', 'exporter', 'recalculer', 'imprimer', 'fermer', 'ajouter', 'sortie', 'alerte', 'banque',
        'colonnes', 'photo', 'ajouterEleve', 'famille', 'wifi', 'soleil', 'journal']

COULEURS = {
    '#0b1f4b': 'texte', '#4b5b7a': 'doux', '#1d4ed8': 'accent', '#1e40af': 'accent', '#a8360a': 'attention', '#b91c1c': 'danger',
    '#15703a': 'succes', '#facc15': 'eclat', '#ffffff': 'panneau', '#fff': 'panneau', '#f6f8fc': 'fond', '#f1f4fa': 'champ',
    '#101318': 'fond', '#171b23': 'panneau', '#1f242e': 'champ', '#e8ecf3': 'texte', '#a9b2c2': 'doux', '#a3c1ff': 'accent',
    '#0e1320': 'surAccent', '#fdba74': 'attention', '#fca5a5': 'danger', '#6ee7a0': 'succes', 'transparent': 'transparent',
}
RGBA = {
    (11, 31, 75): {'0.1': 'bord', '0.22': 'bordFort', '0.07': 'neutreFond', '0.06': 'neutreFond', '0.12': 'neutreFond'},
    (255, 255, 255): {'0.1': 'bord', '0.22': 'bordFort', '0.05': 'trame'},
    (232, 236, 243): {'0.07': 'neutreFond'},
    (29, 78, 216): {'0.1': 'accentFond', '0.3': 'accentBord', '0.38': 'accentBarre'},
    (163, 193, 255): {'0.14': 'accentFond', '0.3': 'accentBord', '0.38': 'accentBarre'},
    (168, 54, 10): {'0.1': 'attentionFond', '0.35': 'attentionBord'},
    (185, 28, 28): {'0.1': 'dangerFond'},
    (21, 112, 58): {'0.1': 'succesFond'},
    (253, 186, 116): {'0.14': 'attentionFond'},
    (252, 165, 165): {'0.14': 'dangerFond'},
    (110, 231, 160): {'0.14': 'succesFond'},
}
VIDES = {'input', 'img', 'br', 'hr', 'meta', 'link', 'col', 'source', 'i'}


def jeton(c):
    c = c.strip().lower()
    if c in COULEURS:
        return COULEURS[c]
    m = re.match(r'rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)', c)
    if m:
        cle = tuple(int(m.group(k)) for k in (1, 2, 3))
        a = str(float(m.group(4))).rstrip('0').rstrip('.') if '.' in m.group(4) else m.group(4)
        a = a if a.startswith('0') or a == '1' else a
        return RGBA.get(cle, {}).get(a, c)
    return c


def jeton_bord(b):
    m = re.search(r'(#[0-9A-Fa-f]{3,6}|rgba\([^)]*\)|transparent)', b)
    epais = re.search(r'(\d+)px', b)
    style = 'dashed' if 'dashed' in b else ''
    return f"{epais.group(1) if epais else ''}{style}:{jeton(m.group(1)) if m else b}"


def icones():
    vus = []
    for f in sorted(glob.glob(os.path.join(os.path.dirname(MAQUETTE), '*.html'))):
        s = open(f, encoding='utf-8').read()
        for m in re.finditer(r'<svg([^>]*)>(.*?)</svg>', s, re.S):
            inner = re.sub(r'\s+', ' ', m.group(2)).strip()
            if inner not in vus:
                vus.append(inner)
    return dict(zip(vus, NOMS))


class Noeud:
    def __init__(self, tag, attrs, parent):
        self.tag, self.attrs, self.parent, self.enfants = tag, dict(attrs), parent, []


class Analyse(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.racine = Noeud('racine', [], None)
        self.courant = self.racine
        self.ignore = 0

    def handle_starttag(self, tag, attrs):
        if tag in ('script', 'style', 'helmet', 'head', 'title'):
            self.ignore += 1
            return
        if self.ignore:
            return
        n = Noeud(tag, attrs, self.courant)
        self.courant.enfants.append(n)
        if tag not in VIDES:
            self.courant = n

    def handle_endtag(self, tag):
        if tag in ('script', 'style', 'helmet', 'head', 'title'):
            self.ignore -= 1
            return
        if self.ignore or tag in VIDES:
            return
        n = self.courant
        while n is not None and n.tag != tag:
            n = n.parent
        if n is not None and n.parent is not None:
            self.courant = n.parent

    def handle_data(self, data):
        if self.ignore:
            return
        t = re.sub(r'\s+', ' ', data)
        if t.strip():
            self.courant.enfants.append(t.strip())


def style(n):
    st = {}
    for decl in n.attrs.get('style', '').split(';'):
        if ':' in decl:
            k, v = decl.split(':', 1)
            st[k.strip().lower()] = v.strip()
    return st


def indices(n):
    st = style(n)
    h = []
    d = st.get('display', '')
    if 'flex' in d:
        h.append('col' if st.get('flex-direction', 'row').startswith('column') else 'row')
        if st.get('flex-wrap') == 'wrap':
            h.append('wrap')
    if d == 'grid':
        h.append(f"grid[{st.get('grid-template-columns', '')}]")
    if 'gap' in st and ('flex' in d or d == 'grid'):
        h.append('gap' + st['gap'].replace('px', ''))
    for k, court in (('justify-content', 'jc'), ('align-items', 'ai')):
        if st.get(k) and st[k] not in ('flex-start', 'stretch', 'normal') and ('flex' in d or d == 'grid'):
            h.append(f'{court}:{st[k]}')
    for k in ('flex', 'width', 'max-width', 'min-width', 'height', 'min-height', 'grid-column'):
        if k in st and st[k] not in ('0', 'none'):
            h.append(f'{k}:{st[k]}')
    if 'font-size' in st:
        h.append('fs' + st['font-size'].replace('px', ''))
    if st.get('font-weight') in ('500', '600', '700'):
        h.append('w' + st['font-weight'])
    if 'color' in st:
        h.append('c:' + jeton(st['color']))
    fond = st.get('background') or st.get('background-color')
    if fond and 'gradient' not in fond and jeton(fond) != 'transparent':
        h.append('bg:' + jeton(fond))
    if 'border' in st and st['border'] not in ('0', 'none'):
        h.append('bd' + jeton_bord(st['border']))
    for cote in ('top', 'bottom', 'left', 'right'):
        v = st.get('border-' + cote)
        if v and v not in ('0', 'none'):
            h.append(f'bd-{cote[0]}' + jeton_bord(v))
    if 'padding' in st:
        h.append('p:' + st['padding'].replace('px', ''))
    if st.get('text-align') in ('right', 'center'):
        h.append('ta:' + st['text-align'])
    if st.get('text-transform') == 'uppercase' or 'letter-spacing:0.08em' in n.attrs.get('style', '').replace(' ', ''):
        h.append('CAPS')
    if 'line-through' in st.get('text-decoration', ''):
        h.append('barré')
    if 'position' in st and st['position'] == 'absolute':
        h.append('abs')
    if st.get('border-radius') in ('50%', '999px'):
        h.append('rond')
    for k in ('href', 'aria-label', 'placeholder', 'value', 'type', 'title', 'aria-current', 'role', 'for'):
        if k in n.attrs and n.attrs[k] not in (None, ''):
            v = n.attrs[k]
            if k == 'type' and v in ('button',):
                continue
            h.append(f'{k}="{v}"')
    if 'checked' in n.attrs:
        h.append('coché')
    if 'selected' in n.attrs:
        h.append('choisi')
    if 'disabled' in n.attrs:
        h.append('inactif')
    if n.tag == 'i' and 'data-icone' in n.attrs:
        return [f"[{n.attrs['data-icone']}]"]
    return h


def texte_plat(n):
    if isinstance(n, str):
        return n
    if n.tag == 'i' and 'data-icone' in n.attrs:
        return f"[{n.attrs['data-icone']}]"
    if n.tag == 'input':
        v = n.attrs.get('value') or n.attrs.get('placeholder') or ''
        return f"⟦{n.attrs.get('type', 'text')}:{v}{' coché' if 'checked' in n.attrs else ''}⟧"
    if n.tag == 'select':
        return '⟦liste:' + ' / '.join(texte_plat(o) for o in n.enfants if not isinstance(o, str)) + '⟧'
    morceaux = [texte_plat(e) for e in n.enfants]
    t = ' '.join(m for m in morceaux if m)
    st = style(n)
    fond = st.get('background') or st.get('background-color')
    marque = []
    if fond and 'gradient' not in fond and jeton(fond) not in ('transparent', 'panneau'):
        marque.append(jeton(fond))
    if st.get('font-weight') in ('600', '700') and n.tag in ('span', 'strong', 'b', 'div', 'a'):
        marque.append('w' + st['font-weight'])
    if 'color' in st and jeton(st['color']) not in ('texte',):
        marque.append('c:' + jeton(st['color']))
    if 'line-through' in st.get('text-decoration', ''):
        marque.append('barré')
    if n.tag == 'a' and n.attrs.get('href'):
        marque.append('→' + n.attrs['href'].replace('.dc.html', ''))
    if n.tag in ('button',) or (n.tag == 'a' and 'height:44px' in n.attrs.get('style', '').replace(' ', '')):
        marque.insert(0, 'bouton')
    if marque and t:
        return f'{t}⟨{",".join(marque)}⟩'
    return t


def est_ligne(n):
    """Élément dont le contenu s'imprime sur une ligne (texte en ligne, cellule de tableau)."""
    if isinstance(n, str):
        return True
    if n.tag in ('td', 'th', 'button', 'option', 'label', 'kbd'):
        return True
    return all(isinstance(e, str) or (e.tag in ('span', 'strong', 'b', 'em', 'small', 'i', 'kbd', 'a') and est_ligne(e)) for e in n.enfants)


SORTIE = []


def imprimer(n, prof, tout):
    if isinstance(n, str):
        SORTIE.append('  ' * prof + f'"{n}"')
        return
    if not tout and (n.tag == 'nav' or n.tag == 'header'):
        return
    if n.tag == 'svg':
        return
    if n.tag == 'tr':
        cellules = [texte_plat(c) for c in n.enfants if not isinstance(c, str)]
        h = indices(n)
        SORTIE.append('  ' * prof + 'tr' + (f'[{" ".join(h)}]' if h else '') + ': ' + ' | '.join(cellules))
        return
    if n.tag == 'select':
        opts = [texte_plat(o) + (' (choisi)' if not isinstance(o, str) and 'selected' in o.attrs else '') for o in n.enfants if not isinstance(o, str)]
        h = indices(n)
        SORTIE.append('  ' * prof + f'select[{" ".join(h)}]: ' + ' / '.join(opts))
        return
    h = indices(n)
    if n.tag == 'i':
        SORTIE.append('  ' * prof + ' '.join(h))
        return
    if est_ligne(n) and n.enfants:
        SORTIE.append('  ' * prof + f'{n.tag}' + (f'[{" ".join(h)}]' if h else '') + ': ' + texte_plat_contenu(n))
        return
    enfants = [e for e in n.enfants]
    if not h and len(enfants) == 1 and n.tag in ('div', 'span', 'section', 'x-dc', 'body', 'html', 'racine'):
        imprimer(enfants[0], prof, tout)
        return
    if not h and not enfants:
        return
    SORTIE.append('  ' * prof + n.tag + (f'[{" ".join(h)}]' if h else ''))
    for e in enfants:
        imprimer(e, prof + 1, tout)


def texte_plat_contenu(n):
    return ' '.join(x for x in (texte_plat(e) for e in n.enfants) if x)


def textes(n, acc, tout):
    if isinstance(n, str):
        acc.append(n)
        return
    if not tout and n.tag in ('nav', 'header'):
        return
    for k in ('placeholder', 'aria-label'):
        if n.attrs.get(k):
            acc.append(n.attrs[k])
    for e in n.enfants:
        textes(e, acc, tout)


if __name__ == '__main__':
    MAQUETTE = sys.argv[1]
    tout = '--tout' in sys.argv
    s = open(MAQUETTE, encoding='utf-8').read()
    noms = icones()
    s = re.sub(r'<svg([^>]*)>(.*?)</svg>', lambda m: f'<i data-icone="{noms.get(re.sub(chr(92) + "s+", " ", m.group(2)).strip(), "?")}"></i>', s, flags=re.S)
    a = Analyse()
    a.feed(s)
    if '--textes' in sys.argv:
        acc = []
        textes(a.racine, acc, tout)
        print('\n'.join(acc))
    else:
        imprimer(a.racine, 0, tout)
        print('\n'.join(SORTIE))
