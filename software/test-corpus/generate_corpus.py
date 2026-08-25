#!/usr/bin/env python3
"""
Corpus Generator for SHAPER-OS Documentary Pipeline.
Generates reference vector source PDFs and creates degraded test cases:
- 00-sources : Clean vector reference PDFs with exact text layers
- 01-rasterise : Pure images, no text layer (150 DPI)
- 02-pivote : Orthogonal rotations (90°, 180°, 270°)
- 03-de-travers : Skewed / tilted scans (3° to 7°)
- 04-degrade : Low resolution (72 DPI), low contrast, noise, photocopy & fax artifacts

Every test case is accompanied by a .verite.txt file containing the exact ground truth
text extracted from the non-degraded source vector PDF.
"""

import os
import sys
import math
import subprocess
import shutil
import glob
import numpy as np
import cairo

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
SOURCES_DIR = os.path.join(BASE_DIR, "00-sources")
DIR_01_RASTER = os.path.join(BASE_DIR, "01-rasterise")
DIR_02_PIVOTE = os.path.join(BASE_DIR, "02-pivote")
DIR_03_TRAVERS = os.path.join(BASE_DIR, "03-de-travers")
DIR_04_DEGRADE = os.path.join(BASE_DIR, "04-degrade")

PAGE_WIDTH_PT = 595.276   # A4 width in points (210 mm)
PAGE_HEIGHT_PT = 841.890  # A4 height in points (297 mm)

# ---------------------------------------------------------------------------
# Neutral synthetic document definitions (No personal data, no real company names)
# ---------------------------------------------------------------------------

