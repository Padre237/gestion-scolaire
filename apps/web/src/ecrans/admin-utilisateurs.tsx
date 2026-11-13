// Maquettes Utilisateurs (comptes, rôles et permissions) et Audit (journal d'audit, consultation seule).
import { useEffect, useMemo, useState } from 'react';
import { api, ErreurApi, requete } from '../core/api.ts';
import { Coque } from '../core/coque.tsx';
import { useMoi } from '../core/session.tsx';
import { telecharger } from '../core/documents.ts';
import { enLettres, pluriel, versIso } from '../core/format.ts';
import {
  agir, Bandeau, Bascules, Bouton, CaseACocher, Cel2, Champ, Chargement, Colonnes, confirmer, Doux, Erreur, Etiquette, Filtres, Icone, Liste, Note,
  ouvrirFormulaire, Panneau, Pastille, PiedFenetre, Tableau, TitrePanneau, useDonnees, type Ton,
} from '../core/ui.tsx';
import {
  BoutonAction, creerCompte, dateHeure, jourHeure, montrerMotDePasse, Pagination, rolesAttribuables, sansAccent, useDiffere, useEtroit, type PersonnelSansCompte, type Role,
} from './admin-commun.tsx';

interface Attribution { roleId: string; cycleId: string | null; du: string | null; au: string | null; libelle: string }
interface Compte {
  id: string; identifiant: string; nomAffiche: string; type: string; actif: boolean; derniereActivite: string | null; roles: string[]; perimetre: string;
  attributions: Attribution[];
}
interface PermissionParticuliere { id: string; code: string; libelle: string; du: string | null; au: string | null; motif: string | null }
const aujourdhui = () => new Date(Date.now() + 3600_000).toISOString().slice(0, 10);
const dateFr = (iso: string | null) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '');
/** « jusqu'au 30/06/2027 », « du 01/12/2026 au 31/12/2026 », « échu le … » ; vide : sans limite. */
function periode(du: string | null, au: string | null): string {
  if (au && au < aujourdhui()) return `échu le ${dateFr(au)}`;
  if (du && du > aujourdhui()) return `à partir du ${dateFr(du)}${au ? ` jusqu’au ${dateFr(au)}` : ''}`;
  return au ? `jusqu’au ${dateFr(au)}` : '';
}
/** Saisie JJ/MM/AAAA → AAAA-MM-JJ ; vide → null ; illégale → undefined. */
const dateSaisie = (s: string): string | null | undefined => (s.trim() ? versIso(s.trim()) ?? undefined : null);
interface Permission { code: string; groupe: string; libelle: string; libelleEn: string }

const TAILLE_COMPTES = 10;

// ---------------------------------------------------------------- fenêtres

