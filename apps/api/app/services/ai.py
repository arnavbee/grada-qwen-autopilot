import json
import logging
import re
from pathlib import Path
from typing import Any
from urllib.parse import urlparse
from urllib.request import Request as UrlRequest
from urllib.request import urlopen
from uuid import uuid4

from openai import APIStatusError, OpenAI
from sqlalchemy.orm import Session

from app.config.styli_attributes import DRESS_ATTRIBUTES
from app.core.config import get_settings
from app.db.base import utcnow
from app.db.session import SessionLocal
from app.models.ai_correction import AICorrection
from app.models.po_request import PORequest
from app.models.processing_job import ProcessingJob
from app.models.product_image import ProductImage
from app.models.product_measurement import ProductMeasurement
from app.services.po_builder import normalize_ai_attributes, rebuild_po_request_rows

settings = get_settings()
logger = logging.getLogger(__name__)

TECHPACK_SOURCE = 'techpack_ocr'
MEASUREMENT_ALIASES: dict[str, tuple[str, ...]] = {
    'chest': ('chest', 'bust'),
    'waist': ('waist',),
    'hip': ('hip', 'hips'),
    'length': ('length', 'total length'),
    'shoulder': ('shoulder', 'across shoulder'),
    'sleeve': ('sleeve', 'sleeve length'),
}
MEASUREMENT_RANGES_CM: dict[str, tuple[float, float]] = {
    'chest': (60.0, 160.0),
    'waist': (50.0, 150.0),
    'hip': (60.0, 170.0),
    'length': (40.0, 200.0),
    'shoulder': (20.0, 80.0),
    'sleeve': (10.0, 90.0),
}
REQUIRED_TECHPACK_KEYS = ('chest', 'waist', 'length')
ANALYSIS_FIELDS = ('category', 'style_name', 'color', 'fabric', 'composition', 'woven_knits')
ANALYSIS_FIELD_LABELS = {
    'category': 'Category',
    'style_name': 'Style Name',
    'color': 'Color',
    'fabric': 'Fabric',
    'composition': 'Composition',
    'woven_knits': 'Woven/Knits',
}


def _normalize_provider_name(provider: str | None) -> str:
    normalized = str(provider or '').strip().lower()
    return normalized or 'openai'


def _resolve_ai_client_config() -> dict[str, str | None]:
    provider = _normalize_provider_name(settings.ai_provider)
    override_base_url = settings.ai_base_url.strip() if settings.ai_base_url else None
    override_model = settings.ai_model.strip() if settings.ai_model else None

    if provider == 'qwen':
        api_key = settings.QWEN_API_KEY or settings.OPENAI_API_KEY
        return {
            'provider': provider,
            'api_key': api_key,
            'base_url': override_base_url or settings.QWEN_BASE_URL,
            'model': override_model or settings.QWEN_MODEL,
        }

    base_url = override_base_url
    if not base_url and settings.OPENAI_API_KEY.startswith('sk-or-v1'):
        base_url = 'https://openrouter.ai/api/v1'

    return {
        'provider': provider,
        'api_key': settings.OPENAI_API_KEY,
        'base_url': base_url,
        'model': override_model or settings.OPENAI_MODEL,
    }


