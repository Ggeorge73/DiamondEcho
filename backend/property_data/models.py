from typing import List, Optional

from pydantic import BaseModel, ConfigDict, Field


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class PropertySuggestion(StrictModel):
    id: str
    label: str
    kind: str
    provider: str
    market: Optional[str] = None


class SuggestionResponse(StrictModel):
    suggestions: List[PropertySuggestion]
    provider: str
    warning: Optional[str] = None


class PropertyDetails(StrictModel):
    id: str
    formatted_address: str
    city: Optional[str] = None
    state: Optional[str] = None
    zip_code: Optional[str] = None
    county: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    property_type: Optional[str] = None
    bedrooms: Optional[float] = None
    bathrooms: Optional[float] = None
    square_footage: Optional[float] = None
    lot_size: Optional[float] = None
    year_built: Optional[int] = None
    last_sale_price: Optional[float] = None
    last_sale_date: Optional[str] = None
    assessed_value: Optional[float] = None
    annual_taxes: Optional[float] = None
    provider: str
    source_url: str
    is_demo: bool = False
    warnings: List[str] = Field(default_factory=list)


class PropertyLookupResponse(StrictModel):
    property: PropertyDetails
