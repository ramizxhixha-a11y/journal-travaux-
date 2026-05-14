"""PDF Journal des Travaux v5 — lit un JSON exporté par la PWA.

Format JSON attendu :
{
  "projet": { ... champs ... },
  "folios": [ { ..., "ouvriers": [...] }, ... ],
  "complements": [ ... ]
}

Usage :
    python build_pdf.py <chemin_json> [chemin_pdf_sortie]

Exemple :
    python build_pdf.py data/PRJ-001.json output/journal.pdf
"""
import json
import sys
from pathlib import Path
from datetime import date, datetime, time

from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas as canvas_mod
from reportlab.lib.colors import black, white
from reportlab.platypus import Paragraph, Frame
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.enums import TA_LEFT


# ═════════════════════════════════════════════════════════════════════════════
# LECTURE JSON & CONVERSIONS
# ═════════════════════════════════════════════════════════════════════════════
def parse_date(s):
    """ISO 'YYYY-MM-DD' → date."""
    if not s: return None
    try: return datetime.strptime(s[:10], '%Y-%m-%d').date()
    except (ValueError, TypeError): return None


def parse_time(s):
    """ISO 'HH:MM' → time."""
    if not s: return None
    try: return datetime.strptime(s[:5], '%H:%M').time()
    except (ValueError, TypeError): return None


def to_int(v):
    if v in (None, ''): return None
    try: return int(v)
    except (ValueError, TypeError): return None


def read_data_from_json(json_path):
    with open(json_path, 'r', encoding='utf-8') as f:
        data = json.load(f)

    projet_raw = data.get('projet', {}) or {}

    journal_no = projet_raw.get('journal_no')
    if isinstance(journal_no, (int, float)):
        journal_no = str(int(journal_no))
    elif journal_no is None:
        journal_no = ''
    else:
        journal_no = str(journal_no)

    projet = {
        'pouvoir_adjudicateur': projet_raw.get('pouvoir_adjudicateur', ''),
        'administration':       projet_raw.get('administration', ''),
        'service':              projet_raw.get('service', ''),
        'no_dossier':           projet_raw.get('no_dossier', ''),
        'description':          projet_raw.get('description', ''),
        'csc_no':               projet_raw.get('csc_no', ''),
        'csc_ref':              projet_raw.get('csc_ref', ''),
        'entrepreneur':         projet_raw.get('entrepreneur', ''),
        'adresse':              projet_raw.get('adresse', ''),
        'telephone':            projet_raw.get('telephone', ''),
        'agreation':            projet_raw.get('agreation', ''),
        'onss':                 projet_raw.get('onss', ''),
        'no_entreprise':        projet_raw.get('no_entreprise', ''),
        'journal_no':           journal_no,
        'remis_a':              projet_raw.get('remis_a', ''),
        'role':                 projet_raw.get('role', ''),
        'lieu_remise':          projet_raw.get('lieu_remise', ''),
        'date_remise':          parse_date(projet_raw.get('date_remise')),
        'fonct_dirigeant':      projet_raw.get('fonct_dirigeant', ''),
        'prepose':              projet_raw.get('prepose', ''),
        'projet_id':            projet_raw.get('projet_id', 'PRJ-001'),
        'nom':                  projet_raw.get('nom', ''),
        'statut':               projet_raw.get('statut', ''),
        'date_debut':           parse_date(projet_raw.get('date_debut')),
        'date_fin':             parse_date(projet_raw.get('date_fin')),
        'notes':                projet_raw.get('notes', ''),
        # Page 2
        'montant_entreprise':       projet_raw.get('montant_entreprise', ''),
        'date_adjudication':        parse_date(projet_raw.get('date_adjudication')),
        'date_approbation':         parse_date(projet_raw.get('date_approbation')),
        'date_contract_debut':      parse_date(projet_raw.get('date_contract_debut')),
        'date_contract_fin':        parse_date(projet_raw.get('date_contract_fin')),
        'lieu_contrat':             projet_raw.get('lieu_contrat', ''),
        'delai_achevement_jo':      to_int(projet_raw.get('delai_achevement_jo')),
        'interruptions_autorisees': projet_raw.get('interruptions_autorisees', ''),
        'prolongations_delai':      projet_raw.get('prolongations_delai', ''),
        'jours_feries':             to_int(projet_raw.get('jours_feries')) or 0,
        'jours_conges_legaux':      to_int(projet_raw.get('jours_conges_legaux')) or 0,
        'jours_intemperies':        to_int(projet_raw.get('jours_intemperies')) or 0,
        'jours_divers':             to_int(projet_raw.get('jours_divers')) or 0,
        'date_reelle_achevement':   parse_date(projet_raw.get('date_reelle_achevement')),
        'date_reportee':            parse_date(projet_raw.get('date_reportee')),
        'jours_retard':             to_int(projet_raw.get('jours_retard')) or 0,
    }

    folios = []
    for f_raw in data.get('folios', []):
        date_val = parse_date(f_raw.get('date'))
        folio_no = to_int(f_raw.get('folio_no'))
        if not date_val or folio_no is None:
            continue
        ouvriers = []
        for o_raw in f_raw.get('ouvriers', []):
            classe = o_raw.get('classe', '').strip() if isinstance(o_raw.get('classe'), str) else ''
            metier = o_raw.get('metier', '').strip() if isinstance(o_raw.get('metier'), str) else ''
            nombre = to_int(o_raw.get('nombre')) or 0
            if classe or metier or nombre:
                ouvriers.append({
                    'classe': classe, 'metier': metier,
                    'nombre': nombre,
                    'notes':  o_raw.get('notes', '') or '',
                })
        folios.append(({
            'folio_no':    folio_no,
            'date':        date_val,
            'h_debut':     parse_time(f_raw.get('h_debut')),
            'h_fin':       parse_time(f_raw.get('h_fin')),
            'meteo':       f_raw.get('meteo', ''),
            't_8h':        f_raw.get('t_8h', ''),
            't_16h':       f_raw.get('t_16h', ''),
            'b_travaux':   f_raw.get('b_travaux', ''),
            'c_materiel':  f_raw.get('c_materiel', ''),
            'd_hs':        f_raw.get('d_hs', ''),
            'e_materiaux': f_raw.get('e_materiaux', ''),
            'f_essais':    f_raw.get('f_essais', ''),
            'g_echant':    f_raw.get('g_echant', ''),
            'h_imprevus':  f_raw.get('h_imprevus', ''),
            'j_decisions': f_raw.get('j_decisions', ''),
            'k_visites':   f_raw.get('k_visites', ''),
            'statut':      f_raw.get('statut', ''),
            'signe_prep':  f_raw.get('signe_prep', ''),
            'signe_ent':   f_raw.get('signe_ent', ''),
        }, ouvriers))
    folios.sort(key=lambda x: x[0]['folio_no'])

    complements = []
    for c_raw in data.get('complements', []):
        compl_no    = to_int(c_raw.get('folio_compl_no'))
        folio_no_ref = to_int(c_raw.get('folio_no_ref'))
        texte        = c_raw.get('texte', '')
        if not compl_no or not folio_no_ref or not texte:
            continue
        complements.append({
            'folio_compl_no': compl_no,
            'folio_no_ref':   folio_no_ref,
            'date_ref':       parse_date(c_raw.get('date_ref')),
            'case':           c_raw.get('case', ''),
            'texte':          texte,
        })
    complements.sort(key=lambda c: c['folio_compl_no'])

    return projet, folios, complements


