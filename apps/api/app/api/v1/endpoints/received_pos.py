import json
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

from fastapi import APIRouter, Body, Depends, File, HTTPException, Query, UploadFile, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, require_roles
from app.config.hsn_codes import get_hsn_code
from app.core.audit import log_audit
from app.db.session import get_db
from app.models.barcode_job import BarcodeJob
from app.models.buyer_document_template import BuyerDocumentTemplate
from app.models.company_settings import CompanySettings
from app.models.invoice import Invoice, InvoiceLineItem
from app.models.marketplace_document_template import MarketplaceDocumentTemplate
from app.models.packing_list import PackingList, PackingListCarton
from app.models.received_po import ReceivedPO, ReceivedPOAgentEvent, ReceivedPOLineItem
from app.models.sticker_template import StickerTemplate
from app.models.user import User
from app.schemas.invoice import (
    InvoiceCreateRequest,
    InvoiceDetails,
    InvoiceGeneratePdfResponse,
    InvoiceResponse,
    InvoiceTaxMode,
    InvoiceUpdateRequest,
)
from app.schemas.packing_list import (
    PackingListCartonResponse,
    PackingListCartonUpdateRequest,
    PackingListCreateRequest,
    PackingListCreateResponse,
    PackingListGeneratePdfRequest,
    PackingListGeneratePdfResponse,
    PackingListResponse,
)
from app.schemas.received_po import (
    BarcodeJobCreateResponse,
    ReceivedPOBulkResolveRequest,
    ReceivedPOBulkResolveResponse,
    BarcodeJobResponse,
    ReceivedPOAgentEventResponse,
    ReceivedPOAgentTimelineResponse,
    ReceivedPOConfirmResponse,
    ReceivedPOExceptionResolveRequest,
    ReceivedPOExceptionsListResponse,
    ReceivedPOExceptionsSummary,
    ReceivedPOHeaderUpdate,
    ReceivedPOListItemResponse,
    ReceivedPOListResponse,
    ReceivedPOLineItemBatchUpdate,
    ReceivedPOLineItemResponse,
    ReceivedPOResponse,
    ReceivedPOStatus,
    ReceivedPOUploadResponse,
)
from app.schemas.sticker_template import CreateBarcodeJobRequest
from app.services.buyer_document_templates import (
    BUYER_DOCUMENT_TYPE_INVOICE,
    build_template_snapshot,
    choose_matching_template,
    json_dumps,
    merge_invoice_details,
    resolve_layout_key,
)
from app.services.object_storage import get_object_storage_service
from app.services.job_queue import (
    JOB_TYPE_RECEIVED_PO_BARCODE_PDF,
    JOB_TYPE_RECEIVED_PO_INVOICE_PDF,
    JOB_TYPE_RECEIVED_PO_PACKING_LIST_PDF,
    JOB_TYPE_RECEIVED_PO_PARSE,
    enqueue_processing_job,
    is_job_worker_running,
)
from app.services.exception_resolver import (
    RESOLUTION_STATUS_AUTO_RESOLVED,
    RESOLUTION_STATUS_HUMAN_CORRECTED,
    RESOLUTION_STATUS_NEEDS_REVIEW,
    run_exception_resolution_for_received_po,
)
from app.services.marketplace_document_templates import (
    DOCUMENT_TYPE_BARCODE,
    DOCUMENT_TYPE_PACKING_LIST,
    dumps_json as template_dumps_json,
    loads_json as template_loads_json,
    normalize_marketplace_key,
)
from app.services.packing_list_service import assign_cartons_for_received_po
from app.services.received_po_agent import (
    ACTOR_AGENT,
    ACTOR_HUMAN,
    STATUS_NEEDS_REVIEW,
    STATUS_QUEUED,
    log_received_po_agent_event,
)
from app.services.received_po_parser import process_received_po_parse_job
from app.utils.amount_words import convert_to_words

router = APIRouter(prefix='/received-pos', tags=['received_pos'])
object_storage = get_object_storage_service()

UPLOAD_DIR = Path('static/uploads/received-pos')
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
ALLOWED_UPLOAD_CONTENT_TYPES = {
    'application/pdf',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
}
ALLOWED_UPLOAD_SUFFIXES = {'.pdf', '.xls', '.xlsx'}
DEFAULT_PRODUCT_DESCRIPTION = 'Women Dress'
DEFAULT_KNITTED_WOVEN = 'Woven'


def _json_loads(raw: str | None) -> dict[str, object]:
    if not raw:
        return {}
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        return {}
    return parsed if isinstance(parsed, dict) else {}


def _to_agent_event_response(event: ReceivedPOAgentEvent) -> ReceivedPOAgentEventResponse:
    return ReceivedPOAgentEventResponse(
        id=event.id,
        received_po_id=event.received_po_id,
        event_type=event.event_type,
        title=event.title,
        summary=event.summary,
        status=event.status,  # type: ignore[arg-type]
        actor_type=event.actor_type,  # type: ignore[arg-type]
        tool_name=event.tool_name,
        metadata=_json_loads(event.metadata_json),
        created_at=event.created_at,
    )


def _to_invoice_response(record: Invoice) -> InvoiceResponse:
    details = InvoiceDetails(**_json_loads(record.details_json))
    tax_mode = _resolve_invoice_tax_mode(details)
    cgst_amount = _money(sum(float(line_item.cgst_amount or 0) for line_item in record.line_items))
    sgst_amount = _money(sum(float(line_item.sgst_amount or 0) for line_item in record.line_items))
    return InvoiceResponse(
        id=record.id,
        received_po_id=record.received_po_id,
        company_id=record.company_id,
        invoice_number=record.invoice_number,
        invoice_date=record.invoice_date,
        number_of_cartons=record.number_of_cartons,
        export_mode=record.export_mode,
        gross_weight=float(record.gross_weight) if record.gross_weight is not None else None,
        total_quantity=int(record.total_quantity),
        subtotal=float(record.subtotal),
        igst_rate=float(record.igst_rate),
        igst_amount=float(record.igst_amount),
        cgst_amount=cgst_amount,
        sgst_amount=sgst_amount,
        tax_mode=tax_mode,
        total_amount=float(record.total_amount),
        total_amount_words=record.total_amount_words,
        status=record.status,
        file_url=record.file_url,
        created_at=record.created_at,
        updated_at=record.updated_at,
        buyer_template_id=record.buyer_template_id,
        buyer_template_name=record.buyer_template_name,
        layout_key=record.layout_key,
        details=details,
        line_items=record.line_items,
    )


def _to_packing_list_response(record: PackingList) -> PackingListResponse:
    return PackingListResponse(
        id=record.id,
        received_po_id=record.received_po_id,
        company_id=record.company_id,
        invoice_id=record.invoice_id,
        invoice_number=record.invoice_number,
        invoice_date=record.invoice_date,
        template_id=record.template_id,
        template_name=record.template_name,
        layout_key=record.layout_key,
        status=record.status,
        file_url=record.file_url,
        created_at=record.created_at,
        cartons=record.cartons,
    )


def _get_company_settings(db: Session, company_id: str) -> CompanySettings:
    company_settings = db.query(CompanySettings).filter(CompanySettings.company_id == company_id).first()
    if company_settings is None:
        company_settings = CompanySettings(id=str(uuid4()), company_id=company_id)
        db.add(company_settings)
        db.flush()
    return company_settings


def _get_default_igst_rate(company_settings: CompanySettings) -> float:
    settings_payload = _json_loads(company_settings.settings_json)
    brand_profile = settings_payload.get('brand_profile')
    if isinstance(brand_profile, dict):
        value = brand_profile.get('default_igst_rate')
        if isinstance(value, (int, float)):
            return float(value)
        if isinstance(value, str):
            try:
                return float(value)
            except ValueError:
                return 0.0
    return 0.0


def _brand_profile(company_settings: CompanySettings | None) -> dict[str, object]:
    settings_payload = _json_loads(company_settings.settings_json if company_settings else '{}')
    brand_profile = settings_payload.get('brand_profile')
    return brand_profile if isinstance(brand_profile, dict) else {}


def _po_builder_defaults(company_settings: CompanySettings | None) -> dict[str, object]:
    settings_payload = _json_loads(company_settings.settings_json if company_settings else '{}')
    defaults = settings_payload.get('po_builder_defaults')
    return defaults if isinstance(defaults, dict) else {}


