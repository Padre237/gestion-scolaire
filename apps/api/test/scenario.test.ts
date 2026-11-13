// Scénario de démonstration de bout en bout sur une base vide (prompt § 7, DEMO.md), avec les règles
// de gestion et les refus de droits (403) vérifiés côté serveur. Les étapes s'appuient les unes sur les autres.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, connecter, connecterParent, preparer, auj, jourSemaine } from './aide.ts';
import { FORMULAIRE_PAR_DEFAUT } from '@gs/shared';

type Env = Awaited<ReturnType<typeof preparer>>;
let env: Env;
let sec: Client, dir: Client, eco: Client, pre: Client, ip: Client, im: Client, mixte: Client;
let adm: Client;
const ids: Record<string, string> = {};
let famille1: { telephone: string; motDePasse: string };
let familleCm2: { telephone: string; motDePasse: string }[] = [];

beforeAll(async () => {
  env = await preparer();
  sec = await connecter(env.app, 'secretaire', 'secret-demo-1');
  adm = await connecter(env.app, 'directeur', 'secret-dir-1');
});
afterAll(async () => { await env?.fermer(); });

describe('Socle : connexion, sessions, droits (CU-01, ENF-05, conception § 8)', () => {
  it('refuse un mauvais mot de passe sans dire si le compte existe', async () => {
    const r = await new Client(env.app).post('/auth/connexion', { identifiant: 'secretaire', motDePasse: 'faux' });
    expect(r.status).toBe(401);
    expect((await new Client(env.app).post('/auth/connexion', { identifiant: 'inconnu', motDePasse: 'faux' })).corps.code).toBe('CORE_IDENTIFIANTS_INVALIDES');
  });
  it('exige une session sur l\'API (401)', async () => {
    expect((await new Client(env.app).get('/structure/etablissement')).status).toBe(401);
  });
  it('décrit la personne connectée et l\'écran de connexion lit l\'établissement dans la base', async () => {
    const moi = await sec.get('/auth/moi');
    expect(moi.corps.libelleRoles).toBe('Secrétaire');
    expect(moi.corps.etablissement.nomFr).toBe('École de démonstration');
    const accueil = await new Client(env.app).get('/auth/accueil');
    expect(accueil.corps.nomFr).toBe('École de démonstration');
  });
});

describe('Étape 1 · la secrétaire paramètre l\'établissement, le directeur crée les comptes (CU-02, CU-03, E-07, D-46)', () => {
  it('paramètre l\'identité et le seuil de réduction', async () => {
    const r = await sec.put('/structure/etablissement', { nomFr: 'École de démonstration', nomEn: 'Demonstration School', seuilReduction: 5000,
      telephone: '600 000 200', villeBp: 'Yaoundé · BP 1234', banque: 'Banque de démonstration', numeroCompte: '00012 345678 90' });
    expect(r.status).toBe(200);
  });
  it('crée et ouvre l\'année 2026/2027, avec trois trimestres (D-11)', async () => {
    const r = await sec.post('/structure/annees', { libelle: '2026/2027', dateDebut: '2026-09-07', dateFin: '2027-06-25', ouvrir: true });
    expect(r.status).toBe(200);
    const e = await sec.get('/structure/etablissement');
    expect(e.corps.periodes).toHaveLength(3);
    expect(e.corps.periodes[0].trancheOrdre).toBe(1);
  });
  it('RG-01 : une seule année ouverte', async () => {
    const r = await sec.post('/structure/annees', { libelle: '2027/2028', dateDebut: '2027-09-06', dateFin: '2028-06-23', ouvrir: true });
    expect(r.status).toBe(422);
    expect(r.corps.code).toBe('STR_ANNEE_DEJA_OUVERTE');
  });
  it('crée les cycles, leurs niveaux et les classes (RG-03)', async () => {
    expect((await sec.post('/structure/cycles', { sousSysteme: 'francophone', ordreEnseignement: 'primaire' })).status).toBe(200);
    expect((await sec.post('/structure/cycles', { sousSysteme: 'anglophone', ordreEnseignement: 'primaire' })).status).toBe(200);
    const niveaux = (await sec.get('/structure/niveaux')).corps as { id: string; code: string }[];
    for (const n of niveaux) ids[`niveau:${n.code}`] = n.id;
    expect(niveaux.map((n) => n.code)).toContain('Class 6');
    for (const [code, nom, max] of [['CE2', 'CE2 B', 40], ['CM2', 'CM2 A', 40], ['SIL', 'SIL A', 2]] as const) {
      const r = await sec.post('/structure/classes', { niveauId: ids[`niveau:${code}`], nom, effectifMax: max });
      expect(r.status).toBe(200);
      ids[`classe:${nom}`] = r.corps.id;
    }
  });
  it('crée les fiches du personnel et les comptes avec leurs rôles', async () => {
    const roles = (await adm.get('/core/roles')).corps as { id: string; code: string }[];
    const role = (c: string) => roles.find((r) => r.code === c)!.id;
    const personnes: [string, string, string, string, string][] = [
      ['directrice', 'Directrice démo', 'directeur', 'permanent', 'directeur'],
      ['econome', 'Économe démo', 'econome', 'permanent', 'econome'],
      ['prefet', 'Préfet des études démo', 'prefet', 'permanent', 'prefet'],
      ['onana.b', 'M. ONANA Bertrand', 'instituteur_principal', 'permanent', 'instituteur_principal'],
      ['essama.l', 'M. ESSAMA Luc', 'instituteur_matiere', 'vacataire', 'instituteur_matiere'],
    ];
    for (const [identifiant, nom, fonction, statut, r] of personnes) {
      const f = await sec.post('/personnel', { nomAffiche: nom, fonction, statut, telephone: '600 000 299' });
      expect(f.status).toBe(200);
      ids[`personnel:${identifiant}`] = f.corps.id;
      const c = await adm.post('/core/comptes', { identifiant, nomAffiche: nom, personnelId: f.corps.id, roles: [{ roleId: role(r) }], motDePasse: `mdp-${identifiant}` });
      expect(c.status).toBe(200);
    }
    // Un compte cumule plusieurs rôles (ADR-12) : directeur et secrétaire.
    const cumul = await adm.post('/core/comptes', { identifiant: 'ngo.b', nomAffiche: 'Mme NGO Berthe', roles: [{ roleId: role('directeur') }, { roleId: role('secretaire') }], motDePasse: 'mdp-ngo.b' });
    expect(cumul.status).toBe(200);
    dir = await connecter(env.app, 'directrice', 'mdp-directrice');
    eco = await connecter(env.app, 'econome', 'mdp-econome');
    pre = await connecter(env.app, 'prefet', 'mdp-prefet');
    ip = await connecter(env.app, 'onana.b', 'mdp-onana.b');
    im = await connecter(env.app, 'essama.l', 'mdp-essama.l');
    mixte = await connecter(env.app, 'ngo.b', 'mdp-ngo.b');
    expect((await mixte.get('/auth/moi')).corps.libelleRoles).toBe('Directeur, Secrétaire');
  });
  it('le parent n\'est jamais créé à la main (RG-35)', async () => {
    const roles = (await adm.get('/core/roles')).corps as { id: string; code: string }[];
    const r = await adm.post('/core/comptes', { identifiant: 'parent.x', nomAffiche: 'Parent X', roles: [{ roleId: roles.find((x) => x.code === 'parent')!.id }] });
    expect(r.status).toBe(422);
  });
  it('403 : chacun reste dans ses droits, même en appelant l\'API directement', async () => {
    expect((await eco.post('/structure/classes', { niveauId: ids['niveau:CP'], nom: 'CP A', effectifMax: 40 })).status).toBe(403);
    expect((await pre.post('/core/comptes', { identifiant: 'zz.z', nomAffiche: 'Z', roles: [] })).status).toBe(403);
    // Utilisateurs et rôles : le directeur seul (D-46) ; la secrétaire n'y a plus accès.
    expect((await sec.post('/core/comptes', { identifiant: 'zz.z', nomAffiche: 'Z', roles: [] })).status).toBe(403);
    expect((await sec.get('/core/comptes')).status).toBe(403);
    expect((await ip.get('/core/journal')).status).toBe(403);
    expect((await im.get('/finances/impayes')).status).toBe(403);
    expect((await dir.put('/structure/etablissement', { nomFr: 'X', nomEn: 'X' })).status).toBe(403);
  });
  it('le directeur crée un rôle à partir d\'un autre et en règle les permissions (SOC-09)', async () => {
    const roles = (await adm.get('/core/roles')).corps as { id: string; code: string; permissions: string[] }[];
    const econome = roles.find((r) => r.code === 'econome')!;
    const r = await adm.post('/core/roles', { depuisRoleId: econome.id, libelle: 'Caissier APE' });
    expect(r.status).toBe(200);
    const maj = await adm.put(`/core/roles/${r.corps.id}/permissions`, { permissions: econome.permissions.filter((p) => !p.startsWith('finances.grille')) });
    expect(maj.status).toBe(200);
    expect((await adm.put(`/core/roles/${roles.find((x) => x.code === 'directeur')!.id}/permissions`, { permissions: [] })).status).toBe(422);
  });
});