# ═════════════════════════════════════════════════════════════════════════════
# CONSTANTES & HELPERS PDF
# ═════════════════════════════════════════════════════════════════════════════
W, H = A4
MARGIN_L = 25; MARGIN_R = 25; MARGIN_T = 25; MARGIN_B = 25
EXEMPLAIRE_W = 14

F_REG  = 'Helvetica'
F_BOLD = 'Helvetica-Bold'
F_IT   = 'Helvetica-Oblique'

CACHET_IMG_PATH = None


def yt(y_top): return H - y_top


def dotted(c, x1, x2, y, dash=(0.7, 1.4), width=0.4):
    c.saveState()
    c.setDash(dash); c.setLineWidth(width); c.setStrokeColor(black)
    c.line(x1, y, x2, y); c.restoreState()


def field(c, x, y_top, label, value, total_w, label_size=9, val_size=9):
    y = yt(y_top); c.setFont(F_REG, label_size); c.drawString(x, y, label)
    lw = c.stringWidth(label, F_REG, label_size) + 4
    dotted(c, x + lw, x + total_w, y - 2)
    if value not in (None, ''):
        c.setFont(F_REG, val_size); c.drawString(x + lw + 2, y, str(value))


def case_tag(c, x, y_top, letter, w=18, h=18):
    y = yt(y_top); c.saveState()
    c.setStrokeColor(black); c.setLineWidth(1)
    c.rect(x, y - h, w, h, fill=0, stroke=1)
    c.setFillColor(black); c.setFont(F_BOLD, h - 5)
    c.drawCentredString(x + w/2, y - h + 5, letter); c.restoreState()


def box(c, x, y_top, w, h, line_width=0.8):
    c.saveState(); c.setLineWidth(line_width); c.setStrokeColor(black)
    c.rect(x, yt(y_top) - h, w, h, fill=0, stroke=1); c.restoreState()


def hline(c, x1, x2, y_top, line_width=0.5):
    c.saveState(); c.setLineWidth(line_width); c.setStrokeColor(black)
    c.line(x1, yt(y_top), x2, yt(y_top)); c.restoreState()


def vline(c, x, y_top, y_bot, line_width=0.5):
    c.saveState(); c.setLineWidth(line_width); c.setStrokeColor(black)
    c.line(x, yt(y_top), x, yt(y_bot)); c.restoreState()


def para(c, text, x, y_top, w, h, font_size=8, font=F_REG, padding=2, leading=None):
    if leading is None: leading = font_size + 2
    style = ParagraphStyle('p', fontName=font, fontSize=font_size,
                           leading=leading, alignment=TA_LEFT, textColor=black)
    s = str(text or '').replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')
    s = s.replace('\n', '<br/>')
    p = Paragraph(s, style); y_bot = yt(y_top) - h
    f = Frame(x, y_bot, w, h, leftPadding=padding, rightPadding=padding,
              topPadding=padding, bottomPadding=padding, showBoundary=0)
    f.addFromList([p], c)


def text_at(c, text, x, y_top, font=F_REG, size=9):
    c.setFont(font, size); c.drawString(x, yt(y_top), str(text))


def fmt_date(d):
    return d.strftime('%d/%m/%Y') if d else ''


def fmt_time(t):
    return t.strftime('%H:%M') if t else ''


def fmt_folio_no(n):
    return f"{n:04d}" if n is not None else ''


# ═════════════════════════════════════════════════════════════════════════════
# CACHET
# ═════════════════════════════════════════════════════════════════════════════
def draw_eeg_cachet(c, cx, cy, scale=1.0):
    w = 200 * scale
    h = 100 * scale
    x = cx - w / 2
    y_bottom = yt(cy + h)
    if CACHET_IMG_PATH and Path(CACHET_IMG_PATH).exists():
        c.drawImage(CACHET_IMG_PATH, x, y_bottom, width=w, height=h,
                    preserveAspectRatio=True, mask='auto')
        return
    _draw_eeg_cachet_fallback(c, cx, cy, scale)


def _draw_eeg_cachet_fallback(c, cx, cy, scale=1.0):
    w = 200 * scale; h = 100 * scale
    x = cx - w / 2; y0 = cy
    c.saveState(); c.setStrokeColor(black); c.setFillColor(black)
    cube_size = 16 * scale
    cube_x = x + w/2 - cube_size/2; cube_y = y0 + 4 * scale
    c.setLineWidth(0.7 * scale)
    c.line(x + 25*scale, yt(cube_y + cube_size/2 + 1*scale),
           cube_x - 6*scale, yt(cube_y + cube_size/2 + 1*scale))
    c.line(cube_x + cube_size + 6*scale, yt(cube_y + cube_size/2 + 1*scale),
           x + w - 25*scale, yt(cube_y + cube_size/2 + 1*scale))
    c.setLineWidth(1.0 * scale)
    c.rect(cube_x, yt(cube_y + cube_size), cube_size, cube_size, fill=0, stroke=1)
    off = 3.5 * scale
    c.line(cube_x, yt(cube_y), cube_x + off, yt(cube_y - off))
    c.line(cube_x + cube_size, yt(cube_y), cube_x + cube_size + off, yt(cube_y - off))
    c.line(cube_x + off, yt(cube_y - off), cube_x + cube_size + off, yt(cube_y - off))
    c.line(cube_x + cube_size + off, yt(cube_y - off),
           cube_x + cube_size + off, yt(cube_y + cube_size - off))
    eeg_y = y0 + 38 * scale
    c.setFont(F_BOLD, 30 * scale)
    c.drawCentredString(x + w/2, yt(eeg_y), 'EEG')
    c.setLineWidth(0.9 * scale)
    c.line(x + 18*scale, yt(eeg_y + 4*scale), x + w/2 - 28*scale, yt(eeg_y + 4*scale))
    c.line(x + w/2 + 28*scale, yt(eeg_y + 4*scale), x + w - 18*scale, yt(eeg_y + 4*scale))
    c.setLineWidth(1.3 * scale)
    c.line(x + 22*scale, yt(y0 + 56*scale), x + w - 22*scale, yt(y0 + 56*scale))
    c.setFont(F_BOLD, 11 * scale)
    c.drawCentredString(x + w/2, yt(y0 + 68*scale), 'Namur')
    c.setFont(F_BOLD, 8 * scale)
    c.drawCentredString(x + w/2, yt(y0 + 79*scale), 'Z.I., 6 rue des Gerboises - 5100 Naninne')
    c.drawCentredString(x + w/2, yt(y0 + 88*scale), 'Tél. : 081/21 27 02')
    c.drawCentredString(x + w/2, yt(y0 + 97*scale), 'Mail : naninne@eeg.be - TVA : BE 0442.891.013')
    c.restoreState()


