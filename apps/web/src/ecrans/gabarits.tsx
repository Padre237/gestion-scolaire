// Modèles d'impression (D-44) : choix d'un modèle parmi trois pour la fiche d'inscription, la carte scolaire et le bulletin ;
// adresse de la page « Vérifier » imprimée dans les QR codes ; aperçu PDF de chaque modèle avec l'en-tête de l'établissement.
import { useState } from 'react';
import { api } from '../core/api.ts';
import { ouvrirDocument } from '../core/documents.ts';
import { agir, Bouton, Champ, Chargement, Doux, Erreur, Note, Panneau, TitrePanneau, useDonnees, useRaccourci } from '../core/ui.tsx';

type Gabarit = 'classique' | 'bandeau' | 'epure';
type Document = 'fiche' | 'carte' | 'bulletin';
interface Reglage { fiche: Gabarit; carte: Gabarit; bulletin: Gabarit; adresseVerification: string; aLogo: boolean; adresseParDefaut: string }

const DOCUMENTS: [Document, string, string][] = [
  ['fiche', 'Fiche d’inscription', 'Remise à la famille : identité, responsables, renseignements, accès à l’espace parents.'],
  ['carte', 'Carte scolaire', 'Format carte bancaire, avec la photo de l’élève et le QR code de vérification.'],
  ['bulletin', 'Bulletin', 'Notes, rang, appréciations ; QR code de vérification sur chaque bulletin publié.'],
];
const GABARITS: [Gabarit, string, string][] = [
  ['classique', 'Classique', 'En-tête centré, logo à gauche'],
  ['bandeau', 'Bandeau', 'Bandeau bleu, logo, filet jaune'],
  ['epure', 'Épuré', 'Noir et blanc, pour toutes les imprimantes'],
];

/** Vignette schématique du modèle (aucune donnée réelle). */
const Vignette = ({ g }: { g: Gabarit }) => (
  <span className={`vignette vignette-${g}`} aria-hidden="true">
    <span className="vignette-tete"><span className="vignette-logo" /><span className="vignette-lignes"><i /><i /></span></span>
    <span className="vignette-corps"><i /><i /><i /><i /></span>
    <span className="vignette-qr" />
  </span>
);

export function PanneauGabarits({ modifiable }: { modifiable: boolean }) {
  const st = useDonnees(() => api.get<Reglage>('/structure/gabarits'));
  const [r, setR] = useState<Reglage | null>(null);
  const [charge, setCharge] = useState(false);
  const v = r ?? st.d;
  const modifie = r !== null;
  const enregistrer = async () => {
    if (!v || !modifie || charge) return;
    setCharge(true);
    if (await agir(() => api.put('/structure/gabarits', { fiche: v.fiche, carte: v.carte, bulletin: v.bulletin, adresseVerification: v.adresseVerification.trim() }), 'Modèles d’impression enregistrés')) {
      setR(null); await st.recharger();
    }
    setCharge(false);
  };
  useRaccourci('ctrl+s', () => { void enregistrer(); }, modifiable && modifie);
  if (st.erreur && !st.d) return <Erreur message={st.erreur} recharger={st.recharger} />;
  if (!v) return <Panneau><Chargement /></Panneau>;
  const maj = (p: Partial<Reglage>) => setR({ ...v, ...p });
  return (
    <Panneau>
      <TitrePanneau titre="Modèles d’impression" sous={modifie ? 'Modifications non enregistrées' : 'Un modèle par document'}
        action={modifiable && <Bouton variante="principal" touches={['Ctrl', 'S']} disabled={!modifie} charge={charge} onClick={enregistrer}>Enregistrer</Bouton>} />
      {!v.aLogo && <Note ton="attention">Ajoutez le logo dans la rubrique Identité : il figure sur les cartes, les bulletins, les fiches et au centre du QR code.</Note>}
      {DOCUMENTS.map(([d, libelle, aide]) => (
        <div key={d} className="gabarit-document">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}><span className="gras">{libelle}</span><Doux>{aide}</Doux></div>
          <div className="gabarits" role="radiogroup" aria-label={`Modèle : ${libelle}`}>
            {GABARITS.map(([g, nom, desc]) => (
              <div key={g} className={`gabarit${v[d] === g ? ' choisi' : ''}`}>
                <button type="button" role="radio" aria-checked={v[d] === g} disabled={!modifiable} onClick={() => maj({ [d]: g } as Partial<Reglage>)}>
                  <Vignette g={g} />
                  <span className="gras">{nom}</span>
                  <span className="doux petit">{desc}</span>
                </button>
                <Bouton petit variante="lien" onClick={() => ouvrirDocument(`/structure/gabarits/apercu?document=${d}&gabarit=${g}`)}>Aperçu PDF</Bouton>
              </div>
            ))}
          </div>
        </div>
      ))}
      <Champ libelle="Adresse de la page « Vérifier » (QR codes)" value={v.adresseVerification} placeholder={v.adresseParDefaut}
        onChange={modifiable ? (x) => maj({ adresseVerification: x }) : undefined} readOnly={!modifiable} />
      <Doux>Le QR code d’une carte ou d’un bulletin mène à cette adresse, suivie de « /verifier/ » et du code du document. Laissée vide : l’adresse de ce poste
        ({v.adresseParDefaut}), lisible sur le réseau de l’école. Avec la version en ligne, indiquez son adresse publique.</Doux>
    </Panneau>
  );
}