DOCUMENTS = {
    "facture_prestation": {
        "title": "FACTURE COMMERCIALE",
        "sections": [
            ("HEADER", [
                "FACTURE N\u00b0 F-2024-00892",
                "Date d'\u00e9mission : 14/11/2024",
                "Date d'\u00e9ch\u00e9ance : 14/12/2024",
                "Mode de r\u00e8glement : Virement bancaire 30 jours net",
            ]),
            ("EMETTEUR_DESTINATAIRE", [
                "\u00c9metteur :",
                "Soci\u00e9t\u00e9 Exemple Ing\u00e9nierie SAS",
                "Capital social : 50 000 EUR",
                "12 rue des D\u00e9veloppeurs, 75011 Paris, France",
                "SIRET : 987 654 321 00012 | RCS Paris B 987 654 321",
                "TVA Intracommunautaire : FR 12 987654321",
                "",
                "Destinataire :",
                "Entreprise Fictive de Logistique SARL",
                "45 avenue du Commerce, 69002 Lyon, France",
                "SIRET : 123 456 789 00045 | N/R\u00e9f Client : CLT-8842",
            ]),
            ("TABLE", [
                "D\u00e9signation des prestations | Qt\u00e9 | PU HT | Total HT",
                "-------------------------------------------------------------",
                "1. D\u00e9veloppement module d'ingestion documentaire | 10 j | 650.00 EUR | 6500.00 EUR",
                "2. Tests unitaires et d'int\u00e9gration automatis\u00e9s | 5 j | 650.00 EUR | 3250.00 EUR",
                "3. R\u00e9daction documentation technique et exploitation | 2 j | 500.00 EUR | 1000.00 EUR",
            ]),
            ("TOTALS", [
                "Total Brut HT : 10750.00 EUR",
                "Remise commerciale accord\u00e9e (5.0%) : -537.50 EUR",
                "Total Net HT : 10212.50 EUR",
                "TVA applicable (20.0%) : 2042.50 EUR",
                "Montant Total TTC \u00e0 payer : 12255.00 EUR",
            ]),
            ("LEGAL", [
                "Coordonn\u00e9es bancaires pour r\u00e8glement :",
                "IBAN : FR76 3000 4000 5000 0123 4567 890",
                "BIC : EXMPFRPPXXX - Banque Fictive de Paris",
                "Conditions g\u00e9n\u00e9rales : En cas de retard de paiement, une indemnit\u00e9 forfaitaire l\u00e9gale de",
                "40 EUR pour frais de recouvrement sera exig\u00e9e (art. D. 441-5 C. com.), major\u00e9e d'un int\u00e9r\u00eat",
                "au taux de refinancement BCE major\u00e9 de 10 points. Aucun escompte pour paiement anticip\u00e9.",
            ])
        ]
    },
    "compte_rendu_reunion": {
        "title": "COMPTE RENDU DE R\u00c9UNION TECHNIQUE",
        "sections": [
            ("HEADER", [
                "PROJET : Cha\u00eene de traitement documentaire SHAPER",
                "Date de s\u00e9ance : 18 octobre 2024 (14h00 - 16h30)",
                "Lieu : Salle B2 / Visioconf\u00e9rence s\u00e9curis\u00e9e",
                "R\u00e9dacteur du compte rendu : Alexandre Martin",
            ]),
            ("PARTICIPANTS", [
                "Participants pr\u00e9sents :",
                "- Sophie Bernard (Chef de projet MOE)",
                "- Alexandre Martin (Architecte logiciel)",
                "- Claire Dubois (Ing\u00e9nieure assurance qualit\u00e9)",
                "- Thomas Leroy (Responsable infrastructure et d\u00e9ploiement)",
            ]),
            ("ORDRE_DU_JOUR", [
                "Ordre du jour :",
                "1. Synth\u00e8se des anomalies observ\u00e9es sur les flux num\u00e9ris\u00e9s entrants.",
                "2. \u00c9valuation des contraintes d'orientation, de basculement et d'inclinaison.",
                "3. D\u00e9finition du protocole de qualification et des jeux de tests de v\u00e9rit\u00e9 terrain.",
                "4. Validation du calendrier pr\u00e9visionnel de livraison du jalon 2.",
            ]),
            ("DECISIONS", [
                "Points abord\u00e9s et d\u00e9cisions act\u00e9es :",
                "1. Traitement des num\u00e9risations sans couche texte :",
                "Il est convenu que l'absence totale de texte vectoriel impose un pr\u00e9-traitement syst\u00e9matique.",
                "Les documents inclin\u00e9s de moins de 10 degr\u00e9s doivent \u00eatre corrig\u00e9s avant extraction.",
                "",
                "2. Gestion des orientations orthogonales anormales :",
                "Les pages tourn\u00e9es \u00e0 90\u00b0, 180\u00b0 ou 270\u00b0 feront l'objet d'une estimation probabiliste d'orientation.",
                "",
                "3. D\u00e9gradation et basse r\u00e9solution :",
                "Les scans basse r\u00e9solution (72 DPI) ou \u00e0 faible contraste seront r\u00e9\u00e9talonn\u00e9s.",
            ]),
            ("ACTIONS", [
                "Plan d'action et assignations :",
                "- Alexandre Martin : Finaliser l'algorithme de d\u00e9tection d'angle (\u00c9ch\u00e9ance : 25/10/2024).",
                "- Claire Dubois : Structurer le corpus de test et les fichiers de v\u00e9rit\u00e9 (\u00c9ch\u00e9ance : 22/10/2024).",
                "- Thomas Leroy : Benchmarker les consommations CPU sur serveur cible (\u00c9ch\u00e9ance : 28/10/2024).",
                "",
                "Prochaine r\u00e9union fix\u00e9e au vendredi 1er novembre 2024 \u00e0 10h00.",
            ])
        ]
    },
    "formulaire_administratif": {
        "title": "BORDEREAU ADMINISTRATIF DE DEMANDE D'ACC\u00c8S",
        "sections": [
            ("HEADER", [
                "R\u00c9F\u00c9RENCE DOSSIER : ADM-2024-7841-K",
                "Date de d\u00e9p\u00f4t : 05 novembre 2024",
                "Statut de la demande : EN COURS D'INSTRUCTION",
            ]),
            ("SECTION_1", [
                "SECTION 1 : IDENTIFICATION DE L'AGENT DEMANDEUR",
                "Nom : DURAND",
                "Pr\u00e9nom : Julien",
                "Matricule agent : AG-94021",
                "Service d'affectation : Direction des Syst\u00e8mes d'Information (DSI)",
                "Courriel de contact : julien.durand@organisme-fictif.fr",
                "Ligne directe : +33 1 42 68 00 00",
            ]),
            ("SECTION_2", [
                "SECTION 2 : NATURE DES HABILITATIONS SOLLICIT\u00c9ES",
                "[X] Acc\u00e8s administrateur aux environnements de qualification",
                "[ ] Acc\u00e8s consultation directe aux bases de donn\u00e9es de production",
                "[X] D\u00e9ploiement automatis\u00e9 sur cluster applicatif",
                "[ ] Modification des r\u00e8gles de filtrage pare-feu",
                "",
                "Justification op\u00e9rationnelle :",
                "Dans le cadre de la refonte du pipeline d'ingestion documentaire, n\u00e9cessit\u00e9 d'effectuer",
                "des tests de mont\u00e9e en charge et de v\u00e9rifier la r\u00e9silience face aux flux d\u00e9grad\u00e9s.",
            ]),
            ("SECTION_3", [
                "SECTION 3 : ENGAGEMENT ET VALIDATIONS",
                "Le demandeur certifie sur l'honneur l'exactitude des \u00e9l\u00e9ments port\u00e9s au pr\u00e9sent bordereau",
                "et s'engage \u00e0 respecter les r\u00e8gles de confidentialit\u00e9 et d'int\u00e9grit\u00e9 du syst\u00e8me.",
                "",
                "Fait \u00e0 Paris, le 05/11/2024",
                "Signature du demandeur : J. Durand",
                "Visa responsable hi\u00e9rarchique : Valid\u00e9 le 06/11/2024 par la Direction Technique",
            ])
        ]
    },
    "rapport_synthese": {
        "title": "NOTE DE SYNTH\u00c8SE TECHNIQUE",
        "sections": [
            ("HEADER", [
                "DOCUMENT TECHNIQUE DE R\u00c9F\u00c9RENCE",
                "Sujet : R\u00e9silience du traitement optique et vectoriel des documents d\u00e9grad\u00e9s",
                "Auteur : Cellule Architecture et Traitement Num\u00e9rique",
                "Version : 1.4 - Classification : Usage Interne",
                "Date de diffusion : 20 novembre 2024",
            ]),
            ("CORPUS_1", [
                "1. Contexte et probl\u00e9matique industrielle",
                "La d\u00e9mat\u00e9rialisation des flux entrants confronte la cha\u00eene de traitement \u00e0 une forte",
                "h\u00e9t\u00e9rog\u00e9n\u00e9it\u00e9 des documents. Si les fichiers nativement num\u00e9riques disposent d'une couche",
                "textuelle directement exploitable, les pi\u00e8ces issues de num\u00e9risations physiques ou de t\u00e9l\u00e9copies",
                "introduisent des alt\u00e9rations s\u00e9v\u00e8res : perte de contraste, rotations et bruit de trame.",
            ]),
            ("CORPUS_2", [
                "2. Typologie et distribution des alt\u00e9rations constat\u00e9es",
                "L'analyse quantitative men\u00e9e sur un \u00e9chantillon repr\u00e9sentatif met en lumi\u00e8re trois facteurs :",
                "- Rotations orthogonales (90\u00b0, 180\u00b0, 270\u00b0) : observ\u00e9es sur 4,2% des flux num\u00e9ris\u00e9s.",
                "- Inclinaisons et d\u00e9viations angulaires (3\u00b0 \u00e0 7\u00b0) : pr\u00e9sentes sur 18,5% des pages.",
                "- D\u00e9gradations de contraste et bruit d'\u00e9chantillonnage : relev\u00e9es sur 12,1% des archives.",
            ]),
            ("CORPUS_3", [
                "3. Recommandations architecturales",
                "Pour atteindre un taux de couverture textuelle sup\u00e9rieur \u00e0 99,5%, il est recommand\u00e9 :",
                "- D'isoler l'\u00e9tape de correction g\u00e9om\u00e9trique en amont de toute tentative de segmentation.",
                "- D'appliquer un filtrage bilat\u00e9ral adaptatif pour att\u00e9nuer le bruit sans dissoudre les contours.",
                "- De valider en continu les m\u00e9triques de pr\u00e9cision sur un corpus de v\u00e9rit\u00e9 terrain certifi\u00e9.",
            ]),
            ("CORPUS_4", [
                "4. Conclusion op\u00e9rationnelle",
                "La robustesse globale du syst\u00e8me repose sur la repr\u00e9sentativit\u00e9 de ses jeux de test.",
                "L'int\u00e9gration syst\u00e9matique de cas d\u00e9grad\u00e9s contr\u00f4l\u00e9s garantit une non-r\u00e9gression p\u00e9renne.",
            ])
        ]
    }
}

