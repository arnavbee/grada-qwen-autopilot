from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.sticker_template import StickerTemplateKind

ReceivedPOStatus = Literal['uploaded', 'parsing', 'parsed', 'confirmed', 'failed']
BarcodeJobStatus = Literal['pending', 'generating', 'done', 'failed']
ReceivedPOExceptionStatus = Literal['auto_resolved', 'needs_review', 'human_corrected']
ReceivedPOAgentEventStatus = Literal['queued', 'running', 'needs_review', 'completed', 'failed']
ReceivedPOAgentActorType = Literal['agent', 'human', 'system']


class ReceivedPOAgentEventResponse(BaseModel):
    id: str
    received_po_id: str
    event_type: str
    title: str
    summary: str | None = None
    status: ReceivedPOAgentEventStatus
    actor_type: ReceivedPOAgentActorType
    tool_name: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime


class ReceivedPOAgentTimelineResponse(BaseModel):
    received_po_id: str
    items: list[ReceivedPOAgentEventResponse] = Field(default_factory=list)


class ReceivedPOLineItemBase(BaseModel):
    brand_style_code: str = Field(min_length=1, max_length=128)
    styli_style_id: str | None = Field(default=None, max_length=128)
    model_number: str | None = Field(default=None, max_length=128)
    option_id: str | None = Field(default=None, max_length=128)
    sku_id: str = Field(min_length=1, max_length=160)
    color: str | None = Field(default=None, max_length=128)
    knitted_woven: str | None = Field(default=None, max_length=64)
    size: str | None = Field(default=None, max_length=32)
    quantity: int = Field(ge=0)
    po_price: float | None = Field(default=None, ge=0)


class ReceivedPOLineItemUpdate(ReceivedPOLineItemBase):
    id: str


class ReceivedPOLineItemBatchUpdate(BaseModel):
    items: list[ReceivedPOLineItemUpdate] = Field(min_length=1)


class ReceivedPOLineItemResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    received_po_id: str
    brand_style_code: str
    styli_style_id: str | None
    model_number: str | None
    option_id: str | None
    sku_id: str
    color: str | None
    knitted_woven: str | None
    size: str | None
    quantity: int
    po_price: float | None
    confidence_score: float | None = None
    resolution_status: ReceivedPOExceptionStatus
    exception_reason: str | None = None
    suggested_fix: dict[str, Any] = Field(default_factory=dict, validation_alias='suggested_fix_json')
    created_at: datetime
    updated_at: datetime


class ReceivedPOHeaderUpdate(BaseModel):
    po_number: str | None = Field(default=None, max_length=128)
    po_date: datetime | None = None
    distributor: str | None = Field(default=None, max_length=128)


class ReceivedPOUploadResponse(BaseModel):
    received_po_id: str
    status: ReceivedPOStatus


class ReceivedPOConfirmResponse(BaseModel):
    id: str
    status: ReceivedPOStatus


class BarcodeJobCreateResponse(BaseModel):
    job_id: str
    status: BarcodeJobStatus
    marketplace_template_id: str | None = None
    marketplace_template_name: str | None = None


class BarcodeJobResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    received_po_id: str
    status: BarcodeJobStatus
    template_kind: StickerTemplateKind
    template_id: str | None
    marketplace_template_id: str | None = None
    marketplace_template_name: str | None = None
    file_url: str | None
    total_stickers: int
    total_pages: int
    created_at: datetime


class BarcodeJobListItemResponse(BaseModel):
    id: str
    received_po_id: str
    po_number: str | None
    template_kind: StickerTemplateKind
    template_id: str | None
    marketplace_template_id: str | None = None
    marketplace_template_name: str | None = None
    status: BarcodeJobStatus
    total_stickers: int
    total_pages: int
    file_url: str | None
    created_at: datetime


class BarcodeJobListResponse(BaseModel):
    items: list[BarcodeJobListItemResponse]
    total: int


class ReceivedPOListItemResponse(BaseModel):
    id: str
    po_number: str | None
    po_date: datetime | None
    distributor: str
    status: ReceivedPOStatus
    line_item_count: int
    created_at: datetime


class ReceivedPOListResponse(BaseModel):
    items: list[ReceivedPOListItemResponse]
    total: int


class ReceivedPOResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    id: str
    company_id: str
    file_url: str
    po_number: str | None
    po_date: datetime | None
    distributor: str
    status: ReceivedPOStatus
    auto_resolve_rate: float | None = None
    exception_count: int = 0
    review_required_count: int = 0
    raw_extracted: dict[str, Any] = Field(validation_alias='raw_extracted_json')
    created_at: datetime
    updated_at: datetime
    items: list[ReceivedPOLineItemResponse] = Field(default_factory=list)


class ReceivedPOExceptionsSummary(BaseModel):
    total: int = 0
    auto_resolved: int = 0
    needs_review: int = 0
    human_corrected: int = 0
    auto_resolve_rate: float = 0


class ReceivedPOExceptionsListResponse(BaseModel):
    received_po_id: str
    status: ReceivedPOStatus
    summary: ReceivedPOExceptionsSummary
    items: list[ReceivedPOLineItemResponse] = Field(default_factory=list)


class ReceivedPOExceptionResolveRequest(BaseModel):
    action: Literal['accept', 'reject']
    size: str | None = Field(default=None, max_length=32)
    color: str | None = Field(default=None, max_length=128)
    knitted_woven: str | None = Field(default=None, max_length=64)
    quantity: int | None = Field(default=None, ge=0)
    po_price: float | None = Field(default=None, ge=0)


class ReceivedPOBulkResolveRequest(BaseModel):
    min_confidence: float = Field(default=0.9, ge=0, le=1)
    only_with_suggestions: bool = True


class ReceivedPOBulkResolveResponse(BaseModel):
    received_po_id: str
    processed_count: int
    summary: ReceivedPOExceptionsSummary
    items: list[ReceivedPOLineItemResponse] = Field(default_factory=list)