describe('Paramétrage des frais et de la pédagogie (CU-10, CU-18)', () => {
  it('l\'économe fixe la grille des frais ; la secrétaire ne peut pas (403)', async () => {
    const annee = (await eco.get('/finances/grille')).corps.anneeId;
    ids['annee'] = annee;
    const corps = { anneeId: annee, tarif: 'nouveau', dates: ['2026-09-07', '2026-09-30', '2026-11-30', '2027-01-31'], lignes: [
      { niveauId: ids['niveau:CE2'], montants: [10000, 25000, 20000, 15000] },
      { niveauId: ids['niveau:CM2'], montants: [12000, 30000, 25000, 18000] },
      { niveauId: ids['niveau:SIL'], montants: [10000, 20000, 18000, 12000] }] };
    expect((await sec.put('/finances/grille', corps)).status).toBe(403);
    expect((await eco.put('/finances/grille', corps)).status).toBe(200);
    const g = await eco.get('/finances/grille');
    expect(g.corps.niveaux.find((n: { code: string }) => n.code === 'CM2').total).toBe(85000);
  });
  it('le préfet définit les matières et affecte les instituteurs (RG-34)', async () => {
    const groupe = await pre.post('/pedagogie/groupes', { libelleFr: 'Langues', libelleEn: 'Languages' });
    for (const [fr, en, abr, coef] of [['Français', 'French', null, 4], ['Mathématiques', 'Mathematics', 'Maths', 4], ['Éducation physique et sportive', 'Physical Education', 'EPS', 1]] as const) {
      const m = await pre.post('/pedagogie/matieres', { libelleFr: fr, libelleEn: en, abregeFr: abr, abregeEn: abr === 'EPS' ? 'PE' : null, groupeId: groupe.corps.id, niveauId: ids['niveau:CM2'], coefficient: coef });
      expect(m.status).toBe(200);
      ids[`matiere:${abr ?? fr}`] = m.corps.id;
    }
    expect((await pre.put('/pedagogie/affectations', { classeId: ids['classe:CM2 A'], matiereId: null, personnelId: ids['personnel:onana.b'] })).status).toBe(200);
    expect((await pre.put('/pedagogie/affectations', { classeId: ids['classe:CM2 A'], matiereId: ids['matiere:EPS'], personnelId: ids['personnel:essama.l'] })).status).toBe(200);
    expect((await ip.put('/pedagogie/affectations', { classeId: ids['classe:CM2 A'], matiereId: null, personnelId: ids['personnel:onana.b'] })).status).toBe(403);
    const p = await pre.get(`/pedagogie/parametrage?niveauId=${ids['niveau:CM2']}`);
    expect(p.corps.equipes[0].principal.nom).toBe('M. ONANA Bertrand');
    expect(p.corps.equipes[0].couverture).toBe('toutes les matières, sauf EPS');
    expect((await ip.get('/auth/moi')).corps.libelleRoles).toBe('Instituteur principal · CM2 A');
    expect((await im.get('/auth/moi')).corps.libelleRoles).toBe('Instituteur de matière · EPS');
  });
});

