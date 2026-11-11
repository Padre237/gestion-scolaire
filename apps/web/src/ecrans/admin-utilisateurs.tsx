// Maquettes Utilisateurs (comptes, rôles et permissions) et Audit (journal d'audit, consultation seule).
import { useEffect, useMemo, useState } from 'react';
import { api, ErreurApi, requete } from '../core/api.ts';
import { Coque } from '../core/coque.tsx';
import { useMoi } from '../core/session.tsx';
import { telecharger } from '../core/documents.ts';
import { enLettres, pluriel, versIso } from '../core/format.ts';
import {
  agir, Bandeau, Bascules, Bouton, CaseACocher, Cel2, Champ, Chargement, Colonnes, confirmer, Doux, Erreur, Etiquette, Filtres, Liste, Note,
  ouvrirFormulaire, Panneau, Pastille, PiedFenetre, Tableau, TitrePanneau, useDonnees, type Ton,
} from '../core/ui.tsx';
import {
  creerCompte, dateHeure, jourHeure, montrerMotDePasse, Pagination, rolesAttribuables, sansAccent, useDiffere, type PersonnelSansCompte, type Role,
} from './admin-commun.tsx';

interface Compte {
  id: string; identifiant: string; nomAffiche: string; type: string; actif: boolean; derniereActivite: string | null; roles: string[]; perimetre: string;
}
interface Permission { code: string; groupe: string; libelle: string; libelleEn: string }

const TAILLE_COMPTES = 10;

// ---------------------------------------------------------------- fenêtres

function FenetreModifierCompte({ fermer, compte, roles }: { fermer: (ok?: boolean) => void; compte: Compte; roles: Role[] }) {
  const [nom, setNom] = useState(compte.nomAffiche);
  const [choisis, setChoisis] = useState(roles.filter((r) => compte.roles.includes(r.libelle)).map((r) => r.id));
  const [erreur, setErreur] = useState<string | null>(null);
  const [charge, setCharge] = useState(false);
  const valider = async () => {
    if (nom.trim().length < 2) return setErreur('Nom à afficher requis (2 caractères au moins).');
    if (!choisis.length) return setErreur('Choisissez au moins un rôle.');
    setCharge(true);
    try {
      await api.patch(`/core/comptes/${compte.id}`, { nomAffiche: nom.trim(), roles: choisis.map((roleId) => ({ roleId })) });
      fermer(true);
    } catch (e) {
      setErreur(e instanceof ErreurApi ? e.message : String(e));
      setCharge(false);
    }
  };
  return (
    <>
      <Doux>Identifiant de connexion : {compte.identifiant}</Doux>
      <Champ libelle="Nom affiché" value={nom} onChange={setNom} autoFocus />
      <div className="champ-groupe">
        <span className="libelle">Rôles</span>
        <div style={{ display: 'flex', flexWrap: 'wrap', columnGap: 18 }}>
          {rolesAttribuables(roles).map((r) => (
            <CaseACocher key={r.id} libelle={r.libelle} valeur={choisis.includes(r.id)}
              onChange={(v) => setChoisis((c) => (v ? [...c, r.id] : c.filter((x) => x !== r.id)))} />
          ))}
        </div>
      </div>
      <Doux>Le périmètre suit les affectations : classes et matières confiées dans Notes et bulletins.</Doux>
      {erreur && <Note ton="danger">{erreur}</Note>}
      <PiedFenetre fermer={() => fermer()} action="Enregistrer" onAction={valider} charge={charge} />
    </>
  );
}

