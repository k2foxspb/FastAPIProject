from datetime import date

from pydantic import BaseModel, Field


class AnalysisSection(BaseModel):
    area: str
    title: str
    summary: str
    recommendations: list[str] = Field(default_factory=list)


class AnalysisResponse(BaseModel):
    date_from: date
    date_to: date
    message: str | None = None
    sections: list[AnalysisSection] = Field(default_factory=list)
