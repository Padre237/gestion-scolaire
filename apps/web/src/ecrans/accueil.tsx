// Maquette Main (tableau de bord). Écran de référence pour les autres modules ; la connexion est dans mobile.tsx (charte Sekou).
import { useNavigate } from 'react-router-dom';
import type { RouteEcran } from '../App.tsx';
import { api } from '../core/api.ts';
import { Coque } from '../core/coque.tsx';
import { fcfa, heure, jjmm, montant, pluriel } from '../core/format.ts';
import { Bouton, CarteChiffre, Colonnes, Doux, Icone, LigneListe, Panneau, Pastille, TitrePanneau, useDonnees, BarreProgression, Chargement, Erreur } from '../core/ui.tsx';
import { useEtroit } from './admin-commun.tsx';


// ===================================================================== tableau de bord

function Courbe({ jours }: { jours: { jour: string; montant: number; versements: number }[] }) {
  const etroit = useEtroit();
  const max = Math.max(1, ...jours.map((x) => x.montant));
  const total = jours.reduce((s, x) => s + x.montant, 0);
  const nb = jours.reduce((s, x) => s + x.versements, 0);
  return (
    <Panneau>
      <TitrePanneau titre="Encaissements · 14 derniers jours" sous={`${fcfa(total)} · ${pluriel(nb, 'versement')}`} />
      <div role="img" aria-label={`Encaissements des 14 derniers jours : ${jours.map((j) => `${j.jour} ${montant(j.montant)}`).join(', ')} FCFA`}
        style={{ height: 200, display: 'flex', alignItems: 'flex-end', gap: etroit ? 4 : 8 }}>
        {jours.map((j, i) => {
          const dernier = i === jours.length - 1;
          // Sous 640 px, un libellé de jour sur deux est masqué (le dernier reste) ; la place du libellé est conservée pour aligner les barres.
          const libelleMasque = !dernier && (jours.length - 1 - i) % 2 === 1;
          return (
            <div key={i} style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', height: '100%', gap: 6 }}>
              {dernier && <span style={{ fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap' }}>{montant(j.montant)}</span>}
              <div style={{ width: '100%', maxWidth: 38, height: Math.max(2, (j.montant / max) * 140), borderRadius: '4px 4px 0 0', background: dernier ? 'var(--eclat)' : 'var(--accent)' }} />
              <span style={{ fontSize: 11, lineHeight: '16px', minHeight: 16, color: dernier ? 'var(--texte)' : 'var(--doux)', fontWeight: dernier ? 700 : 400 }}>
                <span className={libelleMasque ? 'cache-mobile' : ''}>{j.jour}</span>
              </span>
            </div>
          );
        })}
      </div>
    </Panneau>
  );
}

const A_TRAITER: Record<string, [string, string, 'attention' | 'danger' | 'neutre']> = {
  validations: ['demandes à valider', '/finances/validations', 'attention'],
  appels: ['appels non faits ce matin', '/vie-scolaire/appel', 'danger'],
  notes: ['classes sans notes pour la', '/pedagogie/notes', 'danger'],
  sms: ['SMS en attente d’internet', '/messages/sms', 'neutre'],
};

export function EcranTableauDeBord() {
  const naviguer = useNavigate();
  const etroit = useEtroit();
  const { d, erreur, recharger } = useDonnees(() => api.get('/pilotage/tableau-de-bord'));
  const contenu = (() => {
    if (erreur) return <Erreur message={erreur} recharger={recharger} />;
    if (!d) return <Chargement />;
    const cartes = [];
    if (d.effectifs) cartes.push(<CarteChiffre key="e" etiquette="Élèves inscrits" valeur={montant(d.effectifs.eleves)} sous={pluriel(d.effectifs.classes, 'classe')} />);
    if (d.jour) cartes.push(<CarteChiffre key="j" etiquette="Encaissé aujourd'hui" valeur={montant(d.jour.montant)} unite="FCFA" reperes sous={pluriel(d.jour.versements, 'versement')} />);
    if (d.recouvrement) cartes.push(<CarteChiffre key="r" etiquette="Taux de recouvrement" valeur={`${d.recouvrement.du > 0 ? Math.floor((d.recouvrement.verse * 100) / d.recouvrement.du) : 0} %`}
      sous={`${montant(d.recouvrement.verse)} sur ${montant(d.recouvrement.du)} FCFA`} />);
    if (d.echu) cartes.push(<CarteChiffre key="x" etiquette="Échéances dépassées" valeur={montant(d.echu.montant)} unite="FCFA" couleur="var(--attention)" sous={`${pluriel(d.echu.eleves, 'élève')} en retard`} />);
    const aTraiter = ((d.aTraiter ?? []) as { code: string; nombre: number; sequence?: string }[]).filter((a) => a.nombre > 0);
    return (
      <>
        {/* Deux cartes par rangée dès 320 px de large ; quatre sur un grand écran, comme la maquette. */}
        {cartes.length > 0 && <div className="grille" style={{ ['--min' as string]: '150px', gap: etroit ? 12 : 20 }}>{cartes}</div>}
        <Colonnes colonnes={[
          { flex: 2, min: 600, enfants: <>
            {d.courbe && <Courbe jours={d.courbe} />}
            {d.parClasse && (
              <Panneau>
                <TitrePanneau titre="Recouvrement par classe" sous="Part versée, et reste dû en FCFA" />
                {/* Grille sur grand écran ; liste pleine largeur sur téléphone (.pile-mobile). */}
                <div className="grille pile-mobile" style={{ ['--min' as string]: '150px', gap: etroit ? 14 : 18 }}>
                  {(d.parClasse as any[]).map((c) => (
                    <div key={c.classe} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}><span className="gras">{c.classe}</span><span className="gras">{c.du > 0 ? Math.floor((c.verse * 100) / c.du) : 0} %</span></div>
                      <BarreProgression valeur={c.du > 0 ? c.verse / c.du : 0} />
                      <Doux>Reste {montant(c.reste)}</Doux>
                    </div>
                  ))}
                </div>
              </Panneau>
            )}
          </> },
          { flex: 1, min: 300, enfants: <>
            {d.derniers && (
              <Panneau>
                <TitrePanneau titre="Derniers versements" action={<Bouton variante="lien" onClick={() => naviguer('/finances/caisse')}>Caisse du jour</Bouton>} />
                <div>
                  {(d.derniers as any[]).map((v) => (
                    <LigneListe key={v.numeroRecu} onClick={() => naviguer(`/scolarite/eleves/${v.eleveId}`)}>
                      <div style={{ flex: '1 1 160px', minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                        <Doux>{v.numeroRecu}</Doux><span className="gras">{v.eleve}</span><Doux>{v.classe} · {jjmm(v.encaisseLe)} à {heure(v.encaisseLe)}</Doux>
                      </div>
                      <span className="gras" style={{ whiteSpace: 'nowrap' }}>{montant(v.montant)}</span>
                    </LigneListe>
                  ))}
                  {d.derniers.length === 0 && <Doux>Aucun versement pour l’instant</Doux>}
                </div>
              </Panneau>
            )}
            {aTraiter.length > 0 && (
              <Panneau>
                <TitrePanneau titre="À traiter" />
                <div>
                  {aTraiter.map((a) => {
                    const [texte, route, ton] = A_TRAITER[a.code] ?? A_TRAITER['sms']!;
                    return (
                      <LigneListe key={a.code} onClick={() => naviguer(route)}>
                        <Pastille ton={ton}>{a.nombre}</Pastille>
                        <span style={{ flex: '1 1 160px', minWidth: 0 }}>{texte}{a.code === 'notes' ? ` ${a.sequence ?? ''}` : ''}</span>
                        <Icone nom="chevron" taille={16} style={{ color: 'var(--doux)' }} />
                      </LigneListe>
                    );
                  })}
                </div>
              </Panneau>
            )}
          </> },
        ]} />
      </>
    );
  })();
  return <Coque module="tableau">{contenu}</Coque>;
}

export const routes: RouteEcran[] = [
  { path: '/', element: <EcranTableauDeBord /> },
  { path: '/tableau-de-bord', element: <EcranTableauDeBord /> },
];