describe('Étape 2 · inscriptions et compte famille (CU-06, CU-07, RG-04 à RG-09, RG-35)', () => {
  const eleve = (nom: string, prenoms: string, sexe: 'M' | 'F', dateNaissance: string) => ({ nom, prenoms, sexe, dateNaissance, lieuNaissance: 'Yaoundé' });
  const resp = (nom: string, telephone: string, payeur = true) => ({ nom, lien: 'mere', telephone, langue: 'fr', payeur, recoitSms: true });
  it('inscrit un élève : matricule, compte famille, échéancier copié de la grille (RG-07)', async () => {
    const r = await sec.post('/scolarite/inscriptions', { eleve: eleve('KENFACK', 'Steve', 'M', '2017-01-05'), responsables: [resp('KENFACK Pauline', '600 000 055')],
      classeId: ids['classe:CE2 B'], type: 'nouvelle', tarif: 'nouveau' });
    expect(r.status).toBe(200);
    expect(r.corps.matricule).toBe('26FR0001');
    expect(r.corps.compteFamille.cree).toBe(true);
    famille1 = { telephone: '600000055', motDePasse: r.corps.compteFamille.motDePasse };
    ids['insc:steve'] = r.corps.inscriptionId;
    ids['eleve:steve'] = r.corps.eleveId;
    const ech = await eco.get(`/finances/inscriptions/${ids['insc:steve']}/echeancier`);
    expect(ech.corps.lignes.map((l: { prix: number }) => l.prix)).toEqual([10000, 25000, 20000, 15000]);
    expect(ech.corps.inscription.statut).toBe('attente');
  });
  const bus = { code: 'perso_bus', bloc: 'vie', libelle: 'Arrêt du bus', type: 'choix_unique', options: ['Mvan', 'Biyem-Assi'], obligatoire: true, actif: true, ordre: 50, modele: null };
  it('formulaire d’inscription configurable : champ obligatoire exigé, réponses contrôlées (D-42)', async () => {
    expect((await sec.put('/scolarite/formulaire', { champs: [...FORMULAIRE_PAR_DEFAUT, bus] })).status).toBe(200);
    const f = await sec.get('/scolarite/formulaire');
    expect(f.corps.regle).toBe(true);
    expect(f.corps.champs.find((c: { code: string }) => c.code === 'perso_bus').obligatoire).toBe(true);
    const sans = await sec.post('/scolarite/inscriptions', { eleve: eleve('KENFACK', 'Loïc', 'M', '2021-04-11'), responsables: [resp('KENFACK Pauline', '600000055')],
      classeId: ids['classe:SIL A'], type: 'nouvelle', tarif: 'nouveau' });
    expect(sans.status).toBe(422);
    expect(sans.corps.code).toBe('SCO_RENSEIGNEMENT_REQUIS');
    const hors = await sec.post('/scolarite/inscriptions', { eleve: eleve('KENFACK', 'Loïc', 'M', '2021-04-11'), responsables: [resp('KENFACK Pauline', '600000055')],
      classeId: ids['classe:SIL A'], type: 'nouvelle', tarif: 'nouveau', renseignements: { perso_bus: 'Ailleurs' } });
    expect(hors.corps.code).toBe('SCO_RENSEIGNEMENT');
  });
  it('rattache le second enfant à la même famille et au même compte ; renseignements et pièce jointe rangés', async () => {
    const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
    const r = await sec.post('/scolarite/inscriptions', { eleve: eleve('KENFACK', 'Loïc', 'M', '2021-04-11'), responsables: [resp('KENFACK Pauline', '600000055')],
      classeId: ids['classe:SIL A'], type: 'nouvelle', tarif: 'nouveau',
      renseignements: { perso_bus: 'Mvan', groupe_sanguin: 'O+', allergies: 'Arachide', acte_naissance: { base64: png, nom: 'acte.png' } } });
    expect(r.status).toBe(200);
    expect(r.corps.compteFamille.cree).toBe(false);
    ids['insc:loic'] = r.corps.inscriptionId;
    ids['eleve:loic'] = r.corps.eleveId;
    const e = await sec.get(`/scolarite/eleves/${ids['eleve:loic']}`);
    const lignes = e.corps.renseignements.flatMap((b: { lignes: unknown[] }) => b.lignes);
    expect(lignes).toEqual(expect.arrayContaining([expect.objectContaining({ libelle: 'Arrêt du bus', valeur: 'Mvan' }), expect.objectContaining({ libelle: 'Groupe sanguin', valeur: 'O+' })]));
    const piece = lignes.find((l: { libelle: string }) => l.libelle === 'Acte de naissance');
    const img = await sec.get(`/scolarite/eleves/${ids['eleve:loic']}/pieces/${piece.piece}`);
    expect(img.status).toBe(200);
    expect(img.entetes['content-type']).toBe('image/png');
    // Retour au formulaire proposé : les inscriptions suivantes n'ont pas de champ obligatoire.
    expect((await sec.put('/scolarite/formulaire', { champs: FORMULAIRE_PAR_DEFAUT })).status).toBe(200);
  });
  it('mise à jour de la fiche : rien n’est effacé, l’historique garde chaque valeur précédente (D-43)', async () => {
    const id = ids['eleve:loic'];
    const m = await sec.patch(`/scolarite/eleves/${id}`, { lieuNaissance: 'Douala', renseignements: { groupe_sanguin: 'A+', perso_bus: null } });
    expect(m.status).toBe(200);
    expect(m.corps.modifies).toEqual(expect.arrayContaining(['lieu de naissance', 'groupe sanguin']));
    const e = await sec.get(`/scolarite/eleves/${id}`);
    expect(e.corps.lieuNaissance).toBe('Douala');
    expect(e.corps.renseignementsBruts.groupe_sanguin).toBe('A+');
    expect(e.corps.renseignementsBruts.acte_naissance.piece).toBeTruthy(); // la pièce jointe reste
    const rid = e.corps.responsables[0].id;
    expect((await sec.patch(`/scolarite/eleves/${id}/responsables/${rid}`, { recoitSms: false })).status).toBe(200);
    expect((await sec.patch(`/scolarite/eleves/${id}/responsables/${rid}`, { recoitSms: true })).status).toBe(200);
    const v = (await sec.get(`/scolarite/eleves/${id}/variations`)).corps.variations;
    expect(v).toEqual(expect.arrayContaining([
      expect.objectContaining({ champ: 'Lieu de naissance', avant: 'Yaoundé', apres: 'Douala' }),
      expect.objectContaining({ champ: 'Groupe sanguin', avant: 'O+', apres: 'A+' }),
      expect.objectContaining({ champ: 'Reçoit les SMS', avant: 'Oui', apres: 'Non' }),
    ]));
    // Sans la permission de mise à jour : refus côté serveur.
    expect((await pre.patch(`/scolarite/eleves/${id}`, { lieuNaissance: 'Kribi' })).status).toBe(403);
  });
  it('RG-09 : signale et refuse un doublon tant qu\'il n\'est pas écarté', async () => {
    const d = await sec.get('/scolarite/doublons?nom=KENFACK&prenoms=Steeve&dateNaissance=2017-01-05');
    expect(d.corps[0].nom).toBe('KENFACK');
    const r = await sec.post('/scolarite/inscriptions', { eleve: eleve('KENFACK', 'Steve', 'M', '2017-01-05'), responsables: [resp('KENFACK Pauline', '600000055')],
      classeId: ids['classe:CE2 B'], type: 'nouvelle', tarif: 'nouveau' });
    expect(r.status).toBe(409);
  });
  it('RG-05 : une seule inscription active par année', async () => {
    const r = await sec.post('/scolarite/inscriptions', { eleveId: ids['eleve:steve'], classeId: ids['classe:CM2 A'], type: 'reinscription', tarif: 'ancien' });
    expect(r.status).toBe(422); // pas de grille « ancien » : refus avant même le doublon d'inscription
    const r2 = await sec.post('/scolarite/inscriptions', { eleveId: ids['eleve:steve'], classeId: ids['classe:CE2 B'], type: 'reinscription', tarif: 'nouveau' });
    expect(r2.status).toBe(409);
    expect(r2.corps.code).toBe('SCO_DEJA_INSCRIT');
  });
  it('RG-08 : exactement un payeur', async () => {
    const r = await sec.post('/scolarite/inscriptions', { eleve: eleve('NGONO', 'Mireille', 'F', '2016-06-01'),
      responsables: [resp('NGONO A', '600000101', false), resp('NGONO B', '600000102', false)], classeId: ids['classe:CE2 B'], type: 'nouvelle', tarif: 'nouveau' });
    expect(r.status).toBe(422);
  });
  it('RG-06 : la classe complète déclenche une demande de dérogation', async () => {
    await sec.post('/scolarite/inscriptions', { eleve: eleve('ABENA', 'Rose', 'F', '2021-02-02'), responsables: [resp('ABENA M', '600000110')], classeId: ids['classe:SIL A'], type: 'nouvelle', tarif: 'nouveau' });
    const r = await sec.post('/scolarite/inscriptions', { eleve: eleve('TALLA', 'Boris', 'M', '2021-03-03'), responsables: [resp('TALLA M', '600000111')], classeId: ids['classe:SIL A'], type: 'nouvelle', tarif: 'nouveau' });
    expect(r.status).toBe(200);
    expect(r.corps.derogationDemandee).toBe(true);
    const v = await dir.get('/finances/validations');
    expect(v.corps.demandes.some((d: { type: string }) => d.type === 'derogation')).toBe(true);
  });
  it('inscrit trois élèves de CM2 A', async () => {
    for (const [i, [nom, prenoms, sexe]] of ([['DJOMO', 'Josiane', 'F'], ['TAMO', 'Gisèle', 'F'], ['TCHOUA', 'Ivan', 'M']] as const).entries()) {
      const r = await sec.post('/scolarite/inscriptions', { eleve: eleve(nom, prenoms, sexe, '2015-02-09'), responsables: [resp(`${nom} Albert`, `60000012${i}`)],
        classeId: ids['classe:CM2 A'], type: 'nouvelle', tarif: 'nouveau' });
      expect(r.status).toBe(200);
      ids[`insc:${prenoms}`] = r.corps.inscriptionId;
      ids[`eleve:${prenoms}`] = r.corps.eleveId;
      familleCm2.push({ telephone: `60000012${i}`, motDePasse: r.corps.compteFamille.motDePasse });
    }
    const liste = await sec.get('/scolarite/eleves?q=kenfack');
    expect(liste.corps.total).toBe(2);
    expect((await sec.get('/scolarite/eleves?q=600000055')).corps.total).toBe(2);
  });
});

