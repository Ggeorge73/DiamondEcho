from datetime import datetime, timezone
from enum import Enum
from typing import Literal

from pydantic import BaseModel, EmailStr, Field, field_validator, model_validator


class InquiryKind(str, Enum):
    buyer = "buyer"
    seller = "seller"
    tour = "tour"


class InquiryCreate(BaseModel):
    kind: InquiryKind
    full_name: str = Field(min_length=2, max_length=120)
    email: EmailStr
    phone: str | None = Field(default=None, max_length=40)
    message: str | None = Field(default=None, max_length=2000)
    property_id: str | None = Field(default=None, max_length=120)
    property_address: str | None = Field(default=None, max_length=240)
    preferred_tour_time: datetime | None = None
    consent: Literal[True]

    @field_validator("full_name", "phone", "message", "property_id", "property_address")
    @classmethod
    def strip_text(cls, value: str | None) -> str | None:
        return value.strip() if value is not None else None

    @model_validator(mode="after")
    def validate_kind(self) -> "InquiryCreate":
        if not self.full_name:
            raise ValueError("A full name is required.")
        if self.kind in (InquiryKind.buyer, InquiryKind.seller) and not self.message:
            raise ValueError("Please describe your request.")
        if self.kind == InquiryKind.seller and not self.property_address:
            raise ValueError("A property address is required for seller inquiries.")
        if self.kind == InquiryKind.tour:
            if not (self.property_id or self.property_address):
                raise ValueError("A listing ID or property address is required for a tour request.")
            if self.preferred_tour_time is None or self.preferred_tour_time.tzinfo is None:
                raise ValueError("A tour time with a timezone offset is required.")
            if self.preferred_tour_time <= datetime.now(timezone.utc):
                raise ValueError("The preferred tour time must be in the future.")
        return self


class InquiryReceipt(BaseModel):
    request_id: str
    status: Literal["routed"] = "routed"
    submitted_at: datetime
