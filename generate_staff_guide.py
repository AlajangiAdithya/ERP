"""
Generate a simple staff guide PDF for RAPS-ERP.
Language is intentionally simple — short sentences, clear button names,
step-by-step. Designed for staff with low literacy.
"""

import os
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import cm, mm
from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT, TA_CENTER
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, PageBreak, Image,
    Table, TableStyle, KeepTogether, ListFlowable, ListItem
)

HERE = os.path.dirname(os.path.abspath(__file__))
LOGO = os.path.join(HERE, "raps-logo-6.png")
OUT = os.path.join(HERE, "RAPS_ERP_Staff_Guide.pdf")

# ---------- Colors ----------
BLUE = colors.HexColor("#1e3a8a")
LIGHT_BLUE = colors.HexColor("#dbeafe")
GREEN = colors.HexColor("#059669")
LIGHT_GREEN = colors.HexColor("#d1fae5")
ORANGE = colors.HexColor("#ea580c")
LIGHT_ORANGE = colors.HexColor("#ffedd5")
GRAY = colors.HexColor("#374151")
LIGHT_GRAY = colors.HexColor("#f3f4f6")
YELLOW_BG = colors.HexColor("#fef9c3")

# ---------- Styles ----------
styles = getSampleStyleSheet()

title_style = ParagraphStyle(
    "Title", parent=styles["Title"], fontName="Helvetica-Bold",
    fontSize=28, leading=34, alignment=TA_CENTER, textColor=BLUE,
    spaceAfter=10
)
subtitle_style = ParagraphStyle(
    "Subtitle", parent=styles["Normal"], fontName="Helvetica",
    fontSize=14, leading=18, alignment=TA_CENTER, textColor=GRAY,
    spaceAfter=20
)
h1_style = ParagraphStyle(
    "H1", parent=styles["Heading1"], fontName="Helvetica-Bold",
    fontSize=22, leading=28, textColor=colors.white,
    backColor=BLUE, borderPadding=10, spaceBefore=14, spaceAfter=14
)
h2_style = ParagraphStyle(
    "H2", parent=styles["Heading2"], fontName="Helvetica-Bold",
    fontSize=16, leading=20, textColor=BLUE, spaceBefore=12, spaceAfter=8
)
h3_style = ParagraphStyle(
    "H3", parent=styles["Heading3"], fontName="Helvetica-Bold",
    fontSize=13, leading=16, textColor=GRAY, spaceBefore=8, spaceAfter=4
)
body_style = ParagraphStyle(
    "Body", parent=styles["Normal"], fontName="Helvetica",
    fontSize=12, leading=18, textColor=GRAY, spaceAfter=6
)
big_body_style = ParagraphStyle(
    "BigBody", parent=styles["Normal"], fontName="Helvetica",
    fontSize=13, leading=20, textColor=GRAY, spaceAfter=8
)
step_style = ParagraphStyle(
    "Step", parent=styles["Normal"], fontName="Helvetica",
    fontSize=12, leading=18, textColor=GRAY, leftIndent=10, spaceAfter=4
)
note_style = ParagraphStyle(
    "Note", parent=styles["Normal"], fontName="Helvetica-Oblique",
    fontSize=11, leading=15, textColor=GRAY, leftIndent=10, rightIndent=10,
    backColor=YELLOW_BG, borderPadding=8, spaceBefore=6, spaceAfter=10
)
toc_item_style = ParagraphStyle(
    "TOCItem", parent=styles["Normal"], fontName="Helvetica",
    fontSize=13, leading=22, textColor=GRAY
)


# ---------- Helper builders ----------
def section_header(text):
    return Paragraph(text, h1_style)


def heading2(text):
    return Paragraph(text, h2_style)


def heading3(text):
    return Paragraph(text, h3_style)


def para(text):
    return Paragraph(text, big_body_style)


def note_box(text):
    return Paragraph(f"<b>NOTE:</b> {text}", note_style)


def step_list(steps):
    """A numbered list rendered with clear spacing."""
    items = [ListItem(Paragraph(s, step_style), leftIndent=8) for s in steps]
    return ListFlowable(
        items, bulletType="1", start="1",
        leftIndent=22, bulletFontName="Helvetica-Bold",
        bulletFontSize=12, bulletColor=BLUE
    )


