"""Read an order form into a `Contract`: PDF text, one Claude call, then the code gate.

Claude sees the document's extracted text, not the file, so the gate can check every
clause against exactly what the model read. A scanned PDF with no text layer is refused
rather than guessed at.
"""

import io
from dataclasses import dataclass
from pathlib import Path

from pypdf import PdfReader

from recoup.domain.vendors import VendorDirectory
from recoup.extract.claude import ClaudeStructured
from recoup.extract.contract_gate import ContractVerdict, validate_contract
from recoup.extract.prompts import CONTRACT_PROMPT_VERSION, CONTRACT_SYSTEM
from recoup.extract.schema import ContractReading

MAX_DOCUMENT_CHARS = 120_000
MAX_PAGES = 60


class ContractReadError(Exception):
    """A document Recoup cannot read. The message is safe to show a person."""


SUPPORTED_SUFFIXES = (".pdf", ".txt", ".md")


def document_text(path: Path) -> str:
    """The text of a PDF, or of a .txt/.md file, capped in length."""
    return read_document(path.name, path.read_bytes())


def _pdf_text(name: str, data: bytes) -> str:
    try:
        reader = PdfReader(io.BytesIO(data))
        page_count = len(reader.pages)
        pages = [] if page_count > MAX_PAGES else [p.extract_text() or "" for p in reader.pages]
    # pypdf raises many types on malformed or encrypted files; any of them means unreadable.
    except Exception as exc:
        raise ContractReadError(f"Could not read {name} as a PDF.") from exc
    if page_count > MAX_PAGES:
        raise ContractReadError(f"{name} has over {MAX_PAGES} pages.")
    return "\n".join(pages)


def read_document(name: str, data: bytes) -> str:
    """The text of an uploaded PDF, .txt or .md file, capped in length."""
    suffix = Path(name).suffix.lower()
    if suffix in (".txt", ".md"):
        text = data.decode(errors="replace")
    elif suffix == ".pdf":
        text = _pdf_text(name, data)
    else:
        raise ContractReadError("Contracts must be .pdf, .txt, or .md files.")
    if not text.strip():
        raise ContractReadError(f"{name} has no text layer; scanned PDFs are not supported.")
    return text[:MAX_DOCUMENT_CHARS]


def render_document(name: str, text: str) -> str:
    return f'<document name="{name}">\n{text}\n</document>'


@dataclass
class ClaudeContractReader:
    llm: ClaudeStructured

    @property
    def name(self) -> str:
        return f"claude:{self.llm.model}:{CONTRACT_PROMPT_VERSION}"

    def read(self, name: str, text: str) -> ContractReading:
        return self.llm.parse(CONTRACT_SYSTEM, render_document(name, text), ContractReading)


def read_contract(
    reader: ClaudeContractReader, path: Path, vendors: VendorDirectory
) -> ContractVerdict:
    """Raises ContractReadError for an unreadable file and LlmError for an unusable answer."""
    return read_contract_bytes(reader, path.name, path.read_bytes(), vendors)


def read_contract_bytes(
    reader: ClaudeContractReader, name: str, data: bytes, vendors: VendorDirectory
) -> ContractVerdict:
    text = read_document(name, data)
    reading = reader.read(name, text)
    return validate_contract(reading, text, vendors, document=name)
