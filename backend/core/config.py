from typing import List, Union
from pydantic import BaseModel, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import AnyHttpUrl
import json

class Settings(BaseSettings):
    API_V1_STR: str = "/api/v1"
    PROJECT_NAME: str = "CPC WMS API"
    
    # CORS Configuration (string in .env; supports comma-separated or JSON array)
    CORS_ORIGINS: str = "" 
    
    # Database Configuration
    POSTGRES_HOST: str = "localhost"
    POSTGRES_PORT: int = 5432
    POSTGRES_USER: str = "postgres"
    POSTGRES_PASSWORD: str = ""
    POSTGRES_DATABASE: str = "wms_cpc"
    
    # JWT Configuration
    SECRET_KEY: str = ""
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 30
    
    model_config = SettingsConfigDict(case_sensitive=True, env_file=(".env", "backend/.env"))

    def cors_origins_list(self) -> List[str]:
        value = self.CORS_ORIGINS
        if not value:
            return []
        try:
            parsed = json.loads(value)
            if isinstance(parsed, list):
                return [str(x) for x in parsed]
        except Exception:
            pass
        return [origin.strip() for origin in value.split(',') if origin.strip()]

    @field_validator("POSTGRES_PASSWORD", "SECRET_KEY", mode="after")
    @classmethod
    def ensure_non_empty(cls, v: str) -> str:
        if not v:
            # Keep empty allowed for local dev only; prefer .env to supply values
            return v
        return v

settings = Settings() 