describe('Étape 3 · l\'économe encaisse (CU-12, RG-12 à RG-17, RG-21)', () => {
  it('RG-17 : pas d\'espèces sans session de caisse ouverte', async () => {
    const r = await eco.post('/finances/versements', { inscriptionId: ids['insc:steve'], montant: 15000, mode: 'especes' }, { 'idempotency-key': 'cle-test-000' });
    expect(r.corps.code).toBe('CAI_SESSION_FERMEE');
  });
  it('ouvre la session, encaisse et répartit dans l\'ordre des tranches (RG-12, RG-14)', async () => {
    expect((await eco.post('/caisse/sessions', { caisse: 'principale', fondsInitial: 20000 })).status).toBe(200);
    const r = await eco.post('/finances/versements', { inscriptionId: ids['insc:steve'], montant: 15000, mode: 'especes' }, { 'idempotency-key': 'cle-test-001' });
    expect(r.status).toBe(200);
    expect(r.corps.numeroRecu).toBe('R2026-000001');
    expect(r.corps.repartition.map((p: { montant: number }) => p.montant)).toEqual([10000, 5000]);
    ids['versement:1'] = r.corps.id;
    // Le premier versement atteint le montant d'inscription : l'inscription est validée.
    expect((await eco.get(`/finances/inscriptions/${ids['insc:steve']}/echeancier`)).corps.inscription.statut).toBe('validee');
  });
  it('idempotence : un double envoi n\'encaisse pas deux fois (conception § 7.1)', async () => {
    const r = await eco.post('/finances/versements', { inscriptionId: ids['insc:steve'], montant: 15000, mode: 'especes' }, { 'idempotency-key': 'cle-test-001' });
    expect(r.corps.repete).toBe(true);
    expect(r.corps.numeroRecu).toBe('R2026-000001');
  });
  it('RG-12 : refuse un montant supérieur au reste dû', async () => {
    const r = await eco.post('/finances/versements', { inscriptionId: ids['insc:steve'], montant: 60000, mode: 'especes' }, { 'idempotency-key': 'cle-test-002' });
    expect(r.corps.code).toBe('FIN_MONTANT_SUPERIEUR_AU_RESTE');
  });
  it('RG-13 : un bordereau bancaire ne s\'enregistre qu\'une fois', async () => {
    const v = { inscriptionId: ids['insc:steve'], montant: 5000, mode: 'versement_bancaire', banque: 'Banque de démonstration', bordereau: 'BV-004512', dateBordereau: auj() };
    expect((await eco.post('/finances/versements', v, { 'idempotency-key': 'cle-test-003' })).status).toBe(200);
    expect((await eco.post('/finances/versements', v, { 'idempotency-key': 'cle-test-004' })).corps.code).toBe('FIN_BORDEREAU_DEJA_ENREGISTRE');
  });
  it('le directeur n\'encaisse pas (ADR-12) : 403', async () => {
    expect((await dir.post('/finances/versements', { inscriptionId: ids['insc:steve'], montant: 1000, mode: 'cheque' }, { 'idempotency-key': 'cle-test-005' })).status).toBe(403);
  });
  it('RG-21 : la réimpression porte « Duplicata » ; reçu en PDF et en ESC/P', async () => {
    const pdf = await eco.get(`/finances/versements/${ids['versement:1']}/recu?format=pdf`);
    expect(pdf.status).toBe(200);
    expect(String(pdf.entetes['content-type'])).toContain('application/pdf');
    expect((await eco.get(`/finances/versements/${ids['versement:1']}/recu`)).corps.duplicata).toBe(true);
    const escp = await eco.get(`/finances/versements/${ids['versement:1']}/recu?format=escp`);
    expect(escp.brut.includes(Buffer.from('DUPLICATA'))).toBe(true);
    const json = await eco.get(`/finances/versements/${ids['versement:1']}/recu`);
    expect(json.corps.montantLettresFr).toBe('Quinze mille francs CFA');
  });
  it('RG-11 : réduction sous le seuil accordée par l\'économe, au-delà validée par le directeur', async () => {
    const ech = (await eco.get(`/finances/inscriptions/${ids['insc:steve']}/echeancier`)).corps.lignes;
    const t1 = ech.find((l: { ordre: number }) => l.ordre === 2).id;
    const t2 = ech.find((l: { ordre: number }) => l.ordre === 3).id;
    expect((await eco.post('/finances/reductions', { ligneEcheanceId: t1, montant: 5000, motif: 'Fratrie' })).corps.appliquee).toBe(true);
    const d = await eco.post('/finances/reductions', { ligneEcheanceId: t2, montant: 10000, motif: 'Fratrie de trois enfants' });
    expect(d.corps.appliquee).toBe(false);
    expect((await eco.post(`/finances/demandes/${d.corps.demandeId}/decision`, { decision: 'validee' })).status).toBe(403);
    expect((await dir.post(`/finances/demandes/${d.corps.demandeId}/decision`, { decision: 'validee' })).status).toBe(200);
    const apres = (await eco.get(`/finances/inscriptions/${ids['insc:steve']}/echeancier`)).corps.lignes.find((l: { ordre: number }) => l.ordre === 3);
    expect(apres.reduction).toBe(10000);
    expect((await eco.post('/finances/reductions', { ligneEcheanceId: t1, montant: 30000, motif: 'Trop' })).status).toBe(422);
  });
  it('RG-16 : l\'économe valide l\'annulation de son propre versement ; le directeur en est notifié', async () => {
    const v = await eco.post('/finances/versements', { inscriptionId: ids['insc:loic'], montant: 14000, mode: 'especes' }, { 'idempotency-key': 'cle-test-006' });
    const a = await eco.post(`/finances/versements/${v.corps.id}/annulation`, { motif: 'Versement saisi sur le mauvais élève' });
    expect(a.status).toBe(200);
    expect((await eco.post(`/finances/demandes/${a.corps.demandeId}/decision`, { decision: 'validee' })).status).toBe(200);
    const val = await dir.get('/finances/validations');
    expect(val.corps.annulations[0].motif).toBe('Versement saisi sur le mauvais élève');
    expect((await eco.get(`/finances/inscriptions/${ids['insc:loic']}/echeancier`)).corps.totaux.verse).toBe(0);
    const j = await dir.get('/core/journal?action=Annulation');
    expect(j.corps.lignes[0].objet).toContain('notifiée au directeur');
  });
  it('RG-19 : sortie demandée, validée par le directeur, décaissée par l\'économe ; jamais d\'autovalidation', async () => {
    const cat = (await eco.get('/caisse/sorties')).corps.categories[1].id;
    const s = await sec.post('/caisse/sorties', { objet: 'Réparation du photocopieur', categorieId: cat, montant: 8500, motif: 'Panne depuis le 05/11' });
    expect(s.corps.numero).toBe('S2026-0001');
    expect((await eco.post(`/caisse/sorties/${s.corps.id}/decaissement`)).corps.code).toBe('CAI_SORTIE_NON_VALIDEE');
    expect((await dir.post(`/caisse/sorties/${s.corps.id}/decision`, { decision: 'validee' })).status).toBe(200);
    expect((await eco.post(`/caisse/sorties/${s.corps.id}/decaissement`)).status).toBe(200);
    const propre = await mixte.post('/caisse/sorties', { objet: 'Ballon', categorieId: cat, montant: 12000, motif: 'EPS' });
    expect((await mixte.post(`/caisse/sorties/${propre.corps.id}/decision`, { decision: 'validee' })).status).toBe(403);
  });
  it('RG-18 : la clôture exige un motif pour tout écart', async () => {
    const j = await eco.get('/caisse/journee');
    // fonds 20 000 + 15 000 + 14 000 − 14 000 (annulation) − 8 500 (sortie) = 26 500
    expect(j.corps.kpi.attendues).toBe(26500);
    const sid = j.corps.session.id;
    expect((await eco.post(`/caisse/sessions/${sid}/cloture`, { montantCompte: 26000 })).corps.code).toBe('CAI_MOTIF_ECART_REQUIS');
    const c = await eco.post(`/caisse/sessions/${sid}/cloture`, { montantCompte: 26000, motifEcart: 'Erreur de rendu de monnaie' });
    expect(c.corps.ecart).toBe(-500);
    await eco.post('/caisse/sessions', { caisse: 'principale', fondsInitial: 0 });
  });
  it('les impayés listent les échéances dépassées', async () => {
    const r = await eco.get('/finances/impayes');
    expect(r.status).toBe(200);
    expect(r.corps.kpi.eleves).toBeGreaterThan(0);
  });
});