class AIService:
    def __init__(self):
        client_config = _resolve_ai_client_config()
        self.provider = str(client_config['provider'])
        self.model = str(client_config['model'])
        self.client = OpenAI(
            api_key=client_config['api_key'] or 'missing-api-key',
            base_url=client_config['base_url'],
        )

    @property
    def vision_model(self) -> str:
        if self.provider == 'qwen' and 'vl' not in self.model.lower():
            return 'qwen-vl-max'
        return self.model

    @staticmethod
    def _compact_prompt_value(value: str, *, max_length: int = 80) -> str:
        compact = re.sub(r'\s+', ' ', value).strip()
        if len(compact) > max_length:
            compact = f'{compact[: max_length - 3]}...'
        return compact.replace('"', '\\"')

    def _build_allowed_options_block(self, allowed_options: dict[str, list[str]] | None) -> str:
        if not isinstance(allowed_options, dict):
            return 'No runtime allowed-options were provided.'

        lines: list[str] = []
        for field_name in ANALYSIS_FIELDS:
            raw_values = allowed_options.get(field_name)
            if not isinstance(raw_values, list):
                continue
            cleaned_values = [
                self._compact_prompt_value(value)
                for value in raw_values
                if isinstance(value, str) and value.strip()
            ][:40]
            if not cleaned_values:
                continue
            rendered = ', '.join(f'"{value}"' for value in cleaned_values)
            lines.append(f'- {ANALYSIS_FIELD_LABELS[field_name]}: {rendered}')
        if not lines:
            return 'No runtime allowed-options were provided.'
        return '\n'.join(lines)

    def _build_correction_hints_block(self, correction_hints: list[dict[str, str]] | None) -> str:
        if not isinstance(correction_hints, list) or len(correction_hints) == 0:
            return 'No recent correction hints were provided.'

        lines: list[str] = []
        for hint in correction_hints[:36]:
            if not isinstance(hint, dict):
                continue
            field_name = str(hint.get('field') or '').strip().lower()
            if field_name not in ANALYSIS_FIELDS:
                continue
            corrected = str(hint.get('corrected_value') or '').strip()
            if not corrected:
                continue
            suggested = str(hint.get('suggested_value') or '').strip()
            corrected_value = self._compact_prompt_value(corrected)
            if suggested:
                suggested_value = self._compact_prompt_value(suggested)
                lines.append(
                    f'- {ANALYSIS_FIELD_LABELS[field_name]}: prefer "{corrected_value}" over "{suggested_value}" when image evidence is close.'
                )
            else:
                lines.append(f'- {ANALYSIS_FIELD_LABELS[field_name]}: favor "{corrected_value}" when plausible.')
        if not lines:
            return 'No recent correction hints were provided.'
        return '\n'.join(lines)

    @staticmethod
    def _build_po_request_messages(prompt: str, image_url: str, *, image_detail: str) -> list[dict[str, Any]]:
        return [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": prompt},
                    {
                        "type": "image_url",
                        "image_url": {
                            "url": image_url,
                            "detail": image_detail,
                        },
                    },
                ],
            }
        ]

    @staticmethod
    def _is_prompt_token_limit_error(exc: Exception) -> bool:
        return 'prompt tokens limit exceeded' in str(exc).lower()

    @staticmethod
    def _is_credit_limited_error(exc: Exception) -> bool:
        if isinstance(exc, APIStatusError) and exc.status_code == 402:
            return True
        message = str(exc).lower()
        return (
            'error code: 402' in message
            or 'requires more credits' in message
            or 'fewer max_tokens' in message
            or 'can only afford' in message
        )

    def _build_po_attribute_prompt(self, category: str, *, compact: bool) -> str:
        if compact:
            enum_block = '; '.join(
                f'{field_name}={"|".join(options)}' for field_name, options in DRESS_ATTRIBUTES.items()
            )
            return (
                f'Extract Styli PO attributes for a women\'s fashion image. Category hint: {category}. '
                'Return JSON only as '
                '{"fields":{"dress_print":{"value":"","confidence":0},"dress_length":{"value":"","confidence":0},'
                '"dress_shape":{"value":"","confidence":0},"sleeve_length":{"value":"","confidence":0},'
                '"neck_women":{"value":"","confidence":0},"sleeve_styling":{"value":"","confidence":0},'
                '"woven_knits":{"value":"","confidence":0}}}. '
                'For dress fields, use exactly one listed enum value or "". '
                'For woven_knits, use "Woven", "Knitted", or "". '
                'If unclear, keep the value empty and lower the confidence. '
                f'Enums: {enum_block}'
            )

        dress_enum_block = '\n'.join(
            f'- {field_name}: {", ".join(options)}' for field_name, options in DRESS_ATTRIBUTES.items()
        )
        return f"""
You are extracting Styli PO attributes for a women's fashion image.
The garment category hint is: {category}.

Return ONLY valid JSON with this exact structure:
{{
  "fields": {{
    "dress_print": {{"value": "...", "confidence": 0-100}},
    "dress_length": {{"value": "...", "confidence": 0-100}},
    "dress_shape": {{"value": "...", "confidence": 0-100}},
    "sleeve_length": {{"value": "...", "confidence": 0-100}},
    "neck_women": {{"value": "...", "confidence": 0-100}},
    "sleeve_styling": {{"value": "...", "confidence": 0-100}},
    "woven_knits": {{"value": "Woven" or "Knitted", "confidence": 0-100}}
  }}
}}

Rules:
1. Use only these allowed values for the dress attributes:
{dress_enum_block}
2. If an attribute is not visible, set its value to "" with low confidence.
3. Do not return free text outside the enum lists for dress fields.
4. Do not include explanations or markdown.
"""

    def _build_catalog_analysis_prompt(
        self,
        *,
        allowed_options_block: str,
        correction_hints_block: str,
        compact: bool,
    ) -> str:
        if compact:
            return (
                'Analyze this fashion product image and return JSON only. '
                'Fields: category, style_name, color, fabric, composition, woven_knits. '
                'Each field must be {"value":"", "confidence":0-100}. '
                'Prefer runtime allowed options when visually plausible. '
                f'Allowed options: {allowed_options_block}. '
                f'Recent correction hints: {correction_hints_block}. '
                'For woven_knits use "Knits" or "Woven".'
            )

        return f"""
Analyze this fashion product image and extract structured data in JSON format.

Fields:
- category: specific category (usually "DRESSES" or "CORD SETS")
- style_name: style name (for example "Maxi Dress", "Midi Dress", "Knee Length", "Knot Cord Set")
- color: dominant color
- fabric: fabric type
- composition: fabric composition
- woven_knits: "Knits" or "Woven"

Runtime allowed options (prefer these exact spellings whenever visually plausible):
{allowed_options_block}

Recent correction hints from this company (use as soft priors, but do not ignore visual evidence):
{correction_hints_block}

Rules:
1) If allowed options are provided for a field, choose from them whenever possible.
2) Only output a value outside allowed options when image evidence strongly contradicts available options.
3) For each field include confidence (0-100).
4) Return only valid JSON.

Format strictly as:
{{
  "category": {{"value": "...", "confidence": 95}},
  "style_name": {{"value": "...", "confidence": 80}},
  "color": {{"value": "...", "confidence": 90}},
  "fabric": {{"value": "...", "confidence": 60}},
  "composition": {{"value": "...", "confidence": 75}},
  "woven_knits": {{"value": "...", "confidence": 85}}
}}
"""

    def analyze_image(
        self,
        image_url: str,
        *,
        allowed_options: dict[str, list[str]] | None = None,
        correction_hints: list[dict[str, str]] | None = None,
    ) -> dict[str, Any]:
        """
        Analyze a product image to extract structured data using GPT-4o.
        Returns a dictionary with keys: category, style_name, color, fabric, composition, woven_knits
        and optionally a confidence_score for each.
        """
        allowed_options_block = self._build_allowed_options_block(allowed_options)
        correction_hints_block = self._build_correction_hints_block(correction_hints)
        attempt_configs = (
            {'max_tokens': 500, 'compact_prompt': False, 'image_detail': 'high'},
            {'max_tokens': 320, 'compact_prompt': False, 'image_detail': 'low'},
            {'max_tokens': 220, 'compact_prompt': True, 'image_detail': 'low'},
            {'max_tokens': 140, 'compact_prompt': True, 'image_detail': 'low'},
        )
        last_error: Exception | None = None

        for attempt_config in attempt_configs:
            prompt = self._build_catalog_analysis_prompt(
                allowed_options_block=allowed_options_block,
                correction_hints_block=correction_hints_block,
                compact=attempt_config['compact_prompt'],
            )
            has_more_attempts = attempt_config != attempt_configs[-1]
            try:
                response = self.client.chat.completions.create(
                    model=self.vision_model,
                    messages=[
                        {
                            "role": "user",
                            "content": [
                                {"type": "text", "text": prompt},
                                {
                                    "type": "image_url",
                                    "image_url": {
                                        "url": image_url,
                                        "detail": attempt_config['image_detail']
                                    },
                                },
                            ],
                        }
                    ],
                    max_tokens=attempt_config['max_tokens'],
                    response_format={"type": "json_object"}
                )

                content = response.choices[0].message.content
                if not content:
                    return {}

                return json.loads(content)
            except Exception as exc:
                last_error = exc
                prompt_too_large = self._is_prompt_token_limit_error(exc)
                if (self._is_credit_limited_error(exc) or prompt_too_large) and has_more_attempts:
                    logger.warning(
                        '[Catalog AI] Retrying with compact prompt/low detail. '
                        'reason=%s max_tokens=%s detail=%s compact=%s',
                        'prompt_too_large' if prompt_too_large else 'credit_limited',
                        attempt_config['max_tokens'],
                        attempt_config['image_detail'],
                        attempt_config['compact_prompt'],
                    )
                    continue
                logger.exception('AI analysis failed')
                return {"error": str(exc)}

        logger.exception('AI analysis failed')
        return {"error": str(last_error) if last_error else "Unknown AI analysis failure."}

    def extract_po_attributes(self, image_url: str, category: str) -> dict[str, Any]:
        """
        Extract detailed Styli GARMENT attributes for a PO based on product category.
        """
        log_url = image_url[:60] + "..." if len(image_url) > 60 else image_url
        logger.info("[PO AI] Requesting analysis for category='%s' image='%s'", category, log_url)
        attempt_configs = (
            {'max_tokens': 220, 'compact_prompt': False, 'image_detail': 'high'},
            {'max_tokens': 220, 'compact_prompt': True, 'image_detail': 'low'},
            {'max_tokens': 140, 'compact_prompt': True, 'image_detail': 'low'},
        )

        for attempt_config in attempt_configs:
            prompt = self._build_po_attribute_prompt(category, compact=attempt_config['compact_prompt'])
            request_messages = self._build_po_request_messages(
                prompt,
                image_url,
                image_detail=attempt_config['image_detail'],
            )
            try:
                response = self.client.chat.completions.create(
                    model=self.vision_model,
                    messages=request_messages,
                    max_tokens=attempt_config['max_tokens'],
                    response_format={"type": "json_object"}
                )
                content = response.choices[0].message.content
                logger.info('[PO AI] Raw response for %s: %s', category, content)

                if not content:
                    logger.warning('[PO AI] OpenAI returned an empty message content.')
                    return normalize_ai_attributes(None)

                parsed = json.loads(content)
                return normalize_ai_attributes(parsed)
            except APIStatusError as exc:
                prompt_too_large = self._is_prompt_token_limit_error(exc)
                has_more_attempts = attempt_config != attempt_configs[-1]
                if exc.status_code == 402 and has_more_attempts:
                    if prompt_too_large:
                        logger.warning(
                            '[PO AI] Prompt too large for provider limit, retrying with a compact request.',
                        )
                    else:
                        logger.warning(
                            '[PO AI] Credit-limited response at max_tokens=%s, retrying with a smaller budget.',
                            attempt_config['max_tokens'],
                        )
                    continue
                if exc.status_code == 402 and prompt_too_large:
                    logger.warning(
                        '[PO AI] Prompt still exceeds provider limit after compact fallback.',
                    )
                logger.exception('[PO AI] Extraction failed')
                return normalize_ai_attributes(None)
            except Exception:
                logger.exception('[PO AI] Extraction failed')
                return normalize_ai_attributes(None)

        return normalize_ai_attributes(None)

    def assess_received_po_autopilot(
        self,
        *,
        po_snapshot: dict[str, Any],
        exception_summary: dict[str, Any],
    ) -> dict[str, Any]:
        """
        Ask Qwen to review a parsed buyer PO and return structured operational risk guidance.
        """
        prompt = f"""
You are Grada Autopilot, a wholesale operations agent reviewing a buyer purchase order before dispatch documents are generated.

Assess this parsed PO and return ONLY valid JSON with this exact structure:
{{
  "overall_risk": "low" | "medium" | "high",
  "confidence": 0-1,
  "decision": "auto_continue" | "needs_human_review",
  "critical_checks": [
    {{"check": "string", "status": "pass" | "warning" | "fail", "reason": "string"}}
  ],
  "review_questions": ["short question for the human reviewer"],
  "suggested_next_action": "short action"
}}

Rules:
1. Treat zero or missing quantity, price, SKU, style code, size, or construction as review blockers.
2. Prefer human review when commercial documents could be wrong.
3. Keep reasons specific to the rows and fields shown.
4. Do not invent buyer terms not present in the snapshot.

Parsed PO snapshot:
{json.dumps(po_snapshot, separators=(',', ':'), default=str)}

Exception summary:
{json.dumps(exception_summary, separators=(',', ':'), default=str)}
"""
        try:
            response = self.client.chat.completions.create(
                model=self.model,
                messages=[{"role": "user", "content": prompt}],
                max_tokens=700,
                response_format={"type": "json_object"},
            )
            content = response.choices[0].message.content
            if not content:
                return {"error": "Qwen returned an empty reasoning response."}
            parsed = json.loads(content)
            if not isinstance(parsed, dict):
                return {"error": "Qwen returned a non-object reasoning response."}
            return parsed
        except Exception as exc:
            logger.exception('[Received PO AI] Qwen reasoning failed')
            return {"error": str(exc)}

