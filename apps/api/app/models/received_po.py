import uuid

from sqlalchemy import DateTime, ForeignKey, Integer, Numeric, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, utcnow


class ReceivedPO(Base):
    __tablename__ = 'received_pos'

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    company_id: Mapped[str] = mapped_column(String(36), ForeignKey('companies.id', ondelete='CASCADE'), index=True)
    file_url: Mapped[str] = mapped_column(String(512), nullable=False)
    po_number: Mapped[str | None] = mapped_column(String(128), index=True, nullable=True)
    po_date: Mapped[DateTime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    distributor: Mapped[str] = mapped_column(String(128), default='Styli', nullable=False)
    status: Mapped[str] = mapped_column(String(32), default='uploaded', index=True, nullable=False)
    raw_extracted_json: Mapped[str] = mapped_column(Text, default='{}', nullable=False)
    auto_resolve_rate: Mapped[float | None] = mapped_column(Numeric(5, 2), nullable=True)
    exception_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    review_required_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    created_at: Mapped[DateTime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at: Mapped[DateTime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False
    )

    items: Mapped[list['ReceivedPOLineItem']] = relationship(
        'ReceivedPOLineItem',
        back_populates='received_po',
        cascade='all, delete-orphan',
    )
    agent_events: Mapped[list['ReceivedPOAgentEvent']] = relationship(
        'ReceivedPOAgentEvent',
        back_populates='received_po',
        cascade='all, delete-orphan',
    )


class ReceivedPOAgentEvent(Base):
    __tablename__ = 'received_po_agent_events'

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    received_po_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey('received_pos.id', ondelete='CASCADE'),
        index=True,
    )
    company_id: Mapped[str] = mapped_column(String(36), ForeignKey('companies.id', ondelete='CASCADE'), index=True)
    event_type: Mapped[str] = mapped_column(String(64), index=True, nullable=False)
    title: Mapped[str] = mapped_column(String(160), nullable=False)
    summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(32), default='completed', index=True, nullable=False)
    actor_type: Mapped[str] = mapped_column(String(32), default='agent', index=True, nullable=False)
    tool_name: Mapped[str | None] = mapped_column(String(96), nullable=True)
    metadata_json: Mapped[str] = mapped_column(Text, default='{}', nullable=False)
    created_at: Mapped[DateTime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)

    received_po: Mapped['ReceivedPO'] = relationship('ReceivedPO', back_populates='agent_events')


class ReceivedPOLineItem(Base):
    __tablename__ = 'received_po_line_items'

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    received_po_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey('received_pos.id', ondelete='CASCADE'),
        index=True,
    )
    brand_style_code: Mapped[str] = mapped_column(String(128), index=True, nullable=False)
    styli_style_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    model_number: Mapped[str | None] = mapped_column(String(128), nullable=True)
    option_id: Mapped[str | None] = mapped_column(String(128), nullable=True, index=True)
    sku_id: Mapped[str] = mapped_column(String(160), index=True, nullable=False)
    color: Mapped[str | None] = mapped_column(String(128), nullable=True)
    knitted_woven: Mapped[str | None] = mapped_column(String(64), nullable=True)
    size: Mapped[str | None] = mapped_column(String(32), nullable=True, index=True)
    quantity: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    po_price: Mapped[float | None] = mapped_column(Numeric(10, 2), nullable=True)
    confidence_score: Mapped[float | None] = mapped_column(Numeric(5, 2), nullable=True)
    resolution_status: Mapped[str] = mapped_column(String(32), default='needs_review', index=True, nullable=False)
    exception_reason: Mapped[str | None] = mapped_column(String(255), nullable=True)
    suggested_fix_json: Mapped[str] = mapped_column(Text, default='{}', nullable=False)
    created_at: Mapped[DateTime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at: Mapped[DateTime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False
    )

    received_po: Mapped['ReceivedPO'] = relationship('ReceivedPO', back_populates='items')
