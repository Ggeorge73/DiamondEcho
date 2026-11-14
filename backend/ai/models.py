from __future__ import annotations

from datetime import date
from typing import Annotated, Dict, List, Literal, Optional, Union

from pydantic import BaseModel, ConfigDict, Field, StrictFloat, StrictInt, StringConstraints, field_validator, model_validator

from .calculators import INPUTS


class RequestModel(BaseModel):
    """What a visitor sends: a field this service does not know is refused,
    and so is a number that is not finite."""
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


class Jurisdiction(RequestModel):
    # Also part of the answer, so the limits hold both ways. The chat's state
    # box takes 30 characters and may hold a state's full name; the service
    # reads the state from it (intent.normalize_state) and ignores the rest.
    country: str = Field(default="US", min_length=2, max_length=56)
    state: Optional[str] = Field(default=None, max_length=56)
    locality: Optional[str] = Field(default=None, max_length=120)


class ConversationMessage(RequestModel):
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=6000)


class ChatRequest(RequestModel):
    # One question of up to 6,000 characters and at most 12 earlier messages
    # of the same size (the chat sends its last 8). request_guard.py sizes the
    # whole body from these figures.
    message: str = Field(min_length=2, max_length=6000)
    session_id: Optional[str] = Field(default=None, min_length=1, max_length=128, pattern=r"^[A-Za-z0-9._:-]+$")
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


# A calculator input: a plain JSON number (not text, not true/false), finite,
# and no larger than the calculators' own ceiling for an amount. Each input's
# sign and tighter ceiling are checked by the calculator (ai/calculators.py).
CalculatorNumber = Annotated[Union[StrictInt, StrictFloat], Field(ge=-1e15, le=1e15, allow_inf_nan=False)]
CalculatorName = Annotated[str, StringConstraints(min_length=1, max_length=64, pattern=r"^[a-z_]+$")]


class DealAnalysisRequest(RequestModel):
    model: Literal["mortgage", "rental", "fix_flip", "commercial"]
    inputs: Dict[CalculatorName, CalculatorNumber] = Field(max_length=32)
    jurisdiction: Jurisdiction = Field(default_factory=Jurisdiction)

    @model_validator(mode="after")
    def only_inputs_the_model_reads(self) -> "DealAnalysisRequest":
        if any(name not in INPUTS[self.model] for name in self.inputs):
            raise ValueError("inputs holds a name this calculator does not read")
        return self


class DealAnalysisResponse(BaseModel):
    model: str
    metrics: Dict[str, float | str | bool | None]
    assumptions: List[str]
    warnings: List[str]
    disclaimer: str