# ---------------------------------------------------------------------------
# Vector PDF Generation (Cairo)
# ---------------------------------------------------------------------------

def draw_vector_pdf(doc_key, output_pdf_path):
    doc = DOCUMENTS[doc_key]
    surface = cairo.PDFSurface(output_pdf_path, PAGE_WIDTH_PT, PAGE_HEIGHT_PT)
    ctx = cairo.Context(surface)
    
    # White background
    ctx.set_source_rgb(1.0, 1.0, 1.0)
    ctx.paint()
    
    # Header Banner / Border
    ctx.set_source_rgb(0.15, 0.25, 0.45)
    ctx.rectangle(40, 40, PAGE_WIDTH_PT - 80, 4)
    ctx.fill()
    
    # Document Title
    ctx.select_font_face("Sans", cairo.FONT_SLANT_NORMAL, cairo.FONT_WEIGHT_BOLD)
    ctx.set_font_size(16)
    ctx.set_source_rgb(0.1, 0.15, 0.3)
    ctx.move_to(45, 65)
    ctx.show_text(doc["title"])
    
    y = 95
    line_height = 14
    
    for sec_type, lines in doc["sections"]:
        if sec_type in ("EMETTEUR_DESTINATAIRE", "TABLE", "TOTALS", "LEGAL",
                        "PARTICIPANTS", "ORDRE_DU_JOUR", "DECISIONS", "ACTIONS",
                        "SECTION_1", "SECTION_2", "SECTION_3",
                        "CORPUS_1", "CORPUS_2", "CORPUS_3", "CORPUS_4"):
            ctx.set_source_rgb(0.8, 0.85, 0.9)
            ctx.rectangle(45, y - 6, PAGE_WIDTH_PT - 90, 0.8)
            ctx.fill()
            y += 8
            
        for line in lines:
            if not line.strip():
                y += 8
                continue
                
            is_bold = (line.startswith("SECTION ") or 
                       line.startswith("1. ") or line.startswith("2. ") or line.startswith("3. ") or line.startswith("4. ") or
                       line.startswith("FACTURE N\u00b0") or line.startswith("PROJET :") or line.startswith("R\u00c9F\u00c9RENCE DOSSIER") or
                       line.startswith("\u00c9metteur :") or line.startswith("Destinataire :") or
                       line.startswith("Total Net HT") or line.startswith("Montant Total TTC") or
                       line.startswith("D\u00e9signation des prestations") or line.startswith("Ordre du jour") or
                       line.startswith("Participants") or line.startswith("Points abord\u00e9s") or line.startswith("Plan d'action"))
            
            if is_bold:
                ctx.select_font_face("Sans", cairo.FONT_SLANT_NORMAL, cairo.FONT_WEIGHT_BOLD)
                ctx.set_font_size(10.5)
                ctx.set_source_rgb(0.1, 0.1, 0.2)
            elif line.startswith("---") or line.startswith("[X]") or line.startswith("[ ]"):
                ctx.select_font_face("Courier", cairo.FONT_SLANT_NORMAL, cairo.FONT_WEIGHT_NORMAL)
                ctx.set_font_size(9.5)
                ctx.set_source_rgb(0.2, 0.2, 0.2)
            else:
                ctx.select_font_face("Sans", cairo.FONT_SLANT_NORMAL, cairo.FONT_WEIGHT_NORMAL)
                ctx.set_font_size(9.5)
                ctx.set_source_rgb(0.15, 0.15, 0.15)
                
            ctx.move_to(45, y)
            ctx.show_text(line)
            y += line_height
            
    # Bottom footer
    ctx.set_source_rgb(0.5, 0.5, 0.5)
    ctx.select_font_face("Sans", cairo.FONT_SLANT_NORMAL, cairo.FONT_WEIGHT_NORMAL)
    ctx.set_font_size(8)
    ctx.move_to(45, PAGE_HEIGHT_PT - 35)
    ctx.show_text("SHAPER-OS Corpus de test - Page 1 / 1 - Document technique g\u00e9n\u00e9r\u00e9 pour banc d'essai.")
    
    surface.finish()

