-- 0006 · Un bulletin publié et un brouillon de correction coexistent (RG-27) : une unicité par état.
DROP INDEX pedagogie.bulletin_un_courant;
CREATE UNIQUE INDEX bulletin_un_publie ON pedagogie.bulletin (inscription_id, COALESCE(periode_id, '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE statut = 'publie';
CREATE UNIQUE INDEX bulletin_un_brouillon ON pedagogie.bulletin (inscription_id, COALESCE(periode_id, '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE statut = 'brouillon';