# ═════════════════════════════════════════════════════════════════════════════
# LOGO EMBUILD
# ═════════════════════════════════════════════════════════════════════════════
def draw_embuild(c, x, y_top):
    c.saveState(); c.setFillColor(black)
    n_cols, n_rows = 8, 5
    spacing = 5.2; radius = 1.5
    for row in range(n_rows):
        for col in range(n_cols):
            opacity_idx = row + (n_cols - col)
            if opacity_idx < 5 or (row + col) % 4 == 0:
                cx = x + col * spacing; cy = yt(y_top + row * spacing)
                c.circle(cx, cy, radius, fill=1, stroke=0)
    c.restoreState()
    text_y = y_top + n_rows * spacing + 10
    c.setFont(F_BOLD, 16); c.drawString(x, yt(text_y), 'Embuild')
    c.setFont(F_REG, 6)
    c.drawString(x, yt(text_y + 11), 'THE BELGIAN CONSTRUCTION')
    c.drawString(x, yt(text_y + 19), 'ASSOCIATION')
    c.setFont(F_REG, 7)
    c.drawString(x, yt(text_y + 32), 'Avenue des Arts 20')
    c.drawString(x, yt(text_y + 41), '1000 Bruxelles')
    c.drawString(x, yt(text_y + 50), 'www.embuild.be')


# ═════════════════════════════════════════════════════════════════════════════
# PAGE 1 — Page de garde
# ═════════════════════════════════════════════════════════════════════════════
def draw_page_de_garde(c, p):
    admin_x = 230
    admin_w = W - admin_x - MARGIN_R
    y = 55
    for lbl, val in [
        ('Pouvoir adjudicateur', p['pouvoir_adjudicateur']),
        ('Administration',       p['administration']),
        ('Service',              p['service']),
        ('N° du dossier',        p['no_dossier']),
    ]:
        field(c, admin_x, y, lbl, val, admin_w); y += 18
    c.setLineWidth(0.8); c.line(admin_x + 200, yt(y - 4), admin_x + 280, yt(y - 4))

    title_y = 175
    c.setFont(F_BOLD, 22)
    c.drawCentredString(W/2, yt(title_y), 'JOURNAL DES TRAVAUX')
    tw = c.stringWidth('JOURNAL DES TRAVAUX', F_BOLD, 22)
    c.setLineWidth(1.5); c.line(W/2 - tw/2, yt(title_y + 4), W/2 + tw/2, yt(title_y + 4))

    form_x = MARGIN_L + 40; form_w = W - form_x - MARGIN_R
    y = 220
    c.setFont(F_REG, 9); c.drawString(form_x, yt(y), 'Travaux de')
    lbl_w = c.stringWidth('Travaux de', F_REG, 9) + 4
    dotted(c, form_x + lbl_w, form_x + form_w, yt(y) - 2)
    dotted(c, form_x, form_x + form_w, yt(y + 14) - 2)
    dotted(c, form_x, form_x + form_w, yt(y + 28) - 2)
    para(c, p['description'], form_x + lbl_w + 2, y - 9,
         form_w - lbl_w - 2, 42, font_size=9, padding=0, leading=14)

    y = 285
    c.setFont(F_REG, 9); c.drawString(form_x, yt(y), 'Cahier des charges n°')
    lbl_w = c.stringWidth('Cahier des charges n°', F_REG, 9) + 4
    mid = form_x + form_w * 0.55
    dotted(c, form_x + lbl_w, mid - 25, yt(y) - 2)
    c.drawString(form_x + lbl_w + 2, yt(y), str(p['csc_no']))
    c.drawString(mid - 15, yt(y), 'de')
    de_w = c.stringWidth('de', F_REG, 9) + 4
    dotted(c, mid - 15 + de_w, form_x + form_w, yt(y) - 2)
    c.drawString(mid - 15 + de_w + 2, yt(y), str(p['csc_ref']))

    y = 325
    for lbl, val in [
        ('Entrepreneur :',                   p['entrepreneur']),
        ('Adresse :',                        p['adresse']),
        ('',                                 ''),
        ('Téléphone :',                      p['telephone']),
        ("N° du certificat d'agréation :",   p['agreation']),
        ("N° d'immatriculation à l'O.N.S.S. :", p['onss']),
        ("N° d'entreprise :",                p['no_entreprise']),
    ]:
        if lbl:
            field(c, form_x, y, lbl, val, form_w)
        y += 16

    draw_eeg_cachet(c, W/2 + 90, 365, scale=0.85)
    c.setLineWidth(0.7); c.line(W/2 + 50, yt(465), W/2 + 130, yt(465))

    y = 485
    text_p = ("Le présent journal des travaux contenant trente quadruples folios "
              "numérotés de 1 à 30 et 10 quadruples folios complémentaires de 31 à "
              "40 a été remis comme journal n°")
    para(c, text_p, form_x, y, form_w - 50, 32, font_size=9, padding=0, leading=12)
    dotted(c, form_x + form_w - 45, form_x + form_w, yt(y + 14) - 2)
    c.setFont(F_REG, 9); c.drawString(form_x + form_w - 40, yt(y + 14), p['journal_no'])

    y = 530
    c.setFont(F_REG, 9); c.drawString(form_x, yt(y), 'à M')
    am_w = c.stringWidth('à M', F_REG, 9) + 4
    dotted(c, form_x + am_w, form_x + form_w, yt(y) - 2)
    c.drawString(form_x + am_w + 4, yt(y), p['remis_a'])

    role_x = form_x + 200
    y = 565
    roles = ['Conducteur,', 'Chef de district,', 'Contrôleur des travaux,',
             'Surveillant des travaux (1)']
    role_active = p['role']
    for i, role in enumerate(roles):
        c.setFont(F_REG, 9); ry = y + i * 14
        c.drawString(role_x, yt(ry), role)
        role_clean = role.rstrip(',').replace(' (1)', '').strip()
        if role_clean != role_active:
            tw_r = c.stringWidth(role, F_REG, 9)
            c.setLineWidth(0.8); c.line(role_x, yt(ry) + 3, role_x + tw_r, yt(ry) + 3)

    y = 645
    c.setFont(F_REG, 9); c.drawString(role_x, yt(y), 'à')
    a_w = c.stringWidth('à', F_REG, 9) + 4
    dotted(c, role_x + a_w, role_x + 250, yt(y) - 2)
    c.drawString(role_x + a_w + 4, yt(y), p['lieu_remise'])

    y = 668
    dotted(c, role_x, role_x + 130, yt(y) - 2)
    c.drawString(role_x + 4, yt(y), p['lieu_remise'])
    le_x = role_x + 140
    c.setFont(F_REG, 9); c.drawString(le_x, yt(y), ', le')
    le_w = c.stringWidth(', le', F_REG, 9) + 4
    dotted(c, le_x + le_w, role_x + 260, yt(y) - 2)
    if p['date_remise']:
        c.drawString(le_x + le_w + 4, yt(y), fmt_date(p['date_remise']))

    y = 685
    c.setFont(F_REG, 9); c.drawString(role_x + 30, yt(y), 'Le Fonctionnaire dirigeant,')
    c.setFont(F_IT, 9); c.drawString(role_x + 30, yt(y + 16), p['fonct_dirigeant'])

    y = 720
    c.setFont(F_REG, 9); c.drawString(MARGIN_L, yt(y), 'Reçu le présent journal :')
    c.drawString(MARGIN_L, yt(y + 12), 'Le préposé à la surveillance')
    c.drawString(MARGIN_L, yt(y + 24), 'chargé de la tenue du journal,')
    c.setFont(F_IT, 8); c.drawString(MARGIN_L + 55, yt(y + 36), '(Signature)')
    box(c, MARGIN_L, y + 46, 160, 35, line_width=0.4)
    c.setFont(F_IT, 9); c.drawString(MARGIN_L + 5, yt(y + 70), p['prepose'])

    draw_embuild(c, W - 175, 720)

    c.setFont(F_REG, 8); c.drawString(MARGIN_L, yt(820), '(1) Biffer les mentions inutiles')
    c.setFont(F_BOLD, 9); c.drawString(W - MARGIN_R - 35, yt(820), '9545 F')


