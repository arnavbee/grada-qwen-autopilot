from typing import Any

from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models.received_po import ReceivedPO
from app.services.ai import ai_service
from app.services.received_po_agent import log_received_po_agent_event

MAX_REASONING_ROWS = 30


def _line_item_snapshot(record: ReceivedPO) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for item in record.items[:MAX_REASONING_ROWS]:
        rows.append(
            {
                'brand_style_code': item.brand_style_code,
                'sku_id': item.sku_id,
                'size': item.size,
                'color': item.color,
                'knitted_woven': item.knitted_woven,
                'quantity': item.quantity,
                'po_price': float(item.po_price) if item.po_price is not None else None,
                'resolution_status': item.resolution_status,
                'exception_reason': item.exception_reason,
                'suggested_fix': item.suggested_fix_json,
                'confidence_score': float(item.confidence_score) if item.confidence_score is not None else None,
            }
        )
    return rows


def _po_snapshot(record: ReceivedPO) -> dict[str, Any]:
    return {
        'po_number': record.po_number,
        'po_date': record.po_date.isoformat() if record.po_date else None,
        'distributor': record.distributor,
        'line_item_count': len(record.items),
        'sampled_line_items': _line_item_snapshot(record),
        'sample_truncated': len(record.items) > MAX_REASONING_ROWS,
    }


def _fallback_reasoning(
    exception_summary: dict[str, Any], catalog_summary: dict[str, Any] | None = None
) -> dict[str, Any]:
    needs_review = int(exception_summary.get('needs_review') or 0)
    total = int(exception_summary.get('total') or 0)
    auto_resolve_rate = float(exception_summary.get('auto_resolve_rate') or 0)

    checks = []
    questions = []
    overall_risk = 'low'
    decision = 'auto_continue'
    confidence = 0.84

    if needs_review > 0:
        overall_risk = 'medium'
        decision = 'needs_human_review'
        confidence = 0.76
        checks.append(
            {
                'check': 'line_item_exceptions',
                'status': 'warning',
                'reason': f'{needs_review} of {total} line item(s) need review before dispatch documents.',
            }
        )
        questions.append('Resolve flagged quantities, prices, SKUs, sizes, and construction values before confirmation.')
    else:
        checks.append(
            {
                'check': 'line_item_exceptions',
                'status': 'pass',
                'reason': f'All {total} line item(s) passed deterministic checks with {auto_resolve_rate:.0f}% auto-resolution.',
            }
        )

    if catalog_summary:
        price_disc = catalog_summary['summary'].get('price_discrepancies', 0)
        match_rate = catalog_summary['summary'].get('match_rate', 100)
        cat_status = catalog_summary.get('status', 'pass')
        checks.append(
            {
                'check': 'catalog_cross_reference',
                'status': cat_status,
                'reason': f"Catalog match rate {match_rate}% with {price_disc} pricing discrepancy(ies).",
            }
        )
        if cat_status == 'warning' or price_disc > 0:
            overall_risk = 'high' if needs_review > 0 else 'medium'
            decision = 'needs_human_review'
            questions.append(f'Verify {price_disc} line item(s) with price discrepancies against agreement terms.')

    time_saved = max(15, total * 3)
    return {
        'overall_risk': overall_risk,
        'confidence': confidence,
        'decision': decision,
        'critical_checks': checks,
        'review_questions': questions,
        'suggested_next_action': 'Open the exception inbox and resolve flagged rows.' if decision == 'needs_human_review' else 'Proceed to human confirmation and downstream document generation.',
        'what_would_happen_without_me': f"Without Grada Autopilot, an operations coordinator would manually cross-reference {total} order lines against ERP product master tables and historical pricing agreements, consuming approximately {time_saved} minutes of manual review and risking dispatch delays.",
    }


def _normalize_reasoning(raw_reasoning: dict[str, Any], *, source: str, provider: str, model: str) -> dict[str, Any]:
    valid_risks = {'low', 'medium', 'high'}
    valid_decisions = {'auto_continue', 'needs_human_review'}
    overall_risk = str(raw_reasoning.get('overall_risk') or '').lower()
    decision = str(raw_reasoning.get('decision') or '').lower()

    try:
        confidence = float(raw_reasoning.get('confidence') or 0)
    except (TypeError, ValueError):
        confidence = 0

    checks = raw_reasoning.get('critical_checks')
    questions = raw_reasoning.get('review_questions')
    impact = raw_reasoning.get('what_would_happen_without_me')
    if not impact:
        total = len(checks) * 10 or 20
        impact = f"Without Autopilot, human coordinators would spend ~{total * 3} minutes manually cross-referencing order rows and pricing."

    return {
        'source': source,
        'provider': provider,
        'model': model,
        'overall_risk': overall_risk if overall_risk in valid_risks else 'medium',
        'confidence': max(0, min(1, confidence)),
        'decision': decision if decision in valid_decisions else 'needs_human_review',
        'critical_checks': checks if isinstance(checks, list) else [],
        'review_questions': questions if isinstance(questions, list) else [],
        'suggested_next_action': str(raw_reasoning.get('suggested_next_action') or '').strip(),
        'what_would_happen_without_me': str(impact).strip(),
    }


def reason_about_received_po(
    record: ReceivedPO,
    exception_summary: dict[str, Any],
    *,
    catalog_summary: dict[str, Any] | None = None,
    db: Session | None = None,
) -> dict[str, Any]:
    settings = get_settings()
    provider = str(settings.ai_provider or '').strip().lower()
    model = settings.ai_model or settings.QWEN_MODEL

    def _on_tool_invoked(tool_name: str, summary: str, metadata: dict[str, Any] | None = None) -> None:
        if db is not None and record is not None:
            log_received_po_agent_event(
                db,
                record,
                event_type=f'agent.tool.{tool_name}',
                title=f'Agent tool: {tool_name}',
                summary=summary,
                tool_name=tool_name,
                metadata=metadata or {},
            )

    if provider == 'qwen' and settings.QWEN_API_KEY:
        raw_reasoning = ai_service.assess_received_po_autopilot(
            po_snapshot=_po_snapshot(record),
            exception_summary=exception_summary,
            catalog_summary=catalog_summary,
            on_tool_invoked=_on_tool_invoked,
        )
        if 'error' not in raw_reasoning:
            return _normalize_reasoning(raw_reasoning, source='qwen_cloud', provider=provider, model=model)
        fallback = _fallback_reasoning(exception_summary, catalog_summary=catalog_summary)
        fallback['qwen_error'] = str(raw_reasoning.get('error') or '')[:300]
        return _normalize_reasoning(fallback, source='qwen_error_fallback', provider=provider, model=model)

    from app.services.ai import _execute_autopilot_tool
    po_snap = _po_snapshot(record)
    for tool_name in ['check_pricing', 'check_catalog_match', 'check_quantity_reasonableness', 'suggest_resolution']:
        tool_out = _execute_autopilot_tool(tool_name, po_snap, exception_summary, catalog_summary)
        _on_tool_invoked(tool_name, tool_out.get('summary', f'Executed {tool_name}'), tool_out)

    return _normalize_reasoning(
        _fallback_reasoning(exception_summary, catalog_summary=catalog_summary),
        source='local_rule_fallback',
        provider=provider or 'not_configured',
        model=model,
    )
