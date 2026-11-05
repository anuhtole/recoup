"""Read an order form into a `Contract`: PDF text, one Claude call, then the code gate.

Claude sees the document's extracted text, not the file, so the gate can check every
clause against exactly what the model read. A scanned PDF with no text layer is refused
rather than guessed at.
"""

import json
from dataclasses import dataclass
from pathlib import Path

from pydantic import TypeAdapter
from pypdf import PdfReader
from pypdf.errors import PdfReadError

from recoup.domain.sources import Contract
from recoup.domain.vendors import VendorDirectory
from recoup.extract.claude import ClaudeStructured
from recoup.extract.contract_gate import ContractVerdict, validate_contract
from recoup.extract.prompts import CONTRACT_PROMPT_VERSION, CONTRACT_SYSTEM
from recoup.extract.schema import ContractReading

MAX_DOCUMENT_CHARS = 120_000
MAX_PAGES = 60
_CONTRACTS = TypeAdapter(list[Contract])


class ContractReadError(Exception):
    """A document Recoup cannot read. The message is safe to show a person."""


def document_text(path: Path) -> str:
    """The text of a PDF, or of a .txt/.md file, capped in length."""
    if path.suffix.lower() in (".txt", ".md"):
        text = path.read_text(errors="replace")
    elif path.suffix.lower() == ".pdf":
        try:
            reader = PdfReader(path)
            if len(reader.pages) > MAX_PAGES:
                raise ContractReadError(f"{path.name} has over {MAX_PAGES} pages.")
            text = "\n".join(page.extract_text() or "" for page in reader.pages)
        except (PdfReadError, OSError, ValueError) as exc:
            raise ContractReadError(f"Could not read {path.name} as a PDF.") from exc
    else:
        raise ContractReadError("Contracts must be .pdf, .txt, or .md files.")
    if not text.strip():
        raise ContractReadError(f"{path.name} has no text layer; scanned PDFs are not supported.")
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
    text = document_text(path)
    reading = reader.read(path.name, text)
    return validate_contract(reading, text, vendors, document=path.name)


def save_contract(contracts_file: Path, contract: Contract) -> bool:
    """Add or replace the contract for this vendor and plan. True if one was replaced."""
    existing = (
        _CONTRACTS.validate_json(contracts_file.read_bytes()) if contracts_file.exists() else []
    )
    same = (contract.vendor_key, contract.plan)
    kept = [c for c in existing if (c.vendor_key, c.plan) != same]
    rows = [c.model_dump(mode="json") for c in (*kept, contract)]
    contracts_file.write_text(json.dumps(rows, indent=2) + "\n")
    return len(kept) < len(existing)
