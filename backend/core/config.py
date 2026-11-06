from typing import List, Union
from pydantic import BaseModel, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import AnyHttpUrl
import json

class Settings(BaseSettings):
    API_V1_STR: str = "/api/v1"
    PROJECT_NAME: str = "CPC WMS API"
    
    # CORS Configuration (string in .env; supports comma-separated or JSON array).
    # BACKEND_CORS_ORIGINS is accepted as a legacy name (same format as CORS_ORIGINS).
    CORS_ORIGINS: str = ""
    BACKEND_CORS_ORIGINS: str = ""
    
    # Database Configuration
    POSTGRES_HOST: str = "localhost"
    POSTGRES_PORT: int = 5432
    POSTGRES_USER: str = "postgres"
    POSTGRES_PASSWORD: str = ""
    POSTGRES_DATABASE: str = "wms_cpc"
    
    # JWT Configuration
    SECRET_KEY: str = ""
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 300

    # Feature flags: switch unfinished modules on per deployment via .env
    # (prod: the ENV_FILE secret). Off unless set to true/1/yes. Exposed to
    # the frontend by GET /api/v1/features (endpoints/features.py).
    # Needle exchange lives inside the Accessory warehouse, so it only counts
    # as on when accessories are on too (see features_enabled below).
    FEATURE_ACCESSORIES: bool = False
    FEATURE_NEEDLES: bool = False
    
    model_config = SettingsConfigDict(case_sensitive=True, env_file=(".env", "backend/.env"), extra="ignore")

    def cors_origins_list(self) -> List[str]:
        value = self.CORS_ORIGINS or self.BACKEND_CORS_ORIGINS
        if not value:
            return []
        try:
            parsed = json.loads(value)
            if isinstance(parsed, list):
                return [str(x) for x in parsed]
        except Exception:
            pass
        return [origin.strip() for origin in value.split(',') if origin.strip()]

    def features_enabled(self) -> dict:
        """The effective on/off state of each feature flag."""
        return {
            "accessories": self.FEATURE_ACCESSORIES,
            "needles": self.FEATURE_ACCESSORIES and self.FEATURE_NEEDLES,
        }

    @field_validator("POSTGRES_PASSWORD", "SECRET_KEY", mode="after")
    @classmethod
    def ensure_non_empty(cls, v: str) -> str:
        if not v:
            # Keep empty allowed for local dev only; prefer .env to supply values
            return v
        return v

settings = Settings() 