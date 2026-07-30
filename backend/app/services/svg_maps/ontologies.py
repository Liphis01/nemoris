from __future__ import annotations

from dataclasses import dataclass
import re
import unicodedata

from babel import Locale
from countryinfo import CountryInfo

from .contracts import MapImportOntology, MapImportOntologyOption


# Not an ontology: no names, no labels, no user-facing choice. These 51 codes
# exist only to resolve a genuine collision in the data — half of them are also
# ISO alpha-2 country codes (de, ca, in, la, ms…), so a U.S. state map whose
# selectors are lowercase otherwise detects as a bogus 26-country layer. The
# detector needs the code set to recognise that collision and suppress it.
AMBIGUOUS_SUBDIVISION_CODES = frozenset({
    "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA", "HI", "ID",
    "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS",
    "MO", "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH", "OK",
    "OR", "PA", "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV",
    "WI", "WY", "DC",
})

CAPITAL_OVERRIDES = {
    "AT": ["Vienne", "Vienna"],
    "BE": ["Bruxelles", "Brussels"],
    "BO": ["Sucre", "La Paz"],
    "BI": ["Gitega", "Bujumbura"],
    "CH": ["Berne", "Bern"],
    "CN": ["Pékin", "Beijing"],
    "CZ": ["Prague"],
    "DK": ["Copenhague", "Copenhagen"],
    "EG": ["Le Caire", "Cairo"],
    "ES": ["Madrid"],
    "FI": ["Helsinki"],
    "GB": ["Londres", "London"],
    "GR": ["Athènes", "Athens"],
    "HU": ["Budapest"],
    "IE": ["Dublin"],
    "IN": ["New Delhi"],
    "IS": ["Reykjavik"],
    "IT": ["Rome"],
    "JP": ["Tokyo"],
    "KP": ["Pyongyang"],
    "KR": ["Séoul", "Seoul"],
    "LK": ["Sri Jayawardenepura Kotte", "Colombo"],
    "NL": ["Amsterdam"],
    "NO": ["Oslo"],
    "PL": ["Varsovie", "Warsaw"],
    "PT": ["Lisbonne", "Lisbon"],
    "RU": ["Moscou", "Moscow"],
    "SE": ["Stockholm"],
    "SZ": ["Mbabane", "Lobamba"],
    "TR": ["Ankara"],
    "US": ["Washington", "Washington D.C."],
    "ZA": ["Pretoria", "Le Cap", "Bloemfontein", "Cape Town"],
}

ONTOLOGY_OPTIONS = [
    MapImportOntologyOption(id="auto", label="Détection automatique"),
    MapImportOntologyOption(id="generic", label="Structure SVG générique"),
    MapImportOntologyOption(id="iso3166-alpha2", label="Pays et territoires (ISO alpha-2)"),
    MapImportOntologyOption(id="country-capitals", label="Capitales de pays"),
]


@dataclass(frozen=True)
class LabelProposal:
    answer: str = ""
    aliases: tuple[str, ...] = ()
    verified: bool = False
    source: str | None = None


def normalize_label(value):
    text = unicodedata.normalize("NFD", str(value or "").lower())
    text = "".join(char for char in text if unicodedata.category(char) != "Mn")
    return re.sub(r"[^a-z0-9]+", " ", text).strip()


def _dedupe(answer, values):
    seen = {normalize_label(answer)}
    result = []
    for value in values:
        value = str(value or "").strip()
        normalized = normalize_label(value)
        if value and normalized and normalized not in seen:
            seen.add(normalized)
            result.append(value)
    return tuple(result)


def _country_records():
    records = {}
    french = Locale("fr")
    for record in CountryInfo("France").all().values():
        iso = record.get("ISO") or {}
        code = str(iso.get("alpha2") or "").upper()
        if len(code) != 2 or not code.isalpha() or code in records:
            continue
        translations = record.get("translations") or {}
        answer = (
            french.territories.get(code)
            or translations.get("fr")
            or record.get("name")
            or code
        )
        aliases = _dedupe(answer, [
            record.get("name"),
            translations.get("fr"),
            *(record.get("altSpellings") or []),
            code,
            iso.get("alpha3"),
        ])
        capital = str(record.get("capital") or "").strip()
        capitals = tuple(CAPITAL_OVERRIDES.get(code) or ([capital] if capital else []))
        records[code] = {
            "answer": answer,
            "aliases": aliases,
            "capitals": capitals,
        }
    # JetPunk commonly uses XK for Kosovo although it is user-assigned rather
    # than an officially assigned ISO alpha-2 value.
    records.setdefault("XK", {
        "answer": "Kosovo",
        "aliases": ("XK",),
        "capitals": ("Pristina",),
    })
    return records


COUNTRIES = _country_records()


def ontology_matches_code(ontology: MapImportOntology, raw_code):
    code = str(raw_code or "").strip()
    if ontology == "iso3166-alpha2":
        return code.upper() in COUNTRIES and code == code.lower()
    if ontology == "country-capitals":
        match = re.fullmatch(r"([a-z]{2})-c(?:[0-9]+)?", code)
        return bool(match and match.group(1).upper() in COUNTRIES)
    return False


def infer_ontology(codes):
    codes = [str(code or "").strip() for code in codes if str(code or "").strip()]
    if not codes:
        return None
    matches = []
    for ontology in ("country-capitals", "iso3166-alpha2"):
        if all(ontology_matches_code(ontology, code) for code in codes):
            matches.append(ontology)
    return matches[0] if len(matches) == 1 else None


def proposal_for(ontology: MapImportOntology, code, evidence_texts=()):
    raw_code = str(code or "").strip()
    if ontology == "iso3166-alpha2":
        record = COUNTRIES.get(raw_code.upper())
        if record:
            return LabelProposal(
                record["answer"], record["aliases"], True, "iso3166-alpha2"
            )
    elif ontology == "country-capitals":
        match = re.fullmatch(r"([a-z]{2})-c([0-9]*)", raw_code)
        if match:
            capitals = COUNTRIES.get(match.group(1).upper(), {}).get("capitals", ())
            suffix = match.group(2)
            if suffix:
                evidence = {normalize_label(value) for value in evidence_texts}
                matched = [
                    capital for capital in capitals
                    if normalize_label(capital) in evidence
                ]
                if len(matched) == 1:
                    return LabelProposal(
                        matched[0], (), True, "country-capitals:title"
                    )
                return LabelProposal()
            if capitals:
                return LabelProposal(
                    capitals[0],
                    _dedupe(capitals[0], capitals[1:]),
                    True,
                    "country-capitals",
                )
    return LabelProposal()
