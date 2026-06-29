import json
import logging
import math
import re
from collections import OrderedDict
from dataclasses import dataclass

logger = logging.getLogger(__name__)

from datetime import timezone
from contextlib import contextmanager
from io import BytesIO
from pathlib import Path
from urllib.parse import urlparse
from urllib.request import urlopen
from xml.sax.saxutils import escape

from barcode import Code128, Code39, EAN13
from barcode.writer import ImageWriter
from PIL import Image
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.lib.utils import ImageReader
from reportlab import rl_config
from reportlab.pdfgen import canvas
from reportlab.platypus import Image as PlatypusImage
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle
from sqlalchemy.orm import Session

from app.db.session import SessionLocal
from app.models.barcode_job import BarcodeJob
from app.models.company_settings import CompanySettings
from app.models.invoice import Invoice, InvoiceLineItem
from app.models.packing_list import PackingList
from app.models.received_po import ReceivedPO, ReceivedPOLineItem
from app.models.sticker_template import StickerElement, StickerTemplate
from app.services.buyer_document_templates import DEFAULT_INVOICE_LAYOUT_KEY, LANDMARK_INVOICE_LAYOUT_KEY
from app.services.object_storage import get_object_storage_service
from app.services.received_po_agent import STATUS_FAILED, log_received_po_agent_event
from app.utils.amount_words import convert_to_words

object_storage = get_object_storage_service()
GENERATED_DIR = Path('static/generated')
STATIC_DIR = Path('static')
STYLI_LOGO_PATH = Path(__file__).resolve().parents[2] / 'assets' / 'styli_logo.png'
PINK_BORDER = colors.Color(220 / 255, 80 / 255, 150 / 255)
STYLI_SIZE_CODE_MAP = {
    'S': '02',
    'M': '03',
    'L': '04',
    'XL': '05',
    'XXL': '30',
}
CUSTOM_FORMULA_FIELDS = {
    'po_number',
    'model_number',
    'option_id',
    'size',
    'styli_sku',
    'brand_name',
    'sku_id',
    'color',
    'quantity',
    'instagram_handle',
    'website_url',
    'facebook_handle',
    'snapchat_handle',
}
CUSTOM_FORMULA_TOKEN = re.compile(
    r"""
    \s*
    (
        (?P<field>po_number|model_number|option_id|size|styli_sku|brand_name|sku_id|color|quantity|instagram_handle|website_url|facebook_handle|snapchat_handle)
        | (?P<string>'[^']*'|"[^"]*")
        | (?P<plus>\+)
    )
    \s*
    """,
    re.VERBOSE,
)


@dataclass
class BarcodeSheetResult:
    file_url: str
    total_stickers: int
    total_pages: int


def _json_loads(raw: str | None) -> dict[str, object]:
    if not raw:
        return {}
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        return {}
    return parsed if isinstance(parsed, dict) else {}


def _escape_pdf_text(value: str) -> str:
    return value.replace('\\', '\\\\').replace('(', '\\(').replace(')', '\\)')