def _company_default_invoice_details(
    company_settings: CompanySettings | None, received_po: ReceivedPO | None = None
) -> InvoiceDetails:
    profile = _brand_profile(company_settings)
    supplier_name = str(profile.get('supplier_name') or '').strip()
    address = str(profile.get('address') or '').strip()
    return InvoiceDetails(
        marketplace_name=str(received_po.distributor if received_po else '').strip(),
        supplier_name=supplier_name,
        address=address,
        gst_number=str(profile.get('gst_number') or '').strip(),
        pan_number=str(profile.get('pan_number') or '').strip(),
        fbs_name=str(profile.get('fbs_name') or supplier_name).strip(),
        vendor_company_name=str(profile.get('vendor_company_name') or supplier_name).strip(),
        supplier_city=str(profile.get('supplier_city') or '').strip(),
        supplier_state=str(profile.get('supplier_state') or '').strip(),
        supplier_pincode=str(profile.get('supplier_pincode') or '').strip(),
        delivery_from_name=str(profile.get('delivery_from_name') or supplier_name).strip(),
        delivery_from_address=str(profile.get('delivery_from_address') or address).strip(),
        delivery_from_city=str(profile.get('delivery_from_city') or '').strip(),
        delivery_from_pincode=str(profile.get('delivery_from_pincode') or '').strip(),
        origin_country=str(profile.get('origin_country') or '').strip(),
        origin_state=str(profile.get('origin_state') or '').strip(),
        origin_district=str(profile.get('origin_district') or '').strip(),
        bill_to_name=str(profile.get('bill_to_name') or '').strip(),
        bill_to_address=str(profile.get('bill_to_address') or '').strip(),
        bill_to_gst=str(profile.get('bill_to_gst') or '').strip(),
        bill_to_pan=str(profile.get('bill_to_pan') or '').strip(),
        ship_to_name=str(profile.get('ship_to_name') or '').strip(),
        ship_to_address=str(profile.get('ship_to_address') or '').strip(),
        ship_to_gst=str(profile.get('ship_to_gst') or '').strip(),
        stamp_image_url=str(profile.get('stamp_image_url') or '').strip(),
    )


def _default_invoice_details(
    company_settings: CompanySettings | None,
    received_po: ReceivedPO | None = None,
    buyer_template: BuyerDocumentTemplate | None = None,
) -> InvoiceDetails:
    company_defaults = _company_default_invoice_details(company_settings, received_po)
    return merge_invoice_details(
        company_defaults,
        template=buyer_template,
        distributor=received_po.distributor if received_po else None,
    )


def _resolve_invoice_details(
    payload_details: InvoiceDetails | None,
    company_settings: CompanySettings | None,
    received_po: ReceivedPO | None = None,
    buyer_template: BuyerDocumentTemplate | None = None,
) -> InvoiceDetails:
    company_defaults = _company_default_invoice_details(company_settings, received_po)
    return merge_invoice_details(
        company_defaults,
        template=buyer_template,
        distributor=received_po.distributor if received_po else None,
        override=payload_details,
    )


def _list_buyer_document_templates(db: Session, company_id: str) -> list[BuyerDocumentTemplate]:
    return (
        db.query(BuyerDocumentTemplate)
        .filter(
            BuyerDocumentTemplate.company_id == company_id,
            BuyerDocumentTemplate.document_type == BUYER_DOCUMENT_TYPE_INVOICE,
            BuyerDocumentTemplate.is_active.is_(True),
        )
        .order_by(BuyerDocumentTemplate.is_default.desc(), BuyerDocumentTemplate.name.asc())
        .all()
    )


def _get_buyer_document_template_by_id(
    db: Session,
    company_id: str,
    template_id: str,
) -> BuyerDocumentTemplate | None:
    return (
        db.query(BuyerDocumentTemplate)
        .filter(
            BuyerDocumentTemplate.id == template_id,
            BuyerDocumentTemplate.company_id == company_id,
            BuyerDocumentTemplate.document_type == BUYER_DOCUMENT_TYPE_INVOICE,
        )
        .first()
    )


def _resolve_buyer_document_template(
    db: Session,
    company_id: str,
    received_po: ReceivedPO,
    *,
    buyer_template_id: str | None = None,
    existing_invoice: Invoice | None = None,
) -> BuyerDocumentTemplate | None:
    if buyer_template_id:
        template = _get_buyer_document_template_by_id(db, company_id, buyer_template_id)
        if template is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='Buyer document template not found.')
        return template

    if existing_invoice and existing_invoice.buyer_template_id:
        template = _get_buyer_document_template_by_id(db, company_id, existing_invoice.buyer_template_id)
        return template

    return choose_matching_template(_list_buyer_document_templates(db, company_id), received_po.distributor)


def _apply_buyer_template_snapshot(
    invoice: Invoice,
    template: BuyerDocumentTemplate | None,
    *,
    received_po: ReceivedPO,
    resolved_details: InvoiceDetails,
) -> None:
    invoice.buyer_template_id = template.id if template else None
    invoice.buyer_template_name = template.name if template else None
    invoice.layout_key = resolve_layout_key(template)
    invoice.template_snapshot_json = json_dumps(
        build_template_snapshot(template, distributor=received_po.distributor, merged_details=resolved_details)
    )


def _list_marketplace_document_templates(
    db: Session,
    company_id: str,
    *,
    document_type: str,
) -> list[MarketplaceDocumentTemplate]:
    return (
        db.query(MarketplaceDocumentTemplate)
        .filter(
            MarketplaceDocumentTemplate.company_id == company_id,
            MarketplaceDocumentTemplate.document_type == document_type,
            MarketplaceDocumentTemplate.is_active.is_(True),
        )
        .order_by(
            MarketplaceDocumentTemplate.is_default.desc(),
            MarketplaceDocumentTemplate.updated_at.desc(),
        )
        .all()
    )


def _get_marketplace_document_template_by_id(
    db: Session,
    company_id: str,
    template_id: str,
    *,
    document_type: str,
) -> MarketplaceDocumentTemplate | None:
    return (
        db.query(MarketplaceDocumentTemplate)
        .filter(
            MarketplaceDocumentTemplate.id == template_id,
            MarketplaceDocumentTemplate.company_id == company_id,
            MarketplaceDocumentTemplate.document_type == document_type,
        )
        .first()
    )


def _choose_matching_marketplace_template(
    templates: list[MarketplaceDocumentTemplate],
    marketplace_name: str | None,
) -> MarketplaceDocumentTemplate | None:
    if not templates:
        return None
    normalized_name = ''
    if marketplace_name:
        try:
            normalized_name = normalize_marketplace_key(marketplace_name)
        except ValueError:
            normalized_name = ''
    if normalized_name:
        exact_match = next((template for template in templates if template.marketplace_key == normalized_name), None)
        if exact_match is not None:
            return exact_match
        contains_match = next(
            (
                template
                for template in templates
                if template.marketplace_key and normalized_name.find(template.marketplace_key) >= 0
            ),
            None,
        )
        if contains_match is not None:
            return contains_match
    return next((template for template in templates if template.is_default), None)


def _resolve_packing_list_template(
    db: Session,
    company_id: str,
    received_po: ReceivedPO,
    *,
    template_id: str | None = None,
    existing_packing_list: PackingList | None = None,
) -> MarketplaceDocumentTemplate | None:
    if template_id:
        template = _get_marketplace_document_template_by_id(
            db,
            company_id,
            template_id,
            document_type=DOCUMENT_TYPE_PACKING_LIST,
        )
        if template is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='Marketplace template not found.')
        return template
    if existing_packing_list and existing_packing_list.template_id:
        return _get_marketplace_document_template_by_id(
            db,
            company_id,
            existing_packing_list.template_id,
            document_type=DOCUMENT_TYPE_PACKING_LIST,
        )
    return _choose_matching_marketplace_template(
        _list_marketplace_document_templates(db, company_id, document_type=DOCUMENT_TYPE_PACKING_LIST),
        received_po.distributor,
    )


def _resolve_packing_list_layout_key(template: MarketplaceDocumentTemplate | None) -> str:
    if template is None:
        return 'default_v1'
    layout = template_loads_json(template.layout_json)
    layout_key = layout.get('layout_key')
    if isinstance(layout_key, str) and layout_key.strip():
        return layout_key.strip()
    return 'default_v1'