ai_service = AIService()


def _parse_payload(raw_payload: str | None) -> dict[str, Any]:
    if not raw_payload:
        return {}
    try:
        parsed = json.loads(raw_payload)
    except json.JSONDecodeError:
        return {}
    return parsed if isinstance(parsed, dict) else {}


def _read_techpack_bytes(input_ref: str | None) -> bytes:
    if not input_ref:
        return b''

    parsed = urlparse(input_ref)
    if parsed.scheme in {'http', 'https'}:
        with urlopen(input_ref, timeout=10) as response:
            return response.read()

    path_part = parsed.path if parsed.path else input_ref
    if path_part.startswith('/static/'):
        local_path = Path(path_part.lstrip('/'))
    elif path_part.startswith('static/'):
        local_path = Path(path_part)
    else:
        return b''

    if not local_path.exists():
        return b''
    return local_path.read_bytes()


def _extract_text_from_pdf_bytes(content: bytes) -> str:
    if not content:
        return ''
    decoded = content.decode('latin-1', errors='ignore')
    normalized = re.sub(r'[^A-Za-z0-9\s\.\,\-\:\/()%]', ' ', decoded)
    return re.sub(r'\s+', ' ', normalized).strip()


def _extract_measurements_from_text(text: str) -> list[dict[str, Any]]:
    if not text:
        return []

    extracted: dict[str, dict[str, Any]] = {}
    for key, aliases in MEASUREMENT_ALIASES.items():
        alias_pattern = '|'.join(re.escape(alias) for alias in aliases)
        pattern = re.compile(
            rf'(?i)\b(?:{alias_pattern})\b[^0-9]{{0,25}}(\d{{1,3}}(?:\.\d+)?)\s*(cm|in|inch|inches)?'
        )
        match = pattern.search(text)
        if not match:
            continue
        unit_token = (match.group(2) or 'cm').lower()
        unit = 'in' if unit_token in {'in', 'inch', 'inches'} else 'cm'
        confidence = 88.0 if match.group(2) else 74.0
        extracted[key] = {
            'measurement_key': key,
            'measurement_value': float(match.group(1)),
            'unit': unit,
            'confidence_score': confidence,
        }

    return list(extracted.values())


