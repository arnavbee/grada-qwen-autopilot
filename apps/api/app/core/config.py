from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file='.env', env_file_encoding='utf-8', extra='ignore')

    app_env: str = 'development'
    database_url: str = 'sqlite:///./kira.db'
    ai_provider: str = 'openai'
    ai_base_url: str | None = None
    ai_model: str | None = None

    OPENAI_API_KEY: str = ''
    OPENAI_MODEL: str = 'gpt-4o'

    QWEN_API_KEY: str | None = None
    # Proof of Deployment: Standard DashScope International Base URL
    # Token plan alternative: https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1
    QWEN_BASE_URL: str = 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1'
    QWEN_MODEL: str = 'qwen3.7-plus'

    jwt_secret_key: str = 'change-me'
    jwt_refresh_secret_key: str = 'change-me-too'
    jwt_access_token_expires_minutes: int = 30
    jwt_refresh_token_expires_minutes: int = 10080

    password_reset_token_expires_minutes: int = 30
    session_timeout_hours: int = 24

    frontend_origins: str = 'http://localhost:3000,http://127.0.0.1:3000'
    super_admin_emails: str = ''

    # Optional S3-compatible object storage (Cloudflare R2, S3, MinIO, etc.)
    R2_ENDPOINT: str | None = None
    R2_ACCESS_KEY_ID: str | None = None
    R2_SECRET_ACCESS_KEY: str | None = None
    R2_BUCKET: str | None = None
    R2_PUBLIC_BASE_URL: str | None = None
    R2_REGION: str = 'auto'

    job_worker_enabled: bool = True
    job_worker_poll_interval_seconds: float = 0.5


@lru_cache
def get_settings() -> Settings:
    return Settings()