def bullet_list(items):
    items_p = [ListItem(Paragraph(s, step_style), leftIndent=8) for s in items]
    return ListFlowable(
        items_p, bulletType="bullet",
        leftIndent=22, bulletFontName="Helvetica",
        bulletFontSize=10, bulletColor=BLUE
    )


def status_flow(stages):
    """A visual flow of status steps."""
    cells = []
    for i, s in enumerate(stages):
        cells.append(Paragraph(f"<b>{s}</b>", ParagraphStyle(
            "F", fontName="Helvetica-Bold", fontSize=10, leading=12,
            alignment=TA_CENTER, textColor=colors.white
        )))
        if i < len(stages) - 1:
            cells.append(Paragraph("&#8594;", ParagraphStyle(
                "Arrow", fontName="Helvetica-Bold", fontSize=14,
                alignment=TA_CENTER, textColor=BLUE
            )))
    n = len(cells)
    col_widths = []
    for i in range(n):
        col_widths.append(2.5 * cm if i % 2 == 0 else 0.7 * cm)
    t = Table([cells], colWidths=col_widths)
    style = [
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("ALIGN", (0, 0), (-1, -1), "CENTER"),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ]
    for i in range(0, n, 2):
        style.append(("BACKGROUND", (i, 0), (i, 0), GREEN))
        style.append(("ROUNDEDCORNERS", [4, 4, 4, 4]))
    t.setStyle(TableStyle(style))
    return t


def role_badge_row(roles):
    """Show who can use this feature."""
    data = [[Paragraph(f"<b>FOR:</b> {roles}", ParagraphStyle(
        "Role", fontName="Helvetica-Bold", fontSize=11, leading=14,
        textColor=colors.white
    ))]]
    t = Table(data, colWidths=[16 * cm])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), ORANGE),
        ("LEFTPADDING", (0, 0), (-1, -1), 10),
        ("RIGHTPADDING", (0, 0), (-1, -1), 10),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ]))
    return t


def button_row(buttons):
    """Render a row of button-like boxes."""
    cells = []
    for b in buttons:
        cells.append(Paragraph(f"<b>{b}</b>", ParagraphStyle(
            "Btn", fontName="Helvetica-Bold", fontSize=10, leading=12,
            alignment=TA_CENTER, textColor=colors.white
        )))
    t = Table([cells], colWidths=[3.5 * cm] * len(cells))
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), BLUE),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("ALIGN", (0, 0), (-1, -1), "CENTER"),
        ("TOPPADDING", (0, 0), (-1, -1), 8),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
        ("BOX", (0, 0), (-1, -1), 1, colors.white),
        ("INNERGRID", (0, 0), (-1, -1), 1, colors.white),
    ]))
    return t


# ---------- Page header / footer ----------
def on_page(canvas, doc):
    canvas.saveState()
    # Footer
    canvas.setFont("Helvetica", 9)
    canvas.setFillColor(GRAY)
    canvas.drawString(2 * cm, 1.2 * cm, "RAPS ERP — Staff Guide")
    canvas.drawRightString(A4[0] - 2 * cm, 1.2 * cm, f"Page {doc.page}")
    # Top bar (skip cover - page 1)
    if doc.page > 1:
        canvas.setFillColor(BLUE)
        canvas.rect(0, A4[1] - 1.2 * cm, A4[0], 1.2 * cm, fill=1, stroke=0)
        canvas.setFillColor(colors.white)
        canvas.setFont("Helvetica-Bold", 11)
        canvas.drawString(2 * cm, A4[1] - 0.75 * cm, "RAPS ERP")
        canvas.setFont("Helvetica", 10)
        canvas.drawRightString(
            A4[0] - 2 * cm, A4[1] - 0.75 * cm,
            "Simple Staff Guide"
        )
    canvas.restoreState()


