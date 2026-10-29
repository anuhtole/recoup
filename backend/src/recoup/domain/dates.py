"""Dates in prose. Ledger lines keep ISO; sentences people read get "Jun 30, 2026"."""

from datetime import date, datetime


def human_date(value: date | datetime) -> str:
    day = value.date() if isinstance(value, datetime) else value
    return f"{day:%b} {day.day}, {day.year}"