# ---------------------------------------------------------------------------
# Ground truth extraction via pdftotext
# ---------------------------------------------------------------------------

def extract_ground_truth(vector_pdf_path, truth_txt_path):
    cmd = ["pdftotext", vector_pdf_path, truth_txt_path]
    subprocess.run(cmd, check=True)
    with open(truth_txt_path, "r", encoding="utf-8", errors="replace") as f:
        content = f.read()
    return content

# ---------------------------------------------------------------------------
# Image / Raster Operations
# ---------------------------------------------------------------------------

def render_pdf_to_image_surface(pdf_path, dpi=150):
    """Renders PDF to a fresh Cairo ImageSurface via pdftoppm."""
    ppm_prefix = os.path.join(BASE_DIR, f"tmp_render_{os.getpid()}")
    cmd = ["pdftoppm", "-png", "-r", str(dpi), pdf_path, ppm_prefix]
    subprocess.run(cmd, check=True)
    png_file = f"{ppm_prefix}-1.png"
    if not os.path.exists(png_file):
        for f in os.listdir(BASE_DIR):
            if f.startswith(f"tmp_render_{os.getpid()}") and f.endswith(".png"):
                png_file = os.path.join(BASE_DIR, f)
                break
                
    loaded_surf = cairo.ImageSurface.create_from_png(png_file)
    w = loaded_surf.get_width()
    h = loaded_surf.get_height()
    
    # Create fresh surface without PNG mime data attachment to allow buffer mutations
    surface = cairo.ImageSurface(cairo.FORMAT_RGB24, w, h)
    ctx = cairo.Context(surface)
    ctx.set_source_surface(loaded_surf, 0, 0)
    ctx.paint()
    
    if os.path.exists(png_file):
        os.remove(png_file)
    return surface

