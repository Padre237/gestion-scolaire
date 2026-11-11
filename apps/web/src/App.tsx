// Navigation : une route par écran de maquette ; le serveur reste seul juge des droits (403), la garde évite
// seulement d'ouvrir un écran hors permission (E-05).
import type { ReactNode } from 'react';
import { createBrowserRouter, Navigate, RouterProvider, useLocation } from 'react-router-dom';
import { useSession } from './core/session.tsx';
import { accueilDe, routePermise } from './core/coque.tsx';
import { Chargement } from './core/ui.tsx';
import { routes as accueil } from './ecrans/accueil.tsx';
import { routes as eleves } from './ecrans/eleves.tsx';
import { routes as finances } from './ecrans/finances.tsx';
import { routes as pedagogie } from './ecrans/pedagogie.tsx';
import { routes as vie } from './ecrans/vie.tsx';
import { routes as admin } from './ecrans/admin.tsx';
import { routes as mobile } from './ecrans/mobile.tsx';

export interface RouteEcran { path: string; element: ReactNode }

const PUBLIQUES = ['/connexion', '/parent/connexion', '/instituteur/connexion'];

function Garde({ children }: { children: ReactNode }) {
  const { moi, pret } = useSession();
  const p = useLocation().pathname;
  if (!pret) return <Chargement />;
  if (!moi) {
    if (PUBLIQUES.includes(p)) return <>{children}</>;
    if (p.startsWith('/parent')) return <Navigate to="/parent/connexion" replace />;
    if (p.startsWith('/instituteur')) return <Navigate to="/instituteur/connexion" replace />;
    return <Navigate to="/connexion" replace />;
  }
  // RG-35 : le compte famille n'ouvre que l'application du parent.
  if (moi.famille) return p.startsWith('/parent') && p !== '/parent/connexion' ? <>{children}</> : <Navigate to="/parent/accueil" replace />;
  if (p === '/' || p === '/connexion') return <Navigate to={accueilDe(moi)} replace />;
  if (p === '/instituteur' || p === '/instituteur/connexion') return <Navigate to="/instituteur/notes" replace />;
  if (p.startsWith('/parent')) return <Navigate to={accueilDe(moi)} replace />;
  if (!p.startsWith('/instituteur') && !routePermise(p, moi)) return <Navigate to={accueilDe(moi)} replace />;
  return <>{children}</>;
}

const toutes: RouteEcran[] = [...accueil, ...eleves, ...finances, ...pedagogie, ...vie, ...admin, ...mobile];

const routeur = createBrowserRouter([
  ...toutes.map((r) => ({ path: r.path, element: <Garde>{r.element}</Garde> })),
  { path: '*', element: <Garde><Navigate to="/" replace /></Garde> },
]);

export default function App() {
  return <RouterProvider router={routeur} />;
}
