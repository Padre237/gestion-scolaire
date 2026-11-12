// Documents imprimés (conception § 9.2) : un objet de données, deux rendus pour le reçu
// (PDF 240 × 140 mm et ESC/P 80 colonnes en CP850), PDF A4 pour les autres documents (décision D-18).
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage, type PDFPage } from 'pdf-lib';
import iconv from 'iconv-lite';
import QRCode from 'qrcode';

const MM = 72 / 25.4;
const ENCRE = rgb(0.043, 0.122, 0.294); // #0B1F4B
const DOUX = rgb(0.294, 0.357, 0.478);  // #4B5B7A
const TRAIT = rgb(0.75, 0.78, 0.84);

/** Helvetica (WinAnsi) ne couvre pas ɛ, ɔ, ŋ : lettre latine la plus proche (D-18). */
export function pourPdf(s: string): string {
  return s.replace(/[ɛƐ]/g, (c) => (c === 'ɛ' ? 'e' : 'E')).replace(/[ɔƆ]/g, (c) => (c === 'ɔ' ? 'o' : 'O'))
    .replace(/[ŋŊ]/g, (c) => (c === 'ŋ' ? 'n' : 'N')).replace(/[  ]/g, ' ').replace(/[’]/g, "'").replace(/[–—]/g, '-')
    .replace(/[^\x20-\x7E -ÿŒœ€]/g, '');
}

export const montant = (n: number | null | undefined) => (n === null || n === undefined ? '–' : n === 0 ? '0' : n.toLocaleString('fr-FR').replace(/[  ]/g, ' '));
export const dateFr = (iso: string | null | undefined) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '');

interface Polices { normal: PDFFont; gras: PDFFont }

async function nouveauDocument(titre: string) {
  const doc = await PDFDocument.create();
  doc.setTitle(titre);
  doc.setCreator('Gestion scolaire');
  doc.setProducer('Gestion scolaire');
  const polices: Polices = { normal: await doc.embedFont(StandardFonts.Helvetica), gras: await doc.embedFont(StandardFonts.HelveticaBold) };
  return { doc, polices };
}

function texte(page: PDFPage, s: string, x: number, y: number, police: PDFFont, taille: number, couleur = ENCRE, largeurMax?: number) {
  let t = pourPdf(s);
  if (largeurMax) while (t.length > 1 && police.widthOfTextAtSize(t, taille) > largeurMax) t = t.slice(0, -2) + '…';
  page.drawText(t.replace('…', '.'), { x, y, size: taille, font: police, color: couleur });
}

function texteDroite(page: PDFPage, s: string, xDroite: number, y: number, police: PDFFont, taille: number, couleur = ENCRE) {
  const t = pourPdf(s);
  page.drawText(t, { x: xDroite - police.widthOfTextAtSize(t, taille), y, size: taille, font: police, color: couleur });
}

function texteCentre(page: PDFPage, s: string, xCentre: number, y: number, police: PDFFont, taille: number, couleur = ENCRE) {
  const t = pourPdf(s);
  page.drawText(t, { x: xCentre - police.widthOfTextAtSize(t, taille) / 2, y, size: taille, font: police, color: couleur });
}

/** Découpe un paragraphe en lignes tenant dans la largeur. */
function lignesDe(s: string, police: PDFFont, taille: number, largeur: number): string[] {
  const res: string[] = [];
  for (const para of pourPdf(s).split('\n')) {
    let ligne = '';
    for (const mot of para.split(' ')) {
      const essai = ligne ? `${ligne} ${mot}` : mot;
      if (police.widthOfTextAtSize(essai, taille) > largeur && ligne) { res.push(ligne); ligne = mot; } else ligne = essai;
    }
    res.push(ligne);
  }
  return res;
}

export interface TexteModele { entete?: string | null; mentions?: string | null }
export interface ModeleDoc { fr?: TexteModele; en?: TexteModele }
export type TypeModele = 'recu' | 'avis' | 'certificat' | 'liste' | 'bulletin';
export interface Etablissement {
  nom_fr: string; nom_en: string; ville_bp: string | null; telephone: string | null; signataire?: string | null; devise?: string | null;
  /** Modèles de documents saisis dans Paramètres › Établissement. */
  modeles?: Partial<Record<TypeModele, ModeleDoc>> | null;
}

/** En-tête du modèle (par exemple la tutelle), au-dessus du nom de l'établissement : français, puis anglais. */
function enteteModele(page: PDFPage, p: Polices, m: ModeleDoc | undefined, xCentre: number, yHaut: number, taille = 6.5) {
  let y = yHaut;
  for (const t of [m?.fr?.entete, m?.en?.entete]) {
    if (!t?.trim()) continue;
    for (const l of t.split('\n').slice(0, 2)) { texteCentre(page, l.trim(), xCentre, y, p.gras, taille, DOUX); y -= taille + 1.5; }
  }
}

/** Mentions du modèle, en bas de page : français, puis anglais. */
function mentionsModele(page: PDFPage, p: Polices, m: ModeleDoc | undefined, x: number, yBas: number, largeur: number, taille = 7.5) {
  const lignes = [m?.fr?.mentions, m?.en?.mentions].filter((t): t is string => !!t?.trim()).flatMap((t) => lignesDe(t, p.normal, taille, largeur).slice(0, 2));
  let y = yBas + (lignes.length - 1) * (taille + 2.5);
  for (const l of lignes) { texte(page, l, x, y, p.normal, taille, DOUX); y -= taille + 2.5; }
}