def _value_to_cm(value: float, unit: str) -> float:
    if unit == 'in':
        return value * 2.54
    return value


def _validate_techpack_measurements(
    measurements: list[dict[str, Any]]
) -> tuple[list[dict[str, Any]], list[str], float | None]:
    flags: list[str] = []
    total_confidence = 0.0
    reviewed_count = 0
    present_keys = {item['measurement_key'] for item in measurements}

    missing_required = [key for key in REQUIRED_TECHPACK_KEYS if key not in present_keys]
    if missing_required:
        flags.append(f"Missing required measurements: {', '.join(missing_required)}")

    validated: list[dict[str, Any]] = []
    for item in measurements:
        key = item['measurement_key']
        value = float(item['measurement_value'])
        unit = item['unit']
        confidence = float(item.get('confidence_score') or 0.0)
        total_confidence += confidence
        reviewed_count += 1

        needs_review = confidence < 80
        notes: list[str] = []
        if confidence < 80:
            notes.append('Low OCR confidence')

        range_bounds = MEASUREMENT_RANGES_CM.get(key)
        if range_bounds:
            value_cm = _value_to_cm(value, unit)
            min_cm, max_cm = range_bounds
            if value_cm < min_cm or value_cm > max_cm:
                needs_review = True
                notes.append(f'Value outside expected range ({min_cm:.0f}-{max_cm:.0f} cm)')
                flags.append(f'{key}: suspicious value {value} {unit}')

        validated.append(
            {
                **item,
                'needs_review': needs_review,
                'notes': '; '.join(notes) if notes else None,
            }
        )

    if not validated:
        flags.append('No measurable fields detected from tech-pack OCR.')

    average_confidence = (total_confidence / reviewed_count) if reviewed_count > 0 else None
    return validated, flags, average_confidence