def save_image_surface_as_pdf(img_surface, output_pdf_path, page_w=PAGE_WIDTH_PT, page_h=PAGE_HEIGHT_PT):
    """Embeds an ImageSurface into a pure raster PDF (no text layer)."""
    img_w = img_surface.get_width()
    img_h = img_surface.get_height()
    
    pdf_surface = cairo.PDFSurface(output_pdf_path, page_w, page_h)
    ctx = cairo.Context(pdf_surface)
    
    # Scale image to fit specified page dimensions
    scale_x = page_w / img_w
    scale_y = page_h / img_h
    ctx.scale(scale_x, scale_y)
    
    ctx.set_source_surface(img_surface, 0, 0)
    ctx.paint()
    pdf_surface.finish()

# ---------------------------------------------------------------------------
# Degradation Generators
# ---------------------------------------------------------------------------

def create_01_rasterise(doc_name, source_pdf, truth_text):
    """01-rasterise: Pure image at 150 DPI with no text layer."""
    out_pdf = os.path.join(DIR_01_RASTER, f"{doc_name}_raster.pdf")
    out_truth = os.path.join(DIR_01_RASTER, f"{doc_name}_raster.verite.txt")
    
    img_surf = render_pdf_to_image_surface(source_pdf, dpi=150)
    save_image_surface_as_pdf(img_surf, out_pdf)
    
    with open(out_truth, "w", encoding="utf-8") as f:
        f.write(truth_text)

