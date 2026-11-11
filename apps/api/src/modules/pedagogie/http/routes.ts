// Routes du module pédagogie : paramétrage, saisie, résultats, emploi du temps.
import type { FastifyInstance } from 'fastify';
import '../index.ts'; // enregistre le fournisseur de périmètre (RG-34)
import { routesParametrage } from './parametrage.ts';
import { routesNotes } from './notes.ts';
import { routesResultats } from './resultats.ts';
import { routesEdt } from './edt.ts';

export async function routesPedagogie(app: FastifyInstance) {
  await app.register(routesParametrage);
  await app.register(routesNotes);
  await app.register(routesResultats);
  await app.register(routesEdt);
}
