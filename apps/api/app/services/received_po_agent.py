import json
from uuid import uuid4

from sqlalchemy.orm import Session

from app.models.received_po import ReceivedPO, ReceivedPOAgentEvent

ACTOR_AGENT = 'agent'
ACTOR_HUMAN = 'human'
ACTOR_SYSTEM = 'system'

STATUS_COMPLETED = 'completed'
STATUS_FAILED = 'failed'
STATUS_NEEDS_REVIEW = 'needs_review'
STATUS_QUEUED = 'queued'
STATUS_RUNNING = 'running'


def _json_dumps(payload: dict[str, object]) -> str:
    return json.dumps(payload, separators=(',', ':'))


def log_received_po_agent_event(
    db: Session,
    record: ReceivedPO,
    *,
    event_type: str,
    title: str,
    summary: str | None = None,
    status: str = STATUS_COMPLETED,
    actor_type: str = ACTOR_AGENT,
    tool_name: str | None = None,
    metadata: dict[str, object] | None = None,
) -> ReceivedPOAgentEvent:
    event = ReceivedPOAgentEvent(
        id=str(uuid4()),
        received_po_id=record.id,
        company_id=record.company_id,
        event_type=event_type,
        title=title,
        summary=summary,
        status=status,
        actor_type=actor_type,
        tool_name=tool_name,
        metadata_json=_json_dumps(metadata or {}),
    )
    db.add(event)
    db.flush()
    return event