def create_02_pivote(doc_name, source_pdf, truth_text):
    """02-pivote: 90°, 180°, 270° orthogonal rotations."""
    angles = [90, 180, 270]
    base_img = render_pdf_to_image_surface(source_pdf, dpi=150)
    src_w = base_img.get_width()
    src_h = base_img.get_height()
    
    for deg in angles:
        out_pdf = os.path.join(DIR_02_PIVOTE, f"{doc_name}_rot{deg}.pdf")
        out_truth = os.path.join(DIR_02_PIVOTE, f"{doc_name}_rot{deg}.verite.txt")
        
        rad = math.radians(deg)
        if deg in (90, 270):
            target_w, target_h = src_h, src_w
            target_page_w, target_page_h = PAGE_HEIGHT_PT, PAGE_WIDTH_PT
        else:
            target_w, target_h = src_w, src_h
            target_page_w, target_page_h = PAGE_WIDTH_PT, PAGE_HEIGHT_PT
            
        rot_surf = cairo.ImageSurface(cairo.FORMAT_RGB24, target_w, target_h)
        rot_ctx = cairo.Context(rot_surf)
        rot_ctx.set_source_rgb(1.0, 1.0, 1.0)
        rot_ctx.paint()
        
        rot_ctx.translate(target_w / 2.0, target_h / 2.0)
        rot_ctx.rotate(rad)
        rot_ctx.translate(-src_w / 2.0, -src_h / 2.0)
        rot_ctx.set_source_surface(base_img, 0, 0)
        rot_ctx.paint()
        
        save_image_surface_as_pdf(rot_surf, out_pdf, page_w=target_page_w, page_h=target_page_h)
        
        with open(out_truth, "w", encoding="utf-8") as f:
            f.write(truth_text)

def create_03_de_travers(doc_name, source_pdf, truth_text, angle_deg):
    """03-de-travers: Small angle tilt / skew (3° to 7°)."""
    angle_slug = f"plus_{abs(angle_deg):.1f}deg" if angle_deg > 0 else f"minus_{abs(angle_deg):.1f}deg"
    angle_slug = angle_slug.replace(".", "_")
    out_pdf = os.path.join(DIR_03_TRAVERS, f"{doc_name}_skew_{angle_slug}.pdf")
    out_truth = os.path.join(DIR_03_TRAVERS, f"{doc_name}_skew_{angle_slug}.verite.txt")
    
    base_img = render_pdf_to_image_surface(source_pdf, dpi=150)
    w = base_img.get_width()
    h = base_img.get_height()
    
    rot_surf = cairo.ImageSurface(cairo.FORMAT_RGB24, w, h)
    rot_ctx = cairo.Context(rot_surf)
    # White background (simulating scanner platen / margin)
    rot_ctx.set_source_rgb(1.0, 1.0, 1.0)
    rot_ctx.paint()
    
    rad = math.radians(angle_deg)
    rot_ctx.translate(w / 2.0, h / 2.0)
    rot_ctx.rotate(rad)
    rot_ctx.translate(-w / 2.0, -h / 2.0)
    rot_ctx.set_source_surface(base_img, 0, 0)
    rot_ctx.paint()
    
    save_image_surface_as_pdf(rot_surf, out_pdf)
    
    with open(out_truth, "w", encoding="utf-8") as f:
        f.write(truth_text)