function FenetreNouveauRole({ fermer, base }: { fermer: (id?: string) => void; base: Role }) {
  const [libelle, setLibelle] = useState('');
  const [libelleEn, setLibelleEn] = useState('');
  const [erreur, setErreur] = useState<string | null>(null);
  const [charge, setCharge] = useState(false);
  const valider = async () => {
    if (libelle.trim().length < 2) return setErreur('Nom du rôle requis (2 caractères au moins).');
    setCharge(true);
    try {
      const r = await api.post<{ id: string }>('/core/roles', { depuisRoleId: base.id, libelle: libelle.trim(), ...(libelleEn.trim() ? { libelleEn: libelleEn.trim() } : {}) });
      fermer(r.id);
    } catch (e) {
      setErreur(e instanceof ErreurApi ? e.message : String(e));
      setCharge(false);
    }
  };
  return (
    <>
      <p>Le nouveau rôle reprend les {pluriel(base.permissions.length, 'permission')} de « {base.libelle} » ; vous les ajustez ensuite.</p>
      <Champ libelle="Nom du rôle" value={libelle} onChange={setLibelle} autoFocus erreur={erreur} />
      <Champ libelle="Name (English)" value={libelleEn} onChange={setLibelleEn} />
      <PiedFenetre fermer={() => fermer()} action="Créer le rôle" onAction={valider} charge={charge} />
    </>
  );
}

// ---------------------------------------------------------------- permissions du rôle

function PanneauPermissions({ roles, catalogue, roleId, choisirRole, recharger }: {
  roles: Role[]; catalogue: Permission[]; roleId: string | null; choisirRole: (id: string) => void; recharger: () => Promise<void>;
}) {
  const moi = useMoi();
  const role = roles.find((r) => r.id === roleId) ?? roles[0];
  const [cochees, setCochees] = useState<Set<string> | null>(null);
  const [charge, setCharge] = useState(false);
  useEffect(() => { setCochees(null); }, [role?.id]);
  const codes = useMemo(() => new Set(catalogue.map((p) => p.code)), [catalogue]);
  const groupes = useMemo(() => {
    const m = new Map<string, Permission[]>();
    for (const p of catalogue) m.set(p.groupe, [...(m.get(p.groupe) ?? []), p]);
    return [...m.entries()];
  }, [catalogue]);
  if (!role) return <Panneau><TitrePanneau titre="Permissions du rôle" /><Doux>Aucun rôle.</Doux></Panneau>;
  const espaceParent = role.code === 'parent' || role.perimetre === 'famille';
  const modifiable = moi.a('core.role.gerer') && !espaceParent;
  const actuelles = new Set(role.permissions.filter((p) => codes.has(p)));
  const vue = cochees ?? actuelles;
  const modifie = cochees !== null && (cochees.size !== actuelles.size || [...cochees].some((p) => !actuelles.has(p)));
  const basculer = (code: string, v: boolean) => {
    const n = new Set(vue);
    if (v) n.add(code); else n.delete(code);
    setCochees(n);
  };
  const enregistrer = async () => {
    if (!cochees) return;
    setCharge(true);
    // Les permissions hors de ce catalogue (espace parent) restent telles quelles.
    const permissions = [...role.permissions.filter((p) => !codes.has(p)), ...cochees];
    const ok = await agir(() => api.put(`/core/roles/${role.id}/permissions`, { permissions }), `Permissions du rôle « ${role.libelle} » enregistrées`);
    setCharge(false);
    if (ok) { await recharger(); setCochees(null); }
  };
  const creerRole = async () => {
    const id = await ouvrirFormulaire<string>('Créer un rôle', ({ fermer }) => <FenetreNouveauRole fermer={fermer} base={role} />, 460);
    if (id) { await recharger(); choisirRole(id); }
  };
  const options: [string, string][] = roles.map((r) => [r.id, r.libelle]);
  const systeme = roles.filter((r) => r.systeme).length;
  return (
    <Panneau>
      <TitrePanneau titre="Permissions du rôle" sous={espaceParent ? undefined : `${pluriel(vue.size, 'permission')} sur ${catalogue.length}`} />
      <Liste libelle="Rôle" value={role.id} options={options} onChange={(v) => choisirRole(v)} />
      {espaceParent ? (
        <Note>Les permissions de l’espace parent sont fixées par l’application : chaque famille ne voit que ses propres enfants.</Note>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {groupes.map(([g, ps]) => (
            <div key={g} style={{ display: 'flex', flexDirection: 'column' }}>
              <Etiquette>{g}</Etiquette>
              {ps.map((p) => <CaseACocher key={p.code} libelle={p.libelle} valeur={vue.has(p.code)} onChange={modifiable ? (v) => basculer(p.code, v) : undefined} />)}
            </div>
          ))}
        </div>
      )}
      {modifie && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Bouton variante="principal" charge={charge} onClick={enregistrer}>Enregistrer les permissions</Bouton>
          <Bouton onClick={() => setCochees(null)}>Annuler</Bouton>
        </div>
      )}
      {moi.a('core.role.gerer') && !espaceParent && <div><Bouton icone="ajouter" onClick={creerRole}>Créer un rôle à partir de celui-ci</Bouton></div>}
      <Doux>{enLettres(systeme, true)} rôles prêts à l’emploi. La secrétaire peut créer un rôle et lui attribuer des permissions.</Doux>
    </Panneau>
  );
}

