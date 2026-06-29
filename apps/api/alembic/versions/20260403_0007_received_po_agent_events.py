"""Add received PO agent timeline events.

Revision ID: 20260403_0007
Revises: 20260402_0006
Create Date: 2026-04-03 09:00:00
"""

from __future__ import annotations

from collections.abc import Iterable

import sqlalchemy as sa
from sqlalchemy import inspect

from alembic import op

revision = '20260403_0007'
down_revision = '20260402_0006'
branch_labels = None
depends_on = None


def _table_names() -> set[str]:
    bind = op.get_bind()
    return set(inspect(bind).get_table_names())


def _index_names(table_name: str) -> set[str]:
    bind = op.get_bind()
    return {index['name'] for index in inspect(bind).get_indexes(table_name)}


def _create_index_if_missing(index_name: str, table_name: str, columns: Iterable[str]) -> None:
    if table_name not in _table_names():
        return
    if index_name in _index_names(table_name):
        return
    op.create_index(index_name, table_name, list(columns), unique=False)


def upgrade() -> None:
    if 'received_po_agent_events' not in _table_names():
        op.create_table(
            'received_po_agent_events',
            sa.Column('id', sa.String(length=36), nullable=False),
            sa.Column('received_po_id', sa.String(length=36), nullable=False),
            sa.Column('company_id', sa.String(length=36), nullable=False),
            sa.Column('event_type', sa.String(length=64), nullable=False),
            sa.Column('title', sa.String(length=160), nullable=False),
            sa.Column('summary', sa.Text(), nullable=True),
            sa.Column('status', sa.String(length=32), nullable=False, server_default='completed'),
            sa.Column('actor_type', sa.String(length=32), nullable=False, server_default='agent'),
            sa.Column('tool_name', sa.String(length=96), nullable=True),
            sa.Column('metadata_json', sa.Text(), nullable=False, server_default='{}'),
            sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
            sa.ForeignKeyConstraint(['company_id'], ['companies.id'], ondelete='CASCADE'),
            sa.ForeignKeyConstraint(['received_po_id'], ['received_pos.id'], ondelete='CASCADE'),
            sa.PrimaryKeyConstraint('id'),
        )

    _create_index_if_missing('ix_received_po_agent_events_received_po_id', 'received_po_agent_events', ['received_po_id'])
    _create_index_if_missing('ix_received_po_agent_events_company_id', 'received_po_agent_events', ['company_id'])
    _create_index_if_missing('ix_received_po_agent_events_event_type', 'received_po_agent_events', ['event_type'])
    _create_index_if_missing('ix_received_po_agent_events_status', 'received_po_agent_events', ['status'])
    _create_index_if_missing('ix_received_po_agent_events_actor_type', 'received_po_agent_events', ['actor_type'])


def downgrade() -> None:
    pass