def create_04_degrade(doc_name, source_pdf, truth_text, degradation_type):
    """04-degrade: Low resolution, low contrast, noise, photocopy & fax artifacts."""
    out_pdf = os.path.join(DIR_04_DEGRADE, f"{doc_name}_{degradation_type}.pdf")
    out_truth = os.path.join(DIR_04_DEGRADE, f"{doc_name}_{degradation_type}.verite.txt")
    
    if degradation_type == "basse_res_72dpi":
        # Low resolution 72 DPI
        img_surf = render_pdf_to_image_surface(source_pdf, dpi=72)
        save_image_surface_as_pdf(img_surf, out_pdf)
        
    elif degradation_type == "faible_contraste":
        # Washed out / faded print scan
        img_surf = render_pdf_to_image_surface(source_pdf, dpi=150)
        w, h = img_surf.get_width(), img_surf.get_height()
        buf = img_surf.get_data()
        arr = np.ndarray(shape=(h, w, 4), dtype=np.uint8, buffer=buf)
        rgb = arr[:, :, :3].astype(np.float32)
        rgb = np.clip(rgb * 0.35 + 155.0, 0, 255).astype(np.uint8)
        arr[:, :, :3] = rgb
        img_surf.mark_dirty()
        save_image_surface_as_pdf(img_surf, out_pdf)
        
    elif degradation_type == "bruit_scanner":
        # Gaussian noise + Salt & Pepper
        img_surf = render_pdf_to_image_surface(source_pdf, dpi=150)
        w, h = img_surf.get_width(), img_surf.get_height()
        buf = img_surf.get_data()
        arr = np.ndarray(shape=(h, w, 4), dtype=np.uint8, buffer=buf)
        rgb = arr[:, :, :3].astype(np.float32)
        
        np.random.seed(42)
        noise = np.random.normal(0, 18, (h, w, 3))
        rgb = np.clip(rgb + noise, 0, 255)
        
        speck_mask = np.random.random((h, w)) < 0.003
        pepper_mask = np.random.random((h, w)) < 0.003
        rgb[speck_mask] = 255
        rgb[pepper_mask] = 0
        
        arr[:, :, :3] = rgb.astype(np.uint8)
        img_surf.mark_dirty()
        save_image_surface_as_pdf(img_surf, out_pdf)
        
    elif degradation_type == "photocopie_degradee":
        # 72 DPI + Low contrast + noise + illumination gradient + threshold clipping
        img_surf = render_pdf_to_image_surface(source_pdf, dpi=72)
        w, h = img_surf.get_width(), img_surf.get_height()
        buf = img_surf.get_data()
        arr = np.ndarray(shape=(h, w, 4), dtype=np.uint8, buffer=buf)
        rgb = arr[:, :, :3].astype(np.float32)
        
        gray = 0.299 * rgb[:, :, 0] + 0.587 * rgb[:, :, 1] + 0.114 * rgb[:, :, 2]
        
        # Vignetting / gradient
        gradient = np.linspace(0.88, 1.02, w)[np.newaxis, :]
        gray = gray * gradient
        
        # Heavy noise
        np.random.seed(101)
        noise = np.random.normal(5, 20, (h, w))
        gray = gray + noise
        
        # Non-linear photocopy thresholding
        gray = np.where(gray < 110, gray * 0.65, gray)
        gray = np.where(gray > 220, 245, gray)
        
        gray = np.clip(gray, 0, 255).astype(np.uint8)
        for c in range(3):
            arr[:, :, c] = gray
            
        img_surf.mark_dirty()
        save_image_surface_as_pdf(img_surf, out_pdf)
        
    elif degradation_type == "flou_bavure":
        # 96 DPI + mild spatial blur + slight ink spread
        img_surf = render_pdf_to_image_surface(source_pdf, dpi=96)
        w, h = img_surf.get_width(), img_surf.get_height()
        buf = img_surf.get_data()
        arr = np.ndarray(shape=(h, w, 4), dtype=np.uint8, buffer=buf)
        rgb = arr[:, :, :3].astype(np.float32)
        
        blurred = (rgb[1:-1, 1:-1] * 4 + 
                   rgb[:-2, 1:-1] + rgb[2:, 1:-1] + 
                   rgb[1:-1, :-2] + rgb[1:-1, 2:]) / 8.0
        rgb[1:-1, 1:-1] = blurred
        
        rgb = np.clip(rgb * 0.92, 0, 255).astype(np.uint8)
        arr[:, :, :3] = rgb
        img_surf.mark_dirty()
        save_image_surface_as_pdf(img_surf, out_pdf)
        
    elif degradation_type == "fax_binaire":
        # Fax 1-bit style thresholding with roller streak artifact
        img_surf = render_pdf_to_image_surface(source_pdf, dpi=100)
        w, h = img_surf.get_width(), img_surf.get_height()
        buf = img_surf.get_data()
        arr = np.ndarray(shape=(h, w, 4), dtype=np.uint8, buffer=buf)
        gray = 0.299 * arr[:, :, 0] + 0.587 * arr[:, :, 1] + 0.114 * arr[:, :, 2]
        
        binary = np.where(gray < 160, 0, 255).astype(np.uint8)
        
        # Vertical roller streak line typical of fax machines
        roller_pos = int(w * 0.28)
        binary[:, roller_pos:roller_pos+2] = np.minimum(binary[:, roller_pos:roller_pos+2], 60)
        
        for c in range(3):
            arr[:, :, c] = binary
        img_surf.mark_dirty()
        save_image_surface_as_pdf(img_surf, out_pdf)

    elif degradation_type == "photocopie_sombre":
        # Dark photocopy with heavy toner background
        img_surf = render_pdf_to_image_surface(source_pdf, dpi=120)
        w, h = img_surf.get_width(), img_surf.get_height()
        buf = img_surf.get_data()
        arr = np.ndarray(shape=(h, w, 4), dtype=np.uint8, buffer=buf)
        rgb = arr[:, :, :3].astype(np.float32)
        gray = 0.299 * rgb[:, :, 0] + 0.587 * rgb[:, :, 1] + 0.114 * rgb[:, :, 2]
        
        # Dark toner background and crushed blacks
        gray = np.clip((gray - 35.0) * 1.15, 0, 255)
        np.random.seed(777)
        toner_specks = np.random.normal(0, 15, (h, w))
        gray = np.clip(gray + toner_specks, 0, 255).astype(np.uint8)
        
        for c in range(3):
            arr[:, :, c] = gray
        img_surf.mark_dirty()
        save_image_surface_as_pdf(img_surf, out_pdf)

    with open(out_truth, "w", encoding="utf-8") as f:
        f.write(truth_text)

