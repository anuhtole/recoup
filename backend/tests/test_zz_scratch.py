from datetime import date
from sqlalchemy import select
from recoup.db.models import *
from recoup.domain.workflow import Status
from recoup.domain.types import LeakType
from recoup.recovery.workflow import *
from recoup.recovery.drafting import TemplateDrafter
from recoup.recovery.outbox import LocalOutbox
from recoup.extract.schema import ReplyAssessment
from recoup.ingest.loader import ingest_transactions
from recoup.ingest.sources import ingest_emails
from recoup.pipeline.run import run_pipeline
from recoup.db.session import session_scope
from tests.conftest import load_and_run
from tests.factories import email, txn
AS_OF=date(2026,10,1)

def test_send_after_dismiss(session_factory, settings, services, sources):
    load_and_run(session_factory, settings, services, sources)
    with session_scope(session_factory) as s:
        row=s.scalars(select(FindingRow).where(FindingRow.status=="open", FindingRow.outcome=="recoverable")).first()
        d=create_draft(s,row,vendors=sources.vendors,drafter=TemplateDrafter(),as_of=AS_OF,card_dispute_address="x@y.z",actor="u")
        dismiss(s,row,"no",  "u", AS_OF)
        send_draft(s,d,outbox=LocalOutbox(),as_of=AS_OF,actor="u")
        print("STATUS after dismiss+send:",row.status)
        assert row.status==Status.SENT

def test_spoofed_reply(session_factory, settings, services, sources):
    load_and_run(session_factory, settings, services, sources)
    with session_scope(session_factory) as s:
        row=s.scalars(select(FindingRow).where(FindingRow.status=="open", FindingRow.outcome=="recoverable")).first()
        d=create_draft(s,row,vendors=sources.vendors,drafter=TemplateDrafter(),as_of=AS_OF,card_dispute_address="x@y.z",actor="u")
        send_draft(s,d,outbox=LocalOutbox(),as_of=AS_OF,actor="u")
        mid=d.message_id
        e=email("We are unable to refund this charge.", sender="attacker@evil.example", in_reply_to=mid, day="2026-10-02")
        ingest_emails(s,[e])
    with session_scope(session_factory) as s:
        run_pipeline(s,settings,services,sources)
        print("STATUS after spoof:",s.get(FindingRow,row.id).status)
