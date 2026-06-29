from types import SimpleNamespace

from app.services import ai as ai_module


def test_qwen_provider_uses_qwen_cloud_compatible_settings(monkeypatch) -> None:
    monkeypatch.setattr(
        ai_module,
        'settings',
        SimpleNamespace(
            ai_provider='qwen',
            ai_base_url=None,
            ai_model=None,
            OPENAI_API_KEY='',
            OPENAI_MODEL='gpt-4o',
            QWEN_API_KEY='qwen-key',
            QWEN_BASE_URL='https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
            QWEN_MODEL='qwen-vl-max',
        ),
    )

    config = ai_module._resolve_ai_client_config()

    assert config == {
        'provider': 'qwen',
        'api_key': 'qwen-key',
        'base_url': 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
        'model': 'qwen-vl-max',
    }


def test_openrouter_key_keeps_existing_base_url_behavior(monkeypatch) -> None:
    monkeypatch.setattr(
        ai_module,
        'settings',
        SimpleNamespace(
            ai_provider='openai',
            ai_base_url=None,
            ai_model=None,
            OPENAI_API_KEY='sk-or-v1-example',
            OPENAI_MODEL='gpt-4o',
            QWEN_API_KEY=None,
            QWEN_BASE_URL='https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
            QWEN_MODEL='qwen-vl-max',
        ),
    )

    config = ai_module._resolve_ai_client_config()

    assert config['provider'] == 'openai'
    assert config['base_url'] == 'https://openrouter.ai/api/v1'
    assert config['model'] == 'gpt-4o'