# ---------- Build content ----------
def build():
    doc = SimpleDocTemplate(
        OUT, pagesize=A4,
        leftMargin=2 * cm, rightMargin=2 * cm,
        topMargin=2 * cm, bottomMargin=2 * cm,
        title="RAPS ERP — Staff Guide",
        author="RAPS"
    )

    story = []

    # ===== COVER =====
    story.append(Spacer(1, 3 * cm))
    if os.path.exists(LOGO):
        try:
            img = Image(LOGO, width=6 * cm, height=6 * cm, kind="proportional")
            img.hAlign = "CENTER"
            story.append(img)
        except Exception:
            pass
    story.append(Spacer(1, 1 * cm))
    story.append(Paragraph("RAPS ERP", title_style))
    story.append(Paragraph("Simple Staff Guide", subtitle_style))
    story.append(Spacer(1, 0.5 * cm))
    story.append(Paragraph(
        "How to use the system — easy steps, in simple words.",
        ParagraphStyle("CoverText", fontName="Helvetica", fontSize=14,
                       leading=20, alignment=TA_CENTER, textColor=GRAY)
    ))
    story.append(Spacer(1, 4 * cm))
    story.append(Paragraph(
        "<b>Read this book before you use the computer.</b>",
        ParagraphStyle("CoverText2", fontName="Helvetica-Bold", fontSize=12,
                       leading=18, alignment=TA_CENTER, textColor=ORANGE)
    ))

    story.append(PageBreak())

    # ===== TABLE OF CONTENTS =====
    story.append(section_header("What is inside this book?"))
    story.append(Spacer(1, 6))
    toc = [
        "1. How to open the system and log in",
        "2. What each person (role) does",
        "3. Buying things — Purchase Request (PR)",
        "4. Getting price from sellers — Quotation",
        "5. Placing the order — Purchase Order (PO)",
        "6. Paying the seller — Payment Request",
        "7. Goods came in — Quality Check (QC)",
        "8. Putting goods in store — Inward Entry (MIV)",
        "9. Asking for material from store — Material Request",
        "10. Giving material from store — Clearance",
        "11. Sending material out — Gate Pass",
        "12. Moving stock to other unit — Inventory Transfer",
        "13. Lab work — Inter-Office Note (ION)",
        "14. Selling to customer — Sale Order & Invoice",
        "15. Words you will see often",
    ]
    for item in toc:
        story.append(Paragraph(item, toc_item_style))
    story.append(PageBreak())

    # ===== 1. LOGIN =====
    story.append(section_header("1. How to open the system and log in"))
    story.append(para(
        "Every person has their own user name and password. "
        "Do not share it with anyone."
    ))
    story.append(heading3("Steps:"))
    story.append(step_list([
        "Open the website on your computer (Chrome or Edge).",
        "You will see a login box on the screen.",
        "Type your <b>Username</b> in the first box.",
        "Type your <b>Password</b> in the second box.",
        "Click the blue <b>LOGIN</b> button.",
        "If the name or password is wrong, you will see a red message. Try again.",
        "After you log in, you will see the <b>Dashboard</b> page."
    ]))
    story.append(note_box(
        "If you forget your password, ask the Admin to give you a new one. "
        "Do not write your password on the desk."
    ))
    story.append(heading3("How to log out:"))
    story.append(step_list([
        "Look at the top-right corner of the screen.",
        "Click on your name.",
        "Click <b>LOGOUT</b>.",
        "Always log out before leaving the computer."
    ]))
    story.append(PageBreak())

    # ===== 2. ROLES =====
    story.append(section_header("2. What each person does"))
    story.append(para(
        "The system gives different work to different people. "
        "You will only see the buttons for your work. Other buttons are hidden."
    ))

    role_data = [
        ["Role", "Main Work"],
        ["Admin", "Big boss. Can see everything. Approves big requests."],
        ["Manager", "Makes purchase requests. Asks for material. Sends lab work."],
        ["Purchase Officer", "Talks to sellers. Adds quotation. Makes purchase order."],
        ["Store Manager", "Keeps the store. Receives goods. Gives material to staff."],
        ["QC (Quality)", "Checks if goods are good or bad."],
        ["Accounts", "Approves payment. Pays the seller."],
        ["Lab", "Does lab work that managers send."],
    ]
    role_table = Table(role_data, colWidths=[4 * cm, 12 * cm])
    role_table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), BLUE),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, 0), 12),
        ("FONTSIZE", (0, 1), (-1, -1), 11),
        ("FONTNAME", (0, 1), (0, -1), "Helvetica-Bold"),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 10),
        ("RIGHTPADDING", (0, 0), (-1, -1), 10),
        ("TOPPADDING", (0, 0), (-1, -1), 8),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, LIGHT_GRAY]),
        ("GRID", (0, 0), (-1, -1), 0.5, colors.lightgrey),
    ]))
    story.append(role_table)
    story.append(PageBreak())

    # ===== 3. PURCHASE REQUEST =====
    story.append(section_header("3. Buying things — Purchase Request (PR)"))
    story.append(role_badge_row("Manager / Lab"))
    story.append(Spacer(1, 6))
    story.append(para(
        "When you need to buy something for the company (raw material, "
        "spare part, chemical), you make a <b>Purchase Request</b>. "
        "This is the first step. Without a PR, nothing can be bought."
    ))
    story.append(heading3("Steps to make a Purchase Request:"))
    story.append(step_list([
        "On the left side, click <b>Purchase Requests</b>.",
        "Click the green <b>+ NEW REQUEST</b> button at top right.",
        "Type an <b>Order Name</b> (example: \"Production Material May 2026\").",
        "Click <b>+ ADD ITEM</b> for every material you want.",
        "For each item, fill: <b>Material name</b>, <b>Quantity</b>, <b>Unit</b> (kg, pcs, litre).",
        "Choose <b>Inhouse</b> or <b>External</b> for inspection.",
        "Add <b>Purpose</b> (why you need it) — keep it short.",
        "If needed, write <b>Drawing Number</b> or <b>QAP Number</b>.",
        "Pick the <b>Required By</b> date (when you need it).",
        "Check everything once. Then click <b>SUBMIT</b>.",
        "The request goes to Admin for approval."
    ]))
    story.append(note_box(
        "After you submit, you cannot change the Order Name. "
        "So check the spelling before clicking Submit."
    ))
    story.append(heading3("Status — what each word means:"))
    story.append(status_flow(["Pending", "Approved", "Quotation", "PO", "Goods In", "Done"]))
    story.append(Spacer(1, 8))
    story.append(bullet_list([
        "<b>Pending Admin</b> — Admin has not seen it yet.",
        "<b>Approved</b> — Admin said YES. Now go to next step.",
        "<b>Rejected</b> — Admin said NO. See the reason and try again.",
        "<b>Completed</b> — Goods came and put in store. Work finished."
    ]))
    story.append(PageBreak())

    # ===== 4. QUOTATION =====
    story.append(section_header("4. Getting price from sellers — Quotation"))
    story.append(role_badge_row("Purchase Officer / Admin"))
    story.append(Spacer(1, 6))
    story.append(para(
        "After Admin approves the PR, the Purchase Officer asks 2 or 3 "
        "sellers for their price. This is called a <b>Quotation</b>. "
        "We pick the seller with the best price."
    ))
    story.append(heading3("Steps to add a Quotation:"))
    story.append(step_list([
        "Click <b>Quotations</b> on the left side.",
        "Find the approved Purchase Request in the list.",
        "Click <b>+ ADD QUOTATION</b>.",
        "Type the <b>Seller Name</b>, phone number, and address.",
        "For each item, type the <b>Price per piece</b>.",
        "The system will count the total by itself.",
        "Click <b>SAVE</b>.",
        "Add another quotation from a different seller. Add 2 or 3.",
        "Admin will see all the quotations and pick one. They click <b>SELECT</b>.",
        "After SELECT, the system makes a Purchase Order by itself."
    ]))
    story.append(note_box(
        "Always get more than one quotation. This way the company gets the best price."
    ))
    story.append(PageBreak())

    # ===== 5. PURCHASE ORDER =====
    story.append(section_header("5. Placing the order — Purchase Order (PO)"))
    story.append(role_badge_row("Purchase Officer / Admin / Accounts"))
    story.append(Spacer(1, 6))
    story.append(para(
        "A <b>Purchase Order (PO)</b> is the paper that tells the seller: "
        "\"Yes, send us this material at this price.\" "
        "The system makes the PO when Admin selects a quotation."
    ))
    story.append(heading3("Steps:"))
    story.append(step_list([
        "Click <b>Purchase Orders</b> on the left side.",
        "Find the new PO in the list (it shows the seller name).",
        "Click on the PO to open it.",
        "Give a short name to the PO (example: \"WIPRO Q1\").",
        "Click <b>SEND TO ACCOUNTS</b>.",
        "Accounts will check the amount and approve.",
        "Click <b>DOWNLOAD PDF</b> to print the PO and send to the seller."
    ]))

    story.append(heading3("Approval levels (who can approve how much money):"))
    money_data = [
        ["Amount", "Who Approves"],
        ["Less than 1 lakh", "Any Accounts staff"],
        ["1 lakh to 10 lakh", "Accounts Manager"],
        ["More than 10 lakh", "Director only"],
    ]
    money_table = Table(money_data, colWidths=[6 * cm, 10 * cm])
    money_table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), GREEN),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, -1), 11),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 10),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, LIGHT_GREEN]),
        ("GRID", (0, 0), (-1, -1), 0.5, colors.lightgrey),
    ]))
    story.append(money_table)
    story.append(PageBreak())

    # ===== 6. PAYMENT =====
    story.append(section_header("6. Paying the seller — Payment Request"))
    story.append(role_badge_row("Accounts"))
    story.append(Spacer(1, 6))
    story.append(para(
        "After PO is approved, Accounts must pay the seller. "
        "Some sellers want money first (advance). Some want money after delivery."
    ))
    story.append(heading3("Steps:"))
    story.append(step_list([
        "Click <b>Payment Requests</b> on the left side.",
        "You will see all payments waiting.",
        "Click on a payment to see the seller name and amount.",
        "Check if you have the right to approve this amount.",
        "Click the green <b>APPROVE</b> button if everything is correct.",
        "After you pay the money to the seller, click <b>MARK AS PAID</b>.",
        "If something is wrong, click <b>REJECT</b> and write the reason."
    ]))
    story.append(status_flow(["Pending", "Approved", "Paid"]))
    story.append(PageBreak())

    # ===== 7. QC =====
    story.append(section_header("7. Goods came in — Quality Check (QC)"))
    story.append(role_badge_row("Store Manager / QC team"))
    story.append(Spacer(1, 6))
    story.append(para(
        "When a truck comes with the material, the Store Manager creates "
        "an <b>Inspection Request</b>. The QC team then checks if the "
        "material is good or bad."
    ))

    story.append(heading3("Step A — Store Manager creates inspection:"))
    story.append(step_list([
        "Click <b>QC Inspections</b> on the left.",
        "Click <b>+ NEW INSPECTION</b>.",
        "Pick the Purchase Order from the list.",
        "Type the <b>Invoice Number</b> from the seller.",
        "Type the <b>DC Number</b> (Delivery Challan).",
        "Pick the <b>Material Receipt Date</b> (today's date).",
        "Click <b>SAVE</b>. The QC team will see this in their list."
    ]))

    story.append(heading3("Step B — QC team checks the material:"))
    story.append(step_list([
        "Click <b>QC Inspections</b>.",
        "Click on the new inspection (it shows \"Pending\").",
        "Check the <b>Packing</b> — is the box damaged? Yes or No.",
        "Check the <b>Batch Number</b> printed on the box.",
        "Check the <b>Expiry Date</b> if it is a chemical.",
        "Count the items: <b>Received</b>, <b>Accepted</b>, <b>Rejected</b>.",
        "If something is bad, write the reason in the <b>Defect</b> box.",
        "Click one of: <b>PASS</b>, <b>FAIL</b>, or <b>PARTIAL</b>.",
        "Click <b>SAVE</b>."
    ]))
    story.append(note_box(
        "If you click FAIL, the material will go back to the seller. "
        "Be very sure before clicking FAIL."
    ))
    story.append(status_flow(["Pending", "Pass / Fail", "Done"]))
    story.append(PageBreak())

    # ===== 8. INWARD =====
    story.append(section_header("8. Putting goods in store — Inward Entry (MIV)"))
    story.append(role_badge_row("Store Manager"))
    story.append(Spacer(1, 6))
    story.append(para(
        "After QC says PASS, the Store Manager puts the material in the store. "
        "This is called <b>Inward Entry</b>. The system makes a paper called "
        "<b>MIV</b> (Material Inward Voucher). Keep this paper in the file."
    ))
    story.append(heading3("Steps (with PO):"))
    story.append(step_list([
        "Click <b>Inward Entry</b> on the left.",
        "Click <b>+ NEW INWARD</b>.",
        "Choose <b>From Purchase Order</b>.",
        "Pick the QC-passed order from the list.",
        "Type the <b>Batch Number</b> for each item.",
        "Check the quantity. Change it if it is different.",
        "Pick the <b>Warehouse</b> (where you will keep the material).",
        "Click <b>SAVE</b>.",
        "The system gives you a <b>MIV Number</b>. Note it down.",
        "Click <b>DOWNLOAD MIV</b> to print the paper."
    ]))

    story.append(heading3("Direct Inward (no PO — emergency only):"))
    story.append(step_list([
        "Click <b>+ NEW INWARD</b>, choose <b>Direct Entry</b>.",
        "Type the seller name, invoice number, and item details.",
        "Click <b>SAVE</b>."
    ]))
    story.append(note_box(
        "Always type the correct Batch Number. "
        "We use it later to find which lot the material came from. "
        "Wrong batch number is a big problem."
    ))
    story.append(PageBreak())

    # ===== 9. MATERIAL REQUEST =====
    story.append(section_header("9. Asking for material from store — Material Request"))
    story.append(role_badge_row("Manager / Lab / any staff"))
    story.append(Spacer(1, 6))
    story.append(para(
        "When you need material from the store (for production, lab, or any work), "
        "you make a <b>Material Request</b>. The Store Manager will give it to you."
    ))
    story.append(heading3("Steps:"))
    story.append(step_list([
        "Click <b>My Requests</b> on the left.",
        "Click <b>+ NEW REQUEST</b>.",
        "In the search box, type the product name.",
        "Click on the product. Type the <b>Quantity</b> you need.",
        "Add more products the same way.",
        "Type the <b>Purpose</b> (example: \"For production batch 23\").",
        "Click <b>SUBMIT</b>.",
        "Now go to the Store and wait for the Store Manager to approve."
    ]))
    story.append(heading3("After approval — collect material:"))
    story.append(step_list([
        "Open <b>My Requests</b> and click on your request.",
        "If status is <b>Approved</b>, go to the store.",
        "Take the material. Then click <b>MARK AS COLLECTED</b>.",
        "If you take only part of it, click <b>PARTIAL COLLECT</b>."
    ]))
    story.append(PageBreak())

    # ===== 10. CLEARANCE =====
    story.append(section_header("10. Giving material from store — Clearance"))
    story.append(role_badge_row("Store Manager"))
    story.append(Spacer(1, 6))
    story.append(para(
        "When staff ask for material, the Store Manager checks the stock "
        "and gives the material. This is called <b>Clearance</b>."
    ))
    story.append(heading3("Steps:"))
    story.append(step_list([
        "Click <b>Request Clearance</b> on the left.",
        "You will see all material requests waiting.",
        "Click on one to open it.",
        "Type the <b>MIR Number</b> (Material Issue Receipt).",
        "Type the <b>Issue Number</b> and pick today's date.",
        "For each item, type the <b>Approved Quantity</b>.",
        "Type the <b>Batch Number</b> you are giving (FIFO — older batch first).",
        "Click <b>APPROVE</b> to give all.",
        "Click <b>PARTIAL</b> if you can give only some.",
        "Click <b>REJECT</b> with a reason if you cannot give."
    ]))
    story.append(note_box(
        "Always give the OLDER batch first. This is called FIFO "
        "(First In, First Out). New batch should not go out before old batch."
    ))
    story.append(PageBreak())

    # ===== 11. GATE PASS =====
    story.append(section_header("11. Sending material out — Gate Pass"))
    story.append(role_badge_row("Store Manager"))
    story.append(Spacer(1, 6))
    story.append(para(
        "When any item leaves the company gate, you must make a <b>Gate Pass</b>. "
        "Without a gate pass, the security guard will not let the truck go."
    ))
    story.append(heading3("Three types of Gate Pass:"))
    story.append(bullet_list([
        "<b>Returnable</b> — item will come back (example: tools sent for repair).",
        "<b>Non-Returnable</b> — item will not come back (example: scrap, gift).",
        "<b>Delivery Challan</b> — finished goods going to a customer."
    ]))
    story.append(heading3("Steps:"))
    story.append(step_list([
        "Click <b>Gate Pass</b> on the left.",
        "Click <b>+ NEW GATE PASS</b>.",
        "Pick the <b>Type</b> (Returnable / Non-Returnable / Delivery Challan).",
        "Type the <b>Vendor or Customer Name</b>.",
        "Type the <b>Vehicle Number</b> of the truck.",
        "Type the <b>Invoice Number</b> or DC Number.",
        "Click <b>+ ADD ITEM</b> and fill the description, quantity, and unit.",
        "If <b>Returnable</b>, pick the date when the item must come back.",
        "Click <b>SAVE</b>.",
        "Click <b>PRINT</b>. Give the printed paper to the security guard."
    ]))
    story.append(heading3("When the item comes back:"))
    story.append(step_list([
        "Open the gate pass.",
        "Click <b>MARK AS RETURNED</b>.",
        "Type the <b>Return Date</b>."
    ]))
    story.append(PageBreak())

    # ===== 12. INVENTORY TRANSFER =====
    story.append(section_header("12. Moving stock to other unit — Inventory Transfer"))
    story.append(role_badge_row("Manager (sending) / Manager (receiving)"))
    story.append(Spacer(1, 6))
    story.append(para(
        "If our company has more than one unit (Unit 1, Unit 2), and stock "
        "must move from one to the other, we use <b>Inventory Transfer</b>."
    ))
    story.append(heading3("Steps to ASK for transfer:"))
    story.append(step_list([
        "Click <b>Inventory Transfers</b> on the left.",
        "Click <b>+ NEW TRANSFER</b>.",
        "Pick the <b>From Unit</b> (where stock is now).",
        "Pick the <b>To Unit</b> (where stock should go).",
        "Pick the <b>Product</b> and type the <b>Quantity</b>.",
        "Type the <b>Reason</b> (why you need it).",
        "Click <b>SUBMIT</b>."
    ]))
    story.append(heading3("Source Unit Manager — Approve:"))
    story.append(step_list([
        "Open <b>Inventory Transfers</b>.",
        "Find requests with status <b>Pending</b>.",
        "Click on the request.",
        "Click <b>APPROVE</b> to send the stock.",
        "Click <b>REJECT</b> if you cannot send (write a reason)."
    ]))
    story.append(status_flow(["Pending", "Approved", "Transferred"]))
    story.append(PageBreak())

    # ===== 13. ION =====
    story.append(section_header("13. Lab work — Inter-Office Note (ION)"))
    story.append(role_badge_row("Manager (sends) / Lab (does the work)"))
    story.append(Spacer(1, 6))
    story.append(para(
        "When a manager wants the lab to test something, they send an "
        "<b>Inter-Office Note (ION)</b>. The lab gets it, does the work, "
        "and gives the report back."
    ))
    story.append(heading3("Manager — Send the ION:"))
    story.append(step_list([
        "Click <b>Inter-Office Note</b> on the left.",
        "Click <b>+ NEW ION</b>.",
        "Type the <b>Project Name</b>.",
        "Type the <b>Sample Details</b> (what to test).",
        "Pick the <b>Material Supply Date</b> (when you give the sample to lab).",
        "Pick the <b>Required Date</b> (when you want the report).",
        "Click <b>SEND TO LAB</b>."
    ]))
    story.append(heading3("Lab — Do the work:"))
    story.append(step_list([
        "Click <b>Inter-Office Note</b>.",
        "You will see the new ION with status <b>Sent</b>.",
        "Click <b>ACCEPT</b>. Status becomes <b>Waiting</b>.",
        "Do the lab test.",
        "When the report is ready, click <b>MARK AS COLLECTED</b>."
    ]))
    story.append(status_flow(["Sent", "Waiting", "Collected"]))
    story.append(PageBreak())

    # ===== 14. SALES =====
    story.append(section_header("14. Selling to customer — Sale Order & Invoice"))
    story.append(role_badge_row("Sales / Admin"))
    story.append(Spacer(1, 6))
    story.append(para(
        "When a customer wants to buy from us, we make a <b>Sale Order</b>. "
        "After we send the goods, we make an <b>Invoice</b> (the bill)."
    ))

    story.append(heading3("Make a Sale Order:"))
    story.append(step_list([
        "Click <b>Sale Orders</b> on the left.",
        "Click <b>+ NEW SALE ORDER</b>.",
        "Pick the <b>Customer</b> from the list.",
        "Add the products one by one with quantity and price.",
        "Type the <b>Delivery Date</b>.",
        "Click <b>SAVE</b>."
    ]))

    story.append(heading3("Make an Invoice:"))
    story.append(step_list([
        "Click <b>Invoices</b> on the left.",
        "Click <b>+ NEW INVOICE</b>.",
        "Pick the Sale Order it is for.",
        "Check the items and amount.",
        "Click <b>SAVE</b>.",
        "Click <b>DOWNLOAD PDF</b> to print and send to the customer."
    ]))

    story.append(heading3("Send goods to the customer:"))
    story.append(step_list([
        "Make a <b>Delivery Challan Gate Pass</b> (see chapter 11).",
        "Give it to the truck driver and the security guard.",
        "Once the customer receives, mark the sale order as <b>Delivered</b>."
    ]))
    story.append(PageBreak())

    # ===== 15. GLOSSARY =====
    story.append(section_header("15. Words you will see often"))
    glossary = [
        ["Word", "Means"],
        ["PR", "Purchase Request — paper to ask for buying."],
        ["PO", "Purchase Order — paper to tell seller to send goods."],
        ["MIV", "Material Inward Voucher — paper for goods coming in store."],
        ["MIR", "Material Issue Receipt — paper for goods going out to staff."],
        ["DC", "Delivery Challan — paper that comes with the truck."],
        ["QC", "Quality Check — testing if material is good or bad."],
        ["ION", "Inter-Office Note — paper to send lab work."],
        ["FIFO", "First In First Out — give old stock first, new stock later."],
        ["Batch", "A group of items made at the same time."],
        ["Pending", "Waiting for someone to do something."],
        ["Approved", "Yes — boss said okay. Go ahead."],
        ["Rejected", "No — boss said do not do it. See the reason."],
        ["Quotation", "Price paper from the seller."],
        ["Vendor", "Seller — the person/company we buy from."],
        ["Customer", "The person/company we sell to."],
        ["Gate Pass", "Paper to take any item out of the company gate."],
        ["Stock Transfer", "Moving stock from one unit to another unit."],
        ["Dashboard", "Home page — shows the main numbers."],
        ["Notification", "A bell sound message — someone wants something from you."],
    ]
    g_table = Table(glossary, colWidths=[3.5 * cm, 12.5 * cm])
    g_table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), BLUE),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, -1), 11),
        ("FONTNAME", (0, 1), (0, -1), "Helvetica-Bold"),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
        ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, LIGHT_BLUE]),
        ("GRID", (0, 0), (-1, -1), 0.5, colors.lightgrey),
    ]))
    story.append(g_table)

    # ===== END =====
    story.append(Spacer(1, 1.5 * cm))
    story.append(Paragraph(
        "<b>Need help? Talk to your Manager or call the Admin.</b>",
        ParagraphStyle("End", fontName="Helvetica-Bold", fontSize=14,
                       leading=20, alignment=TA_CENTER, textColor=ORANGE)
    ))
    story.append(Spacer(1, 0.6 * cm))
    story.append(Paragraph(
        "Always log out before you leave the computer. "
        "Never share your password.",
        ParagraphStyle("End2", fontName="Helvetica", fontSize=12,
                       leading=18, alignment=TA_CENTER, textColor=GRAY)
    ))

    doc.build(story, onFirstPage=on_page, onLaterPages=on_page)
    print(f"PDF created: {OUT}")


if __name__ == "__main__":
    build()