def _build_packing_list_template_snapshot(
    template: MarketplaceDocumentTemplate | None,
    *,
    distributor: str | None,
) -> dict[str, object]:
    if template is None:
        return {
            'template_id': None,
            'template_name': None,
            'marketplace_key': None,
            'document_type': DOCUMENT_TYPE_PACKING_LIST,
            'layout_key': 'default_v1',
            'layout': {},
            'matched_from_distributor': distributor,
        }
    return {
        'template_id': template.id,
        'template_name': template.name,
        'marketplace_key': template.marketplace_key,
        'document_type': template.document_type,
        'layout_key': _resolve_packing_list_layout_key(template),
        'layout': template_loads_json(template.layout_json),
        'matched_from_distributor': distributor,
    }


def _apply_packing_list_template_snapshot(
    packing_list: PackingList,
    template: MarketplaceDocumentTemplate | None,
    *,
    distributor: str | None,
) -> None:
    packing_list.template_id = template.id if template else None
    packing_list.template_name = template.name if template else None
    packing_list.layout_key = _resolve_packing_list_layout_key(template)
    packing_list.template_snapshot_json = template_dumps_json(
        _build_packing_list_template_snapshot(template, distributor=distributor)
    )


def _resolve_barcode_marketplace_template(
    db: Session,
    company_id: str,
    received_po: ReceivedPO,
    *,
    template_id: str | None = None,
) -> MarketplaceDocumentTemplate | None:
    if template_id:
        template = _get_marketplace_document_template_by_id(
            db,
            company_id,
            template_id,
            document_type=DOCUMENT_TYPE_BARCODE,
        )
        if template is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='Marketplace template not found.')
        return template
    return _choose_matching_marketplace_template(
        _list_marketplace_document_templates(db, company_id, document_type=DOCUMENT_TYPE_BARCODE),
        received_po.distributor,
    )


def _build_barcode_template_snapshot(
    template: MarketplaceDocumentTemplate | None,
    *,
    distributor: str | None,
    template_kind: str,
    sticker_template_id: str | None,
) -> dict[str, object]:
    if template is None:
        return {
            'template_id': None,
            'template_name': None,
            'marketplace_key': None,
            'document_type': DOCUMENT_TYPE_BARCODE,
            'template_kind': template_kind,
            'sticker_template_id': sticker_template_id,
            'layout': {},
            'matched_from_distributor': distributor,
        }
    return {
        'template_id': template.id,
        'template_name': template.name,
        'marketplace_key': template.marketplace_key,
        'document_type': template.document_type,
        'template_kind': template_kind,
        'sticker_template_id': sticker_template_id,
        'layout': template_loads_json(template.layout_json),
        'matched_from_distributor': distributor,
    }


def _apply_invoice_details_to_line_items(
    line_items: list[InvoiceLineItem], details: InvoiceDetails
) -> None:
    for row in line_items:
        row.country_of_origin = details.origin_country or row.country_of_origin
        row.state_of_origin = details.origin_state or row.state_of_origin
        row.district_of_origin = details.origin_district or row.district_of_origin


def _current_financial_year(now: datetime | None = None) -> str:
    current = now or datetime.now(timezone.utc)
    if current.month >= 4:
        start = current.year % 100
        end = (current.year + 1) % 100
    else:
        start = (current.year - 1) % 100
        end = current.year % 100
    return f'{start:02d}-{end:02d}'


def _format_invoice_number(prefix: str, next_number: int, now: datetime | None = None) -> str:
    normalized_prefix = str(prefix or '').strip()
    financial_year = _current_financial_year(now)
    if normalized_prefix:
        return f'{normalized_prefix}/{financial_year}/{next_number:04d}'
    return f'{financial_year}/{next_number:04d}'


def _derive_vendor_style_hash(sku_id: str, size: str | None) -> str:
    normalized_sku = str(sku_id or '').strip()
    normalized_size = str(size or '').strip()
    size_suffix = f'-{normalized_size}'
    if normalized_size and normalized_sku.upper().endswith(size_suffix.upper()):
        return normalized_sku[: -len(size_suffix)]
    return normalized_sku


def _styli_size_code(size: str | None) -> str:
    mapping = {'S': '02', 'M': '03', 'L': '04', 'XL': '05', 'XXL': '30'}
    return mapping.get(str(size or '').strip().upper(), '02')


def _build_neom_sku_id(option_id: str | None, size: str | None, sku_id: str) -> str:
    normalized_option_id = str(option_id or '').strip()
    if normalized_option_id:
        return f'{normalized_option_id}{_styli_size_code(size)}'
    return str(sku_id or '').strip()


def _default_product_description(line_item: ReceivedPOLineItem) -> str:
    color = str(line_item.color or '').strip()
    if color:
        return f'{DEFAULT_PRODUCT_DESCRIPTION} - {color}'
    return DEFAULT_PRODUCT_DESCRIPTION


def _money(value: float) -> float:
    return round(float(value or 0), 2)


def _gst_state_code(value: str | None) -> str | None:
    normalized = ''.join(ch for ch in str(value or '').strip() if not ch.isspace())
    if len(normalized) < 2 or not normalized[:2].isdigit():
        return None
    return normalized[:2]


def _resolve_invoice_tax_mode(details: InvoiceDetails) -> InvoiceTaxMode:
    supplier_state_code = _gst_state_code(details.gst_number)
    destination_state_code = _gst_state_code(details.ship_to_gst) or _gst_state_code(details.bill_to_gst)
    if supplier_state_code and destination_state_code and supplier_state_code == destination_state_code:
        return 'intrastate'
    return 'interstate'


def _invoice_line_item_rows(
    received_po: ReceivedPO,
    line_items: list[ReceivedPOLineItem],
    company_settings: CompanySettings,
    *,
    invoice_details: InvoiceDetails,
    igst_rate: float,
) -> tuple[list[InvoiceLineItem], int, float, float, float, float, float, str, InvoiceTaxMode]:
    brand_profile = _brand_profile(company_settings)
    po_defaults = _po_builder_defaults(company_settings)
    default_fabric = str(po_defaults.get('default_fabric_composition') or '100% Polyester').strip()
    origin_country = str(brand_profile.get('origin_country') or '').strip()
    origin_state = str(brand_profile.get('origin_state') or '').strip()
    origin_district = str(brand_profile.get('origin_district') or '').strip()
    tax_mode = _resolve_invoice_tax_mode(invoice_details)
    rows: list[InvoiceLineItem] = []
    total_quantity = 0
    subtotal = 0.0
    invoice_igst_amount = 0.0
    invoice_cgst_amount = 0.0
    invoice_sgst_amount = 0.0
    for index, line_item in enumerate(line_items):
        quantity = int(line_item.quantity or 0)
        unit_price = _money(float(line_item.po_price or 0))
        net_taxable_amount = _money(quantity * unit_price)
        igst_amount = 0.0
        cgst_amount = 0.0
        sgst_amount = 0.0
        if tax_mode == 'intrastate':
            half_rate = igst_rate / 2
            cgst_amount = _money(net_taxable_amount * half_rate / 100)
            sgst_amount = _money(net_taxable_amount * half_rate / 100)
        else:
            igst_amount = _money(net_taxable_amount * igst_rate / 100)
        total_gst_amount = _money(igst_amount + cgst_amount + sgst_amount)
        total_amount = _money(net_taxable_amount + total_gst_amount)
        total_quantity += quantity
        subtotal = _money(subtotal + net_taxable_amount)
        invoice_igst_amount = _money(invoice_igst_amount + igst_amount)
        invoice_cgst_amount = _money(invoice_cgst_amount + cgst_amount)
        invoice_sgst_amount = _money(invoice_sgst_amount + sgst_amount)
        rows.append(
            InvoiceLineItem(
                id=str(uuid4()),
                source_line_item_id=line_item.id,
                vendor_style_hash=_derive_vendor_style_hash(line_item.sku_id, line_item.size),
                neom_sku_id=_build_neom_sku_id(line_item.option_id, line_item.size, line_item.sku_id),
                neom_po_code=str(received_po.po_number or '').strip() or '-',
                product_description=_default_product_description(line_item),
                hsn_code=get_hsn_code(default_fabric),
                model_number=str(line_item.model_number or line_item.brand_style_code or '-').strip() or '-',
                fabric_composition=default_fabric,
                knitted_woven=str(line_item.knitted_woven or DEFAULT_KNITTED_WOVEN).strip() or DEFAULT_KNITTED_WOVEN,
                neom_size=str(line_item.size or '-').strip() or '-',
                country_of_origin=origin_country,
                state_of_origin=origin_state,
                district_of_origin=origin_district,
                quantity=quantity,
                unit_price=unit_price,
                net_taxable_amount=net_taxable_amount,
                gst_rate=igst_rate,
                igst_amount=igst_amount,
                cgst_amount=cgst_amount,
                sgst_amount=sgst_amount,
                total_gst_amount=total_gst_amount,
                total_amount=total_amount,
                sort_order=index,
            )
        )
    total_amount = _money(subtotal + invoice_igst_amount + invoice_cgst_amount + invoice_sgst_amount)
    total_amount_words = convert_to_words(total_amount)
    return (
        rows,
        total_quantity,
        subtotal,
        invoice_igst_amount,
        invoice_cgst_amount,
        invoice_sgst_amount,
        total_amount,
        total_amount_words,
        tax_mode,
    )


