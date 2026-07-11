from __future__ import annotations

from datetime import date
from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, Field, field_validator


class Jurisdiction(BaseModel):
    country: str = "US"
    state: Optional[str] = None
    locality: Optional[str] = None


class ConversationMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=6000)


class ChatRequest(BaseModel):
    message: str = Field(min_length=2, max_length=6000)
    session_id: Optional[str] = Field(default=None, max_length=128)
    jurisdiction: Jurisdiction = Field(default_factory=Jurisdiction)
    history: List[ConversationMessage] = Field(default_factory=list, max_length=12)

    @field_validator("message")
    @classmethod
    def normalize_message(cls, value: str) -> str:
        return " ".join(value.split())


class Citation(BaseModel):
    id: str
    title: str
    publisher: str
    url: str
    jurisdiction: str
    reviewed_at: date


class ChatResponse(BaseModel):
    response_id: str
    answer: str
    citations: List[Citation]
    disclaimers: List[str]
    follow_up_questions: List[str]
    as_of: date
    jurisdiction: Jurisdiction
    risk_level: Literal["general", "transaction_specific", "regulated"]
    requires_professional: bool = False
    handoff_recommended: bool = False


class DealAnalysisRequest(BaseModel):
    model: Literal["mortgage", "rental", "fix_flip", "commercial"]
    inputs: Dict[str, Any]
    jurisdiction: Jurisdiction = Field(default_factory=Jurisdiction)


class DealAnalysisResponse(BaseModel):
    model: str
    metrics: Dict[str, float | str | bool | None]
    assumptions: List[str]
    warnings: List[str]
    disclaimer: str
