#!/usr/bin/env python3
"""
build_pdf.py — Générateur Journal des Travaux format Embuild 9545 F
Lit les fichiers data/<pid>__J<n>.json publiés par l'app Folio
Produit les PDFs dans pdfs/

Usage (appelé par GitHub Action) :
  python pdf/build_pdf.py                  # traite tous les data/*.json
  python pdf/build_pdf.py data/main__J1.json pdfs/Journal_Travaux_main__J1.pdf
"""
import json, sys, glob, os, re
from datetime import datetime
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.pdfgen import canvas
from reportlab.lib import colors

W, H = A4   # 595.28 x 841.89 pt

# ── helpers ──────────────────────────────────────────────────────────────
def g(d, *keys, default=''):
    """Lit une valeur dans un dict en essayant plusieurs clés."""
    for k in keys:
        if d.get(k) not in (None, ''):
            return str(d[k])
    return default

def load_data(json_path):
    with open(json_path, encoding='utf-8') as f:
        raw = json.load(f)
    proj = raw.get('projet', {}) if isinstance(raw.get('projet'), dict) else {}
    exclude = {'projet','folios','complements','version','published_at','journal_no'}
    root = {k: v for k, v in raw.items() if k not in exclude and v not in (None,'')}
    data = {**proj, **root}
    data['folios']      = raw.get('folios', [])
    data['complements'] = raw.get('complements', [])
    data['journal_no']  = raw.get('journal_no', data.get('journal_no', 1))
    return data

def dotline(c, x, y, w):
    """Ligne en pointillés."""
    c.setDash(1, 2)
    c.setLineWidth(0.4)
    c.line(x, y, x+w, y)
    c.setDash()

def field_line(c, label, value, x, y, label_w, total_w, font_sz=9):
    """Label + valeur + ligne pointillée."""
    c.setFont('Helvetica', font_sz)
    c.drawString(x, y+1.5*mm, label)
    vx = x + label_w
    dotline(c, vx, y, total_w - label_w)
    if value:
        c.setFont('Helvetica', font_sz)
        c.drawString(vx + 1*mm, y+1.5*mm, value[:90])

def strikethrough_text(c, x, y, text, font_sz=8):
    """Texte barré."""
    c.setFont('Helvetica', font_sz)
    w = c.stringWidth(text, 'Helvetica', font_sz)
    c.drawString(x, y, text)
    c.setLineWidth(0.5)
    c.line(x, y + font_sz*0.35, x + w, y + font_sz*0.35)

def fmt_date(d):
    if not d: return ''
    try:
        return datetime.fromisoformat(str(d)[:10]).strftime('%d/%m/%Y')
    except:
        return str(d)[:10]

# ── CACHET ────────────────────────────────────────────────────────────────
CACHET_PATHS = ['cachet.png', 'cachet_propre.png',
                os.path.join(os.path.dirname(__file__), '..', 'cachet.png'),
                os.path.join(os.path.dirname(__file__), '..', 'cachet_propre.png')]

def draw_cachet(c, data, cx, cy, cw=45*mm, ch=24*mm):
    """Dessine le cachet entrepreneur (image ou texte)."""
    label  = data.get('cachet_label', '') or data.get('entrepreneur', '')[:20]
    ville  = data.get('cachet_ville', '')
    mail   = data.get('cachet_mail', '')
    tel    = data.get('telephone', '')
    adresse= data.get('adresse', '')
    tva    = data.get('no_entreprise', '')

    # Essayer d'utiliser l'image cachet si disponible
    img_drawn = False
    if label.upper().strip() in ('EEG', ''):
        for p in CACHET_PATHS:
            if os.path.isfile(p):
                try:
                    c.drawImage(p, cx, cy, width=cw, height=ch,
                                preserveAspectRatio=True, mask='auto')
                    img_drawn = True
                    break
                except:
                    pass

    if not img_drawn:
        # Cachet texte
        c.setLineWidth(0.7)
        c.rect(cx, cy, cw, ch)
        fy = cy + ch - 6*mm
        c.setFont('Helvetica-Bold', 10)
        c.drawCentredString(cx + cw/2, fy, label or '?')
        fy -= 5*mm
        for line in [ville, adresse, tel, mail, tva]:
            if line:
                c.setFont('Helvetica', 7)
                c.drawCentredString(cx + cw/2, fy, str(line)[:35])
                fy -= 3.5*mm