def _invoice_details_from_record(
    invoice: Invoice,
    company_settings: CompanySettings | None,
    received_po: ReceivedPO | None = None,
) -> InvoiceDetails:
    try:
        return InvoiceDetails(**_json_loads(invoice.details_json))
    except Exception:
        return _default_invoice_details(company_settings, received_po)


def _refresh_invoice_snapshot(
    db: Session,
    invoice: Invoice,
    received_po: ReceivedPO,
    company_settings: CompanySettings,
    *,
    buyer_template: BuyerDocumentTemplate | None = None,
    details_override: InvoiceDetails | None = None,
) -> None:
    igst_rate = float(invoice.igst_rate or _get_default_igst_rate(company_settings))
    invoice_details = details_override or _invoice_details_from_record(invoice, company_settings, received_po)
    (
        line_item_rows,
        total_quantity,
        subtotal,
        igst_amount,
        _cgst_amount,
        _sgst_amount,
        total_amount,
        total_amount_words,
        _tax_mode,
    ) = _invoice_line_item_rows(
        received_po,
        list(received_po.items),
        company_settings,
        invoice_details=invoice_details,
        igst_rate=igst_rate,
    )
    _apply_invoice_details_to_line_items(line_item_rows, invoice_details)

    for existing_row in list(invoice.line_items):
        db.delete(existing_row)
    db.flush()

    for row in line_item_rows:
        row.invoice_id = invoice.id
        db.add(row)

    invoice.igst_rate = igst_rate
    invoice.subtotal = subtotal
    invoice.igst_amount = igst_amount
    invoice.total_amount = total_amount
    invoice.total_quantity = total_quantity
    invoice.total_amount_words = total_amount_words
    invoice.details_json = invoice_details.model_dump_json()
    if buyer_template is not None:
        _apply_buyer_template_snapshot(
            invoice,
            buyer_template,
            received_po=received_po,
            resolved_details=invoice_details,
        )


def _get_invoice_or_404(db: Session, company_id: str, received_po_id: str) -> Invoice:
    record = db.query(Invoice).filter(
        Invoice.company_id == company_id,
        Invoice.received_po_id == received_po_id,
    ).first()
    if record is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='Invoice not found.')
    return record


def _get_packing_list_or_404(db: Session, company_id: str, received_po_id: str) -> PackingList:
    record = db.query(PackingList).filter(
        PackingList.company_id == company_id,
        PackingList.received_po_id == received_po_id,
    ).first()
    if record is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='Packing list not found.')
    return record


def _get_received_po_or_404(db: Session, company_id: str, received_po_id: str) -> ReceivedPO:
    record = db.query(ReceivedPO).filter(
        ReceivedPO.id == received_po_id,
        ReceivedPO.company_id == company_id,
    ).first()
    if record is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='Received PO not found.')
    return record


def _to_received_po_response(record: ReceivedPO) -> ReceivedPOResponse:
    serialized_items = [_to_received_po_line_item_response(item) for item in record.items]
    return ReceivedPOResponse(
        id=record.id,
        company_id=record.company_id,
        file_url=record.file_url,
        po_number=record.po_number,
        po_date=record.po_date,
        distributor=record.distributor,
        status=record.status,
        raw_extracted_json=_json_loads(record.raw_extracted_json),
        created_at=record.created_at,
        updated_at=record.updated_at,
        items=serialized_items,
    )


def _to_received_po_line_item_response(item: ReceivedPOLineItem) -> ReceivedPOLineItemResponse:
    return ReceivedPOLineItemResponse(
        id=item.id,
        received_po_id=item.received_po_id,
        brand_style_code=item.brand_style_code,
        styli_style_id=item.styli_style_id,
        model_number=item.model_number,
        option_id=item.option_id,
        sku_id=item.sku_id,
        color=item.color,
        knitted_woven=item.knitted_woven,
        size=item.size,
        quantity=item.quantity,
        po_price=float(item.po_price) if item.po_price is not None else None,
        confidence_score=float(item.confidence_score) if item.confidence_score is not None else None,
        resolution_status=item.resolution_status,  # type: ignore[arg-type]
        exception_reason=item.exception_reason,
        suggested_fix_json=_json_loads(item.suggested_fix_json),
        created_at=item.created_at,
        updated_at=item.updated_at,
    )


def _exception_summary(record: ReceivedPO) -> ReceivedPOExceptionsSummary:
    total = len(record.items)
    auto_resolved = 0
    needs_review = 0
    human_corrected = 0
    for item in record.items:
        status = str(item.resolution_status or '')
        if status == RESOLUTION_STATUS_AUTO_RESOLVED:
            auto_resolved += 1
        elif status == RESOLUTION_STATUS_HUMAN_CORRECTED:
            human_corrected += 1
        else:
            needs_review += 1

    auto_resolve_rate = round((auto_resolved / total) * 100, 2) if total > 0 else 0.0
    return ReceivedPOExceptionsSummary(
        total=total,
        auto_resolved=auto_resolved,
        needs_review=needs_review,
        human_corrected=human_corrected,
        auto_resolve_rate=auto_resolve_rate,
    )


def _to_received_po_exceptions_response(
    record: ReceivedPO,
    *,
    include_resolved: bool = False,
) -> ReceivedPOExceptionsListResponse:
    summary = _exception_summary(record)
    if include_resolved:
        items = list(record.items)
    else:
        items = [item for item in record.items if item.resolution_status != RESOLUTION_STATUS_AUTO_RESOLVED]
    serialized_items = [_to_received_po_line_item_response(item) for item in items]
    return ReceivedPOExceptionsListResponse(
        received_po_id=record.id,
        status=record.status,  # type: ignore[arg-type]
        summary=summary,
        items=serialized_items,
    )


def _load_suggested_fix(item: ReceivedPOLineItem) -> dict[str, object]:
    payload = _json_loads(item.suggested_fix_json)
    return payload if isinstance(payload, dict) else {}


def _apply_exception_resolution_payload(
    item: ReceivedPOLineItem,
    payload: ReceivedPOExceptionResolveRequest,
) -> None:
    suggestion = _load_suggested_fix(item) if payload.action == 'accept' else {}
    item.size = payload.size if payload.size is not None else str(suggestion.get('size') or item.size or '').strip() or None
    item.color = (
        payload.color if payload.color is not None else str(suggestion.get('color') or item.color or '').strip() or None
    )
    item.knitted_woven = (
        payload.knitted_woven
        if payload.knitted_woven is not None
        else str(suggestion.get('knitted_woven') or item.knitted_woven or '').strip() or None
    )
    if payload.quantity is not None:
        item.quantity = payload.quantity
    elif payload.action == 'accept' and isinstance(suggestion.get('quantity'), int):
        item.quantity = int(suggestion.get('quantity') or item.quantity)
    if payload.po_price is not None:
        item.po_price = payload.po_price
    elif payload.action == 'accept' and isinstance(suggestion.get('po_price'), (int, float)):
        item.po_price = float(suggestion.get('po_price'))