# ═════════════════════════════════════════════════════════════════════════════
# PAGE 2 — Synthèse contrat
# ═════════════════════════════════════════════════════════════════════════════
def draw_page_synthese(c, p):
    admin_x = 180; admin_w = W - admin_x - MARGIN_R - 20
    y = 60
    for lbl, val in [('Ministère', p['pouvoir_adjudicateur']),
                     ('Administration', p['administration']),
                     ('Service', p['service'])]:
        field(c, admin_x, y, lbl, val, admin_w); y += 18

    y = 135
    c.setFont(F_BOLD, 16); c.drawString(admin_x, yt(y), 'Journal des Travaux N°')
    tw = c.stringWidth('Journal des Travaux N°', F_BOLD, 16) + 8
    c.setLineWidth(1.0); c.line(admin_x + tw, yt(y) - 2, admin_x + tw + 100, yt(y) - 2)
    c.setFont(F_REG, 12); c.drawString(admin_x + tw + 4, yt(y), p['journal_no'])

    y = 168
    travaux_x = admin_x + 30
    c.setFont(F_REG, 10); c.drawString(travaux_x, yt(y), 'Travaux de')
    lbl_w = c.stringWidth('Travaux de', F_REG, 10) + 4
    travaux_w = W - travaux_x - MARGIN_R - 20
    dotted(c, travaux_x + lbl_w, travaux_x + travaux_w, yt(y) - 2)
    dotted(c, MARGIN_L + 100, MARGIN_L + 100 + travaux_w + 70, yt(y + 14) - 2)
    dotted(c, MARGIN_L + 100, MARGIN_L + 100 + travaux_w + 70, yt(y + 28) - 2)
    para(c, p['description'], travaux_x + lbl_w + 2, y - 9,
         travaux_w - lbl_w - 2, 44, font_size=9, padding=0, leading=14)

    col_left_x = MARGIN_L + 5; col_left_w = 280
    col_right_x = W / 2 + 30; col_right_w = W - col_right_x - MARGIN_R
    y = 240
    for lbl, val in [
        ("Montant de l'entreprise:",        p['montant_entreprise']),
        ("Date d'adjudication:",            fmt_date(p['date_adjudication'])),
        ("Date d'approbation:",             fmt_date(p['date_approbation'])),
        ("Date contractuelle de",           None),
        ("début des travaux:",              fmt_date(p['date_contract_debut'])),
        ("Date contractuelle d'achèvement:", fmt_date(p['date_contract_fin'])),
    ]:
        if val is None:
            c.setFont(F_REG, 9); c.drawString(col_left_x, yt(y), lbl)
        else:
            field(c, col_left_x, y, lbl, val, col_left_w)
        y += 18

    y_ent = 252
    c.setFont(F_REG, 10); c.drawString(col_right_x, yt(y_ent), 'Entrepreneur:')
    lbl_w = c.stringWidth('Entrepreneur:', F_REG, 10) + 6
    dotted(c, col_right_x + lbl_w, col_right_x + col_right_w, yt(y_ent) - 2)
    draw_eeg_cachet(c, col_right_x + lbl_w + (col_right_w - lbl_w) / 2 + 10,
                    y_ent - 5, scale=0.78)

    y_a = 360
    c.setFont(F_REG, 10); c.drawString(col_right_x, yt(y_a), 'à')
    a_w = c.stringWidth('à', F_REG, 10) + 6
    dotted(c, col_right_x + a_w, W - MARGIN_R - 20, yt(y_a) - 2)
    if p.get('lieu_contrat'):
        c.drawString(col_right_x + a_w + 2, yt(y_a), p['lieu_contrat'])

    jo_col_x = W - MARGIN_R - 180; jo_col_w = 60
    y_jo_hdr = 388
    c.setFont(F_REG, 9)
    dotted(c, jo_col_x, jo_col_x + jo_col_w, yt(y_jo_hdr) - 2)
    c.setFont(F_REG, 9)
    c.drawString(jo_col_x + jo_col_w + 6, yt(y_jo_hdr - 4), 'J.O. (jours')
    c.drawString(jo_col_x + jo_col_w + 6, yt(y_jo_hdr + 6), 'ouvrables)')
    if p['delai_achevement_jo']:
        c.setFont(F_REG, 10)
        c.drawCentredString(jo_col_x + jo_col_w / 2, yt(y_jo_hdr),
                            str(p['delai_achevement_jo']))

    c.setLineWidth(0.5)
    jo_top_y = 388; jo_bot_y = 690
    c.line(jo_col_x, yt(jo_top_y) - 3, jo_col_x, yt(jo_bot_y))
    c.line(jo_col_x + jo_col_w, yt(jo_top_y) - 3, jo_col_x + jo_col_w, yt(jo_bot_y))

    left_x = MARGIN_L + 5
    y = 408
    c.setFont(F_REG, 10); c.drawString(left_x, yt(y), "Délai d'achèvement:")

    y = 432
    c.drawString(left_x, yt(y), "Interruptions autorisées:")
    for i in range(1, 4):
        dotted(c, left_x, jo_col_x - 10, yt(y + i * 14) - 2)
    if p.get('interruptions_autorisees'):
        c.setFont(F_REG, 9); c.drawString(left_x + 2, yt(y + 14), p['interruptions_autorisees'])

    y = 500
    c.setFont(F_REG, 10); c.drawString(left_x, yt(y), "Prolongations de délai autorisées:")
    for i in range(1, 4):
        dotted(c, left_x, jo_col_x - 10, yt(y + i * 14) - 2)
    if p.get('prolongations_delai'):
        c.setFont(F_REG, 9); c.drawString(left_x + 2, yt(y + 14), p['prolongations_delai'])

    y = 568
    c.setFont(F_REG, 10); c.drawString(left_x, yt(y), "Nombre de jours")
    items = [
        ("Fériés:",          p['jours_feries']),
        ("De congé légaux:", p['jours_conges_legaux']),
        ("D'intempéries:",   p['jours_intemperies']),
        ("Divers:",          p['jours_divers']),
    ]
    for i, (lbl, val) in enumerate(items):
        y_item = y + 18 + i * 18
        c.setFont(F_REG, 10); c.drawString(left_x + 30, yt(y_item), lbl)
        ll_w = c.stringWidth(lbl, F_REG, 10) + 4
        dotted(c, left_x + 30 + ll_w, jo_col_x - 6, yt(y_item) - 2)
        if val:
            c.setFont(F_REG, 10)
            c.drawCentredString(jo_col_x + jo_col_w / 2, yt(y_item), str(val))

    total = (p['jours_feries'] + p['jours_conges_legaux']
             + p['jours_intemperies'] + p['jours_divers'])
    y_total = y + 18 + 4 * 18 + 4
    c.setFont(F_BOLD, 10); c.drawString(jo_col_x - 60, yt(y_total), 'TOTAL')
    c.line(jo_col_x, yt(y_total) - 3, jo_col_x + jo_col_w, yt(y_total) - 3)
    c.drawCentredString(jo_col_x + jo_col_w / 2, yt(y_total + 12), str(total))

    y = y_total + 30
    c.setFont(F_REG, 9); dotted(c, jo_col_x, jo_col_x + jo_col_w, yt(y) - 2)
    c.drawString(jo_col_x + jo_col_w + 6, yt(y), 'J.O.')
    grand_total = (p['delai_achevement_jo'] or 0) + total
    c.setFont(F_REG, 10); c.drawCentredString(jo_col_x + jo_col_w / 2, yt(y), str(grand_total))

    y += 18
    c.setFont(F_BOLD, 11); c.drawString(jo_col_x - 130, yt(y), 'TOTAL GENERAL:')
    dotted(c, jo_col_x, jo_col_x + jo_col_w, yt(y) - 2)
    c.setFont(F_REG, 9); c.drawString(jo_col_x + jo_col_w + 6, yt(y), 'J.O.')
    c.setFont(F_BOLD, 11); c.drawCentredString(jo_col_x + jo_col_w / 2, yt(y), str(grand_total))

    y = 720
    for lbl, val in [
        ("Date contractuelle d'achèvement:",   fmt_date(p['date_contract_fin'])),
        ("Reportée au:",                       fmt_date(p['date_reportee'])),
        ("Date réelle d'achèvement:",          fmt_date(p['date_reelle_achevement'])),
        ("Nombre des jours pleins de retard:", str(p['jours_retard']) if p['jours_retard'] else ''),
    ]:
        field(c, MARGIN_L + 5, y, lbl, val, W - MARGIN_R - MARGIN_L - 10); y += 16

    y += 8
    c.setFont(F_REG, 9)
    c.drawString(MARGIN_L + 5, yt(y), 'Le préposé à la surveillance chargé de la tenue du journal')
    c.setFont(F_IT, 8); c.drawString(MARGIN_L + 50, yt(y + 12), '(Signature)')


