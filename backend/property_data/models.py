from typing import Dict, List, Optional, Union

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
    unit_count: Optional[int] = None
    zoning: Optional[str] = None
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


class AssumptionEvidence(StrictModel):
    field: str
    value: Union[str, float, int]
    label: str
    source_kind: str
    source_name: str
    method: str
    confidence: str
    sample_size: Optional[int] = None
    radius_miles: Optional[float] = None
    source_url: Optional[str] = None
    note: Optional[str] = None


class ComparableSummary(StrictModel):
    radius_miles: float
    property_records: int = 0
    rental_comps: int = 0
    sale_comps: int = 0
    predominant_property_type: Optional[str] = None
    average_monthly_rent: Optional[float] = None
    average_sale_price: Optional[float] = None
    average_price_per_square_foot: Optional[float] = None


class UnderwritingProfileResponse(StrictModel):
    property: PropertyDetails
    strategy: str
    radius_miles: float
    inputs: Dict[str, str]
    assumptions: List[AssumptionEvidence]
    comparables: ComparableSummary
    generated_at: str
    provider: str
    warnings: List[str] = Field(default_factory=list)