@router.post('/upload', response_model=ReceivedPOUploadResponse, status_code=status.HTTP_201_CREATED)
async def upload_received_po(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles('admin', 'manager', 'operator')),
) -> ReceivedPOUploadResponse:
    content_type = file.content_type or 'application/octet-stream'
    suffix = Path(file.filename or '').suffix.lower()
    if content_type not in ALLOWED_UPLOAD_CONTENT_TYPES and suffix not in ALLOWED_UPLOAD_SUFFIXES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail='Only PDF, XLS, and XLSX files are allowed.')

    unique_name = f'{datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")}-{uuid4().hex}{suffix or ".pdf"}'
    key = f'received-pos/{current_user.company_id}/{unique_name}'
    content = await file.read()

    if object_storage.enabled:
        stored_url = object_storage.upload_bytes(key=key, content=content, content_type=content_type)
        if not stored_url:
            raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail='Failed to store uploaded PO file.')
    else:
        file_path = UPLOAD_DIR / unique_name
        file_path.write_bytes(content)
        stored_url = f'/static/uploads/received-pos/{unique_name}'

    record = ReceivedPO(
        id=str(uuid4()),
        company_id=current_user.company_id,
        file_url=stored_url,
        status='uploaded',
        raw_extracted_json=json.dumps({}, separators=(',', ':')),
    )
    db.add(record)
    db.flush()
    log_received_po_agent_event(
        db,
        record,
        event_type='received_po.uploaded',
        title='Received PO uploaded',
        summary='The autopilot accepted the buyer PO file and prepared it for extraction.',
        actor_type=ACTOR_HUMAN,
        tool_name='received_po_upload',
        metadata={'file_url': stored_url, 'content_type': content_type},
    )
    log_audit(
        db,
        action='received_po.upload',
        user_id=current_user.id,
        company_id=current_user.company_id,
        metadata={'received_po_id': record.id},
    )
    db.commit()
    if is_job_worker_running():
        enqueue_processing_job(
            db,
            company_id=current_user.company_id,
            job_type=JOB_TYPE_RECEIVED_PO_PARSE,
            payload={'received_po_id': record.id},
            created_by_user_id=current_user.id,
            input_ref=record.file_url,
        )
        log_received_po_agent_event(
            db,
            record,
            event_type='agent.parse_queued',
            title='Qwen extraction queued',
            summary='The autopilot queued a parsing job to read the received PO and normalize line items.',
            status=STATUS_QUEUED,
            tool_name='received_po_parser',
        )
        db.commit()
    else:
        process_received_po_parse_job(record.id)
        db.refresh(record)
    return ReceivedPOUploadResponse(received_po_id=record.id, status=record.status)


@router.get('', response_model=ReceivedPOListResponse)
def list_received_pos(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    status_filter: ReceivedPOStatus | None = Query(default=None, alias='status'),
    limit: int = Query(default=25, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
) -> ReceivedPOListResponse:
    query = db.query(ReceivedPO).filter(ReceivedPO.company_id == current_user.company_id)
    if status_filter:
        query = query.filter(ReceivedPO.status == status_filter)
    total = query.count()
    rows = query.order_by(ReceivedPO.created_at.desc()).offset(offset).limit(limit).all()

    line_item_counts = {
        received_po_id: count
        for received_po_id, count in (
            db.query(ReceivedPOLineItem.received_po_id, func.count(ReceivedPOLineItem.id))
            .filter(ReceivedPOLineItem.received_po_id.in_([row.id for row in rows] or ['']))
            .group_by(ReceivedPOLineItem.received_po_id)
            .all()
        )
    }

    return ReceivedPOListResponse(
        items=[
            ReceivedPOListItemResponse(
                id=row.id,
                po_number=row.po_number,
                po_date=row.po_date,
                distributor=row.distributor,
                status=row.status,
                line_item_count=int(line_item_counts.get(row.id, 0) or 0),
                created_at=row.created_at,
            )
            for row in rows
        ],
        total=total,
    )


@router.get('/{received_po_id}', response_model=ReceivedPOResponse)
def get_received_po(
    received_po_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> ReceivedPOResponse:
    record = _get_received_po_or_404(db, current_user.company_id, received_po_id)
    return _to_received_po_response(record)


@router.get('/{received_po_id}/agent-events', response_model=ReceivedPOAgentTimelineResponse)
def list_received_po_agent_events(
    received_po_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> ReceivedPOAgentTimelineResponse:
    record = _get_received_po_or_404(db, current_user.company_id, received_po_id)
    events = (
        db.query(ReceivedPOAgentEvent)
        .filter(
            ReceivedPOAgentEvent.company_id == current_user.company_id,
            ReceivedPOAgentEvent.received_po_id == record.id,
        )
        .order_by(ReceivedPOAgentEvent.created_at.asc())
        .all()
    )
    return ReceivedPOAgentTimelineResponse(
        received_po_id=record.id,
        items=[_to_agent_event_response(event) for event in events],
    )


@router.patch('/{received_po_id}', response_model=ReceivedPOResponse)
def update_received_po_header(
    received_po_id: str,
    payload: ReceivedPOHeaderUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles('admin', 'manager', 'operator')),
) -> ReceivedPOResponse:
    record = _get_received_po_or_404(db, current_user.company_id, received_po_id)
    if record.status == 'confirmed':
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail='Confirmed received POs cannot be edited.')

    updates = payload.model_dump(exclude_unset=True)
    if 'po_number' in updates:
        record.po_number = updates['po_number'].strip() if updates['po_number'] else None
    if 'po_date' in updates:
        record.po_date = updates['po_date']
    if 'distributor' in updates and updates['distributor'] is not None:
        cleaned = updates['distributor'].strip()
        record.distributor = cleaned or record.distributor

    log_audit(
        db,
        action='received_po.update_header',
        user_id=current_user.id,
        company_id=current_user.company_id,
        metadata={'received_po_id': record.id},
    )
    db.commit()
    db.refresh(record)
    return _to_received_po_response(record)


@router.put('/{received_po_id}/items', response_model=ReceivedPOResponse)
def update_received_po_items(
    received_po_id: str,
    payload: ReceivedPOLineItemBatchUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles('admin', 'manager', 'operator')),
) -> ReceivedPOResponse:
    record = _get_received_po_or_404(db, current_user.company_id, received_po_id)
    if record.status == 'confirmed':
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail='Confirmed received POs cannot be edited.')

    item_updates = {item.id: item for item in payload.items}
    rows = db.query(ReceivedPOLineItem).filter(ReceivedPOLineItem.received_po_id == record.id).all()
    for row in rows:
        update = item_updates.get(row.id)
        if update is None:
            continue
        row.brand_style_code = update.brand_style_code.strip()
        row.styli_style_id = update.styli_style_id.strip() if update.styli_style_id else None
        row.model_number = update.model_number.strip() if update.model_number else None
        row.option_id = update.option_id.strip() if update.option_id else None
        row.sku_id = update.sku_id.strip()
        row.color = update.color.strip() if update.color else None
        row.knitted_woven = update.knitted_woven.strip() if update.knitted_woven else None
        row.size = update.size.strip() if update.size else None
        row.quantity = update.quantity
        row.po_price = update.po_price

    log_audit(
        db,
        action='received_po.update_items',
        user_id=current_user.id,
        company_id=current_user.company_id,
        metadata={'received_po_id': record.id, 'item_count': str(len(payload.items))},
    )
    db.commit()
    db.refresh(record)
    return _to_received_po_response(record)


@router.post('/{received_po_id}/exceptions/run', response_model=ReceivedPOExceptionsListResponse)
def run_received_po_exceptions(
    received_po_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles('admin', 'manager', 'operator')),
) -> ReceivedPOExceptionsListResponse:
    record = _get_received_po_or_404(db, current_user.company_id, received_po_id)
    if record.status == 'confirmed':
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail='Confirmed received POs cannot be edited.')
    run_exception_resolution_for_received_po(db, record)
    log_received_po_agent_event(
        db,
        record,
        event_type='agent.exceptions_evaluated',
        title='Exceptions evaluated',
        summary=(
            f'The autopilot checked {len(record.items)} line item(s) and found '
            f'{record.review_required_count} requiring human review.'
        ),
        status=STATUS_NEEDS_REVIEW if record.review_required_count > 0 else 'completed',
        tool_name='exception_resolver',
        metadata={
            'line_item_count': len(record.items),
            'review_required_count': record.review_required_count,
            'auto_resolve_rate': float(record.auto_resolve_rate or 0),
        },
    )
    log_audit(
        db,
        action='received_po.exceptions.run',
        user_id=current_user.id,
        company_id=current_user.company_id,
        metadata={'received_po_id': record.id},
    )
    db.commit()
    db.refresh(record)
    return _to_received_po_exceptions_response(record)


