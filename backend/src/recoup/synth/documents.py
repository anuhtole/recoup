"""Write a one-page, text-only PDF: enough for sample order forms and tests."""

from pathlib import Path

FONT_SIZE = 10
LINE_HEIGHT = 14
TOP_MARGIN = 760
LEFT_MARGIN = 56


def _escape(line: str) -> str:
    return line.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


def text_pdf(lines: list[str]) -> bytes:
    shown = "\n".join(f"({_escape(line)}) Tj T*" for line in lines)
    stream = (
        f"BT /F1 {FONT_SIZE} Tf {LINE_HEIGHT} TL {LEFT_MARGIN} {TOP_MARGIN} Td\n{shown}\nET"
    ).encode("latin-1")
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
        b"/Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
        b"<< /Length %d >>\nstream\n%s\nendstream" % (len(stream), stream),
    ]
    out = bytearray(b"%PDF-1.4\n")
    offsets = []
    for number, body in enumerate(objects, start=1):
        offsets.append(len(out))
        out += b"%d 0 obj\n%s\nendobj\n" % (number, body)
    xref = len(out)
    out += b"xref\n0 %d\n0000000000 65535 f \n" % (len(objects) + 1)
    out += b"".join(b"%010d 00000 n \n" % offset for offset in offsets)
    out += b"trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (
        len(objects) + 1,
        xref,
    )
    return bytes(out)


def write_text_pdf(path: Path, lines: list[str]) -> None:
    path.write_bytes(text_pdf(lines))


# A fictional order form for the demo customer, matching the synthetic Linear plan.
SAMPLE_ORDER_FORM = [
    "ORDER FORM - Linear Orbit, Inc.",
    "Customer: Northwind Labs    Plan: Business    Term: 12 months",
    "",
    "1. Fees. The subscription fee is $160.00 per month, charged to the customer's card.",
    "2. Price protection. Fees will not increase before June 30, 2026.",
    "   After that date, any increase is limited to 7% per renewal.",
    "3. Availability. Linear will make the Services available 99.9% of the time in each month.",
    "4. Service credits. If monthly uptime falls below 99.9%, the customer receives a credit",
    "   of 10% of that month's fee; below 99.0%, a credit of 25%.",
    "5. Claims. Credits must be requested within 30 days after the end of the affected month.",
]