describe('Étapes 5 à 7 · notes, fusion, publication (CU-19 à CU-21, RG-22 à RG-27, RG-34, RG-36)', () => {
  let sequenceId = '';
  const notes = (valeurs: (number | null)[]) => ['Josiane', 'Gisèle', 'Ivan'].map((p, i) => ({ inscriptionId: ids[`insc:${p}`], valeur: valeurs[i] ?? null, statut: 'present' }));
  it('le préfet ouvre la saisie de la séquence 1', async () => {
    const s = await pre.get('/pedagogie/sequences');
    sequenceId = s.corps[0].sequences[0].id;
    expect((await ip.post(`/pedagogie/sequences/${sequenceId}/ouverture`, { jusqua: '2027-06-01' })).status).toBe(403);
    expect((await pre.post(`/pedagogie/sequences/${sequenceId}/ouverture`, { jusqua: '2027-06-01' })).status).toBe(200);
  });
  it('le principal saisit ses matières ; l\'instituteur de matière la sienne seulement (RG-22, RG-34)', async () => {
    const base = { classeId: ids['classe:CM2 A'], sequenceId };
    expect((await ip.put('/pedagogie/saisie', { ...base, matiereId: ids['matiere:Français'], notes: notes([13.5, 16, 7]) })).status).toBe(200);
    expect((await ip.put('/pedagogie/saisie', { ...base, matiereId: ids['matiere:Maths'], notes: notes([15, 17, 8]) })).status).toBe(200);
    expect((await im.put('/pedagogie/saisie', { ...base, matiereId: ids['matiere:Maths'], notes: notes([20, 20, 20]) })).status).toBe(403);
    expect((await ip.put('/pedagogie/saisie', { ...base, matiereId: ids['matiere:EPS'], notes: notes([10, 10, 10]) })).status).toBe(403);
    expect((await im.put('/pedagogie/saisie', { ...base, matiereId: ids['matiere:EPS'], notes: notes([17, 16, null]) })).status).toBe(200);
    // RG-34 : le principal lit l'EPS sans pouvoir la modifier ; l'instituteur de matière ne lit pas les maths dans l'écran de saisie.
    const lecture = await ip.get(`/pedagogie/saisie?classeId=${base.classeId}&matiereId=${ids['matiere:EPS']}&sequenceId=${sequenceId}`);
    expect(lecture.status).toBe(200);
    expect(lecture.corps.modifiable).toBe(false);
    expect((await im.get(`/pedagogie/saisie?classeId=${base.classeId}&matiereId=${ids['matiere:Maths']}&sequenceId=${sequenceId}`)).status).toBe(403);
  });
  it('RG-23 : une note dépasse le barème → refus', async () => {
    const r = await ip.put('/pedagogie/saisie', { classeId: ids['classe:CM2 A'], sequenceId, matiereId: ids['matiere:Français'], notes: notes([25, 16, 7]) });
    expect(r.corps.code).toBe('PED_NOTE_HORS_BAREME');
  });
  it('RG-36 : la transmission attend toutes les notes', async () => {
    const periodeId = (await pre.get('/pedagogie/sequences')).corps[0].id;
    ids['periode:1'] = periodeId;
    const r = await ip.post('/pedagogie/fusion/transmission', { classeId: ids['classe:CM2 A'], periodeId });
    expect(r.corps.code).toBe('PED_MATIERES_INCOMPLETES');
    const f = await ip.get(`/pedagogie/fusion?classeId=${ids['classe:CM2 A']}&periodeId=${periodeId}`);
    expect(f.corps.matieres.find((m: { matiere: string }) => m.matiere.startsWith('Éducation')).manquants).toEqual(['TCHOUA Ivan']);
    expect((await im.put('/pedagogie/saisie', { classeId: ids['classe:CM2 A'], sequenceId, matiereId: ids['matiere:EPS'], notes: notes([17, 16, 12]) })).status).toBe(200);
    expect((await ip.post('/pedagogie/fusion/transmission', { classeId: ids['classe:CM2 A'], periodeId })).status).toBe(200);
  });
  it('le préfet publie ; moyennes et rangs calculés par l\'application (RG-25, RG-26)', async () => {
    expect((await ip.post('/pedagogie/bulletins/publication', { classeId: ids['classe:CM2 A'], periodeId: ids['periode:1'] })).status).toBe(403);
    const p = await pre.post('/pedagogie/bulletins/publication', { classeId: ids['classe:CM2 A'], periodeId: ids['periode:1'] });
    expect(p.corps.publies).toBe(3);
    const b = await pre.get(`/pedagogie/bulletins?classeId=${ids['classe:CM2 A']}&periodeId=${ids['periode:1']}&inscriptionId=${ids['insc:Gisèle']}`);
    // Gisèle : (16×4 + 17×4 + 16×1) / 9 = 16,44 ; rang 1
    expect(b.corps.bulletin.moyenne).toBe(16.44);
    expect(b.corps.bulletin.rang).toBe(1);
    expect(b.corps.bulletin.statut).toBe('publie');
  });
  it('RG-27 : une correction après publication crée la version 2', async () => {
    await pre.post(`/pedagogie/sequences/${sequenceId}/ouverture`, { jusqua: '2027-06-01' });
    await ip.put('/pedagogie/saisie', { classeId: ids['classe:CM2 A'], sequenceId, matiereId: ids['matiere:Français'], notes: notes([14, 16, 7]) });
    await pre.post('/pedagogie/bulletins/publication', { classeId: ids['classe:CM2 A'], periodeId: ids['periode:1'] });
    const b = await pre.get(`/pedagogie/bulletins?classeId=${ids['classe:CM2 A']}&periodeId=${ids['periode:1']}&inscriptionId=${ids['insc:Josiane']}`);
    expect(b.corps.bulletin.version).toBe(2);
    await pre.post(`/pedagogie/sequences/${sequenceId}/fermeture`);
  });
});