def process_image_analysis_job(job_id: str):
    """
    Background task to process image analysis.
    Updates Job status and ProductImage analysis_json.
    """
    db = SessionLocal()
    job = None
    try:
        job = db.query(ProcessingJob).filter(ProcessingJob.id == job_id).first()
        if not job:
            return

        job.status = 'processing'
        job.started_at = utcnow()
        job.progress_percent = 15
        job.error_message = None
        db.commit()

        # Parse payload
        try:
            payload = json.loads(job.payload_json)
        except json.JSONDecodeError:
            payload = {}

        image_id = payload.get('image_id')
        image_data = payload.get('image_data')
        
        if image_id:
            image = db.query(ProductImage).filter(ProductImage.id == image_id).first()
            if image:
                # Prefer inline image data when available, otherwise fall back to the stored URL.
                image_source = image_data if image_data else image.file_url

                analysis = ai_service.analyze_image(image_source)
                if isinstance(analysis, dict) and isinstance(analysis.get('error'), str):
                    raise RuntimeError(analysis['error'])

                image.analysis_json = json.dumps(analysis, separators=(',', ':'))
                image.processing_status = 'completed'

                job.result_json = json.dumps(analysis, separators=(',', ':'))
                job.status = 'completed'
                job.completed_at = utcnow()
                job.progress_percent = 100
                db.commit()
                return
            else:
                job.error_message = f'ProductImage {image_id} not found'
        else:
            job.error_message = 'Missing image_id in payload'

        # Fallback for failure cases
        job.status = 'failed'
        job.completed_at = utcnow()
        job.progress_percent = 100
        db.commit()

    except Exception as e:
        if job:
            job.status = 'failed'
            job.error_message = str(e)
            job.completed_at = utcnow()
            job.progress_percent = 100
            db.commit()
    finally:
        db.close()