// ---------------------------------------------------------------- écran Utilisateurs et rôles

export function EcranUtilisateurs() {
  const moi = useMoi();
  const comptes = useDonnees(() => api.get<Compte[]>('/core/comptes'));
  const roles = useDonnees(() => api.get<Role[]>('/core/roles'));
  const catalogue = useDonnees(() => api.get<Permission[]>('/core/permissions'));
  const [q, setQ] = useState('');
  const recherche = useDiffere(sansAccent(q));
  const [type, setType] = useState<'personnel' | 'famille' | 'tous'>('personnel');
  const [page, setPage] = useState(1);
  const [roleId, setRoleId] = useState<string | null>(null);
  useEffect(() => { setPage(1); }, [recherche, type]);

  const filtres = useMemo(() => (comptes.d ?? []).filter((c) => (type === 'tous' || c.type === type)
    && (!recherche || sansAccent(c.nomAffiche).includes(recherche) || sansAccent(c.identifiant).includes(recherche))), [comptes.d, type, recherche]);
  const visibles = filtres.slice((page - 1) * TAILLE_COMPTES, page * TAILLE_COMPTES);

  const nouveauCompte = async () => {
    if (!roles.d) return;
    const fiches = await agir(() => api.get<{ lignes: (PersonnelSansCompte & { compte: string | null })[] }>(`/personnel${requete({ taille: 500 })}`));
    const sansCompte = (fiches?.lignes ?? []).filter((p) => !p.compte);
    if (await creerCompte(roles.d, {}, sansCompte)) void comptes.recharger();
  };
  const modifier = async (c: Compte) => {
    if (!roles.d) return;
    const ok = await ouvrirFormulaire<boolean>(`Modifier le compte · ${c.nomAffiche}`, ({ fermer }) => <FenetreModifierCompte fermer={fermer} compte={c} roles={roles.d!} />, 520);
    if (ok) { void comptes.recharger(); void roles.recharger(); }
  };
  const reinitialiser = async (c: Compte) => {
    const ok = await confirmer('Réinitialiser le mot de passe',
      `Un nouveau mot de passe est créé pour ${c.nomAffiche} ; l’ancien ne fonctionne plus et les sessions ouvertes de ce compte sont fermées.`, 'Réinitialiser');
    if (!ok) return;
    const r = await agir(() => api.post<{ motDePasse: string; type: string }>(`/core/comptes/${c.id}/reinitialisation`));
    if (!r) return;
    await montrerMotDePasse('Nouveau mot de passe', c.identifiant, r.motDePasse, r.type === 'famille'
      ? 'Communiquez-le à la famille : l’application du parent s’ouvre avec le numéro de téléphone et ce mot de passe.'
      : `Remettez-le à ${c.nomAffiche} : la connexion est possible tout de suite.`);
  };
  const basculer = async (c: Compte) => {
    const ok = await confirmer(c.actif ? 'Désactiver le compte' : 'Réactiver le compte', c.actif
      ? `${c.nomAffiche} ne pourra plus se connecter et les sessions ouvertes de ce compte sont fermées. Le compte et son historique sont conservés.`
      : `${c.nomAffiche} pourra de nouveau se connecter avec le mot de passe actuel du compte.`, c.actif ? 'Désactiver' : 'Réactiver');
    if (ok && await agir(() => api.post(`/core/comptes/${c.id}/desactivation`), c.actif ? 'Compte désactivé' : 'Compte réactivé')) void comptes.recharger();
  };

  const nbRoles = roles.d?.length ?? 0;
  const tableau = comptes.erreur && !comptes.d ? <Erreur message={comptes.erreur} recharger={comptes.recharger} /> : !comptes.d ? <Chargement /> : (
    <>
      <Tableau
        colonnes={[{ titre: 'Compte' }, { titre: 'Rôles' }, { titre: 'Périmètre' }, { titre: 'État' }, { titre: 'Actions', droite: true }]}
        cles={visibles.map((c) => c.id)}
        vide="Aucun compte ne correspond à cette recherche."
        lignes={visibles.map((c) => [
          <Cel2 gras haut={c.nomAffiche} bas={c.identifiant} />,
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>{c.roles.map((r) => <Pastille key={r} ton="accent">{r}</Pastille>)}</div>,
          c.perimetre,
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2 }}>
            <Pastille ton={c.actif ? 'succes' : 'neutre'}>{c.actif ? 'Actif' : 'Désactivé'}</Pastille>
            {c.derniereActivite && <Doux>{jourHeure(c.derniereActivite)}</Doux>}
          </div>,
          <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
            {moi.a('core.compte.gerer') && c.type !== 'famille' && <Bouton petit icone="colonnes" title={`Modifier le compte de ${c.nomAffiche}`} onClick={() => modifier(c)} />}
            {moi.a('core.compte.reinitialiser') && c.actif && <Bouton petit icone="bouclier" title={`Réinitialiser le mot de passe de ${c.nomAffiche}`} onClick={() => reinitialiser(c)} />}
            {moi.a('core.compte.desactiver') && c.id !== moi.compteId && (c.actif
              ? <Bouton petit icone="fermer" title={`Désactiver le compte de ${c.nomAffiche}`} onClick={() => basculer(c)} />
              : <Bouton petit icone="coche" title={`Réactiver le compte de ${c.nomAffiche}`} onClick={() => basculer(c)} />)}
          </div>,
        ])}
      />
      <Pagination total={filtres.length} page={page} taille={TAILLE_COMPTES} nombre={visibles.length} mot="compte" changer={setPage} />
    </>
  );

  return (
    <Coque module="parametres">
      <Colonnes colonnes={[
        { flex: 5, min: 640, enfants: (
          <Panneau>
            <TitrePanneau titre="Comptes" sous={nbRoles ? `${enLettres(nbRoles, true)} rôles ; une même personne peut en cumuler plusieurs` : undefined}
              action={moi.a('core.compte.gerer') && <Bouton variante="principal" icone="ajouter" onClick={nouveauCompte} disabled={!roles.d}>Nouveau compte</Bouton>} />
            <Filtres champs={<>
              <Champ placeholder="Nom ou identifiant" ariaLabel="Rechercher un compte" value={q} onChange={setQ} largeur={260} />
              <Bascules options={[['personnel', 'Personnel'], ['famille', 'Familles'], ['tous', 'Tous']]} valeur={type} onChange={setType} />
            </>} />
            {tableau}
            <Doux>Un compte peut cumuler plusieurs rôles, chacun limité à un périmètre : établissement, cycle, classe ou matière.</Doux>
          </Panneau>
        ) },
        { flex: 2, min: 320, enfants: (
          roles.erreur && !roles.d ? <Erreur message={roles.erreur} recharger={roles.recharger} />
            : catalogue.erreur && !catalogue.d ? <Erreur message={catalogue.erreur} recharger={catalogue.recharger} />
              : roles.d && catalogue.d ? <PanneauPermissions roles={roles.d} catalogue={catalogue.d} roleId={roleId} choisirRole={setRoleId} recharger={roles.recharger} />
                : <Panneau><TitrePanneau titre="Permissions du rôle" /><Chargement /></Panneau>
        ) },
      ]} />
    </Coque>
  );
}