function enteteA4(page: PDFPage, p: Polices, e: Etablissement, titre: string, sousTitre?: string, type?: TypeModele) {
  const { width, height } = page.getSize();
  if (type) {
    const m = e.modeles?.[type];
    enteteModele(page, p, m, width / 2, height - 14);
    mentionsModele(page, p, m, 40, 26, width - 80);
  }
  texteCentre(page, `${e.nom_fr.toUpperCase()} · ${e.nom_en.toUpperCase()}`, width / 2, height - 50, p.gras, 13);
  const coord = [e.ville_bp, e.telephone ? `Tél. ${e.telephone}` : null].filter(Boolean).join(' · ');
  if (coord) texteCentre(page, coord, width / 2, height - 66, p.normal, 9, DOUX);
  if (e.devise) texteCentre(page, e.devise, width / 2, height - 78, p.normal, 8, DOUX);
  page.drawLine({ start: { x: 40, y: height - 88 }, end: { x: width - 40, y: height - 88 }, thickness: 0.8, color: TRAIT });
  texteCentre(page, titre, width / 2, height - 112, p.gras, 15);
  if (sousTitre) texteCentre(page, sousTitre, width / 2, height - 130, p.normal, 10, DOUX);
}

// ---------------------------------------------------------------- modèles d'impression (D-44) : trois habillages, logo, QR code

/** Classique : bandeau bleu encre ou filets, logo à gauche ; Bandeau : bandeau bleu savoir de la charte ; Épuré : noir et blanc. */
export type Gabarit = 'classique' | 'bandeau' | 'epure';
export const GABARITS: [Gabarit, string][] = [['classique', 'Classique'], ['bandeau', 'Bandeau'], ['epure', 'Épuré']];
const SAVOIR = rgb(0.114, 0.306, 0.847); // #1D4ED8
const CRAIE = rgb(0.98, 0.8, 0.082);     // #FACC15 : filet sous le bandeau, jamais un aplat
const NOIR = rgb(0.08, 0.08, 0.08);
const BLANC = rgb(1, 1, 1);

async function imageDe(doc: PDFDocument, b: Uint8Array | null | undefined): Promise<PDFImage | null> {
  if (!b || b.length < 8) return null;
  try { return b[0] === 0x89 ? await doc.embedPng(b) : await doc.embedJpg(b); } catch { return null; }
}
/** Image dans un cadre, sans la déformer. */
function dansCadre(page: PDFPage, img: PDFImage, x: number, y: number, l: number, h: number) {
  const r = Math.min(l / img.width, h / img.height);
  page.drawImage(img, { x: x + (l - img.width * r) / 2, y: y + (h - img.height * r) / 2, width: img.width * r, height: img.height * r });
}
const initialesEtab = (e: Etablissement) => e.nom_fr.split(/\s+/).filter((m) => m.length > 2 && m[0] === m[0]!.toUpperCase()).slice(0, 3).map((m) => m[0]).join('') || e.nom_fr.slice(0, 2).toUpperCase();

/**
 * QR code de vérification (correction H : jusqu'à 30 % du code peut être caché), logo de l'établissement au centre.
 * Le lien mène à la page « Vérifier » de l'établissement.
 */
function dessinerQr(page: PDFPage, p: Polices, lien: string, x: number, y: number, taille: number, logo: PDFImage | null, initiales: string, couleur = ENCRE) {
  const qr = QRCode.create(lien, { errorCorrectionLevel: 'H' });
  const n = qr.modules.size;
  const m = taille / (n + 2);
  page.drawRectangle({ x, y, width: taille, height: taille, color: BLANC });
  for (let ligne = 0; ligne < n; ligne++) {
    let c = 0;
    while (c < n) {
      if (!qr.modules.get(ligne, c)) { c++; continue; }
      let k = c;
      while (k + 1 < n && qr.modules.get(ligne, k + 1)) k++;
      page.drawRectangle({ x: x + (c + 1) * m, y: y + taille - (ligne + 2) * m, width: (k - c + 1) * m, height: m, color: couleur });
      c = k + 1;
    }
  }
  const cs = taille * 0.24;
  const cx = x + (taille - cs) / 2, cy = y + (taille - cs) / 2;
  page.drawRectangle({ x: cx - m, y: cy - m, width: cs + 2 * m, height: cs + 2 * m, color: BLANC });
  if (logo) dansCadre(page, logo, cx, cy, cs, cs);
  else texteCentre(page, initiales, x + taille / 2, y + taille / 2 - cs * 0.17, p.gras, cs * 0.42, couleur);
}

export interface Habillage {
  gabarit?: Gabarit;
  /** Logo de l'établissement (PNG ou JPEG), sur les bulletins, les cartes et les fiches. */
  logo?: Uint8Array | null;
}