# ── PAGE DE GARDE (page 1) ────────────────────────────────────────────────
def draw_page_garde(c, data):
    ML = 17*mm   # marge gauche
    MR = 17*mm   # marge droite
    PW = W - ML - MR  # largeur utile

    # ── EN-TÊTE DROIT ──────────────────────────────────────────────
    hx = ML + PW*0.45   # colonne droite
    hw = PW*0.55        # largeur colonne droite
    hy = H - 20*mm

    for label, key in [
        ('Pouvoir adjudicateur', 'pouvoir_adjudicateur'),
        ('Administration',       'administration'),
        ('Service',              'service'),
        ("N\u00b0 du dossier",   'no_dossier'),
    ]:
        val = g(data, key)
        c.setFont('Helvetica', 8)
        c.drawString(hx, hy + 1.5*mm, label + '  ')
        dotline(c, hx + c.stringWidth(label+'  ', 'Helvetica', 8), hy, hw - c.stringWidth(label+'  ', 'Helvetica', 8))
        if val:
            c.setFont('Helvetica', 7.5)
            c.drawString(hx + c.stringWidth(label+'  ', 'Helvetica', 8) + 1*mm, hy + 1.5*mm, val[:55])
        hy -= 8*mm

    # Ligne de séparation
    hy -= 3*mm
    c.setLineWidth(0.7)
    c.line(ML, hy, ML + PW, hy)
    hy -= 12*mm

    # ── TITRE ──────────────────────────────────────────────────────
    c.setFont('Helvetica-Bold', 18)
    title = 'JOURNAL DES TRAVAUX'
    tw = c.stringWidth(title, 'Helvetica-Bold', 18)
    tx = (W - tw) / 2
    c.drawString(tx, hy, title)
    c.setLineWidth(1.0)
    c.line(tx, hy - 1.5*mm, tx + tw, hy - 1.5*mm)
    hy -= 16*mm

    # ── TRAVAUX DE ──────────────────────────────────────────────────
    desc = g(data, 'description')
    c.setFont('Helvetica', 9)
    c.drawString(ML, hy + 1.5*mm, 'Travaux de  ')
    vx = ML + c.stringWidth('Travaux de  ', 'Helvetica', 9)
    dotline(c, vx, hy, ML + PW - vx)
    if desc:
        c.setFont('Helvetica', 8.5)
        # Tronquer à ~80 chars par ligne
        words = desc.split()
        lines = []
        cur = ''
        for w in words:
            if len(cur + ' ' + w) <= 85:
                cur = (cur + ' ' + w).strip()
            else:
                lines.append(cur); cur = w
        if cur: lines.append(cur)
        for i, line in enumerate(lines[:3]):
            yy = hy - i*7*mm
            c.drawString(vx + 1*mm, yy + 1.5*mm, line)
    for i in range(1, 3):
        dotline(c, ML, hy - i*7*mm, PW)
    hy -= 26*mm

    # ── CSC ──────────────────────────────────────────────────────────
    csc_no  = g(data, 'csc_no')
    csc_ref = g(data, 'csc_ref')
    c.setFont('Helvetica', 9)
    c.drawString(ML, hy + 1.5*mm, "Cahier des charges n\u00b0  ")
    lw = c.stringWidth("Cahier des charges n\u00b0  ", 'Helvetica', 9)
    dotline(c, ML + lw, hy, PW*0.38)
    if csc_no:
        c.setFont('Helvetica', 8.5)
        c.drawString(ML + lw + 1*mm, hy + 1.5*mm, csc_no[:35])
    # "de"
    de_x = ML + lw + PW*0.38 + 3*mm
    c.setFont('Helvetica', 9)
    c.drawString(de_x, hy + 1.5*mm, 'de  ')
    dotline(c, de_x + c.stringWidth('de  ', 'Helvetica', 9), hy, ML + PW - de_x - c.stringWidth('de  ', 'Helvetica', 9))
    if csc_ref:
        c.setFont('Helvetica', 8.5)
        c.drawString(de_x + c.stringWidth('de  ', 'Helvetica', 9) + 1*mm, hy + 1.5*mm, csc_ref[:40])
    hy -= 14*mm

    # ── ENTREPRENEUR ──────────────────────────────────────────────
    rows = [
        ('Entrepreneur\u00a0: ',  g(data, 'entrepreneur')),
        ('Adresse\u00a0: ',        g(data, 'adresse')),
        ('T\u00e9l\u00e9phone\u00a0: ', g(data, 'telephone')),
        ("N\u00b0 du certificat d'agr\u00e9ation\u00a0: ", g(data, 'agreation')),
        ("N\u00b0 d'immatriculation \u00e0 l'O.N.S.S.\u00a0: ", g(data, 'onss')),
        ("N\u00b0 d'entreprise\u00a0: ", g(data, 'no_entreprise')),
    ]
    for label, val in rows:
        lw2 = c.stringWidth(label, 'Helvetica', 9)
        c.setFont('Helvetica', 9)
        c.drawString(ML, hy + 1.5*mm, label)
        dotline(c, ML + lw2, hy, PW - lw2)
        if val:
            c.setFont('Helvetica', 8.5)
            c.drawString(ML + lw2 + 1*mm, hy + 1.5*mm, val[:70])
        hy -= 8.5*mm

    hy -= 8*mm

    # ── TEXTE LÉGAL + REMISE ──────────────────────────────────────
    jno = str(data.get('journal_no', ''))
    texte_legal = (
        "Le pr\u00e9sent journal des travaux contenant trente quadruples folios num\u00e9rot\u00e9s de 1 \u00e0 30 "
        "et 10 quadruples folios compl\u00e9mentaires de 31 \u00e0 40 a \u00e9t\u00e9 remis comme journal n\u00b0"
    )
    c.setFont('Helvetica', 8)
    # Texte sur 2 lignes
    words2 = texte_legal.split()
    lines2 = []; cur2 = ''
    for w in words2:
        if c.stringWidth(cur2+' '+w, 'Helvetica', 8) < PW*0.8:
            cur2 = (cur2+' '+w).strip()
        else:
            lines2.append(cur2); cur2 = w
    if cur2: lines2.append(cur2)
    for ln in lines2[:2]:
        c.drawString(ML, hy, ln)
        hy -= 5*mm
    # N° du journal
    c.setFont('Helvetica', 9)
    c.drawString(W - MR - 25*mm, hy + 5*mm, jno)
    dotline(c, W - MR - 28*mm, hy + 4*mm, 28*mm)
    hy -= 4*mm

    # à M
    c.setFont('Helvetica', 9)
    c.drawString(ML, hy + 1.5*mm, '\u00e0 M  ')
    dotline(c, ML + c.stringWidth('\u00e0 M  ', 'Helvetica', 9), hy, PW - c.stringWidth('\u00e0 M  ', 'Helvetica', 9))
    hy -= 12*mm

    # Rôles avec barrés
    roles = ['Conducteur,', 'Chef de district,', 'Contr\u00f4leur des travaux,', 'Surveillant des travaux\u00a0(1)']
    cx_r = ML + PW*0.4
    for role in roles:
        strikethrough_text(c, cx_r, hy, role, 8)
        hy -= 5.5*mm
    hy -= 3*mm

    # à [lieu] , le [date]
    lieu = g(data, 'lieu_contrat')
    date_v = fmt_date(g(data, 'date_contract_debut'))
    c.setFont('Helvetica', 9)
    c.drawString(ML + PW*0.35, hy + 1.5*mm, '\u00e0  ')
    dotline(c, ML + PW*0.35 + c.stringWidth('\u00e0  ', 'Helvetica', 9), hy, PW*0.20)
    if lieu:
        c.setFont('Helvetica', 8.5); c.drawString(ML + PW*0.35 + c.stringWidth('\u00e0  ', 'Helvetica', 9)+1*mm, hy+1.5*mm, lieu)
    c.setFont('Helvetica', 9)
    c.drawString(ML + PW*0.60, hy + 1.5*mm, ', le  ')
    dotline(c, ML + PW*0.60 + c.stringWidth(', le  ', 'Helvetica', 9), hy, ML + PW - ML - PW*0.60 - c.stringWidth(', le  ', 'Helvetica', 9))
    if date_v:
        c.setFont('Helvetica', 8.5); c.drawString(ML + PW*0.60 + c.stringWidth(', le  ', 'Helvetica', 9)+1*mm, hy+1.5*mm, date_v)
    hy -= 5*mm
    c.setFont('Helvetica-Oblique', 8); c.drawString(ML + PW*0.40, hy, 'Le Fonctionnaire dirigeant,')
    hy -= 10*mm

    # ── BAS DE PAGE ──────────────────────────────────────────────
    # Bloc signature gauche
    sig_x = ML; sig_y = 22*mm; sig_w = 55*mm; sig_h = 20*mm
    c.setFont('Helvetica', 7.5)
    c.drawString(sig_x, sig_y + sig_h + 3*mm, 'Re\u00e7u le pr\u00e9sent journal\u00a0:')
    c.drawString(sig_x, sig_y + sig_h - 1*mm, 'Le pr\u00e9pos\u00e9 \u00e0 la surveillance')
    c.drawString(sig_x, sig_y + sig_h - 5.5*mm, 'charg\u00e9 de la tenue du journal,')
    c.setFont('Helvetica-Oblique', 7.5)
    c.drawString(sig_x, sig_y + sig_h - 10*mm, '(Signature)')
    c.setLineWidth(0.5); c.rect(sig_x, sig_y, sig_w, sig_h - 12*mm)

    # Bloc cachet droit
    cacht_x = W - MR - 55*mm; cacht_y = 22*mm
    c.setFont('Helvetica', 7.5); c.drawString(cacht_x, 22*mm + 22*mm + 2*mm, 'Pour l\u2019entrepreneur,')
    c.setFont('Helvetica-Oblique', 7.5); c.drawString(cacht_x, 22*mm + 22*mm - 2*mm, '(Cachet et signature)')
    draw_cachet(c, data, cacht_x, cacht_y, 55*mm, 22*mm)

    # Note bas
    c.setFont('Helvetica', 7)
    c.drawString(ML, 10*mm, '(1) Biffer les mentions inutiles')

    # Pied de page "9545 F"
    c.setFont('Helvetica-Bold', 8)
    c.drawRightString(W - MR, 8*mm, '9545 F')

