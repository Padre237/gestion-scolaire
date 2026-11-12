// Reçu consulté par le parent : données à l'écran, jamais de fichier (RG-35).
import type { FastifyInstance } from 'fastify';
import { donneesRecu } from '../../finances/recu.ts';

export async function donneesRecuPortail(app: FastifyInstance, etab: string, versementId: string) {
  const d = await app.bd.transaction(null, (tx) => donneesRecu(tx, etab, versementId));
  // Le logo ne sert qu'à l'impression : il ne part pas avec les données affichées à l'écran.
  return { ...d, etablissement: { ...d.etablissement, logo: undefined }, duplicata: false };
}
