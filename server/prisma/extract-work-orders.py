#!/usr/bin/env python3
"""
Extract Work Order data from the Cash Flow workbook into a clean JSON file
that import-work-orders.js loads into the ERP database.

Source : "Cash FLow - V1 01-06-26.xlsx", sheet "orders 26-27 "
Output : work-orders-import.json (next to this script)

Sheet columns:
  A Party Name   -> customerName
  B Order No     -> supplyOrderNo (rows sharing one Order No = one Work Order)
  C Date         -> supplyOrderDate
  D Description  -> WorkOrderItem.description (one item per row)
  E QTY          -> WorkOrderItem.quantity
  H Qty Billed   -> seeds deliveredQty / invoicedQty (in-progress)
  J PDC          -> pdcDate  (rows without a real date are SKIPPED)
  K Type         -> recorded in remarks
  M Unit         -> assignedUnit  (only Unit-1/1A/2/3/4/5 map; others left null)

Rules (agreed with the user):
  - Group rows by Order No -> one Work Order with multiple line items.
  - Skip any order whose PDC column has no real date (relative clauses like
    "FIM+3 Months" / blanks). 38 such line items are dropped.
  - Map factory units Unit-1, Unit-1A, Unit-2..5 to the 6 fixed DB units.
    Any other location (Adibatla, ANSP, CPDC, Design, SHAR, ...) -> "not
    provided" (assignedUnitCode = null). Ambiguous groups (2+ real units) -> null.
  - Import as IN_PROGRESS, seeding billed qty so existing progress is kept.
"""
import openpyxl
import re
import json
import datetime
import os
from collections import OrderedDict

WORKBOOK = os.environ.get(
    "CASHFLOW_XLSX",
    r"C:\Users\alaja\Downloads\Cash FLow - V1 01-06-26.xlsx",
)
SHEET = "orders 26-27 "
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "work-orders-import.json")


def s(v):
    if v is None:
        return None
    t = str(v).strip()
    return t or None


def num(v):
    if v is None or v == "":
        return 0.0
    try:
        return float(v)
    except (TypeError, ValueError):
        m = re.search(r"[-+]?\d*\.?\d+", str(v))
        return float(m.group()) if m else 0.0


def unit_code(v):
    """Map an Excel 'Unit' cell to one of the 6 fixed unit codes, else None."""
    t = s(v)
    if not t:
        return None
    m = re.match(r"^unit\s*-?\s*(\d+a?)$", t.lower())
    return m.group(1).upper() if m else None


def main():
    wb = openpyxl.load_workbook(WORKBOOK, data_only=True)
    ws = wb[SHEET]

    def cell(r, c):
        return ws.cell(row=r, column=c).value

    groups = OrderedDict()
    for r in range(3, ws.max_row + 1):  # row 2 is the header
        a, b = cell(r, 1), cell(r, 2)
        if a is None and b is None:
            continue
        key = s(b) or ("__noB_%d" % r)
        groups.setdefault(key, []).append(r)

    orders, skipped = [], []
    for key, rows in groups.items():
        pdc = next((cell(r, 10) for r in rows
                    if isinstance(cell(r, 10), (datetime.datetime, datetime.date))), None)
        if pdc is None:
            skipped.append((key, len(rows)))
            continue
        odate = next((cell(r, 3) for r in rows
                      if isinstance(cell(r, 3), (datetime.datetime, datetime.date))), None) or pdc
        party = next((s(cell(r, 1)) for r in rows if s(cell(r, 1))), None)

        codes = []
        for r in rows:
            c = unit_code(cell(r, 13))
            if c and c not in codes:
                codes.append(c)
        assigned = codes[0] if len(codes) == 1 else None  # ambiguous -> not provided

        types = []
        for r in rows:
            t = s(cell(r, 11))
            if t and t != "NA" and t not in types:
                types.append(t)

        items, qty_total, billed_total = [], 0.0, 0.0
        for i, r in enumerate(rows, 1):
            q = num(cell(r, 5))
            items.append({
                "lineNo": i,
                "description": s(cell(r, 4)) or "Material",
                "quantity": q,
                "uom": "Nos",
            })
            qty_total += q
            billed_total += num(cell(r, 8))
        billed_total = min(billed_total, qty_total)

        remark = []
        if types:
            remark.append("Type of Order: " + "/".join(types))
        remark.append("Imported from Cash Flow sheet (01-06-26).")

        orders.append({
            "supplyOrderNo": key,
            "supplyOrderDate": odate.date().isoformat(),
            "pdcDate": pdc.date().isoformat(),
            "customerName": party or "Not Provided",
            "nomenclature": (items[0]["description"][:120] if items else None),
            "assignedUnitCode": assigned,
            "orderQuantity": round(qty_total, 4),
            "billedQty": round(billed_total, 4),
            "deliveryStatus": "PARTIAL" if billed_total > 0 else "IN_PROGRESS",
            "status": "IN_PROGRESS",
            "remarks": " | ".join(remark),
            "items": items,
        })

    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(orders, f, indent=2, ensure_ascii=False)

    assigned_n = sum(1 for o in orders if o["assignedUnitCode"])
    print("Orders to import      :", len(orders))
    print("Line items            :", sum(len(o["items"]) for o in orders))
    print("Unit assigned         :", assigned_n)
    print("Unit not provided     :", len(orders) - assigned_n)
    print("Skipped (no real PDC) :", len(skipped), "orders /",
          sum(n for _, n in skipped), "line items")
    print("Written               :", OUT)


if __name__ == "__main__":
    main()