# ═════════════════════════════════════════════════════════════════════════════
# FOLIO + COMPLEMENT (identiques à v4 — versions courtes)
# ═════════════════════════════════════════════════════════════════════════════
def draw_folio_page(c, p, f, ouvriers):
    hdr_y = MARGIN_T; hdr_h = 110
    c.setFont(F_IT, 7)
    c.drawString(MARGIN_L + 5, yt(hdr_y - 4),
                 "Cachet de la Firme avec indications d'ordre général")
    cachet_w = (W - MARGIN_L - MARGIN_R) * 0.38
    cachet_x = MARGIN_L
    info_x = cachet_x + cachet_w
    info_w = W - info_x - MARGIN_R
    box(c, cachet_x, hdr_y, cachet_w, hdr_h, line_width=0.8)
    draw_eeg_cachet(c, cachet_x + cachet_w/2, hdr_y + 5, scale=0.78)
    box(c, info_x, hdr_y, info_w, hdr_h, line_width=0.8)

    y1 = hdr_y + 18
    c.setFont(F_REG, 9); c.drawString(info_x + 6, yt(y1), 'JOURNAL N°')
    jn_w = c.stringWidth('JOURNAL N°', F_REG, 9) + 4
    dotted(c, info_x + 6 + jn_w, info_x + info_w * 0.40, yt(y1) - 2)
    c.drawString(info_x + 6 + jn_w + 4, yt(y1), p['journal_no'])
    folio_label_x = info_x + info_w * 0.42
    c.setFont(F_REG, 9); c.drawString(folio_label_x, yt(y1), 'Folio')
    fl_w = c.stringWidth('Folio', F_REG, 9) + 4
    c.setFont(F_BOLD, 16); c.drawString(folio_label_x + fl_w, yt(y1 + 3),
                                         f"N°{fmt_folio_no(f['folio_no'])}")
    date_x = info_x + info_w * 0.75
    c.setFont(F_REG, 9); c.drawString(date_x, yt(y1), 'Date')
    dt_w = c.stringWidth('Date', F_REG, 9) + 4
    dotted(c, date_x + dt_w, info_x + info_w - 6, yt(y1) - 2)
    c.drawString(date_x + dt_w + 4, yt(y1), fmt_date(f['date']))

    y2 = y1 + 18
    c.setFont(F_REG, 9); c.drawString(info_x + 6, yt(y2), 'Heures de travail : de')
    ht_w = c.stringWidth('Heures de travail : de', F_REG, 9) + 4
    dotted(c, info_x + 6 + ht_w, info_x + info_w * 0.50, yt(y2) - 2)
    c.drawString(info_x + 6 + ht_w + 4, yt(y2), fmt_time(f['h_debut']))
    a_x = info_x + info_w * 0.55
    c.drawString(a_x, yt(y2), 'à')
    a_w_lbl = c.stringWidth('à', F_REG, 9) + 4
    dotted(c, a_x + a_w_lbl, info_x + info_w - 6, yt(y2) - 2)
    c.drawString(a_x + a_w_lbl + 4, yt(y2), fmt_time(f['h_fin']))

    y3 = y2 + 18
    c.setFont(F_REG, 9); c.drawString(info_x + 6, yt(y3), 'Etat atmosphérique :')
    et_w = c.stringWidth('Etat atmosphérique :', F_REG, 9) + 4
    dotted(c, info_x + 6 + et_w, info_x + info_w - 6, yt(y3) - 2)
    c.drawString(info_x + 6 + et_w + 4, yt(y3), f['meteo'])
    dotted(c, info_x + 6, info_x + info_w - 6, yt(y3 + 14) - 2)
    dotted(c, info_x + 6, info_x + info_w - 6, yt(y3 + 28) - 2)

    y4 = y3 + 44
    c.setFont(F_REG, 9); c.drawString(info_x + 6, yt(y4), 'Température à 8 h.')
    t8_w = c.stringWidth('Température à 8 h.', F_REG, 9) + 4
    dotted(c, info_x + 6 + t8_w, info_x + info_w * 0.50, yt(y4) - 2)
    t8 = f['t_8h']
    c.drawString(info_x + 6 + t8_w + 4, yt(y4), f"{t8}°" if t8 not in (None, '') else '')
    a16_x = info_x + info_w * 0.55
    c.drawString(a16_x, yt(y4), 'à 16 h.')
    a16_w = c.stringWidth('à 16 h.', F_REG, 9) + 4
    dotted(c, a16_x + a16_w, info_x + info_w - 6, yt(y4) - 2)
    t16 = f['t_16h']
    c.drawString(a16_x + a16_w + 4, yt(y4), f"{t16}°" if t16 not in (None, '') else '')

    exempl_y_top = hdr_y + hdr_h + 6
    exempl_y_bot = H - MARGIN_B - 30
    c.saveState()
    c.translate(MARGIN_L + 7, yt((exempl_y_top + exempl_y_bot) / 2))
    c.rotate(90); c.setFont(F_BOLD, 7)
    c.drawCentredString(0, 0, 'Exemplaire à conserver sur le chantier')
    c.restoreState()

    grid_x = MARGIN_L + EXEMPLAIRE_W
    grid_w = W - grid_x - MARGIN_R
    grid_y = hdr_y + hdr_h + 6
    grid_bot_y = H - MARGIN_B - 30
    grid_h = grid_bot_y - grid_y
    h_ab = grid_h * 0.34; h_cd = grid_h * 0.13; h_fg = grid_h * 0.13
    h_h  = grid_h * 0.16; h_jk = grid_h * 0.24
    a_w_cell = grid_w * 0.42; b_w_cell = grid_w - a_w_cell

    box(c, grid_x, grid_y, a_w_cell, h_ab)
    case_tag(c, grid_x + 4, grid_y + 4, 'A', w=18, h=18)
    text_at(c, 'OUVRIERS', grid_x + 28, grid_y + 16, font=F_BOLD, size=9)
    sub_y_hdr = grid_y + 28
    text_at(c, 'Classes', grid_x + 6, sub_y_hdr + 9, font=F_REG, size=7.5)
    text_at(c, 'Métiers', grid_x + a_w_cell * 0.22 + 4, sub_y_hdr + 9, font=F_REG, size=7.5)
    text_at(c, 'Nombre', grid_x + a_w_cell * 0.72 + 4, sub_y_hdr + 9, font=F_REG, size=7.5)
    sub_y_data = sub_y_hdr + 12
    hline(c, grid_x, grid_x + a_w_cell, sub_y_data)
    sub_x_v1 = grid_x + a_w_cell * 0.22
    sub_x_v2 = grid_x + a_w_cell * 0.72
    vline(c, sub_x_v1, sub_y_hdr, grid_y + h_ab)
    vline(c, sub_x_v2, sub_y_hdr, grid_y + h_ab)
    rows_a = 11; total_strip_h = 14
    data_zone_h = (grid_y + h_ab) - sub_y_data - total_strip_h
    row_h = data_zone_h / rows_a
    c.setFont(F_REG, 8)
    for i, o in enumerate(ouvriers[:rows_a]):
        y_base = sub_y_data + (i + 1) * row_h - 3
        c.drawString(grid_x + 6, yt(y_base), str(o['classe']))
        c.drawString(sub_x_v1 + 4, yt(y_base), str(o['metier']))
        c.drawCentredString((sub_x_v2 + grid_x + a_w_cell) / 2,
                            yt(y_base), str(o['nombre']))
    for i in range(rows_a):
        dotted(c, grid_x + 4, grid_x + a_w_cell - 4,
               yt(sub_y_data + (i + 1) * row_h), dash=(0.4, 1.2), width=0.3)
    total_y_line = grid_y + h_ab - total_strip_h
    hline(c, grid_x, grid_x + a_w_cell, total_y_line)
    total = sum(o['nombre'] for o in ouvriers)
    c.setFont(F_BOLD, 8); c.drawString(sub_x_v1 + 4, yt(grid_y + h_ab - 4), 'Total')
    c.drawCentredString((sub_x_v2 + grid_x + a_w_cell) / 2,
                        yt(grid_y + h_ab - 4), str(total))

    box(c, grid_x + a_w_cell, grid_y, b_w_cell, h_ab)
    case_tag(c, grid_x + a_w_cell + 4, grid_y + 4, 'B', w=18, h=18)
    text_at(c, 'TRAVAUX EXÉCUTÉS', grid_x + a_w_cell + 28, grid_y + 16, font=F_BOLD, size=9)
    para(c, f['b_travaux'], grid_x + a_w_cell + 4, grid_y + 30,
         b_w_cell - 8, h_ab - 32, font_size=8.5, padding=2, leading=11)

    cd_y = grid_y + h_ab
    c_w_cell = grid_w * 0.21; d_w_cell = grid_w * 0.21
    e_w_cell = grid_w - c_w_cell - d_w_cell
    e_h_total = h_cd + h_fg
    box(c, grid_x, cd_y, c_w_cell, h_cd)
    case_tag(c, grid_x + 4, cd_y + 4, 'C', w=14, h=14)
    text_at(c, 'MATÉRIEL EN SERVICE', grid_x + 22, cd_y + 14, font=F_BOLD, size=7)
    para(c, f['c_materiel'], grid_x + 4, cd_y + 22, c_w_cell - 8, h_cd - 24,
         font_size=7.5, padding=1, leading=9)

    box(c, grid_x + c_w_cell, cd_y, d_w_cell, h_cd)
    case_tag(c, grid_x + c_w_cell + 4, cd_y + 4, 'D', w=14, h=14)
    text_at(c, 'MATÉRIEL HORS SERVICE', grid_x + c_w_cell + 22, cd_y + 12, font=F_BOLD, size=7)
    text_at(c, 'CAUSES', grid_x + c_w_cell + 22, cd_y + 20, font=F_BOLD, size=7)
    para(c, f['d_hs'], grid_x + c_w_cell + 4, cd_y + 26, d_w_cell - 8, h_cd - 28,
         font_size=7.5, padding=1, leading=9)

    box(c, grid_x + c_w_cell + d_w_cell, cd_y, e_w_cell, e_h_total)
    case_tag(c, grid_x + c_w_cell + d_w_cell + 4, cd_y + 4, 'E', w=14, h=14)
    text_at(c, 'MATÉRIAUX ENTRÉS CE JOUR',
            grid_x + c_w_cell + d_w_cell + 22, cd_y + 12, font=F_BOLD, size=7)
    text_at(c, '(observations éventuelles)',
            grid_x + c_w_cell + d_w_cell + 22, cd_y + 20, font=F_IT, size=6.5)
    para(c, f['e_materiaux'], grid_x + c_w_cell + d_w_cell + 4, cd_y + 28,
         e_w_cell - 8, e_h_total - 30, font_size=8, padding=2, leading=10)

    fg_y = cd_y + h_cd
    box(c, grid_x, fg_y, c_w_cell, h_fg)
    case_tag(c, grid_x + 4, fg_y + 4, 'F', w=14, h=14)
    text_at(c, 'ESSAIS SUR CHANTIER', grid_x + 22, fg_y + 14, font=F_BOLD, size=7)
    para(c, f['f_essais'], grid_x + 4, fg_y + 22, c_w_cell - 8, h_fg - 24,
         font_size=7.5, padding=1, leading=9)
    box(c, grid_x + c_w_cell, fg_y, d_w_cell, h_fg)
    case_tag(c, grid_x + c_w_cell + 4, fg_y + 4, 'G', w=14, h=14)
    text_at(c, 'ÉCHANTILLONS EXPÉDIÉS', grid_x + c_w_cell + 22, fg_y + 14, font=F_BOLD, size=7)
    para(c, f['g_echant'], grid_x + c_w_cell + 4, fg_y + 22,
         d_w_cell - 8, h_fg - 24, font_size=7.5, padding=1, leading=9)

    h_y = fg_y + h_fg
    box(c, grid_x, h_y, grid_w, h_h)
    case_tag(c, grid_x + 4, h_y + 4, 'H', w=14, h=14)
    text_at(c, 'ÉVÉNEMENTS IMPRÉVUS', grid_x + 22, h_y + 14, font=F_BOLD, size=7)
    para(c, f['h_imprevus'], grid_x + 4, h_y + 22, grid_w - 8, h_h - 24,
         font_size=8, padding=2, leading=10)

    jk_y = h_y + h_h
    j_w_cell = grid_w * 0.50; k_w_cell = grid_w - j_w_cell
    box(c, grid_x, jk_y, j_w_cell, h_jk)
    case_tag(c, grid_x + 4, jk_y + 4, 'J', w=14, h=14)
    text_at(c, 'DÉCISIONS PRISES', grid_x + 22, jk_y + 14, font=F_BOLD, size=7)
    para(c, f['j_decisions'], grid_x + 4, jk_y + 22, j_w_cell - 8, h_jk - 24,
         font_size=8, padding=2, leading=10)
    box(c, grid_x + j_w_cell, jk_y, k_w_cell, h_jk)
    case_tag(c, grid_x + j_w_cell + 4, jk_y + 4, 'K', w=14, h=14)
    text_at(c, 'VISITES - DIVERS', grid_x + j_w_cell + 22, jk_y + 14, font=F_BOLD, size=7)
    para(c, f['k_visites'], grid_x + j_w_cell + 4, jk_y + 22,
         k_w_cell - 8, h_jk - 24, font_size=8, padding=2, leading=10)

    sig_y = grid_bot_y + 10
    c.setFont(F_IT, 8); c.drawString(grid_x + 4, yt(sig_y), 'Le préposé à la surveillance :')
    c.setFont(F_REG, 8); c.drawString(grid_x + 4, yt(sig_y + 12), p['prepose'])
    c.setFont(F_IT, 8); c.drawString(grid_x + grid_w * 0.55, yt(sig_y), "L'entrepreneur ou son délégué :")
    c.setFont(F_REG, 8); c.drawString(grid_x + grid_w * 0.55, yt(sig_y + 12), p['entrepreneur'])