/** En-tête A4 selon le modèle choisi ; renvoie l'ordonnée sous l'en-tête. */
function enteteDocument(page: PDFPage, p: Polices, e: Etablissement, titre: string, sousTitre: string | undefined, g: Gabarit, logo: PDFImage | null, type?: TypeModele): number {
  const { width, height } = page.getSize();
  const m = type ? e.modeles?.[type] : undefined;
  const coord = [e.ville_bp, e.telephone ? `Tél. ${e.telephone}` : null].filter(Boolean).join(' · ');
  if (type) mentionsModele(page, p, m, 40, 26, width - 80);
  if (g === 'bandeau') {
    const hb = 96;
    page.drawRectangle({ x: 0, y: height - hb, width, height: hb, color: SAVOIR });
    page.drawRectangle({ x: 0, y: height - hb - 3, width, height: 3, color: CRAIE });
    let xt = 40;
    if (logo) {
      page.drawRectangle({ x: 40, y: height - hb + 16, width: 64, height: 64, color: BLANC });
      dansCadre(page, logo, 44, height - hb + 20, 56, 56);
      xt = 118;
    }
    if (m?.fr?.entete?.trim()) texte(page, m.fr.entete.split('\n')[0]!.trim(), xt, height - 26, p.gras, 7, rgb(0.78, 0.84, 1));
    texte(page, e.nom_fr.toUpperCase(), xt, height - 44, p.gras, 13, BLANC, width - xt - 40);
    texte(page, e.nom_en, xt, height - 60, p.normal, 10, BLANC, width - xt - 40);
    if (coord) texte(page, coord, xt, height - 76, p.normal, 8.5, rgb(0.78, 0.84, 1), width - xt - 40);
    texte(page, titre, 40, height - hb - 32, p.gras, 15);
    if (sousTitre) texte(page, sousTitre, 40, height - hb - 48, p.normal, 10, DOUX);
    return height - hb - 70;
  }
  if (g === 'epure') {
    let y = height - 34;
    if (type) { enteteModele(page, p, m, width / 2, height - 14); y -= 6; }
    if (logo) { dansCadre(page, logo, width / 2 - 20, y - 40, 40, 40); y -= 48; }
    texteCentre(page, e.nom_fr.toUpperCase(), width / 2, y - 10, p.gras, 12, NOIR);
    texteCentre(page, [e.nom_en, coord].filter(Boolean).join(' · '), width / 2, y - 24, p.normal, 8.5, NOIR);
    page.drawLine({ start: { x: 40, y: y - 34 }, end: { x: width - 40, y: y - 34 }, thickness: 0.6, color: NOIR });
    texte(page, titre, 40, y - 56, p.gras, 13, NOIR);
    if (sousTitre) texteDroite(page, sousTitre, width - 40, y - 56, p.normal, 9.5, NOIR);
    return y - 80;
  }
  // Classique : l'en-tête d'origine, logo à gauche.
  if (type) enteteModele(page, p, m, width / 2, height - 14);
  if (logo) dansCadre(page, logo, 40, height - 92, 56, 56);
  texteCentre(page, `${e.nom_fr.toUpperCase()} · ${e.nom_en.toUpperCase()}`, width / 2, height - 50, p.gras, 13);
  if (coord) texteCentre(page, coord, width / 2, height - 66, p.normal, 9, DOUX);
  if (e.devise) texteCentre(page, e.devise, width / 2, height - 78, p.normal, 8, DOUX);
  page.drawLine({ start: { x: 40, y: height - 98 }, end: { x: width - 40, y: height - 98 }, thickness: 0.8, color: TRAIT });
  texteCentre(page, titre, width / 2, height - 122, p.gras, 15);
  if (sousTitre) texteCentre(page, sousTitre, width / 2, height - 140, p.normal, 10, DOUX);
  return height - 170;
}

/** Bloc de vérification en bas de page : QR code, logo au centre, et mention. */
function blocVerification(page: PDFPage, p: Polices, lien: string | undefined, x: number, y: number, logo: PDFImage | null, e: Etablissement, g: Gabarit) {
  if (!lien) return;
  dessinerQr(page, p, lien, x, y, 70, logo, initialesEtab(e), g === 'epure' ? NOIR : ENCRE);
  texteCentre(page, 'Vérifier ce document', x + 35, y - 10, p.gras, 7, g === 'epure' ? NOIR : DOUX);
  texteCentre(page, 'Scannez le code', x + 35, y - 19, p.normal, 6.5, DOUX);
}

interface Colonne { titre: string; largeur: number; droite?: boolean }

function tableau(page: PDFPage, p: Polices, x: number, y: number, colonnes: Colonne[], lignes: string[][], opts: { taille?: number; hauteur?: number; total?: string[] } = {}) {
  const taille = opts.taille ?? 9;
  const h = opts.hauteur ?? 16;
  const largeurTotale = colonnes.reduce((s, c) => s + c.largeur, 0);
  let yy = y;
  const ecrireLigne = (cellules: string[], police: PDFFont, fond?: boolean) => {
    if (fond) page.drawRectangle({ x, y: yy - h + 4, width: largeurTotale, height: h, color: rgb(0.945, 0.957, 0.98) });
    let xx = x;
    cellules.forEach((c, i) => {
      const col = colonnes[i]!;
      if (col.droite) texteDroite(page, c, xx + col.largeur - 4, yy - h + 9, police, taille);
      else texte(page, c, xx + 4, yy - h + 9, police, taille, ENCRE, col.largeur - 8);
      xx += col.largeur;
    });
    yy -= h;
    page.drawLine({ start: { x, y: yy + 4 }, end: { x: x + largeurTotale, y: yy + 4 }, thickness: 0.4, color: TRAIT });
  };
  ecrireLigne(colonnes.map((c) => c.titre), p.gras, true);
  for (const l of lignes) ecrireLigne(l, p.normal);
  if (opts.total) ecrireLigne(opts.total, p.gras);
  return yy;
}

// ---------------------------------------------------------------- reçu bilingue (maquette Recu)

export interface RecuData {
  etablissement: Etablissement;
  numero: string; date: string; heure: string;
  eleve: string; matricule: string; classe: string; annee: string;
  lignes: { libelleFr: string; libelleEn: string; prix: number; reduction: number; aPayer: number; verse: number; reste: number; dateLimite: string }[];
  montant: number; montantLettresFr: string; montantLettresEn: string;
  modeFr: string; modeEn: string; bordereau: string | null;
  caissier: string;
  duplicata: boolean; annule: boolean;
}