def process_techpack_ocr_job(job_id: str):
    """
    Background task to process tech-pack OCR style extraction.
    This MVP implementation uses text-pattern extraction from uploaded PDF bytes.
    """
    db: Session = SessionLocal()
    job: ProcessingJob | None = None
    try:
        job = db.query(ProcessingJob).filter(ProcessingJob.id == job_id).first()
        if not job:
            return

        job.status = 'processing'
        job.started_at = utcnow()
        job.progress_percent = 15
        job.error_message = None
        db.commit()

        if not job.product_id:
            job.status = 'failed'
            job.error_message = 'techpack_ocr requires product_id.'
            job.completed_at = utcnow()
            job.progress_percent = 100
            db.commit()
            return

        payload = _parse_payload(job.payload_json)
        techpack_text = payload.get('techpack_text')
        input_ref = payload.get('techpack_url') or job.input_ref

        if isinstance(techpack_text, str) and techpack_text.strip():
            normalized_text = re.sub(r'\s+', ' ', techpack_text).strip()
        else:
            file_bytes = _read_techpack_bytes(input_ref)
            normalized_text = _extract_text_from_pdf_bytes(file_bytes)

        extracted = _extract_measurements_from_text(normalized_text)
        validated, flags, average_confidence = _validate_techpack_measurements(extracted)

        db.query(ProductMeasurement).filter(
            ProductMeasurement.company_id == job.company_id,
            ProductMeasurement.product_id == job.product_id,
            ProductMeasurement.source == TECHPACK_SOURCE,
        ).delete()

        for entry in validated:
            db.add(
                ProductMeasurement(
                    id=str(uuid4()),
                    company_id=job.company_id,
                    product_id=job.product_id,
                    measurement_key=entry['measurement_key'],
                    measurement_value=entry['measurement_value'],
                    unit=entry['unit'],
                    source=TECHPACK_SOURCE,
                    confidence_score=entry.get('confidence_score'),
                    needs_review=bool(entry.get('needs_review')),
                    notes=entry.get('notes'),
                )
            )

        result = {
            'techpack_source': input_ref,
            'measurements': validated,
            'validation_flags': flags,
            'extracted_count': len(validated),
            'ocr_text_preview': normalized_text[:800],
        }
        job.result_json = json.dumps(result, separators=(',', ':'))
        job.confidence_score = average_confidence
        job.status = 'completed'
        job.progress_percent = 100
        job.completed_at = utcnow()
        job.error_message = None
        db.commit()
    except Exception as e:
        if job:
            job.status = 'failed'
            job.error_message = str(e)
            job.completed_at = utcnow()
            job.progress_percent = 100
            db.commit()
    finally:
        db.close()


