import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import App from './App.tsx';
import { FournisseurSession } from './core/session.tsx';
import { MessagesFlottants } from './core/ui.tsx';

createRoot(document.getElementById('racine')!).render(
  <StrictMode>
    <FournisseurSession>
      <App />
      <MessagesFlottants />
    </FournisseurSession>
  </StrictMode>,
);

// Application installable (PWA) : le service worker garde l'application sur le poste et répond hors ligne.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => { void navigator.serviceWorker.register('/sw.js'); });
}