export async function pdfRecu(d: RecuData, exemplaires = 1): Promise<Uint8Array> {
  const { doc, polices: p } = await nouveauDocument(`Reçu ${d.numero}`);
  for (let n = 0; n < exemplaires; n++) {
    const page = doc.addPage([240 * MM, 140 * MM]);
    const { width, height } = page.getSize();
    const g = 12 * MM;
    page.drawRectangle({ x: g, y: height - g - 34, width: 34, height: 34, borderColor: TRAIT, borderWidth: 0.8 });
    texteCentre(page, 'Logo', g + 17, height - g - 20, p.normal, 7, DOUX);
    texte(page, `${d.etablissement.nom_fr.toUpperCase()} · ${d.etablissement.nom_en.toUpperCase()}`, g + 44, height - g - 12, p.gras, 11);
    const coord = [d.etablissement.ville_bp ? `BP ${d.etablissement.ville_bp}` : null, d.etablissement.telephone ? `Tél. ${d.etablissement.telephone}` : null]
      .filter(Boolean).join(' · ');
    texte(page, coord, g + 44, height - g - 26, p.normal, 8, DOUX);
    texte(page, 'REÇU DE PAIEMENT · PAYMENT RECEIPT', g, height - g - 56, p.gras, 11);
    texteDroite(page, `N° ${d.numero}`, width - g, height - g - 12, p.gras, 11);
    texteDroite(page, `${d.date} à ${d.heure}`, width - g, height - g - 26, p.normal, 8, DOUX);
    if (d.duplicata) texteDroite(page, 'DUPLICATA', width - g, height - g - 56, p.gras, 11, rgb(0.66, 0.21, 0.04));
    if (d.annule) texteDroite(page, 'ANNULÉ · CANCELLED', width - g, height - g - 56, p.gras, 11, rgb(0.73, 0.11, 0.11));
    const yId = height - g - 74;
    texte(page, `Élève / Student : ${d.eleve}`, g, yId, p.normal, 8.5);
    texte(page, `Matricule / Reg. no. : ${d.matricule}`, g + 220, yId, p.normal, 8.5);
    texte(page, `Classe / Class : ${d.classe}`, g + 360, yId, p.normal, 8.5);
    texteDroite(page, `Année / Year : ${d.annee}`, width - g, yId, p.normal, 8.5);
    const larg = width - 2 * g;
    const cols: Colonne[] = [
      { titre: 'Rubrique / Item', largeur: larg * 0.24 }, { titre: 'Prix / Price', largeur: larg * 0.11, droite: true },
      { titre: 'Réduction / Discount', largeur: larg * 0.14, droite: true }, { titre: 'À payer / To pay', largeur: larg * 0.12, droite: true },
      { titre: 'Versé / Paid', largeur: larg * 0.11, droite: true }, { titre: 'Reste / Balance', largeur: larg * 0.12, droite: true },
      { titre: 'Date limite / Deadline', largeur: larg * 0.16, droite: true },
    ];
    const tot = (k: 'aPayer' | 'verse' | 'reste') => d.lignes.reduce((s, l) => s + l[k], 0);
    const yFin = tableau(page, p, g, yId - 8, cols, d.lignes.map((l) => [
      `${l.libelleFr} / ${l.libelleEn}`, montant(l.prix), l.reduction ? montant(l.reduction) : '–', montant(l.aPayer), montant(l.verse), montant(l.reste), l.dateLimite,
    ]), { taille: 7.5, hauteur: 14, total: ['Total', '', '', montant(tot('aPayer')), montant(tot('verse')), montant(tot('reste')), ''] });
    texte(page, `Montant versé / Amount paid : ${montant(d.montant)} FCFA`, g, yFin - 14, p.gras, 9);
    texte(page, `${d.montantLettresFr} · ${d.montantLettresEn}`, g, yFin - 27, p.normal, 8);
    texte(page, `Mode / Method : ${d.modeFr} / ${d.modeEn}${d.bordereau ? ` · bordereau ${d.bordereau}` : ''}`, g, yFin - 40, p.normal, 8);
    const m = d.etablissement.modeles?.recu;
    enteteModele(page, p, m, width / 2, height - 12);
    mentionsModele(page, p, m, g, g + 20, width - 2 * g, 6.8);
    texte(page, `Encaissé par / Received by : ${d.caissier}`, g, g + 6, p.normal, 8);
    texteDroite(page, 'Signature et cachet · Signature and stamp', width - g, g + 6, p.normal, 8, DOUX);
  }
  return doc.save();
}

/** Rendu ESC/P pour l'Epson LX-300+II : 80 colonnes, tableau en mode condensé, texte en CP850 (conception § 9.2). */
export function escpRecu(d: RecuData, exemplaires = 2): Buffer {
  const ESC = '\x1b';
  const morceaux: Buffer[] = [];
  const brut = (s: string) => morceaux.push(Buffer.from(s, 'latin1'));
  const txt = (s: string) => morceaux.push(iconv.encode(s.replace(/[ɛ]/g, 'e').replace(/[ɔ]/g, 'o').replace(/[ŋ]/g, 'n').replace(/[  ]/g, ' '), 'cp850'));
  const col = (s: string, n: number, droite = false) => (droite ? s.slice(0, n).padStart(n) : s.slice(0, n).padEnd(n));
  for (let n = 0; n < exemplaires; n++) {
    brut(`${ESC}@`);                 // initialisation
    brut(`${ESC}C${String.fromCharCode(33)}`); // page de 33 lignes (140 mm à 6 lignes par pouce)
    brut(`${ESC}E`); txt(`${d.etablissement.nom_fr.toUpperCase()} · ${d.etablissement.nom_en.toUpperCase()}\r\n`); brut(`${ESC}F`);
    txt(`${[d.etablissement.ville_bp, d.etablissement.telephone ? `Tél. ${d.etablissement.telephone}` : ''].filter(Boolean).join(' · ')}\r\n\r\n`);
    brut(`${ESC}E`); txt(col(`REÇU DE PAIEMENT · PAYMENT RECEIPT`, 50) + col(`N° ${d.numero}`, 30, true) + '\r\n'); brut(`${ESC}F`);
    txt(col(d.duplicata ? 'DUPLICATA' : d.annule ? 'ANNULÉ · CANCELLED' : '', 50) + col(`${d.date} à ${d.heure}`, 30, true) + '\r\n');
    txt(`Élève/Student : ${d.eleve}  Matricule : ${d.matricule}\r\n`);
    txt(`Classe/Class : ${d.classe}  Année/Year : ${d.annee}\r\n`);
    brut('\x0f'); // SI : condensé (137 colonnes)
    txt(col('Rubrique / Item', 34) + col('Prix', 12, true) + col('Réduction', 14, true) + col('À payer', 14, true) + col('Versé', 14, true)
      + col('Reste', 14, true) + col('Date limite', 16, true) + '\r\n');
    for (const l of d.lignes) {
      txt(col(`${l.libelleFr} / ${l.libelleEn}`, 34) + col(montant(l.prix), 12, true) + col(l.reduction ? montant(l.reduction) : '-', 14, true)
        + col(montant(l.aPayer), 14, true) + col(montant(l.verse), 14, true) + col(montant(l.reste), 14, true) + col(l.dateLimite, 16, true) + '\r\n');
    }
    const tot = (k: 'aPayer' | 'verse' | 'reste') => montant(d.lignes.reduce((s, l) => s + l[k], 0));
    txt(col('Total', 60) + col(tot('aPayer'), 14, true) + col(tot('verse'), 14, true) + col(tot('reste'), 14, true) + '\r\n');
    brut('\x12'); // DC2 : fin du condensé
    brut(`${ESC}E`); txt(`Montant versé / Amount paid : ${montant(d.montant)} FCFA\r\n`); brut(`${ESC}F`);
    txt(`${d.montantLettresFr}\r\n${d.montantLettresEn}\r\n`);
    txt(`Mode / Method : ${d.modeFr}${d.bordereau ? ` · bordereau ${d.bordereau}` : ''}\r\n\r\n`);
    txt(col(`Encaissé par / Received by : ${d.caissier}`, 50) + col('Signature et cachet', 30, true) + '\r\n');
    brut('\x0c'); // FF : saut de page
  }
  return Buffer.concat(morceaux);
}

