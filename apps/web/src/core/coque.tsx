// Coque des écrans de bureau : barre latérale, en-tête, onglets du module (éléments communs des maquettes).
// Modules, onglets et liens ne s'affichent que si la personne a la permission (E-05) ; le serveur reste seul juge (403).
// Selon la largeur : barre latérale complète (≥ 1200 px), rail d'icônes (900–1199 px), barre haute compacte et tiroir (< 900 px).
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useMoi, useSession, type Moi } from './session.tsx';
import { Avatar, Icone, Pastille, useFocusPiege } from './ui.tsx';
import type { NomIcone } from './icones-traces.ts';

export type Module = 'tableau' | 'eleves' | 'frais' | 'notes' | 'edt' | 'vie' | 'messages' | 'personnel' | 'pilotage' | 'assistant' | 'parametres';

interface Onglet { libelle: string; route: string; permissions: string[] }
export const MODULES: { code: Module; libelle: string; icone: NomIcone; onglets: Onglet[] }[] = [
  { code: 'tableau', libelle: 'Tableau de bord', icone: 'tableauDeBord', onglets: [{ libelle: 'Tableau de bord', route: '/tableau-de-bord', permissions: [] }] },
  { code: 'eleves', libelle: 'Élèves', icone: 'eleves', onglets: [
    { libelle: 'Liste', route: '/scolarite/eleves', permissions: ['scolarite.eleve.consulter'] },
    { libelle: 'Inscription', route: '/scolarite/inscription', permissions: ['scolarite.inscription.creer'] },
    { libelle: 'Classes', route: '/scolarite/classes', permissions: ['scolarite.eleve.consulter'] },
  ] },
  { code: 'frais', libelle: 'Frais et caisse', icone: 'fraisCaisse', onglets: [
    { libelle: 'Caisse du jour', route: '/finances/caisse', permissions: ['caisse.session.gerer', 'caisse.consulter'] },
    { libelle: 'Impayés', route: '/finances/impayes', permissions: ['finances.impaye.consulter'] },
    { libelle: 'Dépenses', route: '/finances/depenses', permissions: ['caisse.sortie.demander', 'caisse.sortie.valider', 'caisse.sortie.decaisser', 'caisse.consulter'] },
    { libelle: 'Comptes', route: '/finances/comptes', permissions: ['finances.comptes.consulter'] },
    { libelle: 'Relevé bancaire', route: '/finances/releve', permissions: ['finances.releve.gerer'] },
    { libelle: 'Grille des frais', route: '/finances/grille', permissions: ['finances.grille.consulter'] },
    { libelle: 'À valider', route: '/finances/validations', permissions: ['finances.reduction.valider', 'scolarite.derogation.valider', 'caisse.sortie.valider',
      'finances.annulation.valider', 'finances.reduction.demander', 'scolarite.derogation.demander', 'caisse.sortie.demander'] },
  ] },
  { code: 'notes', libelle: 'Notes et bulletins', icone: 'notes', onglets: [
    { libelle: 'Matières', route: '/pedagogie/matieres', permissions: ['pedagogie.programme.consulter'] },
    { libelle: 'Saisie des notes', route: '/pedagogie/notes', permissions: ['pedagogie.note.saisir', 'pedagogie.note.lire', 'pedagogie.periode.ouvrir'] },
    { libelle: 'Fusion des notes', route: '/pedagogie/fusion', permissions: ['pedagogie.fusion.transmettre', 'pedagogie.fusion.valider'] },
    { libelle: 'Bulletins', route: '/pedagogie/bulletins', permissions: ['pedagogie.bulletin.calculer', 'pedagogie.bulletin.publier', 'pedagogie.bulletin.apprecier', 'pedagogie.bulletin.lever_blocage'] },
    { libelle: 'Conseil de classe', route: '/pedagogie/conseil', permissions: ['pedagogie.conseil.gerer', 'pedagogie.conseil.decider'] },
  ] },
  { code: 'edt', libelle: 'Emploi du temps', icone: 'emploiDuTemps', onglets: [{ libelle: 'Emploi du temps', route: '/emploi-du-temps', permissions: ['pedagogie.edt.consulter'] }] },
  { code: 'vie', libelle: 'Vie scolaire', icone: 'vieScolaire', onglets: [
    { libelle: 'Appel', route: '/vie-scolaire/appel', permissions: ['vie_scolaire.appel.faire', 'vie_scolaire.dossier.consulter'] },
    { libelle: 'Absences et discipline', route: '/vie-scolaire/discipline', permissions: ['vie_scolaire.dossier.consulter'] },
  ] },
  { code: 'messages', libelle: 'Messages', icone: 'messages', onglets: [
    { libelle: 'Annonces', route: '/messages/annonces', permissions: ['communication.annonce.publier'] },
    { libelle: 'SMS', route: '/messages/sms', permissions: ['communication.sms.envoyer', 'communication.sms.parametrer'] },
    { libelle: 'Messagerie des parents', route: '/messages/messagerie', permissions: ['communication.messagerie.repondre'] },
  ] },
  { code: 'personnel', libelle: 'Personnel', icone: 'personnel', onglets: [{ libelle: 'Personnel', route: '/personnel', permissions: ['personnel.fiche.consulter', 'personnel.fiche.gerer'] }] },
  { code: 'pilotage', libelle: 'Pilotage', icone: 'pilotage', onglets: [{ libelle: 'Pilotage', route: '/pilotage/statistiques', permissions: ['pilotage.statistiques.consulter'] }] },
  { code: 'assistant', libelle: 'Assistant', icone: 'assistant', onglets: [{ libelle: 'Assistant', route: '/assistant', permissions: ['assistant.question.poser'] }] },
  { code: 'parametres', libelle: 'Paramètres', icone: 'parametres', onglets: [
    { libelle: 'Établissement', route: '/parametres/etablissement', permissions: ['structure.consulter'] },
    { libelle: 'Utilisateurs et rôles', route: '/parametres/utilisateurs', permissions: ['core.compte.consulter'] },
    { libelle: 'Journal d\'audit', route: '/parametres/audit', permissions: ['core.audit.consulter'] },
    { libelle: 'Données', route: '/parametres/donnees', permissions: ['core.sauvegarde.lancer', 'scolarite.import.executer'] },
    { libelle: 'Clôture d\'année', route: '/parametres/cloture', permissions: ['structure.annee.cloturer'] },
  ] },
];

