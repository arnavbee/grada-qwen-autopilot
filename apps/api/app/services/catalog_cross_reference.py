"""
Catalog cross-reference tool for Grada Autopilot.

Compares received PO line items against the product catalog to detect
pricing discrepancies, missing SKUs, and unusual size distributions.
"""

from __future__ import annotations

import json
import logging
from typing import Any

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.product import Product
from app.models.received_po import ReceivedPO, ReceivedPOLineItem

logger = logging.getLogger(__name__)

PRICE_DISCREPANCY_THRESHOLD = 0.10
MIN_SIZE_VARIETY_RATIO = 0.3


def _normalize_code(value: str | None) -> str:
    return str(value or '').strip().lower()


def _parse_ai_attributes(raw_json: str) -> dict[str, Any]:
    if not raw_json:
        return {}
    try:
        parsed = json.loads(raw_json)
    except (json.JSONDecodeError, TypeError):
        return {}
    return parsed if isinstance(parsed, dict) else {}


def _get_catalog_price(product: Product) -> float | None:
    attrs = _parse_ai_attributes(product.ai_attributes_json)
    for key in ('mrp', 'price', 'unit_price', 'po_price', 'retail_price'):
        raw = attrs.get(key)
        if raw is not None:
            try:
                return float(raw)
            except (TypeError, ValueError):
                continue
    return None


def _find_catalog_product(
    db: Session, company_id: str, item: ReceivedPOLineItem
) -> Product | None:
    candidates = [
        _normalize_code(item.brand_style_code),
        _normalize_code(item.styli_style_id),
        _normalize_code(item.sku_id),
        _normalize_code(item.model_number),
        _normalize_code(item.option_id),
    ]
    candidates = [c for c in candidates if c]
    if not candidates:
        return None

    products = db.query(Product).filter(Product.company_id == company_id).all()
    for product in products:
        product_codes = [
            _normalize_code(product.sku),
            _normalize_code(product.title),
        ]
        attrs = _parse_ai_attributes(product.ai_attributes_json)
        for attr_key in ('style_code', 'style_id', 'sku', 'vendor_style_code', 'styli_style_id'):
            product_codes.append(_normalize_code(attrs.get(attr_key)))
        for code in candidates:
            if code in product_codes:
                return product
    return None


def _check_size_distribution(items: list[ReceivedPOLineItem]) -> dict[str, Any]:
    size_quantities: dict[str, int] = {}
    total = 0
    for item in items:
        size = str(item.size or '').strip().upper()
        if not size:
            continue
        size_quantities[size] = size_quantities.get(size, 0) + max(0, item.quantity)
        total += max(0, item.quantity)

    if total == 0 or len(size_quantities) < 2:
        return {
            'check': 'size_distribution',
            'status': 'pass',
            'detail': 'Insufficient size data for distribution analysis.',
            'size_breakdown': size_quantities,
        }

    max_size_qty = max(size_quantities.values())
    max_ratio = max_size_qty / total if total > 0 else 0

    if max_ratio > 0.7 and len(size_quantities) >= 3:
        dominant = max(size_quantities, key=lambda k: size_quantities[k])
        return {
            'check': 'size_distribution',
            'status': 'warning',
            'detail': (
                f"Size {dominant} accounts for {max_ratio:.0%} of total quantity. "
                f"This may indicate an unusual size distribution."
            ),
            'size_breakdown': size_quantities,
            'dominant_size': dominant,
            'dominant_ratio': round(max_ratio, 2),
        }

    return {
        'check': 'size_distribution',
        'status': 'pass',
        'detail': f'Size distribution looks reasonable across {len(size_quantities)} sizes.',
        'size_breakdown': size_quantities,
    }


def cross_reference_catalog(
    db: Session, record: ReceivedPO
) -> dict[str, Any]:
    """
    Cross-reference all line items in a received PO against the product catalog.
    Returns structured findings per line item plus aggregate stats.
    """
    company_id = record.company_id
    findings: list[dict[str, Any]] = []
    matched = 0
    unmatched = 0
    price_discrepancies = 0
    total_items = len(record.items)

    for item in record.items:
        item_finding: dict[str, Any] = {
            'line_item_id': item.id,
            'brand_style_code': item.brand_style_code,
            'sku_id': item.sku_id,
            'issues': [],
        }

        product = _find_catalog_product(db, company_id, item)
        if product is None:
            unmatched += 1
            item_finding['catalog_match'] = False
            item_finding['issues'].append({
                'type': 'catalog_not_found',
                'severity': 'warning',
                'detail': (
                    f"No catalog match found for style code '{item.brand_style_code}' "
                    f"or SKU '{item.sku_id}'. Verify this item exists in the catalog."
                ),
            })
        else:
            matched += 1
            item_finding['catalog_match'] = True
            item_finding['catalog_product_id'] = product.id
            item_finding['catalog_product_title'] = product.title

            catalog_price = _get_catalog_price(product)
            po_price = float(item.po_price) if item.po_price is not None else None

            if catalog_price is not None and po_price is not None and catalog_price > 0:
                delta = abs(po_price - catalog_price) / catalog_price
                item_finding['catalog_price'] = catalog_price
                item_finding['po_price'] = po_price
                item_finding['price_delta_pct'] = round(delta * 100, 1)

                if delta > PRICE_DISCREPANCY_THRESHOLD:
                    price_discrepancies += 1
                    direction = 'below' if po_price < catalog_price else 'above'
                    item_finding['issues'].append({
                        'type': 'price_discrepancy',
                        'severity': 'warning',
                        'detail': (
                            f"PO price ₹{po_price:.2f} is {delta:.0%} {direction} catalog "
                            f"price ₹{catalog_price:.2f}. Verify against buyer agreement."
                        ),
                        'catalog_price': catalog_price,
                        'po_price': po_price,
                        'delta_pct': round(delta, 4),
                        'direction': direction,
                    })

            if product.color and item.color:
                catalog_color = product.color.strip().lower()
                po_color = item.color.strip().lower()
                if catalog_color and po_color and catalog_color != po_color:
                    item_finding['issues'].append({
                        'type': 'color_mismatch',
                        'severity': 'info',
                        'detail': (
                            f"PO color '{item.color}' differs from catalog color '{product.color}'."
                        ),
                        'catalog_color': product.color,
                        'po_color': item.color,
                    })

        if item.quantity <= 0:
            item_finding['issues'].append({
                'type': 'zero_quantity',
                'severity': 'error',
                'detail': 'Line item has zero quantity.',
            })

        if item.po_price is None or float(item.po_price) <= 0:
            item_finding['issues'].append({
                'type': 'missing_price',
                'severity': 'warning',
                'detail': 'Line item is missing a PO price.',
            })

        findings.append(item_finding)

    size_check = _check_size_distribution(record.items)

    items_with_issues = sum(1 for f in findings if f['issues'])
    total_issues = sum(len(f['issues']) for f in findings)

    if price_discrepancies > 0:
        overall_status = 'warning'
    elif unmatched > total_items * 0.5:
        overall_status = 'warning'
    elif size_check['status'] == 'warning':
        overall_status = 'warning'
    else:
        overall_status = 'pass'

    return {
        'tool': 'catalog_cross_reference',
        'status': overall_status,
        'summary': {
            'total_items': total_items,
            'matched': matched,
            'unmatched': unmatched,
            'price_discrepancies': price_discrepancies,
            'items_with_issues': items_with_issues,
            'total_issues': total_issues,
            'match_rate': round((matched / total_items) * 100, 1) if total_items > 0 else 0,
        },
        'findings': findings,
        'size_distribution': size_check,
    }