def process_ai_correction_retraining(correction_id: str):
    """
    Lightweight retraining queue worker for logged AI corrections.
    This MVP marks correction events as processed and stores a short note.
    """
    db: Session = SessionLocal()
    correction: AICorrection | None = None
    try:
        correction = db.query(AICorrection).filter(AICorrection.id == correction_id).first()
        if not correction:
            return

        correction.retraining_status = 'processing'
        db.commit()

        if correction.feedback_type == 'reject':
            correction.retraining_notes = 'Queued negative sample for prompt tuning.'
        else:
            correction.retraining_notes = 'Queued positive sample for confidence calibration.'

        correction.retraining_status = 'completed'
        correction.processed_at = utcnow()
        db.commit()
    except Exception as e:
        if correction:
            correction.retraining_status = 'failed'
            correction.retraining_notes = str(e)[:255]
            correction.processed_at = utcnow()
            db.commit()
    finally:
        db.close()

def _resolve_image_url_for_po(image_url: str) -> str:
    """
    Convert any image URL (local /static/, localhost, or remote) to a form
    that can be sent to OpenAI: either a data-URI (for local files) or the
    original URL (for public remote URLs).
    """
    import base64
    from urllib.parse import urlparse

    url = image_url.strip()
    if not url or url.startswith('data:'):
        return url

    # ai.py lives at: apps/api/app/services/ai.py
    # parents[0] = apps/api/app/services/
    # parents[1] = apps/api/app/
    # parents[2] = apps/api/          <-- API root, where static/ lives
    api_root = Path(__file__).resolve().parents[2]
    static_root = api_root / 'static'

    # FastAPI uvicorn runs from apps/api/ so CWD is also a valid fallback
    cwd_static = Path.cwd() / 'static'

    parsed = urlparse(url)

    # Derive the /static/... relative portion
    static_relative = ''
    if url.startswith('/static/'):
        static_relative = url[len('/static/'):]
    elif parsed.path.startswith('/static/'):
        static_relative = parsed.path[len('/static/'):]

    if static_relative:
        for candidate in [static_root / static_relative, cwd_static / static_relative]:
            if candidate.exists():
                raw = candidate.read_bytes()
                ext = candidate.suffix.lower()
                mime = 'image/png' if ext == '.png' else 'image/webp' if ext == '.webp' else 'image/jpeg'
                return f'data:{mime};base64,{base64.b64encode(raw).decode()}'
        print(f'[PO Extraction] WARNING: local image not found at {static_root / static_relative} or {cwd_static / static_relative}')
        return url

    # For localhost/127.0.0.1 URLs without /static/ prefix, try an HTTP fetch
    if parsed.hostname in {'localhost', '127.0.0.1'}:
        try:
            req = UrlRequest(url, headers={'User-Agent': 'kira-po-extractor/1.0'})
            with urlopen(req, timeout=8) as resp:
                raw = resp.read()
                mime = resp.headers.get_content_type() or 'image/jpeg'
            return f'data:{mime};base64,{base64.b64encode(raw).decode()}'
        except Exception as fetch_err:
            print(f'[PO Extraction] WARNING: could not fetch local URL {url}: {fetch_err}')
            return url

    # Remote public URL — return as-is and let OpenAI fetch it
    return url