describe('Étapes 8 et 9 · espace parent, blocage du bulletin, levée par le directeur (RG-35, RG-40, RG-42)', () => {
  let parentJosiane: Client, parentGisele: Client, parentKenfack: Client;
  it('le parent se connecte par téléphone et ne voit que ses enfants (RG-35)', async () => {
    parentKenfack = await connecterParent(env.app, '600 000 055', famille1.motDePasse);
    // Page de connexion unique (D-38) : le même numéro ouvre l'espace famille par /auth/connexion ; mauvais mot de passe refusé.
    const unique = await new Client(env.app).post<{ compte: { type: string }; jeton: string }>('/auth/connexion', { identifiant: '600 000 055', motDePasse: famille1.motDePasse, client: 'application' });
    expect(unique.status).toBe(200);
    expect(unique.corps.compte.type).toBe('famille');
    expect((await new Client(env.app).post('/auth/connexion', { identifiant: '600000055', motDePasse: 'faux-mot-de-passe', client: 'application' })).status).toBe(401);
    const a = await parentKenfack.get('/portail/accueil');
    expect(a.corps.enfants).toHaveLength(2);
    expect(a.corps.salutation).toBe('Mme KENFACK');
    // Charte Sekou : barres par tranche, dernières notes, absences justifiées, annonces et blocages sur l'accueil.
    expect(a.corps.enfants[0].tranches.length).toBeGreaterThan(0);
    expect(a.corps.enfants[0].tranches[0]).toMatchObject({ libelle: expect.any(String), aPayer: expect.any(Number), reste: expect.any(Number) });
    expect(Array.isArray(a.corps.enfants[0].dernieresNotes)).toBe(true);
    expect(a.corps.enfants[0].absencesJustifiees).toBeLessThanOrEqual(a.corps.enfants[0].absences);
    expect(Array.isArray(a.corps.annonces)).toBe(true);
    expect(Array.isArray(a.corps.blocages)).toBe(true);
    const bs = await parentKenfack.get(`/portail/enfants/${ids['eleve:steve']}/bulletin`);
    expect(bs.corps.periodes.length).toBeGreaterThan(0);
    expect(typeof bs.corps.enseignants).toBe('object');
    expect((await parentKenfack.get(`/portail/enfants/${ids['eleve:Josiane']}/bulletin`)).status).toBe(403);
    expect((await parentKenfack.get('/scolarite/eleves')).status).toBe(403);
  });
  it('aucun téléchargement pour le parent : le reçu se consulte à l\'écran (RG-35)', async () => {
    expect((await parentKenfack.get(`/finances/versements/${ids['versement:1']}/recu?format=pdf`)).status).toBe(403);
    expect((await parentKenfack.get(`/portail/recus/${ids['versement:1']}`)).corps.numero).toBe('R2026-000001');
  });
  it('RG-40 : bulletin masqué tant que la tranche 1 n\'est pas payée à 90 %', async () => {
    parentJosiane = await connecterParent(env.app, familleCm2[0]!.telephone, familleCm2[0]!.motDePasse);
    const b = await parentJosiane.get(`/portail/enfants/${ids['eleve:Josiane']}/bulletin`);
    expect(b.corps.bulletin).toBeNull();
    expect(b.corps.bloque).toContain('90 %');
    // Inscription 12 000 + tranche 1 à 27 000 sur 30 000 = 90 %
    await eco.post('/finances/versements', { inscriptionId: ids['insc:Josiane'], montant: 39000, mode: 'especes' }, { 'idempotency-key': 'cle-test-007' });
    const apres = await parentJosiane.get(`/portail/enfants/${ids['eleve:Josiane']}/bulletin`);
    expect(apres.corps.bloque).toBeNull();
    expect(apres.corps.bulletin.moyenne).toBeGreaterThan(0);
  });
  it('le directeur lève le blocage ; la levée est au journal d\'audit', async () => {
    parentGisele = await connecterParent(env.app, familleCm2[1]!.telephone, familleCm2[1]!.motDePasse);
    expect((await parentGisele.get(`/portail/enfants/${ids['eleve:Gisèle']}/bulletin`)).corps.bulletin).toBeNull();
    expect((await pre.post('/pedagogie/bulletins/levee-blocage', { inscriptionId: ids['insc:Gisèle'], periodeId: ids['periode:1'] })).status).toBe(403);
    expect((await dir.post('/pedagogie/bulletins/levee-blocage', { inscriptionId: ids['insc:Gisèle'], periodeId: ids['periode:1'], motif: 'Situation familiale' })).status).toBe(200);
    expect((await parentGisele.get(`/portail/enfants/${ids['eleve:Gisèle']}/bulletin`)).corps.bulletin.rang).toBe(1);
    const j = await dir.get('/core/journal?action=Levée de blocage');
    expect(j.corps.lignes[0]).toMatchObject({ avant: 'Masqué au parent', apres: 'Visible' });
  });
  it('RG-42 : le message du parent va au seul destinataire choisi', async () => {
    const r = await parentKenfack.post('/portail/messages', { destinataire: 'econome', eleveId: ids['eleve:steve'], texte: 'Peut-on payer la tranche 2 en deux fois ?' });
    expect(r.status).toBe(200);
    expect((await eco.get('/communication/conversations')).corps.conversations).toHaveLength(1);
    expect((await sec.get('/communication/conversations')).corps.conversations).toHaveLength(0);
    expect((await sec.get(`/communication/conversations/${r.corps.conversationId}`)).status).toBe(404);
    expect((await eco.post(`/communication/conversations/${r.corps.conversationId}/messages`, { texte: 'Oui, passez à la caisse.' })).status).toBe(200);
  });
});