// ---------------------------------------------------------------- avis de paiement (CU-17)

export interface AvisData {
  etablissement: Etablissement & { banque: string | null; numero_compte: string | null };
  numero: string; date: string; eleve: string; matricule: string; classe: string; payeur: string;
  lignes: { libelle: string; aPayer: number; verse: number; reste: number; dateLimite: string; echue: boolean }[];
}

export async function pdfAvis(avis: AvisData[]): Promise<Uint8Array> {
  const { doc, polices: p } = await nouveauDocument('Avis de paiement');
  for (const d of avis) {
    const page = doc.addPage([595, 842]);
    enteteA4(page, p, d.etablissement, 'AVIS DE PAIEMENT · PAYMENT NOTICE', `N° ${d.numero} du ${d.date}`, 'avis');
    let y = 842 - 165;
    for (const [k, v] of [['Élève', `${d.eleve} · ${d.matricule}`], ['Classe', d.classe], ['Responsable payeur', d.payeur]]) {
      texte(page, `${k} : ${v}`, 50, y, p.normal, 10); y -= 16;
    }
    y = tableau(page, p, 50, y - 10, [
      { titre: 'Rubrique', largeur: 150 }, { titre: 'À payer', largeur: 80, droite: true }, { titre: 'Versé', largeur: 80, droite: true },
      { titre: 'Reste', largeur: 80, droite: true }, { titre: 'Date limite', largeur: 105, droite: true },
    ], d.lignes.map((l) => [l.libelle + (l.echue ? ' (échue)' : ''), montant(l.aPayer), montant(l.verse), montant(l.reste), l.dateLimite]),
    { total: ['Reste dû', '', '', montant(d.lignes.reduce((s, l) => s + l.reste, 0)), ''] });
    y -= 20;
    for (const l of lignesDe(`Merci de régler le reste dû à la caisse de l'école, ou par versement à la banque${d.etablissement.banque ? ` : ${d.etablissement.banque}` : ''}${d.etablissement.numero_compte ? `, compte ${d.etablissement.numero_compte}` : ''}. Gardez le bordereau et présentez-le à la caisse.`, p.normal, 10, 495)) {
      texte(page, l, 50, y, p.normal, 10); y -= 14;
    }
    texteDroite(page, "L'économe", 545, 120, p.normal, 10, DOUX);
  }
  return doc.save();
}

// ---------------------------------------------------------------- listes et certificats (CU-09)

export interface EleveListe { matricule: string; nom: string; prenoms: string; sexe: string; naissance: string; lieu: string | null }

export async function pdfListeClasse(d: { etablissement: Etablissement; classe: string; annee: string; eleves: EleveListe[] }) {
  const { doc, polices: p } = await nouveauDocument(`Liste de classe ${d.classe}`);
  let page = doc.addPage([595, 842]);
  enteteA4(page, p, d.etablissement, `LISTE DE CLASSE · ${d.classe}`, `Année scolaire ${d.annee} · ${d.eleves.length} élèves`, 'liste');
  const cols: Colonne[] = [{ titre: 'N°', largeur: 30, droite: true }, { titre: 'Matricule', largeur: 80 }, { titre: 'Nom et prénoms', largeur: 210 },
    { titre: 'Sexe', largeur: 40 }, { titre: 'Né(e) le', largeur: 75 }, { titre: 'Signature', largeur: 60 }];
  const parPage = 35;
  for (let i = 0; i < d.eleves.length; i += parPage) {
    if (i > 0) { page = doc.addPage([595, 842]); }
    tableau(page, p, 50, i === 0 ? 842 - 150 : 800, cols, d.eleves.slice(i, i + parPage).map((e, k) => [
      String(i + k + 1), e.matricule, `${e.nom} ${e.prenoms}`, e.sexe, e.naissance, '']), { hauteur: 17 });
  }
  return doc.save();
}