def process_po_ai_extraction_job(po_request_id: str):
    """
    Background task to process PO AI attribute extraction for all items in a request.
    """
    from app.models.product import Product
    db: Session = SessionLocal()
    po_request: PORequest | None = None
    try:
        po_request = db.query(PORequest).filter(PORequest.id == po_request_id).first()
        if not po_request:
            logger.warning('[PO Extraction] PO Request %s not found.', po_request_id)
            return

        logger.info('[PO Extraction] Starting extraction for PO %s (%s items)', po_request_id, len(po_request.items))
        extracted_item_count = 0

        for item in po_request.items:
            product = db.query(Product).filter(Product.id == item.product_id).first()
            if not product:
                logger.warning('[PO Extraction] Product %s not found, skipping.', item.product_id)
                item.extracted_attributes = normalize_ai_attributes(None)
                continue

            # Try dedicated ProductImage first, fall back to ai_attributes / primary_image_url
            image_record = (
                db.query(ProductImage)
                .filter(ProductImage.product_id == product.id)
                .order_by(ProductImage.created_at)
                .first()
            )
            raw_url: str | None = None
            if image_record and image_record.file_url:
                raw_url = image_record.file_url
            else:
                product_ai_attributes = _parse_payload(product.ai_attributes_json)
                primary_image_url = product_ai_attributes.get('primary_image_url')
                if isinstance(primary_image_url, str) and primary_image_url.strip():
                    raw_url = primary_image_url.strip()

            if not raw_url:
                logger.warning('[PO Extraction] No image found for product %s, skipping AI call.', product.id)
                item.extracted_attributes = normalize_ai_attributes(None)
                continue

            try:
                resolved_url = _resolve_image_url_for_po(raw_url)
                logger.info(
                    '[PO Extraction] Extracting attributes for product %s (category=%s)',
                    product.id,
                    product.category,
                )
                attributes = ai_service.extract_po_attributes(resolved_url, product.category or 'Dress')
                item.extracted_attributes = normalize_ai_attributes(attributes)
                if item.extracted_attributes.get('fields'):
                    extracted_item_count += 1
                logger.info(
                    '[PO Extraction] Got %s attributes for product %s',
                    len(item.extracted_attributes.get('fields', {})),
                    product.id,
                )
            except Exception:
                logger.exception('[PO Extraction] Error extracting product %s', product.id)
                item.extracted_attributes = normalize_ai_attributes(None)

        rebuild_po_request_rows(db, po_request)
        po_request.status = 'ready' if extracted_item_count > 0 else 'failed'
        db.commit()
        logger.info('[PO Extraction] Done. PO %s marked %s.', po_request_id, po_request.status)
    except Exception:
        logger.exception('[PO Extraction] Fatal error for PO %s', po_request_id)
        if po_request:
            po_request.status = 'failed'
            db.commit()
    finally:
        db.close()