@router.get('/{received_po_id}/exceptions', response_model=ReceivedPOExceptionsListResponse)
def list_received_po_exceptions(
    received_po_id: str,
    include_resolved: bool = Query(default=False),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> ReceivedPOExceptionsListResponse:
    record = _get_received_po_or_404(db, current_user.company_id, received_po_id)
    return _to_received_po_exceptions_response(record, include_resolved=include_resolved)


@router.post('/{received_po_id}/exceptions/{line_item_id}/resolve', response_model=ReceivedPOExceptionsListResponse)
def resolve_received_po_exception(
    received_po_id: str,
    line_item_id: str,
    payload: ReceivedPOExceptionResolveRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles('admin', 'manager', 'operator')),
) -> ReceivedPOExceptionsListResponse:
    record = _get_received_po_or_404(db, current_user.company_id, received_po_id)
    if record.status == 'confirmed':
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail='Confirmed received POs cannot be edited.')

    line_item = (
        db.query(ReceivedPOLineItem)
        .filter(
            ReceivedPOLineItem.received_po_id == record.id,
            ReceivedPOLineItem.id == line_item_id,
        )
        .first()
    )
    if line_item is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='Received PO line item not found.')

    _apply_exception_resolution_payload(line_item, payload)
    line_item.resolution_status = RESOLUTION_STATUS_HUMAN_CORRECTED
    line_item.exception_reason = (
        'accepted_suggested_fix' if payload.action == 'accept' else 'rejected_suggested_fix'
    )
    line_item.suggested_fix_json = json.dumps({}, separators=(',', ':'))
    if line_item.confidence_score is None:
        line_item.confidence_score = 0.5

    if payload.action != 'accept':
        from uuid import uuid4
        from app.models.ai_correction import AICorrection
        db.add(
            AICorrection(
                id=str(uuid4()),
                company_id=current_user.company_id,
                field_name='po_line_item',
                feedback_type='correction',
                suggested_value=str(payload.action),
                corrected_value=f"SKU: {line_item.sku_id}, Price: {line_item.po_price}, Qty: {line_item.quantity}",
                reason_code='human_po_exception_correction',
                source='received_po_inbox',
                created_by_user_id=current_user.id,
            )
        )

    run_exception_resolution_for_received_po(db, record)
    log_received_po_agent_event(
        db,
        record,
        event_type='human.exception_resolved',
        title='Line item reviewed by human',
        summary='A user reviewed an exception and either accepted or corrected the autopilot suggestion.',
        actor_type=ACTOR_HUMAN,
        tool_name='exception_review',
        metadata={
            'line_item_id': line_item.id,
            'resolution_action': payload.action,
            'review_required_count': record.review_required_count,
        },
    )
    log_audit(
        db,
        action='received_po.exceptions.resolve',
        user_id=current_user.id,
        company_id=current_user.company_id,
        metadata={
            'received_po_id': record.id,
            'line_item_id': line_item.id,
            'resolution_action': payload.action,
        },
    )
    db.commit()
    db.refresh(record)
    return _to_received_po_exceptions_response(record)


@router.post('/{received_po_id}/exceptions/resolve-bulk', response_model=ReceivedPOBulkResolveResponse)
def resolve_received_po_exceptions_bulk(
    received_po_id: str,
    payload: ReceivedPOBulkResolveRequest = Body(default=ReceivedPOBulkResolveRequest()),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles('admin', 'manager', 'operator')),
) -> ReceivedPOBulkResolveResponse:
    record = _get_received_po_or_404(db, current_user.company_id, received_po_id)
    if record.status == 'confirmed':
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail='Confirmed received POs cannot be edited.')

    processed_count = 0
    for item in record.items:
        if item.resolution_status != RESOLUTION_STATUS_NEEDS_REVIEW:
            continue
        confidence = float(item.confidence_score or 0)
        if confidence < payload.min_confidence:
            continue
        suggestion = _load_suggested_fix(item)
        if payload.only_with_suggestions and len(suggestion) == 0:
            continue
        _apply_exception_resolution_payload(
            item,
            ReceivedPOExceptionResolveRequest(action='accept'),
        )
        item.resolution_status = RESOLUTION_STATUS_HUMAN_CORRECTED
        item.exception_reason = 'bulk_accepted_suggested_fix'
        item.suggested_fix_json = json.dumps({}, separators=(',', ':'))
        if item.confidence_score is None:
            item.confidence_score = confidence
        processed_count += 1

    run_exception_resolution_for_received_po(db, record)
    log_received_po_agent_event(
        db,
        record,
        event_type='human.exceptions_bulk_resolved',
        title='Low-risk exceptions bulk reviewed',
        summary=f'A user accepted {processed_count} low-risk autopilot suggestion(s).',
        actor_type=ACTOR_HUMAN,
        tool_name='exception_review',
        metadata={
            'processed_count': processed_count,
            'min_confidence': payload.min_confidence,
            'only_with_suggestions': payload.only_with_suggestions,
            'review_required_count': record.review_required_count,
        },
    )
    log_audit(
        db,
        action='received_po.exceptions.resolve_bulk',
        user_id=current_user.id,
        company_id=current_user.company_id,
        metadata={
            'received_po_id': record.id,
            'processed_count': str(processed_count),
            'min_confidence': str(payload.min_confidence),
            'only_with_suggestions': str(payload.only_with_suggestions),
        },
    )
    db.commit()
    db.refresh(record)
    response = _to_received_po_exceptions_response(record)
    return ReceivedPOBulkResolveResponse(
        received_po_id=record.id,
        processed_count=processed_count,
        summary=response.summary,
        items=response.items,
    )


@router.post('/{received_po_id}/confirm', response_model=ReceivedPOConfirmResponse)
def confirm_received_po(
    received_po_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles('admin', 'manager', 'operator')),
) -> ReceivedPOConfirmResponse:
    record = _get_received_po_or_404(db, current_user.company_id, received_po_id)
    if len(record.items) == 0:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail='Cannot confirm a received PO without line items.')
    record.status = 'confirmed'
    log_received_po_agent_event(
        db,
        record,
        event_type='human.po_confirmed',
        title='Human checkpoint approved',
        summary='A user confirmed the received PO, unlocking downstream barcode, invoice, and packing-list generation.',
        actor_type=ACTOR_HUMAN,
        tool_name='received_po_confirmation',
        metadata={'line_item_count': len(record.items), 'review_required_count': record.review_required_count},
    )
    log_audit(
        db,
        action='received_po.confirm',
        user_id=current_user.id,
        company_id=current_user.company_id,
        metadata={'received_po_id': record.id},
    )
    db.commit()
    return ReceivedPOConfirmResponse(id=record.id, status=record.status)


@router.post('/{received_po_id}/barcode', response_model=BarcodeJobCreateResponse, status_code=status.HTTP_201_CREATED)
def create_barcode_job(
    received_po_id: str,
    payload: CreateBarcodeJobRequest | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles('admin', 'manager', 'operator')),
) -> BarcodeJobCreateResponse:
    record = _get_received_po_or_404(db, current_user.company_id, received_po_id)
    if record.status != 'confirmed':
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail='Confirm the received PO before generating documents.')

    next_payload = payload or CreateBarcodeJobRequest()
    marketplace_template = _resolve_barcode_marketplace_template(
        db,
        current_user.company_id,
        record,
        template_id=next_payload.marketplace_template_id,
    )
    resolved_template_kind = next_payload.template_kind
    resolved_template_id = next_payload.template_id
    if marketplace_template is not None:
        layout = template_loads_json(marketplace_template.layout_json)
        layout_template_kind = str(layout.get('sticker_template_kind') or '').strip()
        layout_template_id = str(layout.get('sticker_template_id') or '').strip() or None
        if (
            layout_template_kind in {'styli', 'custom'}
            and next_payload.template_kind == 'styli'
            and next_payload.template_id is None
        ):
            resolved_template_kind = layout_template_kind
            resolved_template_id = layout_template_id

    if resolved_template_kind == 'custom':
        if not resolved_template_id:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail='Custom template selection is required.')
        template = (
            db.query(StickerTemplate)
            .filter(
                StickerTemplate.id == resolved_template_id,
                StickerTemplate.company_id == current_user.company_id,
            )
            .first()
        )
        if template is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='Sticker template not found.')

    job = BarcodeJob(
        id=str(uuid4()),
        received_po_id=record.id,
        status='pending',
        template_kind=resolved_template_kind,
        template_id=resolved_template_id,
        marketplace_template_id=marketplace_template.id if marketplace_template else None,
        marketplace_template_name=marketplace_template.name if marketplace_template else None,
        template_snapshot_json=template_dumps_json(
            _build_barcode_template_snapshot(
                marketplace_template,
                distributor=record.distributor,
                template_kind=resolved_template_kind,
                sticker_template_id=resolved_template_id,
            )
        ),
        total_stickers=len(record.items),
    )
    db.add(job)
    log_audit(
        db,
        action='received_po.barcode_job.create',
        user_id=current_user.id,
        company_id=current_user.company_id,
        metadata={'received_po_id': record.id, 'barcode_job_id': job.id},
    )
    log_received_po_agent_event(
        db,
        record,
        event_type='agent.barcode_queued',
        title='Barcode generation queued',
        summary='The autopilot queued barcode sticker generation from the confirmed PO lines.',
        status=STATUS_QUEUED,
        tool_name='barcode_pdf_generator',
        metadata={'barcode_job_id': job.id, 'total_stickers': job.total_stickers},
    )
    enqueue_processing_job(
        db,
        company_id=current_user.company_id,
        job_type=JOB_TYPE_RECEIVED_PO_BARCODE_PDF,
        payload={'barcode_job_id': job.id, 'received_po_id': record.id},
        created_by_user_id=current_user.id,
        input_ref=record.file_url,
    )
    db.commit()
    return BarcodeJobCreateResponse(
        job_id=job.id,
        status=job.status,
        marketplace_template_id=job.marketplace_template_id,
        marketplace_template_name=job.marketplace_template_name,
    )