export async function pdfCertificat(d: { etablissement: Etablissement; classe: string; annee: string; eleves: EleveListe[] }) {
  const { doc, polices: p } = await nouveauDocument('Certificats de scolarité');
  for (const e of d.eleves) {
    const page = doc.addPage([595, 842]);
    enteteA4(page, p, d.etablissement, 'CERTIFICAT DE SCOLARITÉ', 'School attendance certificate', 'certificat');
    const ne = e.sexe === 'F' ? 'née' : 'né';
    const inscrit = e.sexe === 'F' ? 'inscrite' : 'inscrit';
    const paragraphe = `${d.etablissement.signataire ? `Je soussigné(e), ${d.etablissement.signataire}` : 'Le chef d’établissement soussigné'}, certifie que l'élève ${e.nom} ${e.prenoms}, ${ne} le ${e.naissance}${e.lieu ? ` à ${e.lieu}` : ''}, matricule ${e.matricule}, est régulièrement ${inscrit} en classe de ${d.classe} pour l'année scolaire ${d.annee}.\n\nEn foi de quoi le présent certificat lui est délivré pour servir et valoir ce que de droit.`;
    let y = 842 - 190;
    for (const l of lignesDe(paragraphe, p.normal, 11.5, 495)) { texte(page, l, 50, y, p.normal, 11.5); y -= 18; }
    const auj = new Date().toISOString().slice(0, 10).split('-').reverse().join('/');
    texteDroite(page, `Fait le ${auj}`, 545, y - 30, p.normal, 11);
    texteDroite(page, 'Le chef d’établissement · cachet', 545, y - 50, p.gras, 11);
  }
  if (!d.eleves.length) doc.addPage([595, 842]);
  return doc.save();
}

// ---------------------------------------------------------------- cartes scolaires (maquette Classes, « Cartes scolaires »)

export interface CarteEleve extends EleveListe { photo: Uint8Array | null; /** Lien de vérification (QR code). */ verification?: string }

/** Cartes au format carte bancaire (85,6 × 54 mm), dix par page A4, bordées pour la découpe. */
export async function pdfCartesScolaires(d: { etablissement: Etablissement; classe: string; annee: string; logo: Uint8Array | null; eleves: CarteEleve[]; gabarit?: Gabarit }) {
  const { doc, polices: p } = await nouveauDocument(`Cartes scolaires ${d.classe}`);
  const image = (b: Uint8Array | null) => imageDe(doc, b);
  const logo = await image(d.logo);
  const g = d.gabarit ?? 'classique';
  const fondBande = g === 'bandeau' ? SAVOIR : g === 'epure' ? BLANC : ENCRE;
  const texteBande = g === 'epure' ? NOIR : rgb(1, 1, 1);
  const L = 85.6 * MM, H = 54 * MM, colonnes = 2, rangees = 5;
  const mx = (595 - colonnes * L) / (colonnes + 1), my = (842 - rangees * H) / (rangees + 1);
  let page = doc.addPage([595, 842]);
  for (let i = 0; i < d.eleves.length; i++) {
    const e = d.eleves[i]!;
    const k = i % (colonnes * rangees);
    if (i > 0 && k === 0) page = doc.addPage([595, 842]);
    const x = mx + (k % colonnes) * (L + mx);
    const y = 842 - my - (Math.floor(k / colonnes) + 1) * H - Math.floor(k / colonnes) * my;
    page.drawRectangle({ x, y, width: L, height: H, borderColor: g === 'epure' ? NOIR : TRAIT, borderWidth: 0.8 });
    // Bandeau : établissement, en français et en anglais (modèle choisi : bleu encre, bleu savoir et filet jaune, ou noir et blanc).
    const bande = 12 * MM;
    page.drawRectangle({ x, y: y + H - bande, width: L, height: bande, color: fondBande });
    if (g === 'bandeau') page.drawRectangle({ x, y: y + H - bande - 0.8 * MM, width: L, height: 0.8 * MM, color: CRAIE });
    if (g === 'epure') page.drawLine({ start: { x: x + 2 * MM, y: y + H - bande }, end: { x: x + L - 2 * MM, y: y + H - bande }, thickness: 0.5, color: NOIR });
    let xt = x + 3 * MM;
    if (logo) {
      const h = 9 * MM, w = Math.min(14 * MM, (logo.width / logo.height) * h);
      page.drawImage(logo, { x: x + 2 * MM, y: y + H - bande + 1.5 * MM, width: w, height: h });
      xt = x + 3.5 * MM + w;
    }
    texte(page, d.etablissement.nom_fr.toUpperCase(), xt, y + H - 5 * MM, p.gras, 6.6, texteBande, x + L - xt - 2 * MM);
    texte(page, d.etablissement.nom_en, xt, y + H - 8.6 * MM, p.normal, 6, texteBande, x + L - xt - 2 * MM);
    texte(page, 'CARTE SCOLAIRE · SCHOOL ID CARD', x + 3 * MM, y + H - bande - 4.2 * MM, p.gras, 6.5, g === 'epure' ? NOIR : SAVOIR);
    texteDroite(page, d.annee, x + L - 3 * MM, y + H - bande - 4.2 * MM, p.gras, 6.5);
    // Photo d'identité, ou initiales.
    const pw = 21 * MM, ph = 26 * MM, px = x + 3 * MM, py = y + 5 * MM;
    const photo = await image(e.photo);
    if (photo) {
      const r = Math.max(pw / photo.width, ph / photo.height);
      const w = photo.width * r, h = photo.height * r;
      page.drawImage(photo, { x: px + (pw - w) / 2, y: py + (ph - h) / 2, width: w, height: h });
      page.drawRectangle({ x: px, y: py, width: pw, height: ph, borderColor: TRAIT, borderWidth: 0.6 });
    } else {
      page.drawRectangle({ x: px, y: py, width: pw, height: ph, color: rgb(0.945, 0.957, 0.98), borderColor: TRAIT, borderWidth: 0.6 });
      texteCentre(page, `${e.nom.charAt(0)}${e.prenoms.charAt(0)}`.toUpperCase(), px + pw / 2, py + ph / 2 - 5, p.gras, 15, DOUX);
    }
    // Identité, et QR code de vérification à droite (logo au centre).
    const qr = e.verification ? 15 * MM : 0;
    const tx = px + pw + 3.5 * MM, tl = x + L - tx - 3 * MM - (qr ? qr + 2 * MM : 0);
    if (e.verification) {
      dessinerQr(page, p, e.verification, x + L - 3 * MM - qr, py + 2 * MM, qr, logo, initialesEtab(d.etablissement), g === 'epure' ? NOIR : ENCRE);
      texteCentre(page, 'Vérifier · Verify', x + L - 3 * MM - qr / 2, py, p.normal, 4.6, DOUX);
    }
    let ty = py + ph - 3.2 * MM;
    texte(page, e.nom.toUpperCase(), tx, ty, p.gras, 9.5, ENCRE, tl); ty -= 3.6 * MM;
    texte(page, e.prenoms, tx, ty, p.normal, 8.5, ENCRE, tl); ty -= 4.4 * MM;
    for (const [libelle, valeur] of [['Matricule', e.matricule], ['Classe · Class', d.classe], [e.sexe === 'F' ? 'Née le · Born on' : 'Né le · Born on', e.naissance]] as [string, string][]) {
      texte(page, libelle, tx, ty, p.normal, 5.6, DOUX, tl);
      texte(page, valeur, tx, ty - 2.8 * MM, p.gras, 7.6, ENCRE, tl);
      ty -= 5.6 * MM;
    }
    const coord = [d.etablissement.ville_bp, d.etablissement.telephone ? `Tél. ${d.etablissement.telephone}` : null].filter(Boolean).join(' · ');
    if (coord) texte(page, coord, x + 3 * MM, y + 1.6 * MM, p.normal, 5.2, DOUX, L - 6 * MM);
  }
  return doc.save();
}

