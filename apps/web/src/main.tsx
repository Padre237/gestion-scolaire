import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import App from './App.tsx';
import { FournisseurSession } from './core/session.tsx';
import { MessagesFlottants } from './core/ui.tsx';
import { BandeauMiseAJour } from './core/installation.tsx';

createRoot(document.getElementById('racine')!).render(
  <StrictMode>
    <FournisseurSession>
      <App />
      <MessagesFlottants />
      <BandeauMiseAJour />
    </FournisseurSession>
  </StrictMode>,
);

// Application installable (PWA) : le service worker garde l'application sur le poste et répond hors ligne.
// L'invitation à installer arrive tôt : elle est gardée pour le bouton « Installer l'application » (D-50).
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  window.__installation = e as never;
  window.dispatchEvent(new Event('gs-installable'));
});
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', async () => {
    const reg = await navigator.serviceWorker.register('/sw.js');
    // Nouvelle version prête : un bandeau propose de recharger ; l'activation recharge la page une fois.
    const annoncer = (w: ServiceWorker) => window.dispatchEvent(new CustomEvent('gs-mise-a-jour', { detail: w }));
    if (reg.waiting && navigator.serviceWorker.controller) annoncer(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const n = reg.installing;
      n?.addEventListener('statechange', () => { if (n.state === 'installed' && navigator.serviceWorker.controller) annoncer(n); });
    });
    let recharge = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (!recharge) { recharge = true; window.location.reload(); } });
    window.setInterval(() => { void reg.update(); }, 30 * 60_000);
  });
}