# ── PAGE FOLIO (page 3+) ──────────────────────────────────────────────────
CASES = [
    ('B', 'Travaux ex\u00e9cut\u00e9s',     'b_travaux',   8),
    ('C', 'Mat\u00e9riel en service',       'c_materiel',  4),
    ('D', 'Mat\u00e9riel hors service',     'd_hs',         3),
    ('E', 'Mat\u00e9riaux entr\u00e9s',     'e_materiaux',  4),
    ('F', 'Essais sur chantier',            'f_essais',     3),
    ('G', '\u00c9chantillons exp\u00e9di\u00e9s', 'g_echant', 3),
    ('H', '\u00c9v\u00e9nements impr\u00e9vus', 'h_imprevus', 4),
    ('J', 'D\u00e9cisions prises',          'j_decisions',  4),
    ('K', 'Visites & divers',               'k_visites',    3),
]

def draw_folio(c, folio, data):
    ML = 12*mm; MR = 12*mm; MT = 12*mm
    PW = W - ML - MR

    # En-tête folio
    hy = H - MT
    c.setFont('Helvetica-Bold', 9)
    fno = str(folio.get('folio_no', ''))
    fdate = fmt_date(folio.get('date', ''))
    c.drawString(ML, hy - 5*mm, f"Folio N\u00b0  {fno}")
    c.drawString(ML + PW*0.3, hy - 5*mm, f"Date\u00a0: {fdate}")

    meteo = folio.get('meteo', '')
    t8 = folio.get('t_8h', ''); t16 = folio.get('t_16h', '')
    h_d = folio.get('h_debut', ''); h_f = folio.get('h_fin', '')
    c.setFont('Helvetica', 8.5)
    c.drawString(ML + PW*0.55, hy - 5*mm, f"M\u00e9t\u00e9o\u00a0: {meteo}")
    c.drawString(ML + PW*0.80, hy - 5*mm, f"T\u00b0 8h\u00a0: {t8}\u00b0")
    hy -= 10*mm
    c.drawString(ML, hy, f"Heures\u00a0: {h_d} \u2192 {h_f}")
    c.drawString(ML + PW*0.80, hy, f"T\u00b0 16h\u00a0: {t16}\u00b0")
    hy -= 5*mm
    c.setLineWidth(0.6); c.line(ML, hy, ML+PW, hy); hy -= 5*mm

    # Case A — Ouvriers
    c.setFont('Helvetica-Bold', 8.5)
    c.drawString(ML, hy, 'A  Ouvriers sur chantier')
    hy -= 5*mm
    ouvriers = folio.get('ouvriers', [])
    total = sum(int(o.get('nombre', 0)) for o in ouvriers)
    # En-tête tableau
    c.setFont('Helvetica-Bold', 7.5)
    c.drawString(ML+2*mm, hy, 'Classe'); c.drawString(ML+45*mm, hy, 'M\u00e9tier'); c.drawString(ML+90*mm, hy, 'Nombre')
    hy -= 4*mm
    c.setLineWidth(0.3); c.line(ML, hy, ML+PW, hy); hy -= 1*mm
    c.setFont('Helvetica', 7.5)
    for o in ouvriers[:8]:
        c.drawString(ML+2*mm, hy, str(o.get('classe',''))[:28])
        c.drawString(ML+45*mm, hy, str(o.get('metier',''))[:28])
        c.drawString(ML+90*mm, hy, str(o.get('nombre','')))
        hy -= 4.5*mm
    c.setFont('Helvetica-Bold', 7.5); c.drawString(ML+80*mm, hy, f'Total\u00a0: {total}'); hy -= 6*mm
    c.setLineWidth(0.6); c.line(ML, hy, ML+PW, hy); hy -= 5*mm

    # Cases B–K
    for letter, title, key, rows in CASES:
        val = folio.get(key, '')
        c.setFont('Helvetica-Bold', 8.5)
        c.drawString(ML, hy, f'{letter}  {title}')
        hy -= 4.5*mm
        c.setFont('Helvetica', 8)
        if val:
            # Wrap le texte
            words = str(val).split()
            lines = []; cur = ''
            for w in words:
                if c.stringWidth(cur+' '+w,'Helvetica',8) < PW:
                    cur = (cur+' '+w).strip()
                else:
                    lines.append(cur); cur = w
            if cur: lines.append(cur)
            for ln in lines[:rows]:
                if hy < 40*mm: break
                c.drawString(ML+5*mm, hy, ln)
                hy -= 4.5*mm
        else:
            for _ in range(rows):
                dotline(c, ML+5*mm, hy, PW-5*mm); hy -= 5*mm
        if hy < 40*mm: break
        c.setLineWidth(0.3); c.line(ML, hy, ML+PW, hy); hy -= 3*mm

    # Signatures bas de page
    c.setLineWidth(0.6); c.line(ML, 38*mm, ML+PW, 38*mm)
    c.setFont('Helvetica', 7.5)
    c.drawString(ML, 34*mm, 'Le pr\u00e9pos\u00e9 \u00e0 la surveillance (signature)\u00a0:')
    dotline(c, ML + c.stringWidth('Le pr\u00e9pos\u00e9 \u00e0 la surveillance (signature)\u00a0:', 'Helvetica', 7.5), 33*mm, PW*0.4)
    c.drawString(ML + PW*0.55, 34*mm, 'L\u2019entrepreneur (signature)\u00a0:')
    dotline(c, ML + PW*0.55 + c.stringWidth('L\u2019entrepreneur (signature)\u00a0:', 'Helvetica', 7.5), 33*mm, PW*0.4)

    # Statut
    statut = folio.get('statut', '')
    if statut:
        c.setFont('Helvetica-Bold', 8); c.drawRightString(W - MR, 38*mm + 2*mm, statut)

    # Pied "9545 F"
    c.setFont('Helvetica-Bold', 7); c.drawRightString(W - MR, 8*mm, '9545 F')