const permis = (o: Onglet, moi: Moi) => o.permissions.length === 0 || moi.unParmi(o.permissions);
export const routeDuModule = (m: Module, moi: Moi) => MODULES.find((x) => x.code === m)!.onglets.find((o) => permis(o, moi))?.route ?? null;
/** Première page d'une personne du personnel après la connexion. */
export const accueilDe = (moi: Moi) => {
  if (moi.famille) return '/parent/accueil';
  for (const m of MODULES) { const r = routeDuModule(m.code, moi); if (r) return r; }
  return '/tableau-de-bord';
};
export function routePermise(chemin: string, moi: Moi): boolean {
  for (const m of MODULES) for (const o of m.onglets) if (chemin === o.route || chemin.startsWith(`${o.route}/`)) return permis(o, moi);
  return true;
}

/** Icônes propres à la coque (absentes du jeu des maquettes) : hamburger du bouton Menu. */
const IconeMenu = () => <svg aria-hidden="true" width={20} height={20} viewBox="0 0 24 24" className="icone"><path d="M4 7h16M4 12h16M4 17h16" /></svg>;

/** Liste des modules et liens vers les applications mobiles : même contenu dans la barre latérale, le rail et le tiroir. */
function Modules({ module, moi, modules, onClic }: { module: Module; moi: Moi; modules: typeof MODULES; onClic?: () => void }) {
  return (
    <div className="menu">
      {modules.map((m) => (
        <Link key={m.code} to={routeDuModule(m.code, moi) ?? '/tableau-de-bord'} className={m.code === module ? 'actif' : ''} aria-current={m.code === module ? 'page' : undefined}
          aria-label={m.libelle} title={m.libelle} onClick={onClic}>
          <Icone nom={m.icone} /><span>{m.libelle}</span>
        </Link>
      ))}
    </div>
  );
}
const Apercu = () => (
  <div className="apercu">
    <span className="etiquette">Applications mobiles</span>
    <a href="/parent/connexion" target="_blank" rel="noreferrer" aria-label="Application du parent (nouvel onglet)" title="Application du parent"><Icone nom="appParent" /><span>Application du parent</span></a>
    <a href="/instituteur/notes" target="_blank" rel="noreferrer" aria-label="Application de l’instituteur (nouvel onglet)" title="Application de l’instituteur"><Icone nom="notes" /><span>Application de l’instituteur</span></a>
  </div>
);