# ---------------------------------------------------------------------------
# Main Orchestrator
# ---------------------------------------------------------------------------

def clean_and_prepare_dirs():
    for d in [SOURCES_DIR, DIR_01_RASTER, DIR_02_PIVOTE, DIR_03_TRAVERS, DIR_04_DEGRADE]:
        if os.path.exists(d):
            shutil.rmtree(d)
        os.makedirs(d, exist_ok=True)

def main():
    print("=== SHAPER-OS Corpus Generation ===")
    clean_and_prepare_dirs()
    
    # Angles for 03-de-travers (strictly in 3° to 7°)
    skew_angles = {
        "facture_prestation": [3.0, -6.5],
        "compte_rendu_reunion": [-3.5, 5.0],
        "formulaire_administratif": [4.5, -7.0],
        "rapport_synthese": [-5.0, 6.0],
    }
    
    # Degradation types for 04-degrade
    degradation_mapping = {
        "facture_prestation": ["basse_res_72dpi", "faible_contraste"],
        "compte_rendu_reunion": ["bruit_scanner", "photocopie_degradee"],
        "formulaire_administratif": ["fax_binaire", "flou_bavure"],
        "rapport_synthese": ["photocopie_sombre", "faible_contraste", "basse_res_72dpi"],
    }
    
    total_cases = 0
    for doc_name in DOCUMENTS.keys():
        print(f"\n[+] Processing Document: {doc_name}")
        src_pdf = os.path.join(SOURCES_DIR, f"{doc_name}.pdf")
        src_truth = os.path.join(SOURCES_DIR, f"{doc_name}.verite.txt")
        
        # 1. Generate clean vector PDF source
        draw_vector_pdf(doc_name, src_pdf)
        truth_text = extract_ground_truth(src_pdf, src_truth)
        print(f"    - Vector source generated: {src_pdf}")
        print(f"    - Ground truth extracted: {src_truth} ({len(truth_text)} chars)")
        
        # 2. Generate 01-rasterise
        create_01_rasterise(doc_name, src_pdf, truth_text)
        print(f"    - 01-rasterise generated (150 DPI pure image)")
        total_cases += 1
        
        # 3. Generate 02-pivote (90°, 180°, 270°)
        create_02_pivote(doc_name, src_pdf, truth_text)
        print(f"    - 02-pivote generated (90°, 180°, 270°)")
        total_cases += 3
        
        # 4. Generate 03-de-travers
        for angle in skew_angles[doc_name]:
            create_03_de_travers(doc_name, src_pdf, truth_text, angle)
            total_cases += 1
        print(f"    - 03-de-travers generated (angles: {skew_angles[doc_name]})")
        
        # 5. Generate 04-degrade
        for deg_type in degradation_mapping[doc_name]:
            create_04_degrade(doc_name, src_pdf, truth_text, deg_type)
            total_cases += 1
        print(f"    - 04-degrade generated ({degradation_mapping[doc_name]})")

    print(f"\n[✓] Corpus generation complete! Total test cases generated: {total_cases}")

if __name__ == "__main__":
    main()
