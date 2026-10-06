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


class SiteLink(BaseModel):
    """A page of this site the answer points to. Paths only, never another site."""
    label: str
    path: str = Field(pattern=r"^/[A-Za-z0-9\-/?=&]*$")


class Handoff(BaseModel):
    """The request form a visitor can open to reach a person (DE-20). The chat
    is not sent with it: the visitor writes the request themselves."""
    kind: Literal["buyer", "seller", "tour"]
    label: str
    topic: Optional[Literal["pre-approval"]] = None


class ChatResponse(BaseModel):
    response_id: str
    answer: str
    citations: List[Citation]
    disclaimers: List[str]
    follow_up_questions: List[str]
    # The day the answer was produced. Each citation carries its own
    # reviewed_at, which is the date to show next to a source.
    as_of: date
    jurisdiction: Jurisdiction
    risk_level: Literal["general", "transaction_specific", "regulated"]
    requires_professional: bool = False
    handoff_recommended: bool = False
    topic: Optional[str] = None
    # True when the answer continues an earlier question in the conversation.
    continued: bool = False
    links: List[SiteLink] = Field(default_factory=list)
    handoff: Optional[Handoff] = None


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
