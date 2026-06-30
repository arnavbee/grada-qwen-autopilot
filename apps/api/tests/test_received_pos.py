import time
import zipfile
from io import BytesIO
from uuid import uuid4

from fastapi.testclient import TestClient

from app.db.session import SessionLocal, init_db
from app.main import app
from app.models.received_po import ReceivedPO, ReceivedPOLineItem

init_db()
client = TestClient(app)


def _auth_headers(company_name: str = 'Received PO Co') -> dict[str, str]:
    email = f'received-po-{uuid4().hex[:8]}@example.com'
    response = client.post(
        '/api/v1/auth/register',
        json={
            'company_name': company_name,
            'full_name': 'Ops Admin',
            'email': email,
            'password': 'Password1',
        },
    )
    assert response.status_code == 201
    return {'Authorization': f"Bearer {response.json()['access_token']}"}


def _build_test_xlsx(rows: list[list[str]]) -> bytes:
    sheet_rows: list[str] = []
    for row_index, row in enumerate(rows, start=1):
        cells: list[str] = []
        for column_index, value in enumerate(row, start=1):
            column_name = ''
            index = column_index
            while index > 0:
                index, remainder = divmod(index - 1, 26)
                column_name = chr(65 + remainder) + column_name
            cell_ref = f'{column_name}{row_index}'
            escaped = (
                str(value)
                .replace('&', '&amp;')
                .replace('<', '&lt;')
                .replace('>', '&gt;')
                .replace('"', '&quot;')
                .replace("'", '&apos;')
            )
            cells.append(
                f'<c r="{cell_ref}" t="inlineStr"><is><t xml:space="preserve">{escaped}</t></is></c>'
            )
        sheet_rows.append(f'<row r="{row_index}">{"".join(cells)}</row>')

    sheet_xml = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
        f'<sheetData>{"".join(sheet_rows)}</sheetData>'
        '</worksheet>'
    )
    workbook_xml = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
        '<sheets><sheet name="PO" sheetId="1" r:id="rId1"/></sheets>'
        '</workbook>'
    )
    content_types_xml = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        '<Default Extension="xml" ContentType="application/xml"/>'
        '<Override PartName="/xl/workbook.xml" '
        'ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
        '<Override PartName="/xl/worksheets/sheet1.xml" '
        'ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
        '</Types>'
    )
    root_rels_xml = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" '
        'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" '
        'Target="xl/workbook.xml"/>'
        '</Relationships>'
    )
    workbook_rels_xml = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" '
        'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" '
        'Target="worksheets/sheet1.xml"/>'
        '</Relationships>'
    )

    buffer = BytesIO()
    with zipfile.ZipFile(buffer, mode='w', compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr('[Content_Types].xml', content_types_xml)
        archive.writestr('_rels/.rels', root_rels_xml)
        archive.writestr('xl/workbook.xml', workbook_xml)
        archive.writestr('xl/_rels/workbook.xml.rels', workbook_rels_xml)
        archive.writestr('xl/worksheets/sheet1.xml', sheet_xml)
    return buffer.getvalue()


def test_received_po_upload_list_get_edit_confirm_and_barcode_job() -> None:
    headers = _auth_headers()

    upload = client.post(
        '/api/v1/received-pos/upload',
        headers=headers,
        files={'file': ('styli-po.pdf', b'%PDF-1.4 fake po', 'application/pdf')},
    )
    assert upload.status_code == 201
    received_po_id = upload.json()['received_po_id']

    timeline = client.get(f'/api/v1/received-pos/{received_po_id}/agent-events', headers=headers)
    assert timeline.status_code == 200
    assert any(item['event_type'] == 'received_po.uploaded' for item in timeline.json()['items'])

    list_response = client.get('/api/v1/received-pos', headers=headers)
    assert list_response.status_code == 200
    assert list_response.json()['total'] >= 1

    filtered_list_response = client.get('/api/v1/received-pos?status=uploaded&limit=1', headers=headers)
    assert filtered_list_response.status_code == 200
    if filtered_list_response.json()['total'] >= 1:
        assert filtered_list_response.json()['total'] >= 1
    else:
        found_in_transitional_state = False
        for po_status in ('parsing', 'parsed', 'failed'):
            alternate_list_response = client.get(f'/api/v1/received-pos?status={po_status}&limit=1', headers=headers)
            assert alternate_list_response.status_code == 200
            if alternate_list_response.json()['total'] >= 1:
                found_in_transitional_state = True
                break
        assert found_in_transitional_state is True

    header_update = client.patch(
        f'/api/v1/received-pos/{received_po_id}',
        headers=headers,
        json={
            'po_number': 'STY-2026-00847',
            'distributor': 'Styli',
        },
    )
    assert header_update.status_code == 200
    assert header_update.json()['po_number'] == 'STY-2026-00847'

    db = SessionLocal()
    try:
        record = db.query(ReceivedPO).filter(ReceivedPO.id == received_po_id).first()
        assert record is not None
        line_item = ReceivedPOLineItem(
            received_po_id=record.id,
            brand_style_code='HRDS25001',
            styli_style_id='STYLI-101',
            model_number='MOD-1',
            option_id='OPT-BLK',
            sku_id='HRDS25001-A-BLACK-S',
            color='Black',
            size='S',
            quantity=10,
            po_price=499.0,
        )
        db.add(line_item)
        db.commit()
        line_item_id = line_item.id
    finally:
        db.close()

    items_update = client.put(
        f'/api/v1/received-pos/{received_po_id}/items',
        headers=headers,
        json={
            'items': [
                {
                    'id': line_item_id,
                    'brand_style_code': 'HRDS25001',
                    'styli_style_id': 'STYLI-101',
                    'model_number': 'MOD-2',
                    'option_id': 'OPT-BLK',
                    'sku_id': 'HRDS25001-A-BLACK-S',
                    'color': 'Black',
                    'size': 'S',
                    'quantity': 12,
                    'po_price': 525.0,
                }
            ]
        },
    )
    assert items_update.status_code == 200
    assert items_update.json()['items'][0]['model_number'] == 'MOD-2'
    assert items_update.json()['items'][0]['quantity'] == 12

    detail = client.get(f'/api/v1/received-pos/{received_po_id}', headers=headers)
    assert detail.status_code == 200
    assert len(detail.json()['items']) == 1

    confirm = client.post(f'/api/v1/received-pos/{received_po_id}/confirm', headers=headers)
    assert confirm.status_code == 200
    assert confirm.json()['status'] == 'confirmed'

    timeline_after_confirm = client.get(f'/api/v1/received-pos/{received_po_id}/agent-events', headers=headers)
    assert timeline_after_confirm.status_code == 200
    assert any(item['event_type'] == 'human.po_confirmed' for item in timeline_after_confirm.json()['items'])

    edit_after_confirm = client.patch(
        f'/api/v1/received-pos/{received_po_id}',
        headers=headers,
        json={'po_number': 'CHANGED'},
    )
    assert edit_after_confirm.status_code == 409

    barcode_job = client.post(f'/api/v1/received-pos/{received_po_id}/barcode', headers=headers)
    assert barcode_job.status_code == 201
    job_id = barcode_job.json()['job_id']

    timeline_after_barcode = client.get(f'/api/v1/received-pos/{received_po_id}/agent-events', headers=headers)
    assert timeline_after_barcode.status_code == 200
    assert any(item['event_type'] == 'agent.barcode_queued' for item in timeline_after_barcode.json()['items'])

    barcode_status = client.get(f'/api/v1/received-pos/{received_po_id}/barcode/status', headers=headers)
    assert barcode_status.status_code == 200
    assert barcode_status.json()['id'] == job_id
    assert barcode_status.json()['total_stickers'] == 1

    second_barcode_job = client.post(f'/api/v1/received-pos/{received_po_id}/barcode', headers=headers)
    assert second_barcode_job.status_code == 201
    second_job_id = second_barcode_job.json()['job_id']

    latest_barcode_status = client.get(f'/api/v1/received-pos/{received_po_id}/barcode/status', headers=headers)
    assert latest_barcode_status.status_code == 200
    assert latest_barcode_status.json()['id'] == second_job_id

    first_barcode_status = client.get(
        f'/api/v1/received-pos/{received_po_id}/barcode/jobs/{job_id}',
        headers=headers,
    )
    assert first_barcode_status.status_code == 200
    assert first_barcode_status.json()['id'] == job_id
    assert first_barcode_status.json()['received_po_id'] == received_po_id


def test_received_po_upload_parses_excel_into_line_items() -> None:
    headers = _auth_headers()

    xlsx_bytes = _build_test_xlsx(
        [
            ['PO Number', 'PO Date', 'Distributor'],
            ['STY-2026-00847', '2026-03-24', 'Styli'],
            [],
            [
                'Brand Style Code',
                'Styli Style ID',
                'Model Number',
                'Option ID',
                'SKU ID',
                'Color',
                'Size',
                'Quantity',
                'PO Price',
            ],
            ['HRDS25001', 'STYLI-101', 'MOD-1', 'OPT-BLK', 'HRDS25001-A-BLACK-S', 'Black', 'S', 10, 499],
            ['HRDS25001', 'STYLI-101', 'MOD-1', 'OPT-BLK', 'HRDS25001-A-BLACK-M', 'Black', 'M', 12, 499],
        ]
    )

    upload = client.post(
        '/api/v1/received-pos/upload',
        headers=headers,
        files={
            'file': (
                'styli-po.xlsx',
                xlsx_bytes,
                'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            )
        },
    )
    assert upload.status_code == 201
    received_po_id = upload.json()['received_po_id']

    final_payload = None
    for _ in range(20):
        detail = client.get(f'/api/v1/received-pos/{received_po_id}', headers=headers)
        assert detail.status_code == 200
        final_payload = detail.json()
        if final_payload['status'] in {'parsed', 'failed'}:
            break
        time.sleep(0.05)

    assert final_payload is not None
    assert final_payload['status'] == 'parsed'
    assert final_payload['po_number'] == 'STY-2026-00847'
    assert final_payload['distributor'] == 'Styli'
    assert len(final_payload['items']) == 2
    assert final_payload['items'][0]['brand_style_code'] == 'HRDS25001'
    assert final_payload['items'][0]['sku_id'] == 'HRDS25001-A-BLACK-S'
    assert final_payload['raw_extracted']['qwen_reasoning']['source'] in {
        'local_rule_fallback',
        'qwen_cloud',
        'qwen_error_fallback',
    }
    assert final_payload['raw_extracted']['qwen_reasoning']['decision'] in {'auto_continue', 'needs_human_review'}

    timeline = client.get(f'/api/v1/received-pos/{received_po_id}/agent-events', headers=headers)
    assert timeline.status_code == 200
    event_types = {item['event_type'] for item in timeline.json()['items']}
    assert 'agent.parse_started' in event_types
    assert 'agent.qwen_reasoning_completed' in event_types
    assert 'agent.parse_completed' in event_types


def test_received_po_upload_parses_vendor_export_format() -> None:
    headers = _auth_headers('Received PO Vendor Format Co')

    xlsx_bytes = _build_test_xlsx(
        [
            ['Booked By', '', 'Shipment Terms', 'FOB', 'PO', '70058628'],
            ['Supplier', 'HOUSE OF RAELI', 'Payment Terms', 'TT', 'PO Date', '2026-01-29 06:33:20'],
            [
                'Vendor Style Number',
                'Style Id',
                'Styli Option ID',
                'Styli SKU',
                'Colour',
                'Size',
                'Total',
                'PO Price',
            ],
            ['MSDR106MXSOBK-A-Black', '70328991', '7032899101', '703289910102', 'Black', 'S', 1, 600],
            ['MSDR106MXSOBK-A-Black', '70328991', '7032899101', '703289910103', 'Black', 'M', 2, 600],
        ]
    )

    upload = client.post(
        '/api/v1/received-pos/upload',
        headers=headers,
        files={
            'file': (
                'vendor-format-po.xlsx',
                xlsx_bytes,
                'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            )
        },
    )
    assert upload.status_code == 201
    received_po_id = upload.json()['received_po_id']

    final_payload = None
    for _ in range(20):
        detail = client.get(f'/api/v1/received-pos/{received_po_id}', headers=headers)
        assert detail.status_code == 200
        final_payload = detail.json()
        if final_payload['status'] in {'parsed', 'failed'}:
            break
        time.sleep(0.05)

    assert final_payload is not None
    assert final_payload['status'] == 'parsed'
    assert final_payload['po_number'] == '70058628'
    assert final_payload['po_date'] == '2026-01-29T06:33:20'
    assert len(final_payload['items']) == 2
    assert final_payload['items'][0]['brand_style_code'] == 'MSDR106MXSOBK-A-Black'
    assert final_payload['items'][0]['styli_style_id'] == '70328991'
    assert final_payload['items'][0]['option_id'] == '7032899101'
    assert final_payload['items'][0]['sku_id'] == '703289910102'
    assert final_payload['items'][0]['quantity'] == 1


def test_received_po_is_company_scoped() -> None:
    headers_a = _auth_headers('Tenant A')
    headers_b = _auth_headers('Tenant B')

    upload = client.post(
        '/api/v1/received-pos/upload',
        headers=headers_a,
        files={'file': ('tenant-a.xlsx', b'PK\x03\x04fake', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')},
    )
    assert upload.status_code == 201
    received_po_id = upload.json()['received_po_id']

    detail_other_tenant = client.get(f'/api/v1/received-pos/{received_po_id}', headers=headers_b)
    assert detail_other_tenant.status_code == 404


def test_received_po_exception_inbox_run_list_and_resolve() -> None:
    headers = _auth_headers('Exception Inbox Co')

    upload = client.post(
        '/api/v1/received-pos/upload',
        headers=headers,
        files={'file': ('styli-po.pdf', b'%PDF-1.4 fake po', 'application/pdf')},
    )
    assert upload.status_code == 201
    received_po_id = upload.json()['received_po_id']

    db = SessionLocal()
    try:
        record = db.query(ReceivedPO).filter(ReceivedPO.id == received_po_id).first()
        assert record is not None
        line_item = ReceivedPOLineItem(
            received_po_id=record.id,
            brand_style_code='HRDS25001',
            styli_style_id='STYLI-101',
            model_number='MOD-1',
            option_id='OPT-BLK',
            sku_id='HRDS25001-A-BLACK-S',
            color=' black ',
            size='XLl',
            knitted_woven='knitted / woven',
            quantity=10,
            po_price=499.0,
        )
        db.add(line_item)
        db.commit()
        line_item_id = line_item.id
    finally:
        db.close()

    run_response = client.post(f'/api/v1/received-pos/{received_po_id}/exceptions/run', headers=headers)
    assert run_response.status_code == 200
    body = run_response.json()
    assert body['summary']['total'] == 1
    assert body['summary']['auto_resolved'] == 1

    bulk_response = client.post(
        f'/api/v1/received-pos/{received_po_id}/exceptions/resolve-bulk',
        headers=headers,
        json={'min_confidence': 0.9, 'only_with_suggestions': True},
    )
    assert bulk_response.status_code == 200
    assert bulk_response.json()['processed_count'] == 0

    list_response = client.get(f'/api/v1/received-pos/{received_po_id}/exceptions', headers=headers)
    assert list_response.status_code == 200
    assert list_response.json()['summary']['total'] == 1
    assert list_response.json()['items'] == []

    resolve_response = client.post(
        f'/api/v1/received-pos/{received_po_id}/exceptions/{line_item_id}/resolve',
        headers=headers,
        json={'action': 'reject', 'size': 'L'},
    )
    assert resolve_response.status_code == 200
    assert resolve_response.json()['summary']['human_corrected'] >= 1

    detail = client.get(f'/api/v1/received-pos/{received_po_id}', headers=headers)
    assert detail.status_code == 200
    item = detail.json()['items'][0]
    assert item['size'] == 'L'
    assert item['resolution_status'] == 'human_corrected'