export function Coque({ module, titre, children, route, sansOnglets }: { module: Module; titre?: string; children: ReactNode; route?: string; sansOnglets?: boolean }) {
  const moi = useMoi();
  const { mode, basculerMode, deconnecter } = useSession();
  const loc = useLocation();
  const naviguer = useNavigate();
  const [menu, setMenu] = useState(false);
  const [tiroir, setTiroir] = useState(false);
  const refMenu = useRef<HTMLDivElement>(null);
  const refTiroir = useRef<HTMLElement>(null);
  const refBoutonMenu = useRef<HTMLButtonElement>(null);
  const refOnglets = useRef<HTMLElement>(null);
  const def = MODULES.find((m) => m.code === module)!;
  const ici = route ?? loc.pathname;
  const onglets = def.onglets.filter((o) => permis(o, moi));
  const modules = MODULES.filter((m) => m.code === 'tableau' || routeDuModule(m.code, moi));
  const titreEcran = titre ?? def.libelle;
  useEffect(() => {
    // Ctrl K : recherche d'un élève depuis n'importe quel écran.
    const k = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k' && moi.a('scolarite.eleve.consulter') && !document.querySelector('.voile')) {
        e.preventDefault();
        if (!e.defaultPrevented || loc.pathname !== '/scolarite/eleves') naviguer('/scolarite/eleves?recherche=1');
      }
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [moi, naviguer, loc.pathname]);
  // Menu de la personne : fermé par Échap ou par un clic ailleurs.
  useEffect(() => {
    if (!menu) return;
    const clic = (e: MouseEvent) => { if (!refMenu.current?.contains(e.target as Node)) setMenu(false); };
    const clavier = (e: KeyboardEvent) => { if (e.key === 'Escape') { setMenu(false); refMenu.current?.querySelector('button')?.focus(); } };
    document.addEventListener('mousedown', clic);
    window.addEventListener('keydown', clavier);
    return () => { document.removeEventListener('mousedown', clic); window.removeEventListener('keydown', clavier); };
  }, [menu]);
  // Tiroir (< 900 px) : Échap ferme, fermé dès que la largeur repasse au-dessus de 900 px, focus piégé puis rendu au bouton Menu.
  useFocusPiege(refTiroir, tiroir, refBoutonMenu.current);
  useEffect(() => {
    if (!tiroir) return;
    const clavier = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); setTiroir(false); } };
    const mq = window.matchMedia('(min-width: 900px)');
    const large = () => { if (mq.matches) setTiroir(false); };
    window.addEventListener('keydown', clavier);
    mq.addEventListener('change', large);
    document.body.classList.add('tiroir-ouvert');
    return () => { window.removeEventListener('keydown', clavier); mq.removeEventListener('change', large); document.body.classList.remove('tiroir-ouvert'); };
  }, [tiroir]);
  // Onglets en bande défilante : l'onglet actif est amené dans la zone visible au montage.
  useEffect(() => {
    const bande = refOnglets.current;
    const a = bande?.querySelector<HTMLElement>('a.actif');
    if (!bande || !a || bande.scrollWidth <= bande.clientWidth) return;
    bande.scrollLeft = Math.max(0, a.offsetLeft - (bande.clientWidth - a.offsetWidth) / 2);
  }, [ici]);
  const actif = (o: Onglet) => ici === o.route || ici.startsWith(`${o.route}/`);
  const seDeconnecter = async () => { setMenu(false); setTiroir(false); await deconnecter(); naviguer('/connexion'); };
  return (
    <div className="app">
      <a href="#contenu" className="lien-evitement" onClick={(e) => { e.preventDefault(); document.getElementById('contenu')?.focus(); }}>Aller au contenu</a>
      <nav className="lateral" aria-label="Menu principal">
        <div className="logo">
          <div className="logo-pastille" aria-hidden="true"><Icone nom="logo" taille={20} /></div>
          <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
            <span className="gras">Gestion scolaire</span>
            <span className="doux petit nom-etab">{moi.etablissement}</span>
          </div>
        </div>
        <Modules module={module} moi={moi} modules={modules} />
        <Apercu />
      </nav>
      <main className="principal" id="contenu" tabIndex={-1}>
        <header className="entete">
          <button ref={refBoutonMenu} type="button" className="bouton bouton-icone bouton-menu" aria-label="Menu" aria-expanded={tiroir} aria-controls="tiroir-menu" onClick={() => setTiroir(true)}>
            <IconeMenu />
          </button>
          <div className="entete-titre"><h1 title={titreEcran}>{titreEcran}</h1>{moi.annee && <Pastille ton="accent">{moi.annee}</Pastille>}</div>
          {moi.a('scolarite.eleve.consulter') && (
            <button type="button" className="recherche-globale" aria-label="Rechercher un élève" onClick={() => naviguer('/scolarite/eleves?recherche=1')}>
              <Icone nom="recherche" /><span>Rechercher un élève</span><kbd>Ctrl</kbd><kbd>K</kbd>
            </button>
          )}
          <button type="button" className="bouton bouton-mode" style={{ width: 44, padding: 0, borderColor: 'var(--bord)', background: 'transparent', color: 'var(--doux)' }}
            aria-label={mode === 'nuit' ? 'Passer en mode Jour' : 'Passer en mode Nuit'} onClick={basculerMode}>
            <Icone nom={mode === 'nuit' ? 'soleil' : 'lune'} />
          </button>
          <div ref={refMenu} style={{ position: 'relative' }}>
            <button type="button" className="utilisateur" aria-haspopup="menu" aria-expanded={menu} aria-label={`Compte de ${moi.nom}`} onClick={() => setMenu((x) => !x)}>
              <Avatar nom={moi.nom} />
              <div className="utilisateur-nom" style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}><span className="gras" style={{ fontSize: 13 }}>{moi.nom}</span><span className="doux petit">{moi.libelleRoles}</span></div>
            </button>
            {menu && (
              <div className="menu-utilisateur" role="menu" aria-label={`Compte de ${moi.nom}`}>
                <div className="menu-utilisateur-info" role="none"><span className="gras">{moi.nom}</span><span className="doux petit">{moi.libelleRoles}</span><span className="doux petit">{moi.etablissement}</span></div>
                <button type="button" role="menuitem" onClick={seDeconnecter}>Se déconnecter</button>
              </div>
            )}
          </div>
        </header>
        {!sansOnglets && def.onglets.length > 1 && onglets.length > 0 && (
          <nav ref={refOnglets} className="onglets" aria-label="Écrans du module">
            {onglets.map((o) => <Link key={o.route} to={o.route} className={actif(o) ? 'actif' : ''} aria-current={actif(o) ? 'page' : undefined}>{o.libelle}</Link>)}
          </nav>
        )}
        {children}
      </main>
      {tiroir && (
        <div className="voile tiroir-voile" onMouseDown={(e) => { if (e.target === e.currentTarget) setTiroir(false); }}>
          <nav ref={refTiroir} id="tiroir-menu" className="tiroir" role="dialog" aria-modal="true" aria-label="Menu principal" tabIndex={-1}>
            <div className="tiroir-entete">
              <div className="logo">
                <div className="logo-pastille" aria-hidden="true"><Icone nom="logo" taille={20} /></div>
                <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                  <span className="gras">Gestion scolaire</span>
                  <span className="doux petit">{moi.etablissement}</span>
                </div>
              </div>
              <button type="button" className="bouton bouton-icone" aria-label="Fermer le menu" onClick={() => setTiroir(false)}><Icone nom="fermer" /></button>
            </div>
            <Modules module={module} moi={moi} modules={modules} onClic={() => setTiroir(false)} />
            <Apercu />
            <div className="tiroir-pied">
              <button type="button" className="bouton" onClick={basculerMode}>
                <Icone nom={mode === 'nuit' ? 'soleil' : 'lune'} /><span>{mode === 'nuit' ? 'Passer en mode Jour' : 'Passer en mode Nuit'}</span>
              </button>
              <button type="button" className="bouton" onClick={seDeconnecter}>
                <Avatar nom={moi.nom} taille={24} /><span className="tiroir-deconnexion"><span>Se déconnecter</span><span className="doux petit">{moi.nom}</span></span>
              </button>
            </div>
          </nav>
        </div>
      )}
    </div>
  );
}
