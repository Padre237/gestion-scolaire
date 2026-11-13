-- Plus d'accès direct à la base depuis l'application (D-47) : la permission « Gérer l'accès en lecture » disparaît.
DELETE FROM core.role_permission WHERE permission_code = 'core.lecture.gerer';
DELETE FROM core.compte_permission WHERE permission_code = 'core.lecture.gerer';
DELETE FROM core.permission WHERE code = 'core.lecture.gerer';
