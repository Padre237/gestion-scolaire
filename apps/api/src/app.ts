// Assemblage du serveur Fastify (conception § 2 et § 7) : un seul processus,
// des modules aux frontières strictes, une API REST /api/v1 décrite en OpenAPI.
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import fastifyStatic from '@fastify/static';
import { existsSync, readFileSync } from 'node:fs';
import { X509Certificate } from 'node:crypto';
import { resolve } from 'node:path';
import {
  jsonSchemaTransform, serializerCompiler, validatorCompiler, type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { RACINE } from '@gs/db';
import { Bd } from './core/bd.ts';
import { gestionnaireErreurs } from './core/erreurs.ts';
import { pluginSession } from './core/session.ts';
import { routesAuth } from './core/http/auth.ts';
import { routesAdministration } from './core/http/administration.ts';
import { routesDonnees } from './core/http/donnees.ts';
import { routesSynchro } from './core/http/synchro.ts';
import { routesStructure } from './modules/structure/http/routes.ts';
import { routesPersonnel } from './modules/personnel/http/routes.ts';
import { routesPedagogie } from './modules/pedagogie/http/routes.ts';
import { routesFinances } from './modules/finances/http/routes.ts';
import { routesScolarite } from './modules/scolarite/http/routes.ts';
import { routesCloture } from './modules/scolarite/http/cloture.ts';
import { routesPilotage } from './modules/pilotage/http/routes.ts';
import { routesCaisse } from './modules/caisse/http/routes.ts';
import { routesVieScolaire } from './modules/vie-scolaire/http/routes.ts';
import { routesCommunication } from './modules/communication/http/routes.ts';
import { routesAssistant } from './modules/assistant/http/routes.ts';
import { routesPortail } from './modules/portail/http/routes.ts';
import './modules/finances/index.ts';
import './modules/scolarite/index.ts';
import './modules/pedagogie/index.ts';

export interface OptionsApp {
  bd: Bd;
  journal?: boolean;
  /** Dossier de l'application web compilée (React, installable), servie par le même serveur (§ 10). */
  dossierWeb?: string;
  /** Origines admises pour les écritures (contrôle de l'en-tête Origin, § 8). */
  originesAdmises?: string[];
  /** Certificat local : HTTPS sur le réseau de l'école (conception § 8). */
  https?: { key: Buffer; cert: Buffer };
}

export async function construireApp(o: OptionsApp): Promise<FastifyInstance> {
  const app = (o.https ? Fastify({ logger: o.journal ?? false, https: o.https }) : Fastify({ logger: o.journal ?? false }))
    .withTypeProvider<ZodTypeProvider>() as unknown as FastifyInstance;
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.setErrorHandler(gestionnaireErreurs);
  app.decorate('bd', o.bd);
  // Inventaire des routes : un test vérifie que chacune déclare sa permission (conception § 8).
  const inventaire: { methode: string; url: string; config: Record<string, unknown> }[] = [];
  app.decorate('inventaireRoutes', inventaire);
  app.addHook('onRoute', (route) => {
    const methodes = Array.isArray(route.method) ? route.method : [route.method];
    for (const m of methodes) inventaire.push({ methode: m, url: route.url, config: (route.config ?? {}) as Record<string, unknown> });
  });

  // Pas de HSTS : le poste sert aussi http://localhost (application installable sans certificat sur ce poste).
  await app.register(helmet, { contentSecurityPolicy: false, crossOriginEmbedderPolicy: false, strictTransportSecurity: false });
  await app.register(cookie);

  // Contrôle de l'en-tête Origin contre la falsification de requêtes (conception § 8).
  app.addHook('onRequest', async (req, rep) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method) || !req.url.startsWith('/api/')) return;
    const origine = req.headers.origin;
    if (!origine || req.headers.authorization) return; // applications : jeton, pas de cookie
    const hote = req.headers.host;
    const admises = new Set([...(o.originesAdmises ?? []), `https://${hote}`, `http://${hote}`]);
    if (!admises.has(origine)) {
      await rep.status(403).type('application/problem+json').send({
        type: 'urn:gestion-scolaire:erreur:CORE_ORIGINE', title: 'CORE_ORIGINE', status: 403,
        detail: 'Origine refusée.', code: 'CORE_ORIGINE',
      });
    }
  });

  await app.register(swagger, {
    openapi: {
      openapi: '3.1.0',
      info: { title: 'Gestion scolaire', version: '1.0.0', description: 'API REST de l\'application de gestion scolaire.' },
      components: { securitySchemes: { jeton: { type: 'http', scheme: 'bearer' }, cookie: { type: 'apiKey', in: 'cookie', name: 'gs_session' } } },
    },
    transform: jsonSchemaTransform,
  });
  await app.register(swaggerUi, { routePrefix: '/api/docs' });

  await app.register(pluginSession);
  await app.register(async (api) => {
    await api.register(routesAuth);
    await api.register(routesAdministration);
    await api.register(routesDonnees);
    await api.register(routesSynchro);
    await api.register(routesStructure);
    await api.register(routesPersonnel);
    await api.register(routesPedagogie);
    await api.register(routesFinances);
    await api.register(routesScolarite);
    await api.register(routesCloture);
    await api.register(routesPilotage);
    await api.register(routesCaisse);
    await api.register(routesVieScolaire);
    await api.register(routesCommunication);
    await api.register(routesAssistant);
    await api.register(routesPortail);
  }, { prefix: '/api/v1' });

  // Certificat de l'autorité locale (var/tls), à installer sur les téléphones pour l'application installable (DEMO.md).
  const autorite = resolve(RACINE, 'var/tls/autorite.pem');
  app.get('/autorite.crt', async (_req, rep) => {
    if (!existsSync(autorite)) return rep.status(404).send();
    const der = new X509Certificate(readFileSync(autorite)).raw;
    return rep.type('application/x-x509-ca-cert').header('content-disposition', 'attachment; filename="autorite-ecole.crt"').send(der);
  });

  const web = o.dossierWeb ?? resolve(RACINE, 'apps/web/dist');
  if (existsSync(web)) {
    // wildcard : un fichier ajouté par une nouvelle construction est servi sans redémarrer le serveur.
    await app.register(fastifyStatic, { root: web, wildcard: true });
    // Navigation côté client : toute adresse inconnue hors /api renvoie l'application.
    app.setNotFoundHandler((req, rep) => {
      if (req.url.startsWith('/api/')) return rep.status(404).type('application/problem+json')
        .send({ type: 'urn:gestion-scolaire:erreur:CORE_INTROUVABLE', title: 'CORE_INTROUVABLE', status: 404, detail: 'Route inconnue.', code: 'CORE_INTROUVABLE' });
      return rep.sendFile('index.html');
    });
  }
  return app;
}