// ---------------------------------------------------------------- fiche d'inscription (E-23)

export interface FicheInscriptionDetail {
  responsables?: { nom: string; lien: string; telephone: string; payeur: boolean }[];
  /** Réponses au formulaire d'inscription, bloc par bloc (D-42). */
  blocs?: { libelle: string; lignes: { libelle: string; valeur: string }[] }[];
}

/** Fiche d'inscription détaillée : identité, classe, responsables, renseignements du formulaire, accès à l'espace parents. Aucun montant. */
export async function pdfFicheInscription(d: Record<string, string> & { motDePasse: string | null; telephoneConnexion: string } & FicheInscriptionDetail & Habillage) {
  const { doc, polices: p } = await nouveauDocument(`Fiche d'inscription ${d['matricule']}`);
  let page = doc.addPage([595, 842]);
  const logo = await imageDe(doc, d.logo);
  let y = enteteDocument(page, p, { nom_fr: d['nom_fr']!, nom_en: d['nom_en']!, ville_bp: d['ville_bp'] || null, telephone: d['telephone'] || null },
    "FICHE D'INSCRIPTION", `Registration form · ${d['annee']}`, d.gabarit ?? 'classique', logo);
  const place = (h: number) => { if (y - h < 60) { page = doc.addPage([595, 842]); y = 842 - 60; } };
  const section = (titre: string) => {
    place(40);
    y -= 6;
    texte(page, titre.toUpperCase(), 50, y, p.gras, 9.5, DOUX);
    page.drawLine({ start: { x: 50, y: y - 5 }, end: { x: 545, y: y - 5 }, thickness: 0.6, color: TRAIT });
    y -= 22;
  };
  const ligneInfo = (k: string, v: string) => {
    const l = lignesDe(v || '–', p.gras, 10.5, 330);
    place(14 * l.length + 4);
    texte(page, k, 60, y, p.normal, 10.5, DOUX);
    for (const [i, x] of l.entries()) texte(page, x, 215, y - i * 14, p.gras, 10.5);
    y -= 14 * l.length + 4;
  };
  section('Élève');
  for (const [k, v] of [['Nom et prénoms', `${d['nom']} ${d['prenoms']}`], ['Matricule', d['matricule']!], ['Né(e) le', `${d['naissance']}${d['lieu'] ? ` à ${d['lieu']}` : ''}`],
    ['Sexe', d['sexe'] === 'F' ? 'Fille' : 'Garçon'], ['Classe', d['classe']!], ['Année scolaire', d['annee']!]] as [string, string][]) ligneInfo(k, v);
  if (d.responsables?.length) {
    section('Responsables');
    for (const r of d.responsables) ligneInfo(`${r.lien}${r.payeur ? ' · payeur' : ''}`, `${r.nom} · ${r.telephone}`);
  }
  for (const b of d.blocs ?? []) {
    section(b.libelle);
    for (const l of b.lignes) ligneInfo(l.libelle, l.valeur);
  }
  place(150);
  y -= 16;
  page.drawRectangle({ x: 50, y: y - 110, width: 495, height: 120, borderColor: TRAIT, borderWidth: 1, color: rgb(0.965, 0.973, 0.988) });
  texte(page, 'Espace parents · Parent space', 66, y - 14, p.gras, 12);
  texte(page, `Numéro de téléphone : ${d.telephoneConnexion}`, 66, y - 40, p.normal, 11);
  texte(page, `Mot de passe : ${d.motDePasse ?? 'inchangé : utilisez celui de votre fiche précédente'}`, 66, y - 60, p.normal, 11);
  for (const [i, l] of lignesDe('Un seul compte par famille. Suivez les notes, les absences et la scolarité de vos enfants. En cas d’oubli, demandez un nouveau mot de passe à l’école.', p.normal, 9, 460).entries()) {
    texte(page, l, 66, y - 84 - i * 12, p.normal, 9, DOUX);
  }
  texteDroite(page, 'Le secrétariat', 545, 60, p.normal, 10, DOUX);
  return doc.save();
}

// ---------------------------------------------------------------- bulletins et procès-verbal (CU-21, CU-22)

export interface BulletinPdf {
  /** Lien de vérification (QR code) de cette version du bulletin. */
  verification?: string;
  etablissement: string; periodeFr: string; periodeEn: string; annee: string; version: number; statut: string; modele?: ModeleDoc;
  eleve: string; matricule: string; classe: string; effectif: number; naissance: string;
  matieres: { libelle: string; coefficient: number; moyenne: number | null; points: number | null; moyenneClasse: number | null; appreciation: string | null }[];
  totalCoefficients: number; totalPoints: number; moyenne: number | null; rang: number | null;
  moyenneClasse: number | null; min: number | null; max: number | null; absences: string; distinction: string; appreciationGenerale: string | null;
}