@router.get('/{received_po_id}/barcode/status', response_model=BarcodeJobResponse)
def get_barcode_job_status(
    received_po_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> BarcodeJobResponse:
    _get_received_po_or_404(db, current_user.company_id, received_po_id)
    job = db.query(BarcodeJob).filter(BarcodeJob.received_po_id == received_po_id).order_by(BarcodeJob.created_at.desc()).first()
    if job is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='Barcode job not found.')
    return BarcodeJobResponse.model_validate(job)


@router.get('/{received_po_id}/barcode/jobs/{job_id}', response_model=BarcodeJobResponse)
def get_barcode_job(
    received_po_id: str,
    job_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> BarcodeJobResponse:
    _get_received_po_or_404(db, current_user.company_id, received_po_id)
    job = (
        db.query(BarcodeJob)
        .filter(BarcodeJob.id == job_id, BarcodeJob.received_po_id == received_po_id)
        .first()
    )
    if job is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='Barcode job not found.')
    return BarcodeJobResponse.model_validate(job)


@router.post('/{received_po_id}/invoice', response_model=InvoiceResponse, status_code=status.HTTP_201_CREATED)
def create_invoice_draft(
    received_po_id: str,
    payload: InvoiceCreateRequest = Body(default=InvoiceCreateRequest()),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles('admin', 'manager', 'operator')),
) -> InvoiceResponse:
    record = _get_received_po_or_404(db, current_user.company_id, received_po_id)
    if record.status != 'confirmed':
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail='Confirm the received PO before creating an invoice.')

    existing = db.query(Invoice).filter(
        Invoice.company_id == current_user.company_id,
        Invoice.received_po_id == record.id,
    ).first()
    if existing is not None:
        company_settings = _get_company_settings(db, current_user.company_id)
        buyer_template = _resolve_buyer_document_template(
            db,
            current_user.company_id,
            record,
            buyer_template_id=payload.buyer_template_id,
            existing_invoice=existing,
        )
        details_override = None
        if payload.details is not None or payload.buyer_template_id is not None:
            details_override = _resolve_invoice_details(
                payload.details,
                company_settings,
                record,
                buyer_template=buyer_template,
            )
        existing.number_of_cartons = payload.number_of_cartons
        existing.export_mode = payload.export_mode
        _refresh_invoice_snapshot(
            db,
            existing,
            record,
            company_settings,
            buyer_template=buyer_template if payload.buyer_template_id is not None else None,
            details_override=details_override,
        )
        if existing.status == 'final':
            existing.status = 'draft'
        log_audit(
            db,
            action='received_po.invoice.refresh',
            user_id=current_user.id,
            company_id=current_user.company_id,
            metadata={'received_po_id': record.id, 'invoice_id': existing.id},
        )
        log_received_po_agent_event(
            db,
            record,
            event_type='agent.invoice_refreshed',
            title='Invoice draft refreshed',
            summary='The autopilot refreshed the commercial invoice draft from the latest confirmed PO data.',
            tool_name='invoice_builder',
            metadata={'invoice_id': existing.id, 'invoice_number': existing.invoice_number},
        )
        db.commit()
        db.refresh(existing)
        return _to_invoice_response(existing)

    company_settings = _get_company_settings(db, current_user.company_id)
    buyer_template = _resolve_buyer_document_template(
        db,
        current_user.company_id,
        record,
        buyer_template_id=payload.buyer_template_id,
    )
    igst_rate = _get_default_igst_rate(company_settings)
    invoice_details = _resolve_invoice_details(
        payload.details,
        company_settings,
        record,
        buyer_template=buyer_template,
    )
    (
        line_item_rows,
        total_quantity,
        subtotal,
        igst_amount,
        _cgst_amount,
        _sgst_amount,
        total_amount,
        total_amount_words,
        _tax_mode,
    ) = _invoice_line_item_rows(
        record,
        list(record.items),
        company_settings,
        invoice_details=invoice_details,
        igst_rate=igst_rate,
    )
    _apply_invoice_details_to_line_items(line_item_rows, invoice_details)
    invoice_prefix = str(company_settings.invoice_prefix or '').strip()
    if invoice_prefix == 'INV' and not _brand_profile(company_settings):
        invoice_prefix = ''
    invoice_number = _format_invoice_number(invoice_prefix, company_settings.invoice_next_number)
    invoice = Invoice(
        id=str(uuid4()),
        received_po_id=record.id,
        company_id=current_user.company_id,
        invoice_number=invoice_number,
        invoice_date=datetime.now(timezone.utc),
        number_of_cartons=payload.number_of_cartons,
        export_mode=payload.export_mode,
        subtotal=subtotal,
        igst_rate=igst_rate,
        igst_amount=igst_amount,
        total_amount=total_amount,
        total_quantity=total_quantity,
        total_amount_words=total_amount_words,
        details_json=invoice_details.model_dump_json(),
        buyer_template_id=buyer_template.id if buyer_template else None,
        buyer_template_name=buyer_template.name if buyer_template else None,
        layout_key=resolve_layout_key(buyer_template),
        template_snapshot_json=json_dumps(
            build_template_snapshot(buyer_template, distributor=record.distributor, merged_details=invoice_details)
        ),
        status='draft',
    )
    company_settings.invoice_next_number += 1
    db.add(invoice)
    db.flush()
    for row in line_item_rows:
        row.invoice_id = invoice.id
        db.add(row)
    log_audit(
        db,
        action='received_po.invoice.create',
        user_id=current_user.id,
        company_id=current_user.company_id,
        metadata={
            'received_po_id': record.id,
            'invoice_number': invoice.invoice_number,
            'number_of_cartons': payload.number_of_cartons,
            'export_mode': payload.export_mode,
            'details_overridden': payload.details is not None,
        },
    )
    log_received_po_agent_event(
        db,
        record,
        event_type='agent.invoice_drafted',
        title='Invoice draft created',
        summary='The autopilot drafted a commercial invoice using company settings, buyer template rules, and confirmed PO lines.',
        tool_name='invoice_builder',
        metadata={
            'invoice_id': invoice.id,
            'invoice_number': invoice.invoice_number,
            'total_quantity': total_quantity,
            'total_amount': float(total_amount),
        },
    )
    db.commit()
    db.refresh(invoice)
    return _to_invoice_response(invoice)


