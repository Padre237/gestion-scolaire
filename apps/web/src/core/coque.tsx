// Coque des écrans de bureau : barre latérale, en-tête, onglets du module (éléments communs des maquettes).
// Modules, onglets et liens ne s'affichent que si la personne a la permission (E-05) ; le serveur reste seul juge (403).
import { useEffect, useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useMoi, useSession, type Moi } from './session.tsx';
import { Avatar, Icone, Pastille } from './ui.tsx';
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

export function Coque({ module, titre, children, route, sansOnglets }: { module: Module; titre?: string; children: ReactNode; route?: string; sansOnglets?: boolean }) {
  const moi = useMoi();
  const { mode, basculerMode, deconnecter } = useSession();
  const loc = useLocation();
  const naviguer = useNavigate();
  const [menu, setMenu] = useState(false);
  const def = MODULES.find((m) => m.code === module)!;
  const ici = route ?? loc.pathname;
  const onglets = def.onglets.filter((o) => permis(o, moi));
  const modules = MODULES.filter((m) => m.code === 'tableau' || routeDuModule(m.code, moi));
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
  const actif = (o: Onglet) => ici === o.route || ici.startsWith(`${o.route}/`);
  return (
    <div className="app">
      <nav className="lateral" aria-label="Menu principal">
        <div className="logo">
          <div className="logo-pastille" aria-hidden="true"><Icone nom="logo" taille={20} /></div>
          <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
            <span className="gras">Gestion scolaire</span>
            <span className="doux petit nom-etab">{moi.etablissement}</span>
          </div>
        </div>
        <div className="menu">
          {modules.map((m) => (
            <Link key={m.code} to={routeDuModule(m.code, moi) ?? '/tableau-de-bord'} className={m.code === module ? 'actif' : ''} aria-current={m.code === module ? 'page' : undefined}>
              <Icone nom={m.icone} /><span>{m.libelle}</span>
            </Link>
          ))}
        </div>
        <div className="apercu">
          <span className="etiquette">Applications mobiles</span>
          <a href="/parent/connexion" target="_blank" rel="noreferrer"><Icone nom="appParent" /><span>Application du parent</span></a>
          <a href="/instituteur/notes" target="_blank" rel="noreferrer"><Icone nom="notes" /><span>Application de l’instituteur</span></a>
        </div>
      </nav>
      <main className="principal">
        <header className="entete">
          <div className="entete-titre"><h1>{titre ?? def.libelle}</h1>{moi.annee && <Pastille ton="accent">{moi.annee}</Pastille>}</div>
          {moi.a('scolarite.eleve.consulter') && (
            <button type="button" className="recherche-globale" onClick={() => naviguer('/scolarite/eleves?recherche=1')}>
              <Icone nom="recherche" /><span>Rechercher un élève</span><kbd>Ctrl</kbd><kbd>K</kbd>
            </button>
          )}
          <button type="button" className="bouton" style={{ width: 44, padding: 0, borderColor: 'var(--bord)', background: 'transparent', color: 'var(--doux)' }}
            aria-label={mode === 'nuit' ? 'Passer en mode Jour' : 'Passer en mode Nuit'} onClick={basculerMode}>
            <Icone nom={mode === 'nuit' ? 'soleil' : 'lune'} />
          </button>
          <div style={{ position: 'relative' }}>
            <button type="button" className="utilisateur" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu((x) => !x)}>
              <Avatar nom={moi.nom} />
              <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}><span className="gras" style={{ fontSize: 13 }}>{moi.nom}</span><span className="doux petit">{moi.libelleRoles}</span></div>
            </button>
            {menu && (
              <div className="menu-utilisateur" role="menu">
                <button type="button" role="menuitem" onClick={async () => { setMenu(false); await deconnecter(); naviguer('/connexion'); }}>Se déconnecter</button>
              </div>
            )}
          </div>
        </header>
        {!sansOnglets && def.onglets.length > 1 && onglets.length > 0 && (
          <nav className="onglets" aria-label="Écrans du module">
            {onglets.map((o) => <Link key={o.route} to={o.route} className={actif(o) ? 'actif' : ''} aria-current={actif(o) ? 'page' : undefined}>{o.libelle}</Link>)}
          </nav>
        )}
        {children}
      </main>
    </div>
  );
}