function FenetreModifierCompte({ fermer, compte, roles }: { fermer: (ok?: boolean) => void; compte: Compte; roles: Role[] }) {
  const [nom, setNom] = useState(compte.nomAffiche);
  const [choisis, setChoisis] = useState(roles.filter((r) => compte.roles.includes(r.libelle)).map((r) => r.id));
  // Période de chaque rôle (D-46) : vide = sans limite.
  const [periodes, setPeriodes] = useState<Record<string, { du: string; au: string }>>(Object.fromEntries(compte.attributions.map((a) => [a.roleId, { du: dateFr(a.du), au: dateFr(a.au) }])));
  const [erreur, setErreur] = useState<string | null>(null);
  const [charge, setCharge] = useState(false);
  const valider = async () => {
    if (nom.trim().length < 2) return setErreur('Nom à afficher requis (2 caractères au moins).');
    if (!choisis.length) return setErreur('Choisissez au moins un rôle.');
    const roles = [];
    for (const roleId of choisis) {
      const p = periodes[roleId] ?? { du: '', au: '' };
      const du = dateSaisie(p.du), au = dateSaisie(p.au);
      if (du === undefined || au === undefined) return setErreur('Dates au format JJ/MM/AAAA, ou laissées vides (sans limite).');
      if (du && au && au < du) return setErreur('La fin d’une période doit suivre son début.');
      roles.push({ roleId, cycleId: compte.attributions.find((a) => a.roleId === roleId)?.cycleId ?? null, du, au });
    }
    setCharge(true);
    try {
      await api.patch(`/core/comptes/${compte.id}`, { nomAffiche: nom.trim(), roles });
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
        <div className="pile-mobile" style={{ display: 'flex', flexWrap: 'wrap', columnGap: 18 }}>
          {rolesAttribuables(roles).map((r) => (
            <CaseACocher key={r.id} libelle={r.libelle} valeur={choisis.includes(r.id)}
              onChange={(v) => setChoisis((c) => (v ? [...c, r.id] : c.filter((x) => x !== r.id)))} />
          ))}
        </div>
      </div>
      {choisis.length > 0 && (
        <div className="champ-groupe">
          <span className="libelle">Période de chaque rôle (vide : sans limite)</span>
          {choisis.map((id) => {
            const p = periodes[id] ?? { du: '', au: '' };
            const maj = (x: Partial<{ du: string; au: string }>) => setPeriodes((o) => ({ ...o, [id]: { ...p, ...x } }));
            return (
              <div key={id} className="grille pile-mobile" style={{ ['--min' as string]: '140px', gap: 10, alignItems: 'end' }}>
                <span className="gras" style={{ alignSelf: 'center' }}>{roles.find((r) => r.id === id)?.libelle}</span>
                <Champ libelle="Du" placeholder="JJ/MM/AAAA" value={p.du} onChange={(v) => maj({ du: v })} />
                <Champ libelle="Au" placeholder="JJ/MM/AAAA" value={p.au} onChange={(v) => maj({ au: v })} />
              </div>
            );
          })}
        </div>
      )}
      <Doux>Le périmètre suit les affectations : classes et matières confiées dans Notes et bulletins.</Doux>
      {erreur && <div role="alert"><Note ton="danger">{erreur}</Note></div>}
      <PiedFenetre fermer={() => fermer()} action="Enregistrer" onAction={valider} charge={charge} />
    </>
  );
}

function FenetreNouveauRole({ fermer, base }: { fermer: (id?: string) => void; base: Role }) {
  const [libelle, setLibelle] = useState('');
  const [libelleEn, setLibelleEn] = useState('');
  const [depart, setDepart] = useState<'base' | 'vide'>('vide');
  const [du, setDu] = useState('');
  const [au, setAu] = useState('');
  const [erreur, setErreur] = useState<string | null>(null);
  const [charge, setCharge] = useState(false);
  const valider = async () => {
    if (libelle.trim().length < 2) return setErreur('Nom du rôle requis (2 caractères au moins).');
    const d = dateSaisie(du), a = dateSaisie(au);
    if (d === undefined || a === undefined) return setErreur('Dates au format JJ/MM/AAAA, ou laissées vides (sans limite).');
    setCharge(true);
    try {
      const r = await api.post<{ id: string }>('/core/roles', { libelle: libelle.trim(), ...(libelleEn.trim() ? { libelleEn: libelleEn.trim() } : {}),
        ...(depart === 'base' ? { depuisRoleId: base.id } : { permissions: [] }), du: d, au: a });
      fermer(r.id);
    } catch (e) {
      setErreur(e instanceof ErreurApi ? e.message : String(e));
      setCharge(false);
    }
  };
  return (
    <>
      <Champ libelle="Nom du rôle" value={libelle} onChange={setLibelle} autoFocus erreur={erreur} />
      <Champ libelle="Name (English)" value={libelleEn} onChange={setLibelleEn} />
      <div className="champ-groupe"><span className="libelle">Actions du rôle</span>
        <Bascules options={[['vide', 'Choisies une à une'], ['base', `Celles de « ${base.libelle} »`]]} valeur={depart} onChange={setDepart} />
      </div>
      <Doux>{depart === 'vide' ? 'Le rôle est créé sans action : cochez ensuite celles qu’il donne.' : `Le rôle reprend les ${pluriel(base.permissions.length, 'permission')} de « ${base.libelle} » ; vous les ajustez ensuite.`}</Doux>
      <div className="grille pile-mobile" style={{ ['--min' as string]: '160px', gap: 10 }}>
        <Champ libelle="Valable du (facultatif)" placeholder="JJ/MM/AAAA" value={du} onChange={setDu} />
        <Champ libelle="au (vide : sans limite)" placeholder="JJ/MM/AAAA" value={au} onChange={setAu} />
      </div>
      <PiedFenetre fermer={() => fermer()} action="Créer le rôle" onAction={valider} charge={charge} />
    </>
  );
}

function FenetrePeriodeRole({ role, fermer }: { role: Role; fermer: (ok?: boolean) => void }) {
  const [du, setDu] = useState(dateFr(role.du ?? null));
  const [au, setAu] = useState(dateFr(role.au ?? null));
  const [erreur, setErreur] = useState<string | null>(null);
  const valider = async () => {
    const d = dateSaisie(du), a = dateSaisie(au);
    if (d === undefined || a === undefined) return setErreur('Dates au format JJ/MM/AAAA, ou laissées vides (sans limite).');
    try { await api.patch(`/core/roles/${role.id}`, { du: d, au: a }); fermer(true); } catch (e) { setErreur(e instanceof ErreurApi ? e.message : String(e)); }
  };
  return (
    <>
      <Doux>Hors de cette période, le rôle ne donne aucun droit aux personnes qui l’ont.</Doux>
      <div className="grille" style={{ ['--min' as string]: '160px', gap: 10 }}>
        <Champ libelle="Du" placeholder="JJ/MM/AAAA" value={du} onChange={setDu} />
        <Champ libelle="Au (vide : sans limite)" placeholder="JJ/MM/AAAA" value={au} onChange={setAu} />
      </div>
      {erreur && <div role="alert"><Note ton="danger">{erreur}</Note></div>}
      <PiedFenetre fermer={() => fermer()} action="Enregistrer" onAction={valider} />
    </>
  );
}

/** Attributions particulières d'un compte : actions données à cette personne en plus de ses rôles (D-46). */
function FenetreAttributions({ compte, catalogue, fermer }: { compte: Compte; catalogue: Permission[]; fermer: () => void }) {
  const liste = useDonnees(() => api.get<PermissionParticuliere[]>(`/core/comptes/${compte.id}/permissions`));
  const [code, setCode] = useState<string | null>(null);
  const [du, setDu] = useState('');
  const [au, setAu] = useState('');
  const [motif, setMotif] = useState('');
  const [erreur, setErreur] = useState<string | null>(null);
  const ajouter = async () => {
    const d = dateSaisie(du), a = dateSaisie(au);
    if (!code) return setErreur('Choisissez l’action à donner.');
    if (d === undefined || a === undefined) return setErreur('Dates au format JJ/MM/AAAA.');
    if (!a) return setErreur('Indiquez la date de fin : une attribution particulière est toujours limitée dans le temps.');
    setErreur(null);
    if (await agir(() => api.post(`/core/comptes/${compte.id}/permissions`, { permission: code, du: d, au: a, motif: motif.trim() || null }), 'Attribution enregistrée')) {
      setCode(null); setDu(''); setAu(''); setMotif(''); await liste.recharger();
    }
  };
  const retirer = async (p: PermissionParticuliere) => {
    if (await agir(() => api.del(`/core/comptes/${compte.id}/permissions/${p.id}`), 'Attribution retirée')) await liste.recharger();
  };
  return (
    <>
      <Doux>Actions données à {compte.nomAffiche} en plus de ses rôles ({compte.roles.join(', ') || 'aucun'}), toujours pour une période définie.</Doux>
      {liste.erreur ? <Erreur message={liste.erreur} recharger={liste.recharger} /> : !liste.d ? <Chargement /> : (
        <Tableau colonnes={[{ titre: 'Action', mobile: 'entete' }, { titre: 'Période' }, { titre: 'Motif' }, { titre: '', droite: true }]}
          vide="Aucune attribution particulière."
          lignes={liste.d.map((p) => [<span className="gras">{p.libelle}</span>, periode(p.du, p.au) || 'Sans limite', p.motif ?? '–',
            <Bouton petit variante="lien" onClick={() => retirer(p)}>Retirer</Bouton>])} />
      )}
      <span className="etiquette">Nouvelle attribution</span>
      <Liste libelle="Action" value={code} onChange={setCode} options={[[null, 'Choisir une action…'], ...catalogue.map((p): [string, string] => [p.code, `${p.groupe} · ${p.libelle}`])]} />
      <div className="grille pile-mobile" style={{ ['--min' as string]: '150px', gap: 10 }}>
        <Champ libelle="Du (facultatif)" placeholder="JJ/MM/AAAA" value={du} onChange={setDu} />
        <Champ libelle="Au" placeholder="JJ/MM/AAAA" value={au} onChange={setAu} />
        <Champ libelle="Motif (facultatif)" value={motif} onChange={setMotif} placeholder="Remplacement, mission…" />
      </div>
      {erreur && <div role="alert"><Note ton="danger">{erreur}</Note></div>}
      <div className="pied"><Bouton onClick={() => fermer()}>Fermer</Bouton><Bouton variante="principal" onClick={ajouter}>Donner cette action</Bouton></div>
    </>
  );
}

// ---------------------------------------------------------------- permissions du rôle

function PanneauPermissions({ roles, catalogue, roleId, choisirRole, recharger }: {
  roles: Role[]; catalogue: Permission[]; roleId: string | null; choisirRole: (id: string) => void; recharger: () => Promise<void>;
}) {
  const moi = useMoi();
  const etroit = useEtroit();
  const role = roles.find((r) => r.id === roleId) ?? roles[0];
  const [cochees, setCochees] = useState<Set<string> | null>(null);
  // Sections repliées par défaut sur téléphone (92 permissions), ouvertes sur grand écran comme la maquette ; chaque section a une ancre.
  const [ouvertes, setOuvertes] = useState<Record<string, boolean> | null>(null);
  const estOuverte = (g: string) => ouvertes?.[g] ?? !etroit;
  const basculerSection = (g: string) => setOuvertes((o) => ({ ...(o ?? {}), [g]: !estOuverte(g) }));
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
  const modifierPeriode = async () => {
    const ok = await ouvrirFormulaire<boolean>(`Période · ${role.libelle}`, ({ fermer }) => <FenetrePeriodeRole role={role} fermer={fermer} />, 460);
    if (ok) await recharger();
  };
  const options: [string, string][] = roles.map((r) => [r.id, `${r.libelle}${!r.systeme && (r.du || r.au) ? ` · ${periode(r.du ?? null, r.au ?? null) || 'daté'}` : ''}`]);
  const systeme = roles.filter((r) => r.systeme).length;
  return (
    <Panneau>
      <TitrePanneau titre="Permissions du rôle" sous={espaceParent ? undefined : `${pluriel(vue.size, 'permission')} sur ${catalogue.length}`} />
      <Liste libelle="Rôle" value={role.id} options={options} onChange={(v) => choisirRole(v)} />
      {espaceParent ? (
        <Note>Les permissions de l’espace parent sont fixées par l’application : chaque famille ne voit que ses propres enfants.</Note>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: etroit ? 4 : 12 }}>
          {etroit && groupes.length > 1 && (
            <nav aria-label="Sections des permissions" className="defile-x" style={{ gap: 8, paddingBottom: 4, margin: '0 -4px', padding: '0 4px 4px' }}>
              {groupes.map(([g]) => (
                <a key={g} href={`#permissions-${sansAccent(g).replace(/[^a-z0-9]+/g, '-')}`} className="pastille" style={{ height: 40, textDecoration: 'none' }}
                  onClick={() => setOuvertes((o) => ({ ...(o ?? {}), [g]: true }))}>{g}</a>
              ))}
            </nav>
          )}
          {groupes.map(([g, ps]) => {
            const id = `permissions-${sansAccent(g).replace(/[^a-z0-9]+/g, '-')}`;
            const cochees = ps.filter((p) => vue.has(p.code)).length;
            const ouverte = estOuverte(g);
            return (
              <section key={g} id={id} aria-labelledby={`${id}-titre`} style={{ display: 'flex', flexDirection: 'column', scrollMarginTop: 12 }}>
                {etroit ? (
                  <button type="button" aria-expanded={ouverte} aria-controls={`${id}-liste`} onClick={() => basculerSection(g)}
                    style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 44, padding: 0, border: 0, background: 'none', cursor: 'pointer', font: 'inherit', textAlign: 'left', width: '100%' }}>
                    <Icone nom="chevron" taille={16} style={{ color: 'var(--doux)', transform: ouverte ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s' }} />
                    <Etiquette style={{ flex: 1 }}><span id={`${id}-titre`}>{g}</span></Etiquette>
                    <Doux>{cochees} / {ps.length}</Doux>
                  </button>
                ) : <Etiquette><span id={`${id}-titre`}>{g}</span></Etiquette>}
                {ouverte && (
                  <div id={`${id}-liste`} style={{ display: 'flex', flexDirection: 'column' }}>
                    {ps.map((p) => <CaseACocher key={p.code} libelle={p.libelle} valeur={vue.has(p.code)} onChange={modifiable ? (v) => basculer(p.code, v) : undefined} />)}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}
      {modifie && (
        <div className="pile-mobile" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Bouton variante="principal" charge={charge} onClick={enregistrer}>Enregistrer les permissions</Bouton>
          <Bouton onClick={() => setCochees(null)}>Annuler</Bouton>
        </div>
      )}
      {!role.systeme && (role.du || role.au) && <Note ton={role.au && role.au < aujourdhui() ? 'attention' : 'neutre'}>Rôle valable {role.du ? `du ${dateFr(role.du)} ` : ''}{role.au ? `au ${dateFr(role.au)}` : 'sans limite'}{role.au && role.au < aujourdhui() ? ' : échu, il ne donne plus aucun droit.' : '.'}</Note>}
      {moi.a('core.role.gerer') && !espaceParent && <div className="pile-mobile" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Bouton icone="ajouter" onClick={creerRole}>Créer un rôle</Bouton>
        {!role.systeme && <Bouton onClick={modifierPeriode}>Période du rôle</Bouton>}
      </div>}
      <Doux>{enLettres(systeme, true)} rôles prêts à l’emploi. Le directeur crée des rôles sur mesure et donne des droits à une personne pour une période définie ; deux actions incompatibles ne vont jamais au même rôle ni au même compte.</Doux>
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
  const attributions = async (c: Compte) => {
    await ouvrirFormulaire(`Attributions particulières · ${c.nomAffiche}`, ({ fermer }) => <FenetreAttributions compte={c} catalogue={catalogue.d ?? []} fermer={fermer} />, 720);
    void comptes.recharger();
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
        colonnes={[{ titre: 'Compte', mobile: 'entete' }, { titre: 'Rôles' }, { titre: 'Périmètre' }, { titre: 'État' }, { titre: 'Actions', droite: true }]}
        cles={visibles.map((c) => c.id)}
        vide="Aucun compte ne correspond à cette recherche."
        lignes={visibles.map((c) => [
          <Cel2 gras haut={c.nomAffiche} bas={c.identifiant} />,
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>{(c.attributions?.length ? c.attributions : c.roles.map((libelle) => ({ libelle, du: null, au: null }))).map((a) => {
            const p = periode(a.du, a.au);
            return <Pastille key={a.libelle} ton={p.startsWith('échu') ? 'neutre' : 'accent'}>{a.libelle}{p ? ` · ${p}` : ''}</Pastille>;
          })}</div>,
          c.perimetre,
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '2px 8px' }}>
            <Pastille ton={c.actif ? 'succes' : 'neutre'}>{c.actif ? 'Actif' : 'Désactivé'}</Pastille>
            {c.derniereActivite && <Doux>{jourHeure(c.derniereActivite)}</Doux>}
          </div>,
          <div className="pile-mobile" style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
            {moi.a('core.compte.gerer') && c.type !== 'famille' && c.id !== moi.compteId && <BoutonAction icone="colonnes" court="Modifier le compte" libelle={`Modifier le compte de ${c.nomAffiche}`} onClick={() => modifier(c)} />}
            {moi.a('core.compte.gerer') && c.type !== 'famille' && c.id !== moi.compteId && catalogue.d && <BoutonAction icone="ajouter" court="Attributions particulières" libelle={`Attributions particulières de ${c.nomAffiche}`} onClick={() => attributions(c)} />}
            {moi.a('core.compte.reinitialiser') && c.actif && <BoutonAction icone="bouclier" court="Réinitialiser le mot de passe" libelle={`Réinitialiser le mot de passe de ${c.nomAffiche}`} onClick={() => reinitialiser(c)} />}
            {moi.a('core.compte.desactiver') && c.id !== moi.compteId && (c.actif
              ? <BoutonAction icone="fermer" danger court="Désactiver" libelle={`Désactiver le compte de ${c.nomAffiche}`} onClick={() => basculer(c)} />
              : <BoutonAction icone="coche" court="Réactiver" libelle={`Réactiver le compte de ${c.nomAffiche}`} onClick={() => basculer(c)} />)}
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
              action={moi.a('core.compte.gerer') && <span className="pleine-mobile" style={{ display: 'inline-flex' }}><Bouton variante="principal" pleine icone="ajouter" onClick={nouveauCompte} disabled={!roles.d}>Nouveau compte</Bouton></span>} />
            <Filtres champs={<>
              <Champ placeholder="Nom ou identifiant" ariaLabel="Rechercher un compte" value={q} onChange={setQ} largeur={260} />
              <div role="group" aria-label="Type de comptes"><Bascules options={[['personnel', 'Personnel'], ['famille', 'Familles'], ['tous', 'Tous']]} valeur={type} onChange={setType} /></div>
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
          <Champ libelle="Du" placeholder="JJ/MM/AAAA" inputMode="numeric" value={du} onChange={setDu} largeur={140} erreur={duFaux ? 'Date JJ/MM/AAAA' : null} />
          <Champ libelle="Au" placeholder="JJ/MM/AAAA" inputMode="numeric" value={au} onChange={setAu} largeur={140} erreur={auFaux ? 'Date JJ/MM/AAAA' : null} />
          <Liste libelle="Utilisateur" value={utilisateur} options={optUtilisateurs} onChange={setUtilisateur} largeur={220} />
          <Liste libelle="Objet" value={objet} options={optObjets} onChange={setObjet} largeur={180} />
          <Liste libelle="Action" value={action} options={optActions} onChange={setAction} largeur={180} />
        </>}
        actions={moi.a('core.audit.exporter') && (
          <div className="pleine-mobile"><Bouton pleine icone="exporter" onClick={() => telecharger(`/core/journal/export${requete({ du: duIso, au: auIso, utilisateur, objet, action })}`)}>Exporter</Bouton></div>
        )}
      />
      <Bandeau icone="bouclier">Le journal se consulte et se filtre ; il ne se modifie pas et ne se vide pas depuis l’application.</Bandeau>
      <Panneau>
        <TitrePanneau titre="Journal" />
        {j.erreur && !d ? <Erreur message={j.erreur} recharger={j.recharger} /> : !d ? <Chargement /> : (
          <>
            <Tableau
              colonnes={[{ titre: 'Date', mobile: 'entete' }, { titre: 'Utilisateur' }, { titre: 'Action' }, { titre: 'Objet' }, { titre: 'Avant' }, { titre: 'Après' }]}
              cles={d.lignes.map((l) => l.id)}
              vide="Aucune opération ne correspond à ces critères."
              lignes={d.lignes.map((l) => [
                <span style={{ whiteSpace: 'nowrap' }}>{dateHeure(l.horodatage)}</span>,
                l.utilisateur,
                <Pastille ton={TON_ACTION[l.action] ?? 'neutre'}>{l.action}</Pastille>,
                <span style={{ overflowWrap: 'anywhere' }}>{l.objet}</span>,
                <span style={{ overflowWrap: 'anywhere' }}>{l.avant || '–'}</span>,
                <span style={{ overflowWrap: 'anywhere' }}>{l.apres || '–'}</span>,
              ])}
            />
            <Pagination total={d.total} page={page} taille={TAILLE_JOURNAL} nombre={d.lignes.length} mot="ligne" changer={setPage} />
          </>
        )}
      </Panneau>
    </Coque>
  );
}