@router.get('/{received_po_id}/invoice', response_model=InvoiceResponse)
def get_invoice(
    received_po_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> InvoiceResponse:
    _get_received_po_or_404(db, current_user.company_id, received_po_id)
    invoice = _get_invoice_or_404(db, current_user.company_id, received_po_id)
    return _to_invoice_response(invoice)


@router.patch('/{received_po_id}/invoice', response_model=InvoiceResponse)
def update_invoice(
    received_po_id: str,
    payload: InvoiceUpdateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles('admin', 'manager', 'operator')),
) -> InvoiceResponse:
    received_po = _get_received_po_or_404(db, current_user.company_id, received_po_id)
    invoice = _get_invoice_or_404(db, current_user.company_id, received_po_id)
    invoice.gross_weight = payload.gross_weight
    if payload.number_of_cartons is not None:
        invoice.number_of_cartons = payload.number_of_cartons
    if payload.export_mode is not None:
        invoice.export_mode = payload.export_mode
    company_settings = _get_company_settings(db, current_user.company_id)
    buyer_template = _resolve_buyer_document_template(
        db,
        current_user.company_id,
        received_po,
        buyer_template_id=payload.buyer_template_id,
        existing_invoice=invoice,
    )
    details_override = None
    if payload.details is not None or payload.buyer_template_id is not None:
        details_override = _resolve_invoice_details(
            payload.details,
            company_settings,
            received_po,
            buyer_template=buyer_template,
        )
        _refresh_invoice_snapshot(
            db,
            invoice,
            received_po,
            company_settings,
            buyer_template=buyer_template if payload.buyer_template_id is not None else None,
            details_override=details_override,
        )
    log_audit(
        db,
        action='received_po.invoice.update',
        user_id=current_user.id,
        company_id=current_user.company_id,
        metadata={
            'received_po_id': received_po_id,
            'invoice_id': invoice.id,
            'details_overridden': payload.details is not None,
        },
    )
    db.commit()
    db.refresh(invoice)
    return _to_invoice_response(invoice)


@router.post('/{received_po_id}/invoice/generate-pdf', response_model=InvoiceGeneratePdfResponse)
def generate_invoice_pdf_endpoint(
    received_po_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles('admin', 'manager', 'operator')),
) -> InvoiceGeneratePdfResponse:
    received_po = _get_received_po_or_404(db, current_user.company_id, received_po_id)
    invoice = _get_invoice_or_404(db, current_user.company_id, received_po_id)
    company_settings = _get_company_settings(db, current_user.company_id)
    buyer_template = _resolve_buyer_document_template(
        db,
        current_user.company_id,
        received_po,
        existing_invoice=invoice,
    )
    _refresh_invoice_snapshot(db, invoice, received_po, company_settings, buyer_template=buyer_template)
    invoice.status = 'draft'
    invoice.file_url = None
    log_received_po_agent_event(
        db,
        received_po,
        event_type='agent.invoice_pdf_queued',
        title='Invoice PDF generation queued',
        summary='The autopilot queued the final invoice PDF after refreshing the invoice snapshot.',
        status=STATUS_QUEUED,
        tool_name='invoice_pdf_generator',
        metadata={'invoice_id': invoice.id, 'invoice_number': invoice.invoice_number},
    )
    enqueue_processing_job(
        db,
        company_id=current_user.company_id,
        job_type=JOB_TYPE_RECEIVED_PO_INVOICE_PDF,
        payload={'invoice_id': invoice.id, 'received_po_id': received_po_id},
        created_by_user_id=current_user.id,
    )
    db.commit()
    return InvoiceGeneratePdfResponse(invoice_id=invoice.id, status=invoice.status, file_url=invoice.file_url)


@router.post('/{received_po_id}/packing-list', response_model=PackingListCreateResponse, status_code=status.HTTP_201_CREATED)
def create_packing_list(
    received_po_id: str,
    payload: PackingListCreateRequest | None = Body(default=None),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles('admin', 'manager', 'operator')),
) -> PackingListCreateResponse:
    record = _get_received_po_or_404(db, current_user.company_id, received_po_id)
    if record.status != 'confirmed':
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail='Confirm the received PO before creating a packing list.')

    # Invoice must exist first — packing list is downstream of the invoice snapshot.
    invoice = db.query(Invoice).filter(
        Invoice.company_id == current_user.company_id,
        Invoice.received_po_id == record.id,
    ).first()
    if invoice is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail='Create an invoice draft before generating a packing list.',
        )

    packing_template = _resolve_packing_list_template(
        db,
        current_user.company_id,
        record,
        template_id=payload.template_id if payload else None,
    )

    packing_list, total_cartons, total_pieces = assign_cartons_for_received_po(
        db,
        received_po=record,
        company_id=current_user.company_id,
        invoice=invoice,
        template_id=packing_template.id if packing_template else None,
        template_name=packing_template.name if packing_template else None,
        layout_key=_resolve_packing_list_layout_key(packing_template),
        template_snapshot_json=template_dumps_json(
            _build_packing_list_template_snapshot(packing_template, distributor=record.distributor)
        ),
    )
    log_audit(
        db,
        action='received_po.packing_list.create',
        user_id=current_user.id,
        company_id=current_user.company_id,
        metadata={'received_po_id': record.id, 'packing_list_id': packing_list.id},
    )
    log_received_po_agent_event(
        db,
        record,
        event_type='agent.packing_list_drafted',
        title='Packing list drafted',
        summary='The autopilot assigned PO quantities into cartons using configured carton-capacity rules.',
        tool_name='packing_list_builder',
        metadata={
            'packing_list_id': packing_list.id,
            'total_cartons': total_cartons,
            'total_pieces': total_pieces,
        },
    )
    db.commit()
    return PackingListCreateResponse(
        packing_list_id=packing_list.id,
        total_cartons=total_cartons,
        total_pieces=total_pieces,
        template_id=packing_list.template_id,
        template_name=packing_list.template_name,
        layout_key=packing_list.layout_key,
    )


@router.get('/{received_po_id}/packing-list', response_model=PackingListResponse)
def get_packing_list(
    received_po_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> PackingListResponse:
    _get_received_po_or_404(db, current_user.company_id, received_po_id)
    packing_list = _get_packing_list_or_404(db, current_user.company_id, received_po_id)
    return _to_packing_list_response(packing_list)


@router.patch('/{received_po_id}/packing-list/cartons/{carton_id}', response_model=PackingListCartonResponse)
def update_packing_list_carton(
    received_po_id: str,
    carton_id: str,
    payload: PackingListCartonUpdateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles('admin', 'manager', 'operator')),
) -> PackingListCartonResponse:
    packing_list = _get_packing_list_or_404(db, current_user.company_id, received_po_id)
    carton = db.query(PackingListCarton).filter(
        PackingListCarton.id == carton_id,
        PackingListCarton.packing_list_id == packing_list.id,
    ).first()
    if carton is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='Packing list carton not found.')

    updates = payload.model_dump(exclude_unset=True)
    if 'gross_weight' in updates:
        carton.gross_weight = updates['gross_weight']
    if 'net_weight' in updates:
        carton.net_weight = updates['net_weight']
    if 'dimensions' in updates:
        carton.dimensions = updates['dimensions']

    log_audit(
        db,
        action='received_po.packing_list.carton.update',
        user_id=current_user.id,
        company_id=current_user.company_id,
        metadata={'received_po_id': received_po_id, 'carton_id': carton.id},
    )
    db.commit()
    db.refresh(carton)
    return PackingListCartonResponse.model_validate(carton)


@router.post('/{received_po_id}/packing-list/generate-pdf', response_model=PackingListGeneratePdfResponse)
def generate_packing_list_pdf_endpoint(
    received_po_id: str,
    payload: PackingListGeneratePdfRequest | None = Body(default=None),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles('admin', 'manager', 'operator')),
) -> PackingListGeneratePdfResponse:
    record = _get_received_po_or_404(db, current_user.company_id, received_po_id)
    packing_list = _get_packing_list_or_404(db, current_user.company_id, received_po_id)
    packing_template = _resolve_packing_list_template(
        db,
        current_user.company_id,
        record,
        template_id=payload.template_id if payload else None,
        existing_packing_list=packing_list,
    )
    _apply_packing_list_template_snapshot(packing_list, packing_template, distributor=record.distributor)
    packing_list.status = 'draft'
    packing_list.file_url = None
    log_received_po_agent_event(
        db,
        record,
        event_type='agent.packing_list_pdf_queued',
        title='Packing-list PDF generation queued',
        summary='The autopilot queued the final packing-list PDF from the carton breakdown.',
        status=STATUS_QUEUED,
        tool_name='packing_list_pdf_generator',
        metadata={'packing_list_id': packing_list.id, 'template_id': packing_list.template_id},
    )
    enqueue_processing_job(
        db,
        company_id=current_user.company_id,
        job_type=JOB_TYPE_RECEIVED_PO_PACKING_LIST_PDF,
        payload={'packing_list_id': packing_list.id, 'received_po_id': received_po_id},
        created_by_user_id=current_user.id,
    )
    db.commit()
    return PackingListGeneratePdfResponse(
        packing_list_id=packing_list.id,
        status=packing_list.status,
        file_url=packing_list.file_url,
        template_id=packing_list.template_id,
        template_name=packing_list.template_name,
        layout_key=packing_list.layout_key,
    )