# ── GÉNÉRATION PRINCIPALE ──────────────────────────────────────────────────
def generate_pdf(json_path, pdf_path):
    data = load_data(json_path)
    pid  = data.get('projet_id', 'main')
    jno  = data.get('journal_no', 1)
    print(f"  → projet={pid} journal={jno} entrepreneur={data.get('entrepreneur','?')[:40]}")

    os.makedirs(os.path.dirname(pdf_path) or '.', exist_ok=True)
    c = canvas.Canvas(pdf_path, pagesize=A4)
    c.setTitle(f"Journal des Travaux — J{jno}")
    c.setAuthor(data.get('entrepreneur', 'EEG'))

    # Page 1 : page de garde
    draw_page_garde(c, data)
    c.showPage()

    # Page 2 : identification (idem page de garde dans certaines versions)
    # On saute directement aux folios si l'ancienne version avait une page 2 identique
    # (ici on fait juste la page 2 = blank avec entête pour respecter le format 9545 F)
    c.setFont('Helvetica', 8)
    c.drawString(17*mm, H - 20*mm, f"Journal N\u00b0 {jno}  —  {data.get('entrepreneur', '')}")
    c.setFont('Helvetica-Bold', 11)
    c.drawCentredString(W/2, H/2, 'Page d\u2019identification')
    c.setFont('Helvetica', 8)
    c.drawCentredString(W/2, H/2 - 10*mm, '(page r\u00e9serv\u00e9e)')
    c.showPage()

    # Pages folios
    for folio in data.get('folios', []):
        draw_folio(c, folio, data)
        c.showPage()

    # Compléments
    compls = data.get('complements', [])
    if compls:
        # Grouper par folio_no_ref
        from collections import defaultdict
        groups = defaultdict(list)
        for comp in compls:
            groups[comp.get('folio_no_ref', 0)].append(comp)
        for ref_no, rows in sorted(groups.items()):
            c.setFont('Helvetica-Bold', 10)
            c.drawString(17*mm, H - 20*mm, f"Compl\u00e9ment Folio N\u00b0 {ref_no}")
            y = H - 35*mm
            for row in rows:
                case = row.get('case',''); texte = row.get('texte','')
                c.setFont('Helvetica-Bold', 8.5)
                c.drawString(17*mm, y, f"Suite case {case}\u00a0:")
                y -= 6*mm
                c.setFont('Helvetica', 8)
                words = str(texte).split()
                lines = []; cur = ''
                for w in words:
                    if c.stringWidth(cur+' '+w,'Helvetica',8) < W-34*mm:
                        cur = (cur+' '+w).strip()
                    else:
                        lines.append(cur); cur = w
                if cur: lines.append(cur)
                for ln in lines:
                    c.drawString(22*mm, y, ln); y -= 5*mm
                y -= 3*mm
            c.showPage()

    c.save()
    print(f"  ✓ PDF généré : {pdf_path}")

def main():
    if len(sys.argv) >= 3:
        # Usage direct : python build_pdf.py data.json output.pdf
        generate_pdf(sys.argv[1], sys.argv[2])
    elif len(sys.argv) == 2:
        # Un seul argument = fichier JSON
        jf = sys.argv[1]
        pid = re.search(r'data/(.+?)__J(\d+)', jf)
        if pid:
            out = f"pdfs/Journal_Travaux_{pid.group(1)}__J{pid.group(2)}.pdf"
        else:
            out = jf.replace('data/', 'pdfs/').replace('.json', '.pdf')
        generate_pdf(jf, out)
    else:
        # Mode automatique : traiter tous les data/*.json
        jsons = glob.glob('data/*.json')
        if not jsons:
            print("Aucun fichier data/*.json trouvé.")
            sys.exit(0)
        for jf in jsons:
            m = re.search(r'data/(.+?)__J(\d+)', jf)
            if m:
                out = f"pdfs/Journal_Travaux_{m.group(1)}__J{m.group(2)}.pdf"
            else:
                out = jf.replace('data/', 'pdfs/').replace('.json', '.pdf')
            print(f"Traitement : {jf}")
            generate_pdf(jf, out)

if __name__ == '__main__':
    main()