def draw_complement_page(c, p, parent_folio_data, cpl):
    hdr_y = MARGIN_T; hdr_h = 80
    c.setFont(F_IT, 7)
    c.drawString(MARGIN_L + 5, yt(hdr_y - 4),
                 "Cachet de la Firme avec indications d'ordre général")
    cachet_w = (W - MARGIN_L - MARGIN_R) * 0.38
    cachet_x = MARGIN_L; info_x = cachet_x + cachet_w
    info_w = W - info_x - MARGIN_R
    box(c, cachet_x, hdr_y, cachet_w, hdr_h, line_width=0.8)
    draw_eeg_cachet(c, cachet_x + cachet_w/2, hdr_y - 8, scale=0.65)
    box(c, info_x, hdr_y, info_w, hdr_h, line_width=0.8)

    y1 = hdr_y + 24
    c.setFont(F_BOLD, 11); c.drawString(info_x + 6, yt(y1), 'Journal des Travaux N°')
    jn_w = c.stringWidth('Journal des Travaux N°', F_BOLD, 11) + 4
    dotted(c, info_x + 6 + jn_w, info_x + info_w * 0.55, yt(y1) - 2)
    c.setFont(F_REG, 10); c.drawString(info_x + 6 + jn_w + 4, yt(y1), p['journal_no'])
    fn_x = info_x + info_w * 0.60
    c.setFont(F_REG, 9); c.drawString(fn_x, yt(y1), 'Folio')
    fl_w = c.stringWidth('Folio', F_REG, 9) + 4
    c.setFont(F_BOLD, 14); c.drawString(fn_x + fl_w, yt(y1 + 2),
                                         f"N°{fmt_folio_no(cpl['folio_compl_no'])}")

    y2 = y1 + 24
    c.setFont(F_REG, 9); c.drawString(info_x + 6, yt(y2), 'Complément au folio N°')
    cf_w = c.stringWidth('Complément au folio N°', F_REG, 9) + 4
    dotted(c, info_x + 6 + cf_w, info_x + info_w * 0.50, yt(y2) - 2)
    c.drawString(info_x + 6 + cf_w + 4, yt(y2), fmt_folio_no(cpl['folio_no_ref']))
    du_x = info_x + info_w * 0.55
    c.drawString(du_x, yt(y2), 'du')
    du_w = c.stringWidth('du', F_REG, 9) + 4
    dotted(c, du_x + du_w, info_x + info_w - 6, yt(y2) - 2)
    c.drawString(du_x + du_w + 4, yt(y2), fmt_date(cpl.get('date_ref')))

    exempl_y_top = hdr_y + hdr_h + 6
    exempl_y_bot = H - MARGIN_B - 30
    c.saveState()
    c.translate(MARGIN_L + 7, yt((exempl_y_top + exempl_y_bot) / 2))
    c.rotate(90); c.setFont(F_BOLD, 7)
    c.drawCentredString(0, 0, 'Exemplaire à conserver sur le chantier')
    c.restoreState()

    case_x = MARGIN_L + EXEMPLAIRE_W; case_w = W - case_x - MARGIN_R
    case_y = hdr_y + hdr_h + 6
    case_h = H - MARGIN_B - 35 - case_y
    box(c, case_x, case_y, case_w, case_h, line_width=0.8)

    cy = case_y + 22
    c.setFont(F_BOLD, 11); c.drawString(case_x + 8, yt(cy), 'CASE')
    cw_lbl = c.stringWidth('CASE', F_BOLD, 11) + 6
    c.setLineWidth(0.7); c.line(case_x + 8 + cw_lbl, yt(cy) - 2, case_x + 80, yt(cy) - 2)
    c.setFont(F_BOLD, 12); c.drawString(case_x + 8 + cw_lbl + 6, yt(cy), str(cpl['case']))

    text_top = cy + 14; text_bot = case_y + case_h - 14
    n_lines = 7
    line_spacing = (text_bot - text_top) / n_lines
    for i in range(1, n_lines + 1):
        y_line = text_top + i * line_spacing
        c.setLineWidth(0.6); c.line(case_x + 12, yt(y_line), case_x + case_w - 12, yt(y_line))

    para(c, cpl['texte'], case_x + 14, text_top + 4,
         case_w - 28, text_bot - text_top - 8, font_size=9.5, padding=0, leading=14)

    sig_y = H - MARGIN_B - 15
    c.setFont(F_IT, 8); c.drawString(case_x + 4, yt(sig_y), 'Le préposé à la surveillance :')
    c.setFont(F_REG, 8); c.drawString(case_x + 4, yt(sig_y + 12), p['prepose'])
    c.setFont(F_IT, 8); c.drawString(case_x + case_w * 0.55, yt(sig_y), "L'entrepreneur ou son délégué :")
    c.setFont(F_REG, 8); c.drawString(case_x + case_w * 0.55, yt(sig_y + 12), p['entrepreneur'])