describe('Vie scolaire, annonces, SMS (RG-28, RG-38, RG-39, RG-41)', () => {
  it('RG-41 : le principal publie pour sa classe seulement', async () => {
    const a = { titre: 'Sortie au musée', texteFr: 'La classe visitera le musée.', texteEn: 'The class will visit the museum.', publier: true };
    expect((await ip.post('/communication/annonces', { ...a, cible: 'classe', cibleId: ids['classe:CE2 B'] })).status).toBe(403);
    expect((await ip.post('/communication/annonces', { ...a, cible: 'classe', cibleId: ids['classe:CM2 A'] })).status).toBe(200);
    expect((await sec.post('/communication/annonces', { ...a, cible: 'ecole', publier: true })).status).toBe(200);
  });
  it('RG-28 : les SMS attendent dans la file ; rien ne part sans prestataire (E-22)', async () => {
    const s = await sec.get('/communication/sms');
    expect(s.corps.enAttente).toBeGreaterThan(0);
    expect(s.corps.fournisseur).toBe('desactive');
  });
  it('RG-37 et RG-38 : emploi du temps publié, appel fait par l\'instituteur du créneau, absence justifiée', async () => {
    const jour = jourSemaine();
    if (jour > 6) return; // dimanche : pas de cours
    const edt = await ip.get(`/pedagogie/edt?classeId=${ids['classe:CM2 A']}`);
    const creneau = edt.corps.creneaux.find((c: { debut: string }) => c.debut === '07:30').id;
    expect((await ip.put('/pedagogie/edt/cours', { classeId: ids['classe:CM2 A'], jour, creneauId: creneau, matiereId: ids['matiere:Français'], libelle: null })).status).toBe(200);
    expect((await im.put('/pedagogie/edt/cours', { classeId: ids['classe:CM2 A'], jour, creneauId: creneau, matiereId: ids['matiere:EPS'], libelle: null })).status).toBe(403);
    expect((await pre.post(`/pedagogie/edt/${ids['classe:CM2 A']}/publication`, {})).status).toBe(200);
    const appel = await ip.get(`/vie-scolaire/appel?classeId=${ids['classe:CM2 A']}`);
    expect(appel.corps.fiche.modifiable).toBe(true);
    const presences = appel.corps.fiche.eleves.map((e: { inscriptionId: string }, i: number) => ({ inscriptionId: e.inscriptionId, statut: i === 0 ? 'absent' : 'present' }));
    expect((await im.put(`/vie-scolaire/appel/${appel.corps.fiche.id}`, { presences })).status).toBe(403);
    expect((await ip.put(`/vie-scolaire/appel/${appel.corps.fiche.id}`, { presences })).status).toBe(200);
    const absent = appel.corps.fiche.eleves[0].inscriptionId;
    expect((await im.post('/vie-scolaire/absences/justification', { inscriptionId: absent, jour: auj(), motif: 'Malade' })).status).toBe(403);
    expect((await sec.post('/vie-scolaire/absences/justification', { inscriptionId: absent, jour: auj(), motif: 'Certificat médical' })).status).toBe(200);
  });
  it('l\'instituteur de matière note une observation et décide d\'une sanction pour ses faits', async () => {
    const r = await im.post('/vie-scolaire/observations', { inscriptionId: ids['insc:Ivan'], type: 'comportement', description: 'Bagarre pendant le relais', sanction: 'Retenue de 2 h' });
    expect(r.status).toBe(200);
    expect((await im.post('/vie-scolaire/observations', { inscriptionId: ids['insc:steve'], type: 'tenue', description: 'Tenue incomplète' })).status).toBe(403);
  });
});

describe('Pilotage, journal d\'audit (CU-04, CU-26)', () => {
  it('le tableau de bord du directeur et les statistiques se lisent dans la base', async () => {
    const t = await dir.get('/pilotage/tableau-de-bord');
    expect(t.corps.effectifs.eleves).toBe(7);
    expect(t.corps.courbe).toHaveLength(14);
    expect((await dir.get('/pilotage/statistiques')).status).toBe(200);
    expect((await sec.get('/pilotage/statistiques')).status).toBe(403);
  });
  it('le journal se consulte et se filtre ; il ne se modifie pas', async () => {
    const j = await dir.get('/core/journal?taille=50');
    expect(j.corps.total).toBeGreaterThan(20);
    const r = await env.bd.lire<{ n: number }>(sqlBrut('SELECT count(*)::int AS n FROM core.journal_audit WHERE nature = \'technique\''));
    expect(r[0]!.n).toBeGreaterThan(50);
    // gs_application n'a que l'insertion et la lecture sur le journal (conception § 6.6).
    const e = await env.bd.lire(sqlBrut('UPDATE core.journal_audit SET action = \'x\'')).catch((x: Error & { cause?: Error }) => x);
    expect(String((e as Error & { cause?: Error }).cause?.message)).toMatch(/permission denied/);
  });
});