// ---------------------------------------------------------------- écran Journal d'audit

interface LigneJournal {
  id: string; horodatage: string; utilisateur: string; action: string; objetType: string | null; objet: string; avant: string | null; apres: string | null;
}
interface Journal {
  total: number; page: number; taille: number; lignes: LigneJournal[];
  options: { utilisateurs: { id: string; nom: string }[]; objets: string[]; actions: string[] };
}

const TAILLE_JOURNAL = 8;
const TON_ACTION: Record<string, Ton> = {
  Création: 'accent', Import: 'accent', Modification: 'neutre', Export: 'neutre', Demande: 'attention', 'Levée de blocage': 'attention',
  Réinitialisation: 'attention', Validation: 'succes', Publication: 'succes', Annulation: 'danger', Refus: 'danger', Désactivation: 'danger', Suppression: 'danger',
};
const parNom = (a: string, b: string) => a.localeCompare(b, 'fr');

export function EcranAudit() {
  const moi = useMoi();
  const [du, setDu] = useState('');
  const [au, setAu] = useState('');
  const [utilisateur, setUtilisateur] = useState<string | null>(null);
  const [objet, setObjet] = useState<string | null>(null);
  const [action, setAction] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const duIso = du.trim() ? versIso(du) : null;
  const auIso = au.trim() ? versIso(au) : null;
  const duFaux = !!du.trim() && !duIso;
  const auFaux = !!au.trim() && !auIso;
  useEffect(() => { setPage(1); }, [duIso, auIso, utilisateur, objet, action]);
  const j = useDonnees(() => api.get<Journal>(`/core/journal${requete({ du: duIso, au: auIso, utilisateur, objet, action, page, taille: TAILLE_JOURNAL })}`),
    [duIso, auIso, utilisateur, objet, action, page]);
  const o = j.d?.options;
  const optUtilisateurs: [string | null, string][] = [[null, 'Tous'], ...[...(o?.utilisateurs ?? [])].sort((a, b) => parNom(a.nom, b.nom)).map((u): [string, string] => [u.id, u.nom])];
  const optObjets: [string | null, string][] = [[null, 'Tous'], ...[...(o?.objets ?? [])].sort(parNom).map((x): [string, string] => [x, x])];
  const optActions: [string | null, string][] = [[null, 'Toutes'], ...[...(o?.actions ?? [])].sort(parNom).map((x): [string, string] => [x, x])];
  const d = j.d;
  return (
    <Coque module="parametres">
      <Filtres
        champs={<>
          <Champ libelle="Du" placeholder="JJ/MM/AAAA" value={du} onChange={setDu} largeur={140} erreur={duFaux ? 'Date JJ/MM/AAAA' : null} />
          <Champ libelle="Au" placeholder="JJ/MM/AAAA" value={au} onChange={setAu} largeur={140} erreur={auFaux ? 'Date JJ/MM/AAAA' : null} />
          <Liste libelle="Utilisateur" value={utilisateur} options={optUtilisateurs} onChange={setUtilisateur} largeur={220} />
          <Liste libelle="Objet" value={objet} options={optObjets} onChange={setObjet} largeur={180} />
          <Liste libelle="Action" value={action} options={optActions} onChange={setAction} largeur={180} />
        </>}
        actions={moi.a('core.audit.exporter') && (
          <Bouton icone="exporter" onClick={() => telecharger(`/core/journal/export${requete({ du: duIso, au: auIso, utilisateur, objet, action })}`)}>Exporter</Bouton>
        )}
      />
      <Bandeau icone="bouclier">Le journal se consulte et se filtre ; il ne se modifie pas et ne se vide pas depuis l’application.</Bandeau>
      <Panneau>
        <TitrePanneau titre="Journal" />
        {j.erreur && !d ? <Erreur message={j.erreur} recharger={j.recharger} /> : !d ? <Chargement /> : (
          <>
            <Tableau
              colonnes={[{ titre: 'Date' }, { titre: 'Utilisateur' }, { titre: 'Action' }, { titre: 'Objet' }, { titre: 'Avant' }, { titre: 'Après' }]}
              cles={d.lignes.map((l) => l.id)}
              vide="Aucune opération ne correspond à ces critères."
              lignes={d.lignes.map((l) => [
                <span style={{ whiteSpace: 'nowrap' }}>{dateHeure(l.horodatage)}</span>,
                l.utilisateur,
                <Pastille ton={TON_ACTION[l.action] ?? 'neutre'}>{l.action}</Pastille>,
                l.objet,
                l.avant || '–',
                l.apres || '–',
              ])}
            />
            <Pagination total={d.total} page={page} taille={TAILLE_JOURNAL} nombre={d.lignes.length} mot="ligne" changer={setPage} />
          </>
        )}
      </Panneau>
    </Coque>
  );
}
