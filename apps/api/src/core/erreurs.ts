// Erreurs au format RFC 9457 (application/problem+json) avec un code métier stable (conception § 7.1).
import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { hasZodFastifySchemaValidationErrors } from 'fastify-type-provider-zod';

export class ErreurMetier extends Error {
  constructor(
    readonly code: string,
    readonly statut: number = 422,
    message?: string,
    readonly champ?: string,
  ) {
    super(message ?? code);
  }
}

export const nonAutorise = () => new ErreurMetier('CORE_NON_AUTHENTIFIE', 401, 'Connexion requise.');
export const interdit = (permission?: string) =>
  new ErreurMetier('CORE_INTERDIT', 403, permission ? `Permission requise : ${permission}.` : 'Action hors de vos droits.');
export const introuvable = (quoi: string) => new ErreurMetier('CORE_INTROUVABLE', 404, `${quoi} introuvable.`);
export const conflit = () => new ErreurMetier('CORE_CONFLIT_VERSION', 409, 'La ressource a été modifiée entre-temps.');

export function gestionnaireErreurs(err: FastifyError | ErreurMetier | Error, req: FastifyRequest, rep: FastifyReply) {
  const envoyer = (statut: number, code: string, detail: string, extra: Record<string, unknown> = {}) =>
    rep.status(statut).type('application/problem+json').send({
      type: `urn:gestion-scolaire:erreur:${code}`, title: code, status: statut, detail, code, ...extra,
    });

  if (err instanceof ErreurMetier) {
    return envoyer(err.statut, err.code, err.message, err.champ ? { champ: err.champ } : {});
  }
  if (hasZodFastifySchemaValidationErrors(err)) {
    const champs = err.validation.map((v) => ({ champ: v.instancePath.replace(/^\//, '').replaceAll('/', '.'), message: v.message }));
    return envoyer(400, 'CORE_REQUETE_INVALIDE', 'Requête invalide.', { champs });
  }
  const pgErr = err as Error & { code?: string; constraint?: string };
  if (pgErr.code === '23505') return envoyer(409, 'CORE_DOUBLON', 'Cette valeur existe déjà.', { contrainte: pgErr.constraint });
  if (pgErr.code === '23514') return envoyer(422, 'CORE_CONTRAINTE', pgErr.message, { contrainte: pgErr.constraint });
  const statut = (err as FastifyError).statusCode;
  if (statut && statut < 500) return envoyer(statut, 'CORE_REQUETE_INVALIDE', err.message);
  req.log.error(err);
  return envoyer(500, 'CORE_ERREUR_INTERNE', 'Erreur interne du serveur.');
}