describe('Données et clôture : import, sauvegardes, accès en lecture, clôture d\'année (écrans Données et Clôture)', () => {
  const lignes = [
    { ligne: 2, nom: 'MBARGA', prenoms: 'Inès', sexe: 'F', dateNaissance: '03/04/2015', classe: 'cm2 a', type: 'Nouvelle', responsable: 'MBARGA Odile', lien: 'Mère', telephone: '600 000 171' },
    { ligne: 3, nom: 'FOTSO Junior', sexe: 'M', dateNaissance: '31/02/2018', classe: 'CM2 A', responsable: 'FOTSO Bertrand', telephone: '600 000 172' },
    { ligne: 4, nom: 'ESSOMBA', prenoms: 'Brice', sexe: 'M', dateNaissance: '14/09/2019', classe: 'CP B', responsable: 'ESSOMBA Jean', telephone: '600 000 173' },
    { ligne: 5, nom: 'KENFACK', prenoms: 'Steve', sexe: 'M', dateNaissance: '05/01/2017', classe: 'CE2 B', responsable: 'KENFACK Pauline', telephone: '600 000 055' },
    { ligne: 6, nom: 'MBARGA', prenoms: 'Inès', sexe: 'F', dateNaissance: '2015-04-03', classe: 'CM2 A', responsable: 'MBARGA Odile', telephone: '600 000 171' },
    { ligne: 7, nom: 'NGUEMA', prenoms: 'Prisca', sexe: 'F', dateNaissance: '05/07/2015', classe: 'CM2 A', responsable: 'NGUEMA Alice', telephone: '60000' },
  ];
  const compter = async () => (await env.bd.lire<{ n: number }>(sqlBrut('SELECT count(*)::int AS n FROM scolarite.eleve')))[0]!.n;
  it('403 : seuls les comptes autorisés importent, même en appelant l\'API directement', async () => {
    for (const c of [pre, eco, dir, ip]) expect((await c.post('/scolarite/import', { essai: true, lignes })).status).toBe(403);
  });
  it('l\'essai contrôle chaque ligne sans rien écrire', async () => {
    const avant = await compter();
    const r = await sec.post('/scolarite/import', { essai: true, lignes });
    expect(r.status).toBe(200);
    expect(r.corps).toMatchObject({ essai: true, lues: 6, valides: 1, importes: 0 });
    expect(r.corps.erreurs.map((e: { ligne: number; probleme: string }) => [e.ligne, e.probleme])).toEqual([
      [3, 'Date impossible'], [4, 'Classe inconnue en 2026/2027'], [5, 'Doublon probable avec 26FR0001'],
      [6, 'Doublon dans le fichier (ligne 2)'], [7, 'Numéro incomplet'],
    ]);
    expect(await compter()).toBe(avant);
  });
  it('l\'import enregistre les lignes valides, avec compte famille, et s\'inscrit au journal', async () => {
    const avant = await compter();
    const r = await sec.post('/scolarite/import', { essai: false, lignes });
    expect(r.corps).toMatchObject({ essai: false, valides: 1, importes: 1 });
    expect(await compter()).toBe(avant + 1);
    const e = await env.bd.lire<{ nom: string; prenoms: string; classe: string }>(sqlBrut(`SELECT e.nom, e.prenoms, c.nom AS classe FROM scolarite.eleve e
      JOIN scolarite.inscription i ON i.eleve_id = e.id JOIN structure.classe c ON c.id = i.classe_id WHERE e.nom = 'MBARGA'`));
    expect(e).toEqual([{ nom: 'MBARGA', prenoms: 'Inès', classe: 'CM2 A' }]);
    const compte = await env.bd.lire(sqlBrut(`SELECT 1 FROM core.compte WHERE identifiant = '600000171' AND type = 'famille'`));
    expect(compte).toHaveLength(1);
    const j = await env.bd.lire<{ n: number }>(sqlBrut(`SELECT count(*)::int AS n FROM core.journal_audit WHERE action = 'Import'`));
    expect(j[0]!.n).toBe(1);
    // Relancer le même fichier ne crée pas de doublon.
    const encore = await sec.post('/scolarite/import', { essai: false, lignes });
    expect(encore.corps.importes).toBe(0);
  });
  it('cartes scolaires de la classe en PDF ; refusées sans droit d\'imprimer (403)', async () => {
    const r = await sec.get(`/scolarite/classes/${ids['classe:CM2 A']}/document?type=cartes`);
    expect(r.status).toBe(200);
    expect(String(r.entetes['content-type'])).toContain('application/pdf');
    expect(r.brut.subarray(0, 4).toString()).toBe('%PDF');
    expect((await eco.get(`/scolarite/classes/${ids['classe:CM2 A']}/document?type=cartes`)).status).toBe(403);
    // QR code de vérification (D-44) : un code par carte, lisible sans connexion, informations réduites ; code inconnu : 404.
    const v = await env.bd.lireUn<{ code: string }>(sql`SELECT v.code FROM scolarite.verification v JOIN scolarite.inscription i ON i.id = v.objet_id
                                                        WHERE v.type = 'carte' AND i.classe_id = ${ids['classe:CM2 A']} LIMIT 1`);
    expect(v?.code).toMatch(/^[A-Z2-7]{12}$/);
    const pub = await new Client(env.app).get(`/verification/${v!.code}`);
    expect(pub.status).toBe(200);
    expect(pub.corps.valide).toBe(true);
    expect(pub.corps.lignes.map((l: { libelle: string }) => l.libelle)).toEqual(['Élève', 'Matricule', 'Classe', 'Année scolaire']);
    expect((await new Client(env.app).get('/verification/AAAAAAAAAAAA')).status).toBe(404);
  });
  it('modèles de documents : lus avec le paramétrage, modifiés par la secrétaire seule (403)', async () => {
    const corps = { fr: { entete: 'RÉPUBLIQUE DU CAMEROUN · Paix – Travail – Patrie', mentions: 'Les frais versés ne sont pas remboursables.' },
      en: { entete: 'REPUBLIC OF CAMEROON · Peace – Work – Fatherland', mentions: 'Fees paid are not refundable.' } };
    expect((await sec.put('/structure/modeles/recu', corps)).status).toBe(200);
    const m = await sec.get('/structure/modeles');
    expect(m.corps.map((x: { type: string }) => x.type)).toEqual(['recu', 'avis', 'certificat', 'liste', 'bulletin']);
    expect(m.corps[0].en.mentions).toBe('Fees paid are not refundable.');
    for (const c of [eco, dir, pre]) expect((await c.put('/structure/modeles/recu', corps)).status).toBe(403);
    expect((await sec.get(`/scolarite/classes/${ids['classe:CM2 A']}/document?type=liste`)).status).toBe(200);
  });
  it('rapports pour la tutelle en PDF, réservés au pilotage (403)', async () => {
    for (const t of ['rentree', 'instituteurs', 'trimestre']) {
      const r = await dir.get(`/pilotage/rapports/${t}`);
      expect(r.status).toBe(200);
      expect(r.brut.subarray(0, 4).toString()).toBe('%PDF');
    }
    for (const c of [eco, sec, pre]) expect((await c.get('/pilotage/rapports/rentree')).status).toBe(403);
  });
  it('export comptable : écritures équilibrées, réservé aux comptes (403)', async () => {
    const r = await eco.get(`/finances/comptes/document?format=ecritures&du=2020-01-01&au=${auj()}`);
    expect(r.status).toBe(200);
    const lignes = String(r.corps).replace(/^\uFEFF/, '').trim().split('\r\n').map((l) => l.split(';'));
    expect(lignes[0]).toEqual(['Date', 'Journal', 'Compte', 'Intitulé du compte', 'Libellé', 'Pièce', 'Débit', 'Crédit']);
    const somme = (k: number) => lignes.slice(1).reduce((t, l) => t + Number(l[k] || 0), 0);
    expect(somme(6)).toBeGreaterThan(0);
    expect(somme(6)).toBe(somme(7));
    expect((await sec.get('/finances/comptes/document?format=ecritures')).status).toBe(403);
  });
  it('403 : sauvegarde, restauration et accès en lecture restent à la secrétaire', async () => {
    expect((await eco.get('/core/sauvegardes')).status).toBe(403);
    expect((await pre.post('/core/sauvegardes', {})).status).toBe(403);
    expect((await dir.post('/core/sauvegardes/restauration', { nom: 'gs-20261111-180000-quotidienne.sauvegarde' })).status).toBe(403);
    // Plus d'accès direct à la base depuis l'application (D-47).
    expect((await dir.get('/core/base')).status).toBe(404);
    expect((await sec.post('/core/base/lecture', {})).status).toBe(404);
    expect((await sec.get('/core/sauvegardes')).status).toBe(200);
  });
  it('403 : la clôture d\'année n\'est lancée que par un compte autorisé ; elle se prépare par des vérifications', async () => {
    expect((await new Client(env.app).get('/scolarite/cloture')).status).toBe(401);
    expect((await eco.get('/scolarite/cloture')).status).toBe(403);
    for (const c of [dir, pre, eco, ip]) expect((await c.post('/scolarite/cloture', { passages: [] })).status).toBe(403);
    const r = await sec.get('/scolarite/cloture');
    expect(r.status).toBe(200);
    expect(r.corps.verifications.length).toBeGreaterThan(0);
    expect(typeof r.corps.pret).toBe('boolean');
  });
});

import { sql } from 'drizzle-orm';
const sqlBrut = (s: string) => sql.raw(s);
