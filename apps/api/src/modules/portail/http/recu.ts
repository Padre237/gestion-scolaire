// Reçu consulté par le parent : données à l'écran, jamais de fichier (RG-35).
import type { FastifyInstance } from 'fastify';
import { donneesRecu } from '../../finances/recu.ts';

export async function donneesRecuPortail(app: FastifyInstance, etab: string, versementId: string) {
  const d = await app.bd.transaction(null, (tx) => donneesRecu(tx, etab, versementId));
  return { ...d, duplicata: false };
}
