"""Help a person fill in setup from what Recoup already has: vendor suggestions from
the ledger, and contract terms read from an uploaded document.

Nothing here saves. Each result is shown for a person to confirm, and the confirmed
version goes through PUT /api/vendors or POST /api/contracts.
"""

import base64
import binascii
from dataclasses import asdict
from typing import Any

from anthropic import APIError
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from recoup.api.deps import ContextDep, SessionDep
from recoup.extract.claude import LlmError
from recoup.extract.contract_reader import (
    ClaudeContractReader,
    ContractReadError,
    read_contract_bytes,
)
from recoup.ingest.discovery import suggest_vendors

router = APIRouter(prefix="/api")
MAX_CONTRACT_BYTES = 10_000_000


class DocumentIn(BaseModel):
    filename: str = Field(min_length=1, max_length=200)
    # Base64, so a PDF fits in a JSON body; ~4/3 the file's size.
    data_base64: str = Field(min_length=1, max_length=MAX_CONTRACT_BYTES * 4 // 3 + 4)


@router.get("/vendors/suggestions")
def vendor_suggestions(session: SessionDep, context: ContextDep) -> list[dict[str, Any]]:
    return [asdict(s) for s in suggest_vendors(session, context.sources_for(session).vendors)]


@router.post("/contracts/read")
def read_uploaded_contract(
    body: DocumentIn, session: SessionDep, context: ContextDep
) -> dict[str, Any]:
    llm = context.services.llm
    if llm is None:
        raise HTTPException(
            status_code=409, detail="Reading contracts needs ANTHROPIC_API_KEY on the server."
        )
    try:
        data = base64.b64decode(body.data_base64, validate=True)
    except binascii.Error as exc:
        raise HTTPException(status_code=422, detail="The file did not upload cleanly.") from exc
    vendors = context.sources_for(session).vendors
    try:
        verdict = read_contract_bytes(ClaudeContractReader(llm), body.filename, data, vendors)
    except ContractReadError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except LlmError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except APIError as exc:
        raise HTTPException(
            status_code=502, detail="Claude could not be reached. Try again shortly."
        ) from exc
    contract = verdict.contract.model_dump(mode="json") if verdict.contract else None
    return {"contract": contract, "problems": list(verdict.problems)}
