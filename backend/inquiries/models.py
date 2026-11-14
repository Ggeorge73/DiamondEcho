from datetime import datetime, timedelta, timezone
from enum import Enum
from typing import Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator, model_validator

# What each text field may hold. Lengths were already limited; these also
# refuse control characters (a NUL, an escape sequence), which no form sends
# and which staff would otherwise be shown. A message may have line breaks
# and tabs. Letters of every script, accents and punctuation all pass.
ONE_LINE = r"^[^\x00-\x1f\x7f-\x9f]*$"
MANY_LINES = r"^[^\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]*$"
# The form's phone box is free text ("404-555-0100 ext. 12, after 5pm"), so
# only this much is asked of it: one line, with at least one digit in it.
PHONE = r"^[^\x00-\x1f\x7f-\x9f]*[0-9][^\x00-\x1f\x7f-\x9f]*$"
# A listing number as the MLS writes it.
PROPERTY_ID = r"^[A-Za-z0-9][A-Za-z0-9 ._:#/\-]*$"
# A tour is asked for days or weeks ahead, not years.
TOUR_HORIZON = timedelta(days=730)


class InquiryKind(str, Enum):
    buyer = "buyer"
    seller = "seller"
    tour = "tour"


class InquiryCreate(BaseModel):
    # A field the form does not have is refused, not dropped.
    model_config = ConfigDict(extra="forbid")

    kind: InquiryKind
    full_name: str = Field(min_length=2, max_length=120, pattern=ONE_LINE)
    # An address can be 254 characters at most; the email check enforces it.
    email: EmailStr = Field(max_length=254)
    phone: str | None = Field(default=None, max_length=40, pattern=PHONE)
    message: str | None = Field(default=None, max_length=2000, pattern=MANY_LINES)
    property_id: str | None = Field(default=None, max_length=120, pattern=PROPERTY_ID)
    property_address: str | None = Field(default=None, max_length=240, pattern=ONE_LINE)
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
            if self.preferred_tour_time > datetime.now(timezone.utc) + TOUR_HORIZON:
                raise ValueError("The preferred tour time must be within the next two years.")
        return self


class InquiryReceipt(BaseModel):
    request_id: str
    status: Literal["queued"] = "queued"
    submitted_at: datetime


class StaffInquiry(BaseModel):
    request_id: str
    kind: InquiryKind
    full_name: str
    email: EmailStr
    phone: str | None = None
    message: str | None = None
    property_id: str | None = None
    property_address: str | None = None
    preferred_tour_time: datetime | None = None
    submitted_at: datetime
    status: Literal["queued", "acknowledged"]
    consent_at: datetime
    consent_version: str


class StaffInquiryList(BaseModel):
    items: list[StaffInquiry]


class StaffAcknowledgement(BaseModel):
    request_id: str
    status: Literal["acknowledged"] = "acknowledged"
    acknowledged_at: datetime
