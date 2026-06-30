from types import SimpleNamespace

from app.services import received_po_reasoning as reasoning_module


def _record() -> SimpleNamespace:
    return SimpleNamespace(
        po_number='STY-2026-00847',
        po_date=None,
        distributor='Styli',
        items=[
            SimpleNamespace(
                brand_style_code='HRDS25001',
                sku_id='HRDS25001-A-BLACK-S',
                size='S',
                color='Black',
                knitted_woven='Woven',
                quantity=10,
                po_price=499,
                resolution_status='auto_resolved',
                exception_reason=None,
                suggested_fix_json='{}',
                confidence_score=1,
            )
        ],
    )


def test_reasoning_uses_qwen_when_configured(monkeypatch) -> None:
    monkeypatch.setattr(
        reasoning_module,
        'get_settings',
        lambda: SimpleNamespace(
            ai_provider='qwen',
            ai_model=None,
            QWEN_API_KEY='qwen-key',
            QWEN_MODEL='qwen-vl-max',
        ),
    )

    def _fake_assess(**_kwargs: object) -> dict[str, object]:
        return {
            'overall_risk': 'low',
            'confidence': 0.91,
            'decision': 'auto_continue',
            'critical_checks': [{'check': 'rows', 'status': 'pass', 'reason': 'All rows are usable.'}],
            'review_questions': [],
            'suggested_next_action': 'Confirm the PO.',
        }

    monkeypatch.setattr(reasoning_module.ai_service, 'assess_received_po_autopilot', _fake_assess)

    result = reasoning_module.reason_about_received_po(
        _record(),
        {'total': 1, 'auto_resolved': 1, 'needs_review': 0, 'human_corrected': 0, 'auto_resolve_rate': 100},
    )

    assert result['source'] == 'qwen_cloud'
    assert result['provider'] == 'qwen'
    assert result['model'] == 'qwen-vl-max'
    assert result['overall_risk'] == 'low'
    assert result['decision'] == 'auto_continue'


def test_reasoning_falls_back_without_qwen_key(monkeypatch) -> None:
    monkeypatch.setattr(
        reasoning_module,
        'get_settings',
        lambda: SimpleNamespace(
            ai_provider='qwen',
            ai_model=None,
            QWEN_API_KEY=None,
            QWEN_MODEL='qwen-vl-max',
        ),
    )

    result = reasoning_module.reason_about_received_po(
        _record(),
        {'total': 1, 'auto_resolved': 0, 'needs_review': 1, 'human_corrected': 0, 'auto_resolve_rate': 0},
    )

    assert result['source'] == 'local_rule_fallback'
    assert result['decision'] == 'needs_human_review'
    assert result['overall_risk'] == 'medium'
