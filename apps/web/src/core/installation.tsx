// Application installable (PWA, D-50) : bouton « Installer l'application », aide pour l'iPhone et le réseau de l'école,
// annonce d'une nouvelle version. Une seule application, Sekou, pour tout le monde.
import { useEffect, useState } from 'react';
import { ouvrirFenetre } from './ui.tsx';

interface InvitationInstallation extends Event { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> }
declare global { interface Window { __installation?: InvitationInstallation | null } }

/** L'application tourne-t-elle déjà installée (écran d'accueil) ? */
export const estInstallee = () => window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
const iPhone = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

function aide() {
  const securise = window.isSecureContext;
  return ouvrirFenetre('Installer Sekou sur ce téléphone', (fermer) => (
    <>
      {!securise ? (
        <>
          <p>Un téléphone n’installe une application que depuis une adresse sûre (https). Deux possibilités :</p>
          <ol style={{ margin: 0, paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <li>ouvrir la <b>version en ligne</b> de l’école, à son adresse https ;</li>
            <li>sur le réseau de l’école, ouvrir l’adresse <b>https://…:8443</b> du poste, après avoir installé une fois le certificat de l’école
              (adresse <b>/autorite.crt</b> du poste, voir le guide de démonstration).</li>
          </ol>
        </>
      ) : iPhone() ? (
        <ol style={{ margin: 0, paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <li>Ouvrez cette page dans <b>Safari</b>.</li>
          <li>Touchez le bouton <b>Partager</b> (le carré avec une flèche vers le haut).</li>
          <li>Choisissez <b>Sur l’écran d’accueil</b>, puis <b>Ajouter</b>.</li>
          <li>Sekou s’ouvre ensuite depuis son icône, en plein écran.</li>
        </ol>
      ) : (
        <ol style={{ margin: 0, paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <li>Ouvrez le menu du navigateur (les trois points).</li>
          <li>Choisissez <b>Installer l’application</b> ou <b>Ajouter à l’écran d’accueil</b>.</li>
          <li>Sekou s’ouvre ensuite depuis son icône, en plein écran.</li>
        </ol>
      )}
      <p className="doux petit">Une seule application pour tous : chacun se connecte et arrive dans son espace (parent, instituteur, administration).</p>
      <div className="pied"><button type="button" className="bouton principal" onClick={() => fermer()}>Compris</button></div>
    </>
  ), 460);
}

/** Bouton « Installer l'application » : invitation du navigateur (Android, ordinateur), aide pas à pas sinon (iPhone, réseau non sûr). */
export function BoutonInstaller({ className = 'bouton', libelle = 'Installer l’application' }: { className?: string; libelle?: string }) {
  const [invitation, setInvitation] = useState<InvitationInstallation | null>(() => window.__installation ?? null);
  const [installee, setInstallee] = useState(estInstallee);
  useEffect(() => {
    const prete = () => setInvitation(window.__installation ?? null);
    const faite = () => { setInstallee(true); setInvitation(null); };
    window.addEventListener('gs-installable', prete);
    window.addEventListener('appinstalled', faite);
    return () => { window.removeEventListener('gs-installable', prete); window.removeEventListener('appinstalled', faite); };
  }, []);
  if (installee) return null;
  const installer = async () => {
    if (!invitation) { await aide(); return; }
    await invitation.prompt();
    const choix = await invitation.userChoice;
    window.__installation = null;
    setInvitation(null);
    if (choix.outcome === 'accepted') setInstallee(true);
  };
  return <button type="button" className={className} onClick={() => { void installer(); }}>{libelle}</button>;
}

/** Bandeau « Nouvelle version disponible » : la nouvelle version s'active d'un geste, sans perdre ce qui est gardé sur le téléphone. */
export function BandeauMiseAJour() {
  const [attente, setAttente] = useState<ServiceWorker | null>(null);
  useEffect(() => {
    const f = (e: Event) => setAttente((e as CustomEvent<ServiceWorker>).detail);
    window.addEventListener('gs-mise-a-jour', f);
    return () => window.removeEventListener('gs-mise-a-jour', f);
  }, []);
  if (!attente) return null;
  return (
    <div className="mise-a-jour" role="status">
      <span>Nouvelle version de Sekou disponible.</span>
      <button type="button" className="bouton principal petit" onClick={() => attente.postMessage('ACTIVER')}>Recharger</button>
      <button type="button" className="bouton petit" onClick={() => setAttente(null)}>Plus tard</button>
    </div>
  );
}