# ═════════════════════════════════════════════════════════════════════════════
# BUILD
# ═════════════════════════════════════════════════════════════════════════════
def build_pdf(json_path, output_path=None):
    global CACHET_IMG_PATH
    json_dir = Path(json_path).parent.parent  # data/foo.json → racine du repo

    for ext in ['png', 'jpg', 'jpeg']:
        candidate = json_dir / f'cachet.{ext}'
        if candidate.exists():
            CACHET_IMG_PATH = str(candidate)
            print(f'  Cachet image : {CACHET_IMG_PATH}')
            break
    else:
        CACHET_IMG_PATH = None

    projet, folios, complements = read_data_from_json(json_path)

    if output_path is None:
        pid = projet.get('projet_id', 'PROJET')
        output_path = str(Path(json_path).parent / f"Journal_Travaux_{pid}.pdf")

    c = canvas_mod.Canvas(output_path, pagesize=A4)
    c.setTitle(f"Journal des Travaux — {projet.get('nom') or projet.get('projet_id', '')}")
    c.setAuthor(projet.get('entrepreneur') or '')

    draw_page_de_garde(c, projet); c.showPage()
    draw_page_synthese(c, projet); c.showPage()

    folio_by_no = {f['folio_no']: f for f, _ in folios}
    for f, ouvriers in folios:
        draw_folio_page(c, projet, f, ouvriers); c.showPage()

    for cpl in complements:
        parent = folio_by_no.get(cpl['folio_no_ref'])
        if parent is None: continue
        if not cpl.get('date_ref'):
            cpl['date_ref'] = parent['date']
        draw_complement_page(c, projet, parent, cpl); c.showPage()

    c.save()
    print(f'OK → {output_path}')
    print(f'  Projet : {projet.get("projet_id")} ({projet.get("nom", "")})')
    print(f'  Folios : {len(folios)} | Compléments : {len(complements)}')
    return output_path


if __name__ == '__main__':
    json_path = sys.argv[1] if len(sys.argv) > 1 else 'data/PRJ-001.json'
    output    = sys.argv[2] if len(sys.argv) > 2 else None
    build_pdf(json_path, output)