const note = (n: number | null) => (n === null ? '–' : n.toFixed(2).replace('.', ','));

export async function pdfBulletins(bulletins: BulletinPdf[], h: Habillage & { etablissement?: Etablissement } = {}): Promise<Uint8Array> {
  const { doc, polices: p } = await nouveauDocument('Bulletins');
  const logo = await imageDe(doc, h.logo);
  const g = h.gabarit ?? 'classique';
  for (const b of bulletins) {
    const page = doc.addPage([595, 842]);
    const e: Etablissement = h.etablissement ?? { nom_fr: b.etablissement, nom_en: '', ville_bp: null, telephone: null };
    let y = enteteDocument(page, p, { ...e, modeles: { ...(e.modeles ?? {}), bulletin: b.modele ?? e.modeles?.bulletin } },
      g === 'classique' ? 'BULLETIN DE NOTES' : 'Bulletin de notes', `${b.periodeFr} · ${b.periodeEn} report · ${b.annee}`, g, logo, 'bulletin');
    texteDroite(page, `${b.statut === 'publie' ? 'Publié' : 'Brouillon'} · version ${b.version}`, 545, y + 14, p.normal, 8.5, DOUX);
    y -= 4;
    for (const [k, v] of [['Élève', b.eleve], ['Matricule', b.matricule], ['Classe', `${b.classe} · ${b.effectif} élèves`], ['Né(e) le', b.naissance]] as [string, string][]) {
      texte(page, k, 50, y, p.normal, 9.5, DOUX); texte(page, v, 140, y, p.gras, 9.5); y -= 14;
    }
    y = tableau(page, p, 50, y - 6, [
      { titre: 'Matière', largeur: 150 }, { titre: 'Coef.', largeur: 40, droite: true }, { titre: 'Note sur 20', largeur: 65, droite: true },
      { titre: 'Note × coef.', largeur: 65, droite: true }, { titre: 'Moy. classe', largeur: 60, droite: true }, { titre: 'Appréciation', largeur: 115 },
    ], b.matieres.map((m) => [m.libelle, String(m.coefficient), note(m.moyenne), note(m.points), note(m.moyenneClasse), m.appreciation ?? '']),
    { total: ['Total', String(b.totalCoefficients), '', note(b.totalPoints), '', ''], taille: 8.5, hauteur: 17 });
    y -= 18;
    for (const [k, v] of [
      ['Moyenne générale', `${note(b.moyenne)} sur 20`], ['Rang', b.rang ? `${b.rang}${b.rang === 1 ? 'er' : 'e'} sur ${b.effectif} élèves` : '–'],
      ['Moyenne de la classe', `${note(b.moyenneClasse)} de ${note(b.min)} à ${note(b.max)}`], ['Absences', b.absences], ['Distinction', b.distinction],
    ] as [string, string][]) { texte(page, k, 50, y, p.normal, 10, DOUX); texte(page, v, 190, y, p.gras, 10); y -= 16; }
    if (b.appreciationGenerale) {
      y -= 6;
      texte(page, 'Appréciation générale', 50, y, p.normal, 10, DOUX); y -= 15;
      for (const l of lignesDe(b.appreciationGenerale, p.normal, 10, 495)) { texte(page, l, 50, y, p.normal, 10); y -= 14; }
    }
    for (const [i, s] of ["L'instituteur principal", 'Le directeur · cachet', 'Le parent'].entries()) texte(page, s, 50 + i * (b.verification ? 140 : 175), 90, p.normal, 9, DOUX);
    blocVerification(page, p, b.verification, 475, 70, logo, e, g);
  }
  if (!bulletins.length) doc.addPage([595, 842]);
  return doc.save();
}

export async function pdfProcesVerbal(d: { etablissement: Etablissement; classe: string; periode: string; annee: string;
  stats: [string, string][]; lignes: string[][]; contenu: string }) {
  const { doc, polices: p } = await nouveauDocument(`Procès-verbal ${d.classe}`);
  const page = doc.addPage([595, 842]);
  enteteA4(page, p, d.etablissement, `PROCÈS-VERBAL DU CONSEIL DE CLASSE · ${d.classe}`, `${d.periode} · ${d.annee}`);
  let y = 842 - 160;
  for (const [k, v] of d.stats) { texte(page, `${k} : ${v}`, 50, y, p.normal, 10); y -= 15; }
  y = tableau(page, p, 50, y - 8, [{ titre: 'Rang', largeur: 40, droite: true }, { titre: 'Élève', largeur: 180 }, { titre: 'Moyenne', largeur: 60, droite: true },
    { titre: 'Absences', largeur: 60, droite: true }, { titre: 'Distinction', largeur: 155 }], d.lignes, { taille: 8.5 });
  y -= 18;
  for (const l of lignesDe(d.contenu || '', p.normal, 10, 495)) { if (y < 80) break; texte(page, l, 50, y, p.normal, 10); y -= 14; }
  return doc.save();
}

// ---------------------------------------------------------------- tableaux génériques (exports imprimés)

export async function pdfTableau(d: { etablissement: Etablissement; titre: string; sousTitre?: string; colonnes: Colonne[]; lignes: string[][] }) {
  const { doc, polices: p } = await nouveauDocument(d.titre);
  const paysage = d.colonnes.reduce((s, c) => s + c.largeur, 0) > 500;
  const taille: [number, number] = paysage ? [842, 595] : [595, 842];
  let page = doc.addPage(taille);
  enteteA4(page, p, d.etablissement, d.titre, d.sousTitre);
  const parPage = paysage ? 26 : 40;
  for (let i = 0; i < Math.max(d.lignes.length, 1); i += parPage) {
    if (i > 0) page = doc.addPage(taille);
    tableau(page, p, 40, i === 0 ? taille[1] - 150 : taille[1] - 50, d.colonnes, d.lignes.slice(i, i + parPage), { taille: 8.5 });
  }
  return doc.save();
}