def _build_simple_pdf(pages: list[list[str]]) -> bytes:
    font_size = 10
    page_width = 595
    page_height = 842
    margin_left = 36
    top = 806
    line_height = 14

    objects: list[bytes] = []

    def add_object(payload: bytes) -> int:
        objects.append(payload)
        return len(objects)

    font_id = add_object(b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>')
    content_ids: list[int] = []
    page_ids: list[int] = []

    for page_lines in pages:
        cleaned_lines = page_lines or ['']
        content_lines = ['BT', f'/F1 {font_size} Tf', f'{margin_left} {top} Td']
        for index, line in enumerate(cleaned_lines):
            if index == 0:
                content_lines.append(f'({_escape_pdf_text(line[:110])}) Tj')
            else:
                content_lines.append(f'0 -{line_height} Td')
                content_lines.append(f'({_escape_pdf_text(line[:110])}) Tj')
        content_lines.append('ET')
        stream = '\n'.join(content_lines).encode('latin-1', errors='replace')
        content_id = add_object(f'<< /Length {len(stream)} >>\nstream\n'.encode() + stream + b'\nendstream')
        content_ids.append(content_id)
        page_ids.append(-1)

    pages_id = add_object(b'')
    for index, content_id in enumerate(content_ids):
        page_payload = (
            f'<< /Type /Page /Parent {pages_id} 0 R /MediaBox [0 0 {page_width} {page_height}] '
            f'/Resources << /Font << /F1 {font_id} 0 R >> >> /Contents {content_id} 0 R >>'
        ).encode()
        page_ids[index] = add_object(page_payload)

    kids = ' '.join(f'{page_id} 0 R' for page_id in page_ids)
    objects[pages_id - 1] = f'<< /Type /Pages /Count {len(page_ids)} /Kids [{kids}] >>'.encode()
    catalog_id = add_object(f'<< /Type /Catalog /Pages {pages_id} 0 R >>'.encode())

    pdf = bytearray(b'%PDF-1.4\n')
    offsets = [0]
    for index, payload in enumerate(objects, start=1):
        offsets.append(len(pdf))
        pdf.extend(f'{index} 0 obj\n'.encode())
        pdf.extend(payload)
        pdf.extend(b'\nendobj\n')

    xref_start = len(pdf)
    pdf.extend(f'xref\n0 {len(objects) + 1}\n'.encode())
    pdf.extend(b'0000000000 65535 f \n')
    for offset in offsets[1:]:
        pdf.extend(f'{offset:010d} 00000 n \n'.encode())
    pdf.extend(
        (
            f'trailer\n<< /Size {len(objects) + 1} /Root {catalog_id} 0 R >>\n'
            f'startxref\n{xref_start}\n%%EOF'
        ).encode()
    )
    return bytes(pdf)


def _uncompressed_canvas(*args, **kwargs):
    kwargs.setdefault('pageCompression', 0)
    return canvas.Canvas(*args, **kwargs)


@contextmanager
def _debug_friendly_pdf_streams():
    previous_page_compression = getattr(rl_config, 'pageCompression', 1)
    previous_use_a85 = getattr(rl_config, 'useA85', 1)
    rl_config.pageCompression = 0
    rl_config.useA85 = 0
    try:
        yield
    finally:
        rl_config.pageCompression = previous_page_compression
        rl_config.useA85 = previous_use_a85


def _write_generated_pdf(*, key: str, content: bytes) -> str:
    if object_storage.enabled:
        stored_url = object_storage.upload_bytes(key=key, content=content, content_type='application/pdf')
        if stored_url:
            return stored_url

    relative_path = Path(key)
    local_path = GENERATED_DIR / relative_path
    local_path.parent.mkdir(parents=True, exist_ok=True)
    local_path.write_bytes(content)
    return f'/static/generated/{relative_path.as_posix()}'


def _normalize_color(value: str | None, fallback: colors.Color = colors.black) -> colors.Color:
    if not value:
        return fallback
    cleaned = value.strip()
    if not cleaned:
        return fallback
    if not cleaned.startswith('#'):
        cleaned = f'#{cleaned}'
    try:
        return colors.HexColor(cleaned)
    except ValueError:
        return fallback


def _local_static_path_from_url(asset_url: str) -> Path | None:
    if asset_url.startswith('/static/'):
        return STATIC_DIR / Path(asset_url.removeprefix('/static/'))
    if asset_url.startswith('/api/v1/static/'):
        return STATIC_DIR / Path(asset_url.removeprefix('/api/v1/static/'))
    if asset_url.startswith('static/'):
        return Path(asset_url)
    if asset_url.startswith('api/v1/static/'):
        return STATIC_DIR / Path(asset_url.removeprefix('api/v1/static/'))
    if asset_url.startswith('/api/v1/uploads/'):
        return STATIC_DIR / 'uploads' / Path(asset_url.removeprefix('/api/v1/uploads/'))
    if asset_url.startswith('api/v1/uploads/'):
        return STATIC_DIR / 'uploads' / Path(asset_url.removeprefix('api/v1/uploads/'))
    if asset_url.startswith('/uploads/'):
        return STATIC_DIR / Path(asset_url.removeprefix('/'))
    if asset_url.startswith('uploads/'):
        return STATIC_DIR / Path(asset_url)
    try:
        parsed = urlparse(asset_url)
        if parsed.path.startswith('/static/'):
            return STATIC_DIR / Path(parsed.path.removeprefix('/static/'))
        if parsed.path.startswith('/api/v1/static/'):
            return STATIC_DIR / Path(parsed.path.removeprefix('/api/v1/static/'))
        if parsed.path.startswith('static/'):
            return Path(parsed.path)
        if parsed.path.startswith('/api/v1/uploads/'):
            return STATIC_DIR / 'uploads' / Path(parsed.path.removeprefix('/api/v1/uploads/'))
        if parsed.path.startswith('api/v1/uploads/'):
            return STATIC_DIR / 'uploads' / Path(parsed.path.removeprefix('api/v1/uploads/'))
        if parsed.path.startswith('/uploads/'):
            return STATIC_DIR / Path(parsed.path.removeprefix('/'))
        if parsed.path.startswith('uploads/'):
            return STATIC_DIR / Path(parsed.path)
    except Exception:
        return None
    return None


def _load_image_reader(asset_url: str | None) -> ImageReader | None:
    if not asset_url:
        return None

    def _reader_from_bytes(content: bytes) -> ImageReader | None:
        try:
            return ImageReader(BytesIO(content))
        except Exception:
            try:
                image = Image.open(BytesIO(content))
                converted = BytesIO()
                image.save(converted, format='PNG')
                converted.seek(0)
                return ImageReader(converted)
            except Exception:
                return None

    try:
        object_storage_bytes = object_storage.download_bytes_for_url(asset_url)
        if object_storage_bytes is not None:
            return _reader_from_bytes(object_storage_bytes)

        local_path = _local_static_path_from_url(asset_url)
        if local_path is not None and local_path.exists():
            return _reader_from_bytes(local_path.read_bytes())

        file_path = Path(asset_url)
        if file_path.is_absolute() and file_path.exists():
            return _reader_from_bytes(file_path.read_bytes())

        if asset_url.startswith(('http://', 'https://')):
            with urlopen(asset_url, timeout=5) as response:  # noqa: S310
                return _reader_from_bytes(response.read())
    except Exception:
        return None

    return None


def _resolve_template_image_reader(properties: dict[str, object]) -> ImageReader | None:
    asset_url = str(properties.get('asset_url') or '').strip()
    return _load_image_reader(asset_url)


def _chunk_lines(lines: list[str], *, page_size: int = 48) -> list[list[str]]:
    if not lines:
        return [['']]
    return [lines[index : index + page_size] for index in range(0, len(lines), page_size)]


def _amount_to_words(value: float) -> str:
    units = [
        'zero',
        'one',
        'two',
        'three',
        'four',
        'five',
        'six',
        'seven',
        'eight',
        'nine',
        'ten',
        'eleven',
        'twelve',
        'thirteen',
        'fourteen',
        'fifteen',
        'sixteen',
        'seventeen',
        'eighteen',
        'nineteen',
    ]
    tens = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety']

    def _under_thousand(number: int) -> str:
        parts: list[str] = []
        if number >= 100:
            parts.append(f'{units[number // 100]} hundred')
            number %= 100
        if number >= 20:
            parts.append(tens[number // 10])
            if number % 10:
                parts.append(units[number % 10])
        elif number > 0 or not parts:
            parts.append(units[number])
        return ' '.join(part for part in parts if part)

    whole = int(value)
    paise = int(round((value - whole) * 100))
    if whole == 0:
        words = 'zero'
    else:
        groups = [
            (10000000, 'crore'),
            (100000, 'lakh'),
            (1000, 'thousand'),
        ]
        remaining = whole
        parts: list[str] = []
        for divisor, label in groups:
            if remaining >= divisor:
                count, remaining = divmod(remaining, divisor)
                parts.append(f'{_under_thousand(count)} {label}')
        if remaining:
            parts.append(_under_thousand(remaining))
        words = ' '.join(parts)
    if paise:
        return f'{words} rupees and {_under_thousand(paise)} paise only'
    return f'{words} rupees only'


def _brand_profile(company_settings: CompanySettings | None) -> dict[str, object]:
    settings_payload = _json_loads(company_settings.settings_json if company_settings else '{}')
    brand_profile = settings_payload.get('brand_profile')
    return brand_profile if isinstance(brand_profile, dict) else {}


def _styli_size_code(size: str | None) -> str:
    return STYLI_SIZE_CODE_MAP.get(str(size or '').strip().upper(), '02')


def _build_styli_sku(option_id: str | None, size: str | None) -> str | None:
    normalized_option_id = str(option_id or '').strip()
    if not normalized_option_id:
        return None
    return f'{normalized_option_id}{_styli_size_code(size)}'


def _resolve_model_display_value(model_number: str | None, brand_style_code: str | None) -> str | None:
    normalized_model_number = str(model_number or '').strip()
    if normalized_model_number:
        return normalized_model_number
    normalized_brand_style_code = str(brand_style_code or '').strip()
    return normalized_brand_style_code or None


def _sticker_line_item_record(
    *,
    po_number: str | None,
    model_number: str | None,
    option_id: str | None,
    size: str | None,
    quantity: int,
    sku_id: str | None = None,
    color: str | None = None,
    brand_name: str | None = None,
    styli_sku: str | None = None,
    instagram_handle: str | None = None,
    website_url: str | None = None,
    facebook_handle: str | None = None,
    snapchat_handle: str | None = None,
) -> dict[str, object]:
    return {
        'po_number': str(po_number or '').strip() or '-',
        'model_number': str(model_number or '').strip() or '-',
        'option_id': str(option_id or '').strip() or '-',
        'size': str(size or '').strip() or '-',
        'styli_sku': str(styli_sku or '').strip() or None,
        'quantity': int(quantity or 0),
        'sku_id': str(sku_id or '').strip() or None,
        'color': str(color or '').strip() or None,
        'brand_name': str(brand_name or '').strip() or None,
        'instagram_handle': str(instagram_handle or '').strip() or None,
        'website_url': str(website_url or '').strip() or None,
        'facebook_handle': str(facebook_handle or '').strip() or None,
        'snapchat_handle': str(snapchat_handle or '').strip() or None,
    }


def _received_po_sticker_records(
    received_po: ReceivedPO,
    line_items: list[ReceivedPOLineItem],
    company_settings: CompanySettings | None,
) -> list[dict[str, object]]:
    brand_profile = _brand_profile(company_settings)
    brand_name = str(
        brand_profile.get('brand_name') or brand_profile.get('supplier_name') or 'Grada'
    ).strip()
    instagram_handle = str(brand_profile.get('instagram_handle') or '').strip() or None
    website_url = str(brand_profile.get('website_url') or '').strip() or None
    facebook_handle = str(brand_profile.get('facebook_handle') or '').strip() or None
    snapchat_handle = str(brand_profile.get('snapchat_handle') or '').strip() or None
    return [
        _sticker_line_item_record(
            po_number=received_po.po_number,
            model_number=_resolve_model_display_value(item.model_number, item.brand_style_code),
            option_id=item.option_id,
            size=item.size,
            styli_sku=_build_styli_sku(item.option_id, item.size),
            quantity=int(item.quantity or 0),
            sku_id=item.sku_id,
            color=item.color,
            brand_name=brand_name,
            instagram_handle=instagram_handle,
            website_url=website_url,
            facebook_handle=facebook_handle,
            snapchat_handle=snapchat_handle,
        )
        for item in line_items
    ]


def _dedupe_records(
    records: list[dict[str, object]],
    *,
    key_builder,
) -> list[dict[str, object]]:
    deduped: OrderedDict[str, dict[str, object]] = OrderedDict()
    for record in records:
        key = key_builder(record)
        existing = deduped.get(key)
        if existing is None:
            deduped[key] = dict(record)
            continue
        existing['quantity'] = int(existing.get('quantity') or 0) + int(record.get('quantity') or 0)
    return list(deduped.values())


def _styli_records(records: list[dict[str, object]]) -> list[dict[str, object]]:
    return _dedupe_records(
        records,
        key_builder=lambda record: '|'.join(
            [
                str(record.get('po_number') or ''),
                str(record.get('option_id') or ''),
                str(record.get('size') or ''),
            ]
        ),
    )


def _custom_records(records: list[dict[str, object]]) -> list[dict[str, object]]:
    return _dedupe_records(
        records,
        key_builder=lambda record: str(record.get('sku_id') or '')
        or '|'.join(
            [
                str(record.get('po_number') or ''),
                str(record.get('option_id') or ''),
                str(record.get('size') or ''),
            ]
        ),
    )


def _make_barcode_image(value: str, barcode_type: str) -> ImageReader:
    if barcode_type == 'qr':
        import qrcode

        qr = qrcode.QRCode(border=1, box_size=8)
        qr.add_data(value)
        qr.make(fit=True)
        image = qr.make_image(fill_color='black', back_color='white')
        output = BytesIO()
        image.save(output, format='PNG')
        output.seek(0)
        return ImageReader(output)

    barcode_class = {
        'code128': Code128,
        'code39': Code39,
        'ean13': EAN13,
    }.get(barcode_type)
    if barcode_class is None:
        raise ValueError(f'Unsupported barcode type: {barcode_type}')

    normalized_value = value
    if barcode_type == 'ean13':
        digits = ''.join(character for character in value if character.isdigit())
        if len(digits) == 13:
            digits = digits[:12]
        if len(digits) != 12:
            raise ValueError('EAN13 values must contain 12 digits before checksum.')
        normalized_value = digits

    barcode = barcode_class(normalized_value, writer=ImageWriter())
    output = BytesIO()
    barcode.write(
        output,
        {
            'module_width': 0.22,
            'module_height': 12,
            'font_size': 0,
            'text_distance': 1,
            'quiet_zone': 1.0,
            'write_text': False,
        },
    )
    output.seek(0)
    image = Image.open(output)
    converted = BytesIO()
    image.save(converted, format='PNG')
    converted.seek(0)
    return ImageReader(converted)


def _draw_cover_image(
    pdf: canvas.Canvas,
    image_reader: ImageReader,
    *,
    x: float,
    y: float,
    width: float,
    height: float,
    fit: str,
) -> None:
    image_width, image_height = image_reader.getSize()
    if image_width <= 0 or image_height <= 0:
        return

    width_ratio = width / image_width
    height_ratio = height / image_height
    ratio = max(width_ratio, height_ratio) if fit == 'cover' else min(width_ratio, height_ratio)
    draw_width = image_width * ratio
    draw_height = image_height * ratio
    draw_x = x + (width - draw_width) / 2
    draw_y = y + (height - draw_height) / 2
    pdf.drawImage(image_reader, draw_x, draw_y, width=draw_width, height=draw_height, preserveAspectRatio=False)


def _mm_to_points(value_mm: float) -> float:
    return float(value_mm) * mm


def _element_box(template_height_mm: float, x_mm: float, y_mm: float, width_mm: float, height_mm: float) -> tuple[float, float, float, float]:
    x_pt = _mm_to_points(x_mm)
    width_pt = _mm_to_points(width_mm)
    height_pt = _mm_to_points(height_mm)
    y_pt = _mm_to_points(template_height_mm - y_mm - height_mm)
    return x_pt, y_pt, width_pt, height_pt


def _evaluate_custom_formula(formula: str, record: dict[str, object]) -> str:
    cleaned = formula.strip()
    if not cleaned:
        return ''

    position = 0
    parts: list[str] = []
    expect_operand = True
    while position < len(cleaned):
        match = CUSTOM_FORMULA_TOKEN.match(cleaned, position)
        if match is None:
            raise ValueError('Formula supports only field names, quoted strings, and + operators.')
        token = match.group(0)
        position = match.end()
        field_name = match.group('field')
        string_token = match.group('string')
        plus_token = match.group('plus')

        if plus_token:
            if expect_operand:
                raise ValueError('Formula cannot start with +.')
            expect_operand = True
            continue

        if not expect_operand:
            raise ValueError('Formula pieces must be joined with +.')

        if field_name:
            if field_name not in CUSTOM_FORMULA_FIELDS:
                raise ValueError(f'Unsupported field in formula: {field_name}')
            value = record.get(field_name)
            parts.append('' if value is None else str(value))
        elif string_token:
            parts.append(string_token[1:-1])
        expect_operand = False

        if token == '':
            break

    if expect_operand:
        raise ValueError('Formula cannot end with +.')
    return ''.join(parts)


def _resolve_dynamic_value(field: str | None, properties: dict[str, object], record: dict[str, object]) -> str:
    if field in {'instagram_handle', 'website_url', 'facebook_handle', 'snapchat_handle'}:
        return str(properties.get('social_value') or '').strip()
    if field in {'custom', 'custom_formula'}:
        return _evaluate_custom_formula(str(properties.get('custom_formula') or ''), record)
    if not field:
        return ''
    value = record.get(field)
    return '' if value is None else str(value)


def _fit_font_size_to_width(
    pdf: canvas.Canvas,
    *,
    text: str,
    font_name: str,
    font_size: float,
    width: float,
    min_font_size: float = 5.5,
) -> float:
    fitted_font_size = max(font_size, min_font_size)
    while fitted_font_size > min_font_size and pdf.stringWidth(text, font_name, fitted_font_size) > width:
        fitted_font_size = round(max(min_font_size, fitted_font_size - 0.25), 2)
    return fitted_font_size


def _truncate_text_to_width(
    pdf: canvas.Canvas,
    *,
    text: str,
    font_name: str,
    font_size: float,
    width: float,
) -> str:
    if not text or width <= 0:
        return ''
    if pdf.stringWidth(text, font_name, font_size) <= width:
        return text
    ellipsis = '...'
    ellipsis_width = pdf.stringWidth(ellipsis, font_name, font_size)
    if ellipsis_width >= width:
        return ellipsis
    truncated = text
    while truncated and pdf.stringWidth(f'{truncated}{ellipsis}', font_name, font_size) > width:
        truncated = truncated[:-1]
    return f'{truncated.rstrip()}{ellipsis}' if truncated else ellipsis


def _draw_text_span(
    pdf: canvas.Canvas,
    *,
    x: float,
    y: float,
    width: float,
    height: float,
    text: str,
    font_size: float,
    font_name: str,
    alignment: str,
    color: colors.Color,
) -> None:
    padding = 1.2
    available_width = max(width - padding * 2, 0)
    if available_width <= 0:
        return
    max_font_size = max(5.5, min(font_size, height - 1.2))
    fitted_font_size = _fit_font_size_to_width(
        pdf,
        text=text,
        font_name=font_name,
        font_size=max_font_size,
        width=available_width,
    )
    fitted_text = _truncate_text_to_width(
        pdf,
        text=text,
        font_name=font_name,
        font_size=fitted_font_size,
        width=available_width,
    )
    pdf.setFillColor(color)
    pdf.setFont(font_name, fitted_font_size)
    if alignment == 'right':
        pdf.drawRightString(x + width - padding, y, fitted_text)
    elif alignment == 'center':
        pdf.drawCentredString(x + width / 2, y, fitted_text)
    else:
        pdf.drawString(x + padding, y, fitted_text)


def _draw_dynamic_text(
    pdf: canvas.Canvas,
    *,
    x: float,
    y: float,
    width: float,
    height: float,
    label: str,
    value: str,
    font_size: float,
    alignment: str,
    color: colors.Color,
    label_weight: str,
    value_weight: str,
) -> None:
    label_font = 'Helvetica-Bold' if label_weight == 'bold' else 'Helvetica'
    value_font = 'Helvetica-Bold' if value_weight == 'bold' else 'Helvetica'
    padding = 1.2
    available_width = max(width - padding * 2, 0)
    if available_width <= 0:
        return
    fitted_font_size = max(5.5, min(font_size, height - 1.2))
    label_width = pdf.stringWidth(label, label_font, fitted_font_size)
    value_width = pdf.stringWidth(value, value_font, fitted_font_size)
    total_width = label_width + value_width
    while fitted_font_size > 5.5 and total_width > available_width:
        fitted_font_size = round(max(5.5, fitted_font_size - 0.25), 2)
        label_width = pdf.stringWidth(label, label_font, fitted_font_size)
        value_width = pdf.stringWidth(value, value_font, fitted_font_size)
        total_width = label_width + value_width

    fitted_label = label
    fitted_value = value
    if total_width > available_width:
        fitted_label = _truncate_text_to_width(
            pdf,
            text=label,
            font_name=label_font,
            font_size=fitted_font_size,
            width=min(label_width, available_width * 0.55) if label else 0,
        )
        fitted_label_width = pdf.stringWidth(fitted_label, label_font, fitted_font_size)
        fitted_value = _truncate_text_to_width(
            pdf,
            text=value,
            font_name=value_font,
            font_size=fitted_font_size,
            width=max(available_width - fitted_label_width, 0),
        )
        label_width = pdf.stringWidth(fitted_label, label_font, fitted_font_size)
        value_width = pdf.stringWidth(fitted_value, value_font, fitted_font_size)
        total_width = label_width + value_width

    if alignment == 'right':
        start_x = x + width - padding - total_width
    elif alignment == 'center':
        start_x = x + (width - total_width) / 2
    else:
        start_x = x + padding

    pdf.setFillColor(color)
    pdf.setFont(label_font, fitted_font_size)
    pdf.drawString(start_x, y, fitted_label)
    pdf.setFont(value_font, fitted_font_size)
    pdf.drawString(start_x + label_width, y, fitted_value)


def _draw_styli_logo(pdf: canvas.Canvas, *, x: float, y: float, width: float, height: float) -> None:
    if STYLI_LOGO_PATH.exists():
        pdf.drawImage(str(STYLI_LOGO_PATH), x, y, width=width, height=height, preserveAspectRatio=True, anchor='c')
        return

    pdf.setStrokeColor(PINK_BORDER)
    pdf.setFillColor(colors.white)
    pdf.roundRect(x, y, width, height, 1.4 * mm, stroke=1, fill=1)
    pdf.setFillColor(colors.black)
    pdf.setFont('Helvetica-Bold', 11)
    pdf.drawCentredString(x + width / 2, y + height / 2 - 4, 'STYLI')


def _draw_social_icon(pdf: canvas.Canvas, *, center_x: float, center_y: float, label: str) -> None:
    radius = 1.4 * mm
    pdf.setFillColor(colors.black)
    pdf.circle(center_x, center_y, radius, stroke=0, fill=1)
    pdf.setFillColor(colors.white)
    pdf.setFont('Helvetica-Bold', 6)
    pdf.drawCentredString(center_x, center_y - 2, label)


def _social_icon_spec(field: str) -> tuple[str, colors.Color]:
    specs = {
        'instagram_handle': ('I', colors.HexColor('#E1306C')),
        'website_url': ('W', colors.HexColor('#3B3B3B')),
        'facebook_handle': ('F', colors.HexColor('#1877F2')),
        'snapchat_handle': ('S', colors.HexColor('#FFFC00')),
    }
    return specs.get(field, ('@', colors.black))


def _draw_social_handle_field(
    pdf: canvas.Canvas,
    *,
    x: float,
    y: float,
    width: float,
    height: float,
    field: str,
    text: str,
    font_size: float,
    alignment: str,
    color: colors.Color,
) -> None:
    icon_label, icon_color = _social_icon_spec(field)
    padding = 1.2
    available_width = max(width - padding * 2, 0)
    if available_width <= 0:
        return
    fitted_font_size = max(5, min(font_size, height - 1))
    radius = max(3.3, min(4.8, fitted_font_size * 0.5))
    gap = 2
    text_width = pdf.stringWidth(text, 'Helvetica', fitted_font_size)
    total_width = radius * 2 + gap + text_width
    while fitted_font_size > 5 and total_width > available_width:
        fitted_font_size = round(max(5, fitted_font_size - 0.25), 2)
        radius = max(3.3, min(4.8, fitted_font_size * 0.5))
        text_width = pdf.stringWidth(text, 'Helvetica', fitted_font_size)
        total_width = radius * 2 + gap + text_width
    fitted_text = text
    if total_width > available_width:
        text_width = max(available_width - radius * 2 - gap, 0)
        fitted_text = _truncate_text_to_width(
            pdf,
            text=text,
            font_name='Helvetica',
            font_size=fitted_font_size,
            width=text_width,
        )
        total_width = radius * 2 + gap + pdf.stringWidth(fitted_text, 'Helvetica', fitted_font_size)

    if alignment == 'right':
        start_x = x + width - padding - total_width
    elif alignment == 'center':
        start_x = x + (width - total_width) / 2
    else:
        start_x = x + padding

    pdf.setFillColor(icon_color)
    icon_center_y = y + fitted_font_size * 0.32
    pdf.circle(start_x + radius, icon_center_y, radius, stroke=0, fill=1)
    pdf.setFillColor(colors.black if field == 'snapchat_handle' else colors.white)
    icon_font_size = max(5, fitted_font_size - 1)
    pdf.setFont('Helvetica-Bold', icon_font_size)
    pdf.drawCentredString(start_x + radius, icon_center_y - icon_font_size * 0.35, icon_label)
    pdf.setFillColor(color)
    pdf.setFont('Helvetica', fitted_font_size)
    pdf.drawString(start_x + radius * 2 + gap, y, fitted_text)


def _clip_to_box(pdf: canvas.Canvas, *, x: float, y: float, width: float, height: float) -> None:
    path = pdf.beginPath()
    path.rect(x, y, width, height)
    pdf.clipPath(path, stroke=0, fill=0)


def _draw_styli_sticker(pdf: canvas.Canvas, *, x: float, y: float, sticker: dict[str, object]) -> None:
    sticker_width = 45.03 * mm
    sticker_height = 60 * mm

    pdf.setLineWidth(0.5)
    pdf.setStrokeColor(PINK_BORDER)
    pdf.setFillColor(colors.white)
    pdf.roundRect(x, y, sticker_width, sticker_height, 2 * mm, stroke=1, fill=1)

    logo_height = 9.8 * mm
    _draw_styli_logo(
        pdf,
        x=x + 8.5 * mm,
        y=y + sticker_height - 13.4 * mm,
        width=28 * mm,
        height=logo_height,
    )

    center_x = x + sticker_width / 2
    cursor_y = y + sticker_height - 17.7 * mm

    pdf.setFillColor(colors.black)
    pdf.setFont('Helvetica', 11)
    pdf.drawCentredString(center_x, cursor_y, f"PO No : {sticker['po_number']}")
    cursor_y -= 4.9 * mm
    pdf.drawCentredString(center_x, cursor_y, f"Model No. : {sticker['model_number']}")
    cursor_y -= 4.9 * mm
    pdf.drawCentredString(center_x, cursor_y, f"Option ID : {sticker['option_id']}")

    barcode_value = str(sticker.get('styli_sku') or _build_styli_sku(sticker.get('option_id'), sticker.get('size')) or '')
    barcode_image = _make_barcode_image(barcode_value, 'code128')
    barcode_width = 33 * mm
    barcode_height = 12.6 * mm
    barcode_y = y + 18.8 * mm
    pdf.drawImage(
        barcode_image,
        x + (sticker_width - barcode_width) / 2,
        barcode_y,
        width=barcode_width,
        height=barcode_height,
        preserveAspectRatio=False,
    )

    pdf.setFont('Helvetica', 8)
    pdf.drawCentredString(center_x, barcode_y - 3.5 * mm, barcode_value)

    pdf.setFont('Helvetica', 8)
    pdf.drawCentredString(center_x, y + 14.2 * mm, f"Qty: {int(sticker['quantity'])}")
    pdf.setFont('Helvetica-Bold', 14)
    pdf.drawCentredString(center_x, y + 10.2 * mm, f"Size : {sticker['size']}")
    pdf.setFont('Helvetica', 9)
    pdf.drawCentredString(center_x, y + 6.7 * mm, 'Made in India')
    pdf.setFont('Helvetica', 8)
    pdf.drawCentredString(center_x, y + 4.1 * mm, 'Follow us')
    underline_width = pdf.stringWidth('Follow us', 'Helvetica', 8)
    pdf.line(center_x - underline_width / 2, y + 3.8 * mm, center_x + underline_width / 2, y + 3.8 * mm)

    row_y = y + 1.7 * mm
    left_icon_x = x + 9 * mm
    right_icon_x = x + 27.5 * mm
    _draw_social_icon(pdf, center_x=left_icon_x, center_y=row_y + 1.7 * mm, label='S')
    pdf.setFillColor(colors.black)
    pdf.setFont('Helvetica', 6.6)
    pdf.drawString(left_icon_x + 2.3 * mm, row_y, '/styliofficial')
    _draw_social_icon(pdf, center_x=right_icon_x, center_y=row_y + 1.7 * mm, label='I')
    pdf.drawString(right_icon_x + 2.3 * mm, row_y, '/styli_official')


def _render_sticker_template(
    pdf: canvas.Canvas,
    *,
    template: StickerTemplate,
    elements: list[StickerElement],
    sticker: dict[str, object],
    origin_x: float,
    origin_y: float,
) -> None:
    template_width = _mm_to_points(float(template.width_mm))
    template_height = _mm_to_points(float(template.height_mm))
    pdf.saveState()
    pdf.translate(origin_x, origin_y)
    pdf.setFillColor(_normalize_color(template.background_color, colors.white))
    pdf.setStrokeColor(_normalize_color(template.border_color, colors.black))
    pdf.setLineWidth(0.5)
    pdf.roundRect(
        0,
        0,
        template_width,
        template_height,
        _mm_to_points(float(template.border_radius_mm)),
        stroke=1 if template.border_color else 0,
        fill=1,
    )

    for element in sorted(elements, key=lambda item: (item.z_index, item.created_at)):
        props = element.properties if isinstance(element.properties, dict) else {}
        box_x, box_y, box_width, box_height = _element_box(
            float(template.height_mm),
            float(element.x_mm),
            float(element.y_mm),
            float(element.width_mm),
            float(element.height_mm),
        )
        absolute_x = box_x
        absolute_y = box_y
        alignment = str(props.get('alignment') or 'left')
        font_size = float(props.get('font_size') or 10)
        effective_font_size = max(5, min(font_size, box_height - 1.2))
        text_y = absolute_y + max(effective_font_size * 0.25, (box_height - effective_font_size) / 2)
        color = _normalize_color(str(props.get('color') or '#000000'))

        if element.element_type == 'text_static':
            font_name = 'Helvetica-Bold' if str(props.get('font_weight') or 'normal') == 'bold' else 'Helvetica'
            pdf.saveState()
            _clip_to_box(pdf, x=absolute_x, y=absolute_y, width=box_width, height=box_height)
            _draw_text_span(
                pdf,
                x=absolute_x,
                y=text_y,
                width=box_width,
                height=box_height,
                text=str(props.get('content') or ''),
                font_size=font_size,
                font_name=font_name,
                alignment=alignment,
                color=color,
            )
            pdf.restoreState()
            continue

        if element.element_type == 'text_dynamic':
            field = str(props.get('field') or '')
            label = str(props.get('label') or '')
            value = _resolve_dynamic_value(field, props, sticker)
            if field in {'instagram_handle', 'website_url', 'facebook_handle', 'snapchat_handle'} and value:
                pdf.saveState()
                _clip_to_box(pdf, x=absolute_x, y=absolute_y, width=box_width, height=box_height)
                _draw_social_handle_field(
                    pdf,
                    x=absolute_x,
                    y=text_y,
                    width=box_width,
                    height=box_height,
                    field=field,
                    text=value,
                    font_size=font_size,
                    alignment=alignment,
                    color=color,
                )
                pdf.restoreState()
                continue
            pdf.saveState()
            _clip_to_box(pdf, x=absolute_x, y=absolute_y, width=box_width, height=box_height)
            _draw_dynamic_text(
                pdf,
                x=absolute_x,
                y=text_y,
                width=box_width,
                height=box_height,
                label=label,
                value=value,
                font_size=font_size,
                alignment=alignment,
                color=color,
                label_weight=str(props.get('label_weight') or 'normal'),
                value_weight=str(props.get('value_weight') or 'bold'),
            )
            pdf.restoreState()
            continue

        if element.element_type == 'barcode':
            field = str(props.get('field') or '')
            barcode_value = _resolve_dynamic_value(field, props, sticker)
            if not barcode_value:
                continue
            barcode_type = str(props.get('barcode_type') or 'code128')
            barcode_image = _make_barcode_image(barcode_value, barcode_type)
            draw_height = box_height - (8 if props.get('show_number') else 0)
            _draw_cover_image(
                pdf,
                barcode_image,
                x=absolute_x,
                y=absolute_y + (box_height - draw_height),
                width=box_width,
                height=draw_height,
                fit='contain',
            )
            if props.get('show_number'):
                pdf.setFillColor(colors.black)
                pdf.setFont('Helvetica', float(props.get('number_font_size') or 7))
                pdf.drawCentredString(
                    absolute_x + box_width / 2,
                    absolute_y + 1,
                    barcode_value,
                )
            continue

        if element.element_type == 'image':
            asset_type = str(props.get('asset_type') or '').strip().lower()
            asset_url = str(props.get('asset_url') or '').strip()
            image_reader = _resolve_template_image_reader(props)
            if image_reader is None:
                if asset_type == 'logo' and not asset_url:
                    _draw_styli_logo(
                        pdf,
                        x=absolute_x,
                        y=absolute_y,
                        width=box_width,
                        height=box_height,
                    )
                    continue
                if asset_url:
                    logger.warning('Template image asset could not be loaded for PDF generation: %s', asset_url)
                pdf.setStrokeColor(colors.lightgrey)
                pdf.rect(absolute_x, absolute_y, box_width, box_height, stroke=1, fill=0)
                pdf.setFillColor(colors.grey)
                pdf.setFont('Helvetica', 7)
                pdf.drawCentredString(absolute_x + box_width / 2, absolute_y + box_height / 2, 'Image')
                continue
            _draw_cover_image(
                pdf,
                image_reader,
                x=absolute_x,
                y=absolute_y,
                width=box_width,
                height=box_height,
                fit=str(props.get('fit') or 'contain'),
            )
            continue

        if element.element_type == 'line':
            pdf.setStrokeColor(_normalize_color(str(props.get('color') or '#000000')))
            pdf.setLineWidth(float(props.get('thickness_pt') or 0.5))
            if str(props.get('orientation') or 'horizontal') == 'vertical':
                x_mid = absolute_x + box_width / 2
                pdf.line(x_mid, absolute_y, x_mid, absolute_y + box_height)
            else:
                y_mid = absolute_y + box_height / 2
                pdf.line(absolute_x, y_mid, absolute_x + box_width, y_mid)

    pdf.restoreState()


def _build_sheet_pdf(
    records: list[dict[str, object]],
    *,
    sticker_width_mm: float,
    sticker_height_mm: float,
    draw_sticker,
    max_columns: int = 2,
    margin_mm: float = 10,
    horizontal_gutter_mm: float = 5,
    vertical_gutter_mm: float = 5,
) -> tuple[bytes, int]:
    pdf_buffer = BytesIO()
    pdf = canvas.Canvas(pdf_buffer, pagesize=A4, pageCompression=0)
    page_width, page_height = A4
    margin = margin_mm * mm
    horizontal_gutter = horizontal_gutter_mm * mm
    vertical_gutter = vertical_gutter_mm * mm
    sticker_width = sticker_width_mm * mm
    sticker_height = sticker_height_mm * mm
    usable_width = page_width - 2 * margin
    columns = max(1, min(max_columns, int((usable_width + horizontal_gutter) // (sticker_width + horizontal_gutter))))
    rows_per_page = max(1, int((page_height - (2 * margin) + vertical_gutter) // (sticker_height + vertical_gutter)))
    stickers_per_page = columns * rows_per_page
    total_pages = max(1, math.ceil(len(records) / stickers_per_page)) if records else 1
    row_width = sticker_width * columns + horizontal_gutter * max(columns - 1, 0)
    row_origin_x = margin + max(0, usable_width - row_width) / 2

    for index, record in enumerate(records or [{}]):
        slot = index % stickers_per_page
        if index > 0 and slot == 0:
            pdf.showPage()

        row = slot // columns
        column = slot % columns
        x = row_origin_x + column * (sticker_width + horizontal_gutter)
        y = page_height - margin - sticker_height - row * (sticker_height + vertical_gutter)
        draw_sticker(pdf, x=x, y=y, sticker=record)

    pdf.save()
    return pdf_buffer.getvalue(), total_pages


def build_styli_sheet_pdf(records: list[dict[str, object]]) -> tuple[bytes, int, int]:
    stickers = _styli_records(records)
    pdf_content, total_pages = _build_sheet_pdf(
        stickers,
        sticker_width_mm=45.03,
        sticker_height_mm=60.0,
        draw_sticker=_draw_styli_sticker,
        max_columns=4,
        margin_mm=7,
    )
    return pdf_content, len(stickers), total_pages


def build_custom_sheet_pdf(
    template: StickerTemplate,
    elements: list[StickerElement],
    records: list[dict[str, object]],
) -> tuple[bytes, int, int]:
    stickers = _custom_records(records)
    pdf_content, total_pages = _build_sheet_pdf(
        stickers,
        sticker_width_mm=float(template.width_mm),
        sticker_height_mm=float(template.height_mm),
        draw_sticker=lambda pdf, x, y, sticker: _render_sticker_template(
            pdf,
            template=template,
            elements=elements,
            sticker=sticker,
            origin_x=x,
            origin_y=y,
        ),
        max_columns=4,
        margin_mm=7,
    )
    return pdf_content, len(stickers), total_pages


def build_custom_preview_pdf(template: StickerTemplate, elements: list[StickerElement], sticker: dict[str, object]) -> bytes:
    pdf_buffer = BytesIO()
    pdf = canvas.Canvas(pdf_buffer, pagesize=A4, pageCompression=0)
    page_width, page_height = A4
    sticker_width = _mm_to_points(float(template.width_mm))
    sticker_height = _mm_to_points(float(template.height_mm))
    origin_x = (page_width - sticker_width) / 2
    origin_y = (page_height - sticker_height) / 2
    _render_sticker_template(
        pdf,
        template=template,
        elements=elements,
        sticker=sticker,
        origin_x=origin_x,
        origin_y=origin_y,
    )
    pdf.save()
    return pdf_buffer.getvalue()


def generate_styli_sheet_for_records(
    *,
    company_id: str,
    received_po_id: str,
    records: list[dict[str, object]],
) -> BarcodeSheetResult:
    pdf_content, total_stickers, total_pages = build_styli_sheet_pdf(records)
    file_url = _write_generated_pdf(
        key=f'barcodes/{company_id}/{received_po_id}/styli_sticker_sheet.pdf',
        content=pdf_content,
    )
    return BarcodeSheetResult(file_url=file_url, total_stickers=total_stickers, total_pages=total_pages)


def _get_template_or_404(db: Session, company_id: str, template_id: str) -> StickerTemplate:
    template = (
        db.query(StickerTemplate)
        .filter(StickerTemplate.id == template_id, StickerTemplate.company_id == company_id)
        .first()
    )
    if template is None:
        raise ValueError('Sticker template not found.')
    return template


def generate_custom_sheet_for_records(
    *,
    db: Session,
    company_id: str,
    received_po_id: str,
    template_id: str,
    records: list[dict[str, object]],
) -> BarcodeSheetResult:
    template = _get_template_or_404(db, company_id, template_id)
    elements = (
        db.query(StickerElement)
        .filter(StickerElement.template_id == template.id)
        .order_by(StickerElement.z_index.asc(), StickerElement.created_at.asc())
        .all()
    )
    pdf_content, total_stickers, total_pages = build_custom_sheet_pdf(template, elements, records)
    key = f'barcodes/{company_id}/{received_po_id}/custom_{template.id}.pdf'
    file_url = _write_generated_pdf(key=key, content=pdf_content)
    return BarcodeSheetResult(file_url=file_url, total_stickers=total_stickers, total_pages=total_pages)


def barcode_line_items_to_records(line_items: list[dict[str, object]]) -> list[dict[str, object]]:
    return [
        _sticker_line_item_record(
            po_number=str(item.get('po_number') or ''),
            model_number=str(item.get('model_number') or ''),
            option_id=str(item.get('option_id') or ''),
            size=str(item.get('size') or ''),
            styli_sku=str(item.get('styli_sku') or '') or _build_styli_sku(
                str(item.get('option_id') or ''),
                str(item.get('size') or ''),
            ),
            quantity=int(item.get('quantity') or 0),
            sku_id=str(item.get('sku_id') or '') or None,
            color=str(item.get('color') or '') or None,
            brand_name=str(item.get('brand_name') or '') or None,
            instagram_handle=str(item.get('instagram_handle') or '') or None,
            website_url=str(item.get('website_url') or '') or None,
            facebook_handle=str(item.get('facebook_handle') or '') or None,
            snapchat_handle=str(item.get('snapchat_handle') or '') or None,
        )
        for item in line_items
    ]


def sample_preview_record() -> dict[str, object]:
    return _sticker_line_item_record(
        po_number='70150792',
        model_number='IN000090128',
        option_id='7015079228',
        size='M',
        styli_sku=_build_styli_sku('7015079228', 'M'),
        quantity=7,
        sku_id='HRDS25001-A-BLACK-M',
        color='Black',
        brand_name='House Of Raeli',
        instagram_handle='@houseofraeli',
        website_url='houseofraeli.com',
        facebook_handle='houseofraeli',
        snapchat_handle='houseofraeli',
    )


def _invoice_pdf_lines(
    invoice: Invoice,
    received_po: ReceivedPO,
    line_items: list[ReceivedPOLineItem],
    company_settings: CompanySettings | None,
) -> list[str]:
    brand_profile = _brand_profile(company_settings)
    supplier_name = str(brand_profile.get('supplier_name') or 'Supplier')
    address = str(brand_profile.get('address') or '-')
    gst_number = str(brand_profile.get('gst_number') or '-')
    pan_number = str(brand_profile.get('pan_number') or '-')
    bill_to = str(brand_profile.get('bill_to_address') or '')
    ship_to = str(brand_profile.get('ship_to_address') or bill_to)

    lines = [
        'GRADA INVOICE',
        f'Supplier: {supplier_name}',
        f'Address: {address}',
        f'GST: {gst_number}',
        f'PAN: {pan_number}',
        f'Invoice Number: {invoice.invoice_number}',
        f'Invoice Date: {invoice.invoice_date.astimezone(timezone.utc).date().isoformat()}',
        f'PO Number: {received_po.po_number or "-"}',
        f'Bill To: {bill_to}',
        f'Ship To: {ship_to}',
        '',
        'Line Items',
    ]

    for item in line_items:
        taxable_amount = float(item.po_price or 0) * int(item.quantity or 0)
        lines.append(
            ' | '.join(
                [
                    str(item.brand_style_code or '-'),
                    str(item.option_id or '-'),
                    str(item.size or '-'),
                    f'Qty {int(item.quantity or 0)}',
                    f'Rate {float(item.po_price or 0):.2f}',
                    f'Taxable {taxable_amount:.2f}',
                ]
            )
        )

    lines.extend(
        [
            '',
            f'Subtotal: INR {float(invoice.subtotal):.2f}',
            f'IGST {float(invoice.igst_rate):.2f}%: INR {float(invoice.igst_amount):.2f}',
            f'Total: INR {float(invoice.total_amount):.2f}',
            f'Amount in words: {_amount_to_words(float(invoice.total_amount)).title()}',
            f'Gross weight: {float(invoice.gross_weight):.2f} kg' if invoice.gross_weight is not None else 'Gross weight: -',
        ]
    )
    return lines


def _build_packing_list_pdf(
    packing_list: PackingList,
    received_po: ReceivedPO,
    invoice: Invoice | None,
    line_items_by_id: dict[str, ReceivedPOLineItem],
    invoice_items_by_source_line_item: dict[str, InvoiceLineItem],
    invoice_items_by_neom_sku: dict[str, InvoiceLineItem],
    company_settings: CompanySettings | None,
) -> bytes:
    """Render a structured landscape A4 packing list PDF matching the sample format."""
    profile = _invoice_profile(invoice, company_settings)
    template_snapshot = _json_loads(packing_list.template_snapshot_json)
    template_layout = template_snapshot.get('layout') if isinstance(template_snapshot.get('layout'), dict) else {}
    title_text = str(template_layout.get('title') or 'PACKING LIST').strip() or 'PACKING LIST'
    meta_labels = template_layout.get('meta_labels') if isinstance(template_layout.get('meta_labels'), dict) else {}
    column_headers = (
        template_layout.get('column_headers')
        if isinstance(template_layout.get('column_headers'), dict)
        else {}
    )
    marketplace_name = (
        str(template_layout.get('marketplace_name') or '').strip()
        or profile['marketplace_name']
        or str(received_po.distributor or '').strip()
    )
    styles = _invoice_styles()
    buffer = BytesIO()
    document = SimpleDocTemplate(
        buffer,
        pagesize=landscape(A4),
        leftMargin=10 * mm,
        rightMargin=10 * mm,
        topMargin=10 * mm,
        bottomMargin=10 * mm,
    )
    story: list[object] = []

    # ---------- header ----------
    supplier_city_line = ' '.join(
        part for part in [profile['supplier_city'], profile['supplier_state'], profile['supplier_pincode']] if part
    )
    supplier_address_one, supplier_address_two = _invoice_address_pair(profile['address'], trailer=supplier_city_line)
    delivery_city_line = ' '.join(
        part for part in [profile['delivery_from_city'], profile['delivery_from_pincode']] if part
    )
    delivery_address_one, delivery_address_two = _invoice_address_pair(
        profile['delivery_from_address'], trailer=delivery_city_line
    )

    supplier_block = _invoice_label_value_block(
        [
            ('Supplier Name:', profile['fbs_name'] or profile['vendor_company_name'] or '-'),
            ('Vendor company name', profile['vendor_company_name'] or '-'),
            ('Address line 1', supplier_address_one),
            ('Address line 2', supplier_address_two),
            ('Supplier GSTNO:', profile['gst_number'] or '-'),
            ('Supplier PAN No:', profile['pan_number'] or '-'),
        ],
        total_width=75 * mm,
        label_width=19 * mm,
        style=styles['small'],
    )
    delivery_block = _invoice_label_value_block(
        [
            ('Delivery From:', profile['delivery_from_name'] or '-'),
            ('Company name', profile['delivery_from_name'] or '-'),
            ('Address line 1', delivery_address_one),
            ('Address line 2', delivery_address_two),
        ],
        total_width=75 * mm,
        label_width=19 * mm,
        style=styles['small'],
    )
    bill_to_lines = [
        'Bill To:',
        profile['bill_to_name'] or '-',
        *_invoice_address_lines(profile['bill_to_address']),
        f'Billed To GST NO: {profile["bill_to_gst"] or "-"}',
        f'Billed To PAN No: {profile["bill_to_pan"] or "-"}',
    ]
    ship_to_lines = [
        'Ship To :',
        profile['ship_to_name'] or '-',
        *_invoice_address_lines(profile['ship_to_address']),
        f'Ship To GST NO: {profile["ship_to_gst"] or "-"}',
    ]
    bill_to_block = _invoice_single_column_block(
        bill_to_lines, width=125 * mm, style=styles['small'],
        bold_rows={0, 1, len(bill_to_lines) - 2, len(bill_to_lines) - 1},
        highlight_rows={len(bill_to_lines) - 2, len(bill_to_lines) - 1},
    )
    ship_to_block = _invoice_single_column_block(
        ship_to_lines, width=125 * mm, style=styles['small'],
        bold_rows={0, 1, len(ship_to_lines) - 1},
        highlight_rows={len(ship_to_lines) - 1},
    )

    # Right meta panel reuses invoice fields when linked
    inv_number = packing_list.invoice_number or (invoice.invoice_number if invoice else '-') or '-'
    inv_date_str = '-'
    if packing_list.invoice_date is not None:
        inv_date_str = packing_list.invoice_date.astimezone(timezone.utc).strftime('%d/%m/%Y')
    elif invoice is not None and invoice.invoice_date is not None:
        inv_date_str = invoice.invoice_date.astimezone(timezone.utc).strftime('%d/%m/%Y')
    carton_count_str = str(len(packing_list.cartons))
    total_gross = sum(float(c.gross_weight or 0) for c in packing_list.cartons if c.gross_weight is not None)
    gross_str = f'{total_gross:.2f} kg' if total_gross else '-'
    export_mode = invoice.export_mode if invoice else 'Air'
    meta_block = _invoice_label_value_block(
        [
            (str(meta_labels.get('invoice_number') or 'INVOICE NO'), inv_number),
            (str(meta_labels.get('invoice_date') or 'INVOICE DATE'), inv_date_str),
            (str(meta_labels.get('po_number') or 'PO NUMBER'), str(received_po.po_number or '-')),
            (str(meta_labels.get('carton_count') or 'NO.OF.CARTONS'), carton_count_str),
            (str(meta_labels.get('gross_weight') or 'Gross weight'), gross_str),
            (
                str(meta_labels.get('shipment_mode') or f'Export Shipment Mode by {marketplace_name}'),
                export_mode,
            ),
        ],
        total_width=67 * mm,
        label_width=28 * mm,
        style=styles['small'],
    )

    header_content = Table(
        [[[
            supplier_block, Spacer(1, 3 * mm), delivery_block
        ], [
            bill_to_block, Spacer(1, 3 * mm), ship_to_block
        ], meta_block]],
        colWidths=[75 * mm, 125 * mm, 67 * mm],
    )
    header_content.setStyle(TableStyle([
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('LEFTPADDING', (0, 0), (-1, -1), 0),
        ('RIGHTPADDING', (0, 0), (-1, -1), 0),
        ('TOPPADDING', (0, 0), (-1, -1), 0),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 0),
    ]))
    header_wrapper = Table(
        [
            [_rich_paragraph(title_text, styles['title'], bold=True)],
            [header_content],
        ],
        colWidths=[267 * mm],
    )
    header_wrapper.setStyle(TableStyle([
        ('BOX', (0, 0), (-1, -1), 0.5, colors.black),
        ('LINEBELOW', (0, 0), (-1, 0), 0.5, colors.black),
        ('ALIGN', (0, 0), (0, 0), 'CENTER'),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('LEFTPADDING', (0, 0), (-1, -1), 0),
        ('RIGHTPADDING', (0, 0), (-1, -1), 0),
        ('TOPPADDING', (0, 0), (-1, -1), 2),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 2),
    ]))
    story.append(header_wrapper)
    story.append(Spacer(1, 3 * mm))

    # ---------- data table ----------
    col_widths = [
        10 * mm,  # Carton No
        18 * mm,  # PO No
        18 * mm,  # Option ID
        14 * mm,  # L1
        14 * mm,  # L4
        14 * mm,  # Country
        13 * mm,  # State
        13 * mm,  # District
        22 * mm,  # Fabric
        19 * mm,  # Model Number
        15 * mm,  # HSN
        22 * mm,  # SKU ID
        8 * mm,   # Size
        8 * mm,   # Qty
        13 * mm,  # Unit Rate
        16 * mm,  # Dimensions
        13 * mm,  # Net Wt
        15 * mm,  # Gross Wt
    ]
    header_row = [
        _paragraph(str(column_headers.get('carton_number') or 'Carton_No'), styles['small']),
        _paragraph(str(column_headers.get('po_number') or f'{marketplace_name} PO No'), styles['small']),
        _paragraph(str(column_headers.get('option_id') or f'{marketplace_name} Option ID'), styles['small']),
        _paragraph(str(column_headers.get('l1') or 'L1 (As in PO)'), styles['small']),
        _paragraph(str(column_headers.get('l4') or 'L4 (As in PO)'), styles['small']),
        _paragraph(str(column_headers.get('country_of_origin') or 'Country_Of_Origin'), styles['small']),
        _paragraph(str(column_headers.get('state_of_origin') or 'State_Of_Origin'), styles['small']),
        _paragraph(str(column_headers.get('district_of_origin') or 'District_Of_Origin'), styles['small']),
        _paragraph(str(column_headers.get('fabric') or 'Fabric composition'), styles['small']),
        _paragraph(str(column_headers.get('model_number') or 'Model Number'), styles['small']),
        _paragraph(str(column_headers.get('hsn_code') or 'HSN Code'), styles['small']),
        _paragraph(str(column_headers.get('sku_id') or f'{marketplace_name} SKU ID'), styles['small']),
        _paragraph(str(column_headers.get('size') or 'Size'), styles['small']),
        _paragraph(str(column_headers.get('quantity') or f'{marketplace_name} Qty'), styles['small']),
        _paragraph(str(column_headers.get('unit_rate') or 'Unit_Rate (As Per PO)'), styles['small']),
        _paragraph(str(column_headers.get('dimensions') or 'Carton_Dimn'), styles['small']),
        _paragraph(str(column_headers.get('net_weight') or 'Carton_Net Weight (Kg)'), styles['small']),
        _paragraph(str(column_headers.get('gross_weight') or 'Carton_Gross Weight (Kg)'), styles['small']),
    ]
    table_rows: list[list[object]] = [header_row]

    sorted_cartons = sorted(packing_list.cartons, key=lambda c: c.carton_number)
    for carton in sorted_cartons:
        sorted_items = sorted(carton.items, key=lambda ci: (
            str(line_items_by_id.get(ci.line_item_id, None) and line_items_by_id[ci.line_item_id].option_id or ''),
            str(line_items_by_id.get(ci.line_item_id, None) and line_items_by_id[ci.line_item_id].size or ''),
        ))
        is_first_in_carton = True
        for carton_item in sorted_items:
            li = line_items_by_id.get(carton_item.line_item_id)
            if li is None:
                continue

            # Build the neom_sku_id key the same way the invoice builder does
            neom_sku = _build_styli_sku(li.option_id, li.size) or li.sku_id
            inv_li = invoice_items_by_source_line_item.get(li.id)
            if inv_li is None:
                inv_li = invoice_items_by_neom_sku.get(neom_sku)

            # Commercial fields come from InvoiceLineItem when available
            fabric = str(inv_li.fabric_composition if inv_li else '') or '-'
            hsn = str(inv_li.hsn_code if inv_li else '') or '-'
            unit_rate = f'{float(inv_li.unit_price):.2f}' if inv_li else '-'
            description = str(inv_li.product_description if inv_li else '').strip()
            country = str(inv_li.country_of_origin if inv_li else '').strip() or '-'
            state = str(inv_li.state_of_origin if inv_li else '') or '-'
            district = str(inv_li.district_of_origin if inv_li else '') or '-'
            sku_display = neom_sku or li.sku_id or '-'
            description_words = [part for part in re.split(r'[\s/-]+', description) if part]
            l1_value = description_words[0] if description_words else '-'
            l4_value = '-'
            for candidate in ['Midi', 'Maxi', 'Mini', 'Dress', 'Top', 'Tunic', 'Kurta', 'Set']:
                if any(part.lower() == candidate.lower() for part in description_words):
                    l4_value = candidate
                    break
            if l4_value == '-' and len(description_words) > 1:
                l4_value = description_words[1]

            # Carton-level cells only on first row per carton
            if is_first_in_carton:
                dims_val = carton.dimensions or '-'
                net_wt_val = f'{float(carton.net_weight):.2f}' if carton.net_weight is not None else '-'
                gross_wt_val = f'{float(carton.gross_weight):.2f}' if carton.gross_weight is not None else '-'
                is_first_in_carton = False
            else:
                dims_val = ''
                net_wt_val = ''
                gross_wt_val = ''

            table_rows.append([
                _paragraph(str(carton.carton_number), styles['cell']),
                _paragraph(str(received_po.po_number or '-'), styles['cell']),
                _paragraph(str(li.option_id or '-'), styles['cell']),
                _paragraph(l1_value, styles['cell']),
                _paragraph(l4_value, styles['cell']),
                _paragraph(country, styles['cell']),
                _paragraph(state, styles['cell']),
                _paragraph(district, styles['cell']),
                _paragraph(fabric, styles['cell']),
                _paragraph(str(inv_li.model_number if inv_li else li.model_number or li.brand_style_code or '-'), styles['cell']),
                _paragraph(hsn, styles['cell']),
                _paragraph(sku_display, styles['cell']),
                _paragraph(str(li.size or '-'), styles['cell']),
                _paragraph(str(carton_item.pieces_in_carton), styles['cell']),
                _paragraph(unit_rate, styles['cell']),
                _paragraph(dims_val, styles['cell']),
                _paragraph(net_wt_val, styles['cell']),
                _paragraph(gross_wt_val, styles['cell']),
            ])

    data_table = Table(table_rows, colWidths=col_widths, repeatRows=1)
    table_style_rules: list[tuple] = [
        ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#E8E8E8')),
        ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('FONTSIZE', (0, 0), (-1, -1), 6),
        ('GRID', (0, 0), (-1, -1), 0.3, colors.HexColor('#AAAAAA')),
        ('BOX', (0, 0), (-1, -1), 0.5, colors.black),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('LEFTPADDING', (0, 0), (-1, -1), 2),
        ('RIGHTPADDING', (0, 0), (-1, -1), 2),
        ('TOPPADDING', (0, 0), (-1, -1), 2),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 2),
    ]
    data_table.setStyle(TableStyle(table_style_rules))
    story.append(data_table)
    story.append(Spacer(1, 2 * mm))
    summary_table = Table(
        [[
            _rich_paragraph(
                f'Total cartons: {len(sorted_cartons)}    Total pieces: {sum(carton.total_pieces for carton in sorted_cartons)}',
                styles['meta'],
                bold=True,
            )
        ]],
        colWidths=[265 * mm],
    )
    summary_table.setStyle(TableStyle([
        ('BOX', (0, 0), (-1, -1), 0.5, colors.black),
        ('LEFTPADDING', (0, 0), (-1, -1), 4),
        ('RIGHTPADDING', (0, 0), (-1, -1), 4),
        ('TOPPADDING', (0, 0), (-1, -1), 3),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 3),
    ]))
    story.append(summary_table)

    with _debug_friendly_pdf_streams():
        document.build(story, canvasmaker=_uncompressed_canvas)
    return buffer.getvalue()


def _invoice_profile(invoice: Invoice | None, company_settings: CompanySettings | None) -> dict[str, str]:
    profile = _brand_profile(company_settings)
    invoice_details = _json_loads(invoice.details_json if invoice else '{}')
    merged = {**profile, **invoice_details}
    return {
        'marketplace_name': str(merged.get('marketplace_name') or '').strip(),
        'supplier_name': str(merged.get('supplier_name') or '').strip(),
        'fbs_name': str(merged.get('fbs_name') or merged.get('supplier_name') or '').strip(),
        'vendor_company_name': str(merged.get('vendor_company_name') or merged.get('supplier_name') or '').strip(),
        'address': str(merged.get('address') or '').strip(),
        'gst_number': str(merged.get('gst_number') or '').strip(),
        'pan_number': str(merged.get('pan_number') or '').strip(),
        'supplier_city': str(merged.get('supplier_city') or '').strip(),
        'supplier_state': str(merged.get('supplier_state') or '').strip(),
        'supplier_pincode': str(merged.get('supplier_pincode') or '').strip(),
        'delivery_from_name': str(merged.get('delivery_from_name') or merged.get('supplier_name') or '').strip(),
        'delivery_from_address': str(merged.get('delivery_from_address') or merged.get('address') or '').strip(),
        'delivery_from_city': str(merged.get('delivery_from_city') or '').strip(),
        'delivery_from_pincode': str(merged.get('delivery_from_pincode') or '').strip(),
        'bill_to_name': str(merged.get('bill_to_name') or '').strip(),
        'bill_to_address': str(merged.get('bill_to_address') or '').strip(),
        'bill_to_gst': str(merged.get('bill_to_gst') or '').strip(),
        'bill_to_pan': str(merged.get('bill_to_pan') or '').strip(),
        'ship_to_name': str(merged.get('ship_to_name') or '').strip(),
        'ship_to_address': str(merged.get('ship_to_address') or '').strip(),
        'ship_to_gst': str(merged.get('ship_to_gst') or '').strip(),
        'stamp_image_url': str(merged.get('stamp_image_url') or '').strip(),
    }


def _invoice_currency(value: float, *, trim_zero_decimals: bool = False) -> str:
    normalized = f'{float(value or 0):.2f}'
    if trim_zero_decimals and normalized.endswith('.00'):
        return normalized[:-3]
    return normalized


def _invoice_address_lines(value: str) -> list[str]:
    if not value:
        return ['-']
    if '\n' in value:
        return [line.strip() for line in value.splitlines() if line.strip()]
    return [part.strip() for part in value.split(',') if part.strip()]


def _invoice_styles() -> dict[str, ParagraphStyle]:
    stylesheet = getSampleStyleSheet()
    return {
        'title': ParagraphStyle(
            'InvoiceTitle',
            parent=stylesheet['Heading2'],
            fontName='Helvetica-Bold',
            fontSize=11,
            leading=13,
            alignment=1,
            spaceAfter=4,
        ),
        'meta': ParagraphStyle(
            'InvoiceMeta',
            parent=stylesheet['BodyText'],
            fontName='Helvetica',
            fontSize=7,
            leading=8.5,
        ),
        'cell': ParagraphStyle(
            'InvoiceCell',
            parent=stylesheet['BodyText'],
            fontName='Helvetica',
            fontSize=7,
            leading=8.5,
        ),
        'small': ParagraphStyle(
            'InvoiceSmall',
            parent=stylesheet['BodyText'],
            fontName='Helvetica',
            fontSize=6,
            leading=7,
        ),
        'footer': ParagraphStyle(
            'InvoiceFooter',
            parent=stylesheet['BodyText'],
            fontName='Helvetica-Oblique',
            fontSize=7,
            leading=8.5,
        ),
    }


def _paragraph(text: str, style: ParagraphStyle) -> Paragraph:
    return Paragraph(escape(text).replace('\n', '<br/>'), style)


def _invoice_header_cell(lines: list[str], style: ParagraphStyle) -> Paragraph:
    return _paragraph('\n'.join(lines), style)


def _rich_paragraph(text: str, style: ParagraphStyle, *, bold: bool = False) -> Paragraph:
    content = escape(text).replace('\n', '<br/>')
    if bold:
        content = f'<b>{content}</b>'
    return Paragraph(content, style)


def _invoice_address_pair(value: str, *, trailer: str = '') -> tuple[str, str]:
    lines = _invoice_address_lines(value)
    line_one = lines[0] if lines else '-'
    remaining = ', '.join(line for line in lines[1:] if line)
    line_two = ', '.join(part for part in [remaining, trailer] if part).strip()
    return line_one or '-', line_two or '-'


def _invoice_label_value_block(
    rows: list[tuple[str, str]],
    *,
    total_width: float,
    label_width: float,
    style: ParagraphStyle,
) -> Table:
    data = [
        [
            _rich_paragraph(label, style, bold=True),
            _rich_paragraph(value or '-', style, bold=True),
        ]
        for label, value in rows
    ]
    table = Table(data, colWidths=[label_width, total_width - label_width])
    table.setStyle(
        TableStyle(
            [
                ('BOX', (0, 0), (-1, -1), 0.5, colors.black),
                ('VALIGN', (0, 0), (-1, -1), 'TOP'),
                ('LEFTPADDING', (0, 0), (-1, -1), 3),
                ('RIGHTPADDING', (0, 0), (-1, -1), 3),
                ('TOPPADDING', (0, 0), (-1, -1), 2),
                ('BOTTOMPADDING', (0, 0), (-1, -1), 2),
            ]
        )
    )
    return table


def _invoice_single_column_block(
    lines: list[str],
    *,
    width: float,
    style: ParagraphStyle,
    bold_rows: set[int] | None = None,
    highlight_rows: set[int] | None = None,
) -> Table:
    bold_rows = bold_rows or set()
    highlight_rows = highlight_rows or set()
    data = [[_rich_paragraph(line or '-', style, bold=index in bold_rows)] for index, line in enumerate(lines)]
    table = Table(data, colWidths=[width])
    style_rules: list[tuple] = [
        ('BOX', (0, 0), (-1, -1), 0.5, colors.black),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('LEFTPADDING', (0, 0), (-1, -1), 3),
        ('RIGHTPADDING', (0, 0), (-1, -1), 3),
        ('TOPPADDING', (0, 0), (-1, -1), 2),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 2),
    ]
    for row_index in highlight_rows:
        style_rules.append(('BACKGROUND', (0, row_index), (0, row_index), colors.HexColor('#FFF86B')))
    table.setStyle(TableStyle(style_rules))
    return table


def _stamp_flowable(stamp_image_url: str) -> PlatypusImage | Paragraph:
    if not stamp_image_url:
        return Paragraph('&nbsp;', _invoice_styles()['small'])

    local_path = _local_static_path_from_url(stamp_image_url)
    if local_path is not None and local_path.exists():
        return PlatypusImage(str(local_path), width=34 * mm, height=16 * mm)

    file_path = Path(stamp_image_url)
    if file_path.is_absolute() and file_path.exists():
        return PlatypusImage(str(file_path), width=34 * mm, height=16 * mm)

    if stamp_image_url.startswith(('http://', 'https://')):
        try:
            with urlopen(stamp_image_url, timeout=5) as response:  # noqa: S310
                return PlatypusImage(BytesIO(response.read()), width=34 * mm, height=16 * mm)
        except Exception:
            return Paragraph('&nbsp;', _invoice_styles()['small'])

    return Paragraph('&nbsp;', _invoice_styles()['small'])


def _build_invoice_pdf_layout(
    invoice: Invoice,
    received_po: ReceivedPO,
    line_items: list[InvoiceLineItem],
    company_settings: CompanySettings | None,
    *,
    document_title: str = 'COMMERCIAL INVOICE',
    bill_to_label: str = 'Bill To:',
    ship_to_label: str = 'Ship To :',
    signature_label: str = 'Receivers Signature and Date',
) -> bytes:
    profile = _invoice_profile(invoice, company_settings)
    marketplace_name = profile['marketplace_name'] or str(received_po.distributor or '').strip()
    total_cgst_amount = sum(float(row.cgst_amount or 0) for row in line_items)
    total_sgst_amount = sum(float(row.sgst_amount or 0) for row in line_items)
    total_split_gst_amount = total_cgst_amount + total_sgst_amount
    styles = _invoice_styles()
    buffer = BytesIO()
    document = SimpleDocTemplate(
        buffer,
        pagesize=landscape(A4),
        leftMargin=10 * mm,
        rightMargin=10 * mm,
        topMargin=10 * mm,
        bottomMargin=10 * mm,
    )
    story: list[object] = []

    supplier_city_line = ' '.join(
        part
        for part in [profile['supplier_city'], profile['supplier_state'], profile['supplier_pincode']]
        if part
    )
    supplier_address_one, supplier_address_two = _invoice_address_pair(
        profile['address'], trailer=supplier_city_line
    )
    delivery_city_line = ' '.join(
        part for part in [profile['delivery_from_city'], profile['delivery_from_pincode']] if part
    )
    delivery_address_one, delivery_address_two = _invoice_address_pair(
        profile['delivery_from_address'], trailer=delivery_city_line
    )

    supplier_block = _invoice_label_value_block(
        [
            ('Supplier Name:', profile['fbs_name'] or profile['vendor_company_name'] or '-'),
            ('Vendor company name', profile['vendor_company_name'] or '-'),
            ('Address line 1', supplier_address_one),
            ('Address line 2', supplier_address_two),
            ('Supplier GSTNO:', profile['gst_number'] or '-'),
            ('Supplier PAN No:', profile['pan_number'] or '-'),
        ],
        total_width=75 * mm,
        label_width=19 * mm,
        style=styles['small'],
    )
    delivery_block = _invoice_label_value_block(
        [
            ('Delivery From:', profile['delivery_from_name'] or '-'),
            ('Company name', profile['delivery_from_name'] or '-'),
            ('Address line 1', delivery_address_one),
            ('Address line 2', delivery_address_two),
        ],
        total_width=75 * mm,
        label_width=19 * mm,
        style=styles['small'],
    )
    bill_to_lines = [
        bill_to_label,
        profile['bill_to_name'] or '-',
        *_invoice_address_lines(profile['bill_to_address']),
        f'Billed To GST NO: {profile["bill_to_gst"] or "-"}',
        f'Billed To PAN No: {profile["bill_to_pan"] or "-"}',
    ]
    ship_to_lines = [
        ship_to_label,
        profile['ship_to_name'] or '-',
        *_invoice_address_lines(profile['ship_to_address']),
        f'Ship To GST NO: {profile["ship_to_gst"] or "-"}',
    ]
    bill_to_block = _invoice_single_column_block(
        bill_to_lines,
        width=125 * mm,
        style=styles['small'],
        bold_rows={0, 1, len(bill_to_lines) - 2, len(bill_to_lines) - 1},
        highlight_rows={len(bill_to_lines) - 2, len(bill_to_lines) - 1},
    )
    ship_to_block = _invoice_single_column_block(
        ship_to_lines,
        width=125 * mm,
        style=styles['small'],
        bold_rows={0, 1, len(ship_to_lines) - 1},
        highlight_rows={len(ship_to_lines) - 1},
    )
    meta_block = _invoice_label_value_block(
        [
            ('INVOICE NO', invoice.invoice_number),
            ('INVOICE DATE', invoice.invoice_date.astimezone(timezone.utc).strftime('%d/%m/%Y')),
            ('NO.OF.CARTONS', str(invoice.number_of_cartons)),
            (
                'Gross weight',
                _invoice_currency(float(invoice.gross_weight or 0)) if invoice.gross_weight is not None else '-',
            ),
            (f'Export Shipment Mode by {marketplace_name}', invoice.export_mode),
        ],
        total_width=67 * mm,
        label_width=28 * mm,
        style=styles['small'],
    )
    header_content = Table(
        [[
            [supplier_block, Spacer(1, 3 * mm), delivery_block],
            [bill_to_block, Spacer(1, 3 * mm), ship_to_block],
            meta_block,
        ]],
        colWidths=[75 * mm, 125 * mm, 67 * mm],
    )
    header_content.setStyle(
        TableStyle(
            [
                ('VALIGN', (0, 0), (-1, -1), 'TOP'),
                ('LEFTPADDING', (0, 0), (-1, -1), 0),
                ('RIGHTPADDING', (0, 0), (-1, -1), 0),
                ('TOPPADDING', (0, 0), (-1, -1), 0),
                ('BOTTOMPADDING', (0, 0), (-1, -1), 0),
            ]
        )
    )
    header_wrapper = Table(
        [
            [_rich_paragraph(document_title, styles['title'], bold=True)],
            [header_content],
        ],
        colWidths=[267 * mm],
    )
    header_wrapper.setStyle(
        TableStyle(
            [
                ('BOX', (0, 0), (-1, -1), 0.5, colors.black),
                ('LINEBELOW', (0, 0), (-1, 0), 0.5, colors.black),
                ('ALIGN', (0, 0), (0, 0), 'CENTER'),
                ('VALIGN', (0, 0), (-1, -1), 'TOP'),
                ('LEFTPADDING', (0, 0), (-1, -1), 0),
                ('RIGHTPADDING', (0, 0), (-1, -1), 0),
                ('TOPPADDING', (0, 0), (-1, -1), 2),
                ('BOTTOMPADDING', (0, 0), (-1, -1), 2),
            ]
        )
    )
    story.append(header_wrapper)
    story.append(Spacer(1, 3 * mm))

    column_widths = [
        18 * mm,
        20 * mm,
        14 * mm,
        20 * mm,
        13 * mm,
        15 * mm,
        19 * mm,
        10 * mm,
        8 * mm,
        10 * mm,
        12 * mm,
        12 * mm,
        7 * mm,
        12 * mm,
        13 * mm,
        8 * mm,
        10 * mm,
        10 * mm,
        11 * mm,
        12 * mm,
    ]
    table_rows: list[list[object]] = [[
        _paragraph('Vendor Style #', styles['small']),
        _paragraph(f'{marketplace_name} SKU ID', styles['small']),
        _paragraph(f'{marketplace_name} PO Code', styles['small']),
        _paragraph('Product Description', styles['small']),
        _paragraph('HSN Code', styles['small']),
        _paragraph('Model No.', styles['small']),
        _paragraph('Fabric Composition', styles['small']),
        _paragraph('Knitted/ Woven', styles['small']),
        _paragraph('Size', styles['small']),
        _paragraph('Country', styles['small']),
        _paragraph('State', styles['small']),
        _paragraph('District', styles['small']),
        _paragraph('Qty', styles['small']),
        _paragraph('Unit Price', styles['small']),
        _paragraph('Net Taxable', styles['small']),
        _paragraph('GST %', styles['small']),
        _paragraph('IGST', styles['small']),
        _paragraph('CGST/SGST', styles['small']),
        _paragraph('Total GST', styles['small']),
        _paragraph('Total Amount', styles['small']),
    ]]
    for row in line_items:
        table_rows.append(
            [
                str(row.vendor_style_hash),
                str(row.neom_sku_id),
                str(row.neom_po_code),
                str(row.product_description),
                str(row.hsn_code),
                str(row.model_number),
                str(row.fabric_composition),
                str(row.knitted_woven),
                str(row.neom_size),
                str(row.country_of_origin),
                str(row.state_of_origin),
                str(row.district_of_origin),
                str(int(row.quantity)),
                _invoice_currency(float(row.unit_price)),
                _invoice_currency(float(row.net_taxable_amount)),
                _invoice_currency(float(row.gst_rate), trim_zero_decimals=True),
                _invoice_currency(float(row.igst_amount)),
                _invoice_currency(float(row.cgst_amount + row.sgst_amount)),
                _invoice_currency(float(row.total_gst_amount)),
                _invoice_currency(float(row.total_amount)),
            ]
        )
    table_rows.append(
        [
            '', '', '', '', '', '', '', '', '', '', '', 'TOTAL',
            str(int(invoice.total_quantity)),
            '',
            _invoice_currency(float(invoice.subtotal), trim_zero_decimals=True),
            '',
            _invoice_currency(float(invoice.igst_amount), trim_zero_decimals=True),
            _invoice_currency(float(total_split_gst_amount), trim_zero_decimals=True),
            _invoice_currency(float(invoice.igst_amount) + total_split_gst_amount, trim_zero_decimals=True),
            _invoice_currency(float(invoice.total_amount), trim_zero_decimals=True),
        ]
    )
    line_table = Table(table_rows, colWidths=column_widths, repeatRows=1)
    line_table_style = [
        ('BOX', (0, 0), (-1, -1), 0.3, colors.black),
        ('INNERGRID', (0, 0), (-1, -1), 0.3, colors.black),
        ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('FONTNAME', (0, -1), (-1, -1), 'Helvetica-Bold'),
        ('FONTSIZE', (0, 0), (-1, 0), 7),
        ('FONTSIZE', (0, 1), (-1, -2), 6),
        ('FONTSIZE', (0, -1), (-1, -1), 6.5),
        ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('LEFTPADDING', (0, 0), (-1, -1), 2),
        ('RIGHTPADDING', (0, 0), (-1, -1), 2),
        ('TOPPADDING', (0, 0), (-1, -1), 2),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 2),
        ('SPAN', (0, -1), (11, -1)),
        ('ALIGN', (0, -1), (11, -1), 'RIGHT'),
    ]
    line_table.setStyle(TableStyle(line_table_style))
    story.append(line_table)
    story.append(Spacer(1, 1.5 * mm))
    summary_table = Table(
        [[
            '',
            _paragraph(
                f'{invoice.total_quantity}  |  {_invoice_currency(float(invoice.subtotal), trim_zero_decimals=True)}  |  '
                f'{_invoice_currency(float(invoice.total_amount), trim_zero_decimals=True)}',
                styles['cell'],
            ),
        ]],
        colWidths=[205 * mm, 62 * mm],
    )
    summary_table.setStyle(
        TableStyle(
            [
                ('ALIGN', (1, 0), (1, 0), 'RIGHT'),
                ('LEFTPADDING', (0, 0), (-1, -1), 0),
                ('RIGHTPADDING', (0, 0), (-1, -1), 0),
                ('TOPPADDING', (0, 0), (-1, -1), 0),
                ('BOTTOMPADDING', (0, 0), (-1, -1), 0),
            ]
        )
    )
    story.append(summary_table)
    story.append(Spacer(1, 3 * mm))

    story.append(
        Table(
            [[
                _paragraph(
                    f'Net Amount in Words: {invoice.total_amount_words or convert_to_words(float(invoice.total_amount))}',
                    styles['cell'],
                )
            ]],
            colWidths=[267 * mm],
            style=TableStyle(
                [
                    ('BOX', (0, 0), (-1, -1), 0.5, colors.black),
                    ('LEFTPADDING', (0, 0), (-1, -1), 4),
                    ('RIGHTPADDING', (0, 0), (-1, -1), 4),
                    ('TOPPADDING', (0, 0), (-1, -1), 4),
                    ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
                ]
            ),
        )
    )
    story.append(
        Table(
            [[
                _paragraph(
                    'Certified that the particulars given above are true & correct and the amount indicated '
                    'represents the price actually charged and that there is no flow of additional '
                    'consideration directly or indirectly from the buyer.',
                    styles['footer'],
                )
            ]],
            colWidths=[267 * mm],
            style=TableStyle(
                [
                    ('BOX', (0, 0), (-1, -1), 0.5, colors.black),
                    ('LEFTPADDING', (0, 0), (-1, -1), 4),
                    ('RIGHTPADDING', (0, 0), (-1, -1), 4),
                    ('TOPPADDING', (0, 0), (-1, -1), 4),
                    ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
                ]
            ),
        )
    )
    story.append(Spacer(1, 2 * mm))
    footer_table = Table(
        [[
            _stamp_flowable(profile['stamp_image_url']),
            _paragraph('', styles['cell']),
            _paragraph(signature_label, styles['cell']),
        ]],
        colWidths=[90 * mm, 105 * mm, 72 * mm],
    )
    footer_table.setStyle(
        TableStyle(
            [
                ('BOX', (0, 0), (-1, -1), 0.5, colors.black),
                ('INNERGRID', (0, 0), (-1, -1), 0.5, colors.black),
                ('VALIGN', (0, 0), (-1, -1), 'BOTTOM'),
                ('ALIGN', (2, 0), (2, 0), 'RIGHT'),
                ('LEFTPADDING', (0, 0), (-1, -1), 4),
                ('RIGHTPADDING', (0, 0), (-1, -1), 4),
                ('TOPPADDING', (0, 0), (-1, -1), 6),
                ('BOTTOMPADDING', (0, 0), (-1, -1), 8),
            ]
        )
    )
    story.append(footer_table)
    with _debug_friendly_pdf_streams():
        document.build(story, canvasmaker=_uncompressed_canvas)
    return buffer.getvalue()


def _build_invoice_pdf_default_v1(
    invoice: Invoice,
    received_po: ReceivedPO,
    line_items: list[InvoiceLineItem],
    company_settings: CompanySettings | None,
) -> bytes:
    return _build_invoice_pdf_layout(invoice, received_po, line_items, company_settings)


def _build_invoice_pdf_landmark_v1(
    invoice: Invoice,
    received_po: ReceivedPO,
    line_items: list[InvoiceLineItem],
    company_settings: CompanySettings | None,
) -> bytes:
    return _build_invoice_pdf_layout(
        invoice,
        received_po,
        line_items,
        company_settings,
        document_title='LANDMARK COMMERCIAL INVOICE',
        bill_to_label='Landmark Bill To:',
        ship_to_label='Landmark Ship To:',
        signature_label='Landmark Receiver Signature and Date',
    )


def _build_invoice_pdf(
    invoice: Invoice,
    received_po: ReceivedPO,
    line_items: list[InvoiceLineItem],
    company_settings: CompanySettings | None,
) -> bytes:
    layout_key = str(invoice.layout_key or DEFAULT_INVOICE_LAYOUT_KEY).strip() or DEFAULT_INVOICE_LAYOUT_KEY
    if layout_key == LANDMARK_INVOICE_LAYOUT_KEY:
        return _build_invoice_pdf_landmark_v1(invoice, received_po, line_items, company_settings)
    return _build_invoice_pdf_default_v1(invoice, received_po, line_items, company_settings)


def generate_barcode_job_pdf(barcode_job_id: str) -> None:
    db: Session = SessionLocal()
    try:
        job = db.query(BarcodeJob).filter(BarcodeJob.id == barcode_job_id).first()
        if job is None:
            return

        received_po = db.query(ReceivedPO).filter(ReceivedPO.id == job.received_po_id).first()
        if received_po is None:
            job.status = 'failed'
            db.commit()
            return

        job.status = 'generating'
        db.commit()

        line_items = (
            db.query(ReceivedPOLineItem)
            .filter(ReceivedPOLineItem.received_po_id == received_po.id)
            .order_by(ReceivedPOLineItem.brand_style_code.asc(), ReceivedPOLineItem.sku_id.asc())
            .all()
        )
        company_settings = (
            db.query(CompanySettings).filter(CompanySettings.company_id == received_po.company_id).first()
        )
        records = _received_po_sticker_records(received_po, line_items, company_settings)
        if job.template_kind == 'custom' and job.template_id:
            result = generate_custom_sheet_for_records(
                db=db,
                company_id=received_po.company_id,
                received_po_id=received_po.id,
                template_id=job.template_id,
                records=records,
            )
        else:
            result = generate_styli_sheet_for_records(
                company_id=received_po.company_id,
                received_po_id=received_po.id,
                records=records,
            )
        job.file_url = result.file_url
        job.status = 'done'
        job.total_stickers = result.total_stickers
        job.total_pages = result.total_pages
        log_received_po_agent_event(
            db,
            received_po,
            event_type='agent.barcode_completed',
            title='Barcode PDF generated',
            summary='The autopilot generated barcode stickers from the confirmed PO.',
            tool_name='barcode_pdf_generator',
            metadata={
                'barcode_job_id': job.id,
                'file_url': job.file_url,
                'total_stickers': job.total_stickers,
                'total_pages': job.total_pages,
            },
        )
        db.commit()
    except Exception:
        if 'job' in locals() and job is not None:
            job.status = 'failed'
            if 'received_po' in locals() and received_po is not None:
                log_received_po_agent_event(
                    db,
                    received_po,
                    event_type='agent.barcode_failed',
                    title='Barcode PDF generation failed',
                    summary='The autopilot could not generate barcode stickers.',
                    status=STATUS_FAILED,
                    tool_name='barcode_pdf_generator',
                    metadata={'barcode_job_id': job.id},
                )
            db.commit()
        raise
    finally:
        db.close()


def generate_invoice_pdf(invoice_id: str) -> None:
    db: Session = SessionLocal()
    try:
        invoice = db.query(Invoice).filter(Invoice.id == invoice_id).first()
        if invoice is None:
            return

        received_po = db.query(ReceivedPO).filter(ReceivedPO.id == invoice.received_po_id).first()
        if received_po is None:
            return

        company_settings = db.query(CompanySettings).filter(CompanySettings.company_id == invoice.company_id).first()
        line_items = (
            db.query(InvoiceLineItem)
            .filter(InvoiceLineItem.invoice_id == invoice.id)
            .order_by(InvoiceLineItem.sort_order.asc(), InvoiceLineItem.created_at.asc())
            .all()
        )
        pdf_content = _build_invoice_pdf(invoice, received_po, line_items, company_settings)
        key = f'invoices/{invoice.company_id}/{invoice.id}.pdf'
        invoice.file_url = _write_generated_pdf(key=key, content=pdf_content)
        invoice.status = 'final'
        log_received_po_agent_event(
            db,
            received_po,
            event_type='agent.invoice_pdf_completed',
            title='Invoice PDF generated',
            summary='The autopilot generated the final commercial invoice PDF.',
            tool_name='invoice_pdf_generator',
            metadata={
                'invoice_id': invoice.id,
                'invoice_number': invoice.invoice_number,
                'file_url': invoice.file_url,
            },
        )
        db.commit()
    except Exception:
        if 'invoice' in locals() and invoice is not None:
            invoice.status = 'failed'
            invoice.file_url = None
            if 'received_po' in locals() and received_po is not None:
                log_received_po_agent_event(
                    db,
                    received_po,
                    event_type='agent.invoice_pdf_failed',
                    title='Invoice PDF generation failed',
                    summary='The autopilot could not generate the commercial invoice PDF.',
                    status=STATUS_FAILED,
                    tool_name='invoice_pdf_generator',
                    metadata={'invoice_id': invoice.id},
                )
            db.commit()
        raise
    finally:
        db.close()


def generate_packing_list_pdf(packing_list_id: str) -> None:
    db: Session = SessionLocal()
    try:
        packing_list = db.query(PackingList).filter(PackingList.id == packing_list_id).first()
        if packing_list is None:
            return

        received_po = db.query(ReceivedPO).filter(ReceivedPO.id == packing_list.received_po_id).first()
        if received_po is None:
            return

        company_settings = (
            db.query(CompanySettings).filter(CompanySettings.company_id == packing_list.company_id).first()
        )

        # Load linked invoice and its line items for commercial row data
        invoice: Invoice | None = None
        invoice_items_by_source_line_item: dict[str, InvoiceLineItem] = {}
        invoice_items_by_neom_sku: dict[str, InvoiceLineItem] = {}
        if packing_list.invoice_id:
            invoice = db.query(Invoice).filter(Invoice.id == packing_list.invoice_id).first()
        if invoice is None and packing_list.received_po_id:
            # Fall back to any invoice for this PO
            invoice = (
                db.query(Invoice)
                .filter(Invoice.received_po_id == packing_list.received_po_id)
                .first()
            )
        if invoice is not None:
            inv_line_items = (
                db.query(InvoiceLineItem)
                .filter(InvoiceLineItem.invoice_id == invoice.id)
                .order_by(InvoiceLineItem.sort_order.asc())
                .all()
            )
            for ili in inv_line_items:
                if ili.source_line_item_id:
                    invoice_items_by_source_line_item[ili.source_line_item_id] = ili
                invoice_items_by_neom_sku[ili.neom_sku_id] = ili

        # Load received PO line items for carton item lookup
        cartons = sorted(packing_list.cartons, key=lambda item: item.carton_number)
        line_item_ids = [
            carton_item.line_item_id
            for carton in cartons
            for carton_item in carton.items
        ]
        line_items = (
            db.query(ReceivedPOLineItem)
            .filter(ReceivedPOLineItem.id.in_(line_item_ids or ['']))
            .all()
        )
        line_items_by_id = {item.id: item for item in line_items}

        if not line_items_by_id:
            raise ValueError('No line items found for packing list cartons.')

        pdf_content = _build_packing_list_pdf(
            packing_list,
            received_po,
            invoice,
            line_items_by_id,
            invoice_items_by_source_line_item,
            invoice_items_by_neom_sku,
            company_settings,
        )
        key = f'packing-lists/{packing_list.company_id}/{packing_list.id}.pdf'
        packing_list.file_url = _write_generated_pdf(key=key, content=pdf_content)
        packing_list.status = 'final'
        log_received_po_agent_event(
            db,
            received_po,
            event_type='agent.packing_list_pdf_completed',
            title='Packing-list PDF generated',
            summary='The autopilot generated the final packing-list PDF.',
            tool_name='packing_list_pdf_generator',
            metadata={'packing_list_id': packing_list.id, 'file_url': packing_list.file_url},
        )
        db.commit()
    except Exception:
        if 'packing_list' in locals() and packing_list is not None:
            packing_list.status = 'failed'
            packing_list.file_url = None
            if 'received_po' in locals() and received_po is not None:
                log_received_po_agent_event(
                    db,
                    received_po,
                    event_type='agent.packing_list_pdf_failed',
                    title='Packing-list PDF generation failed',
                    summary='The autopilot could not generate the packing-list PDF.',
                    status=STATUS_FAILED,
                    tool_name='packing_list_pdf_generator',
                    metadata={'packing_list_id': packing_list.id},
                )
            db.commit()
        raise
    finally:
        db.close()
