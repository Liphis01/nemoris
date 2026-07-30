from __future__ import annotations

from dataclasses import dataclass
import re
import unicodedata

from babel import Locale
from countryinfo import CountryInfo

from .contracts import MapImportOntology, MapImportOntologyOption


US_STATES = {
    "AL": "Alabama", "AK": "Alaska", "AZ": "Arizona", "AR": "Arkansas",
    "CA": "Californie", "CO": "Colorado", "CT": "Connecticut",
    "DE": "Delaware", "FL": "Floride", "GA": "Géorgie", "HI": "Hawaï",
    "ID": "Idaho", "IL": "Illinois", "IN": "Indiana", "IA": "Iowa",
    "KS": "Kansas", "KY": "Kentucky", "LA": "Louisiane", "ME": "Maine",
    "MD": "Maryland", "MA": "Massachusetts", "MI": "Michigan",
    "MN": "Minnesota", "MS": "Mississippi", "MO": "Missouri",
    "MT": "Montana", "NE": "Nebraska", "NV": "Nevada",
    "NH": "New Hampshire", "NJ": "New Jersey", "NM": "Nouveau-Mexique",
    "NY": "New York", "NC": "Caroline du Nord", "ND": "Dakota du Nord",
    "OH": "Ohio", "OK": "Oklahoma", "OR": "Oregon",
    "PA": "Pennsylvanie", "RI": "Rhode Island",
    "SC": "Caroline du Sud", "SD": "Dakota du Sud",
    "TN": "Tennessee", "TX": "Texas", "UT": "Utah", "VT": "Vermont",
    "VA": "Virginie", "WA": "Washington", "WV": "Virginie-Occidentale",
    "WI": "Wisconsin", "WY": "Wyoming", "DC": "District de Columbia",
}

FR_DEPARTMENTS = {
    "01": "Ain", "02": "Aisne", "03": "Allier",
    "04": "Alpes-de-Haute-Provence", "05": "Hautes-Alpes",
    "06": "Alpes-Maritimes", "07": "Ardèche", "08": "Ardennes",
    "09": "Ariège", "10": "Aube", "11": "Aude", "12": "Aveyron",
    "13": "Bouches-du-Rhône", "14": "Calvados", "15": "Cantal",
    "16": "Charente", "17": "Charente-Maritime", "18": "Cher",
    "19": "Corrèze", "2A": "Corse-du-Sud", "2B": "Haute-Corse",
    "21": "Côte-d'Or", "22": "Côtes-d'Armor", "23": "Creuse",
    "24": "Dordogne", "25": "Doubs", "26": "Drôme", "27": "Eure",
    "28": "Eure-et-Loir", "29": "Finistère", "30": "Gard",
    "31": "Haute-Garonne", "32": "Gers", "33": "Gironde",
    "34": "Hérault", "35": "Ille-et-Vilaine", "36": "Indre",
    "37": "Indre-et-Loire", "38": "Isère", "39": "Jura",
    "40": "Landes", "41": "Loir-et-Cher", "42": "Loire",
    "43": "Haute-Loire", "44": "Loire-Atlantique", "45": "Loiret",
    "46": "Lot", "47": "Lot-et-Garonne", "48": "Lozère",
    "49": "Maine-et-Loire", "50": "Manche", "51": "Marne",
    "52": "Haute-Marne", "53": "Mayenne", "54": "Meurthe-et-Moselle",
    "55": "Meuse", "56": "Morbihan", "57": "Moselle",
    "58": "Nièvre", "59": "Nord", "60": "Oise", "61": "Orne",
    "62": "Pas-de-Calais", "63": "Puy-de-Dôme",
    "64": "Pyrénées-Atlantiques", "65": "Hautes-Pyrénées",
    "66": "Pyrénées-Orientales", "67": "Bas-Rhin", "68": "Haut-Rhin",
    "69": "Rhône", "70": "Haute-Saône", "71": "Saône-et-Loire",
    "72": "Sarthe", "73": "Savoie", "74": "Haute-Savoie",
    "75": "Paris", "76": "Seine-Maritime", "77": "Seine-et-Marne",
    "78": "Yvelines", "79": "Deux-Sèvres", "80": "Somme",
    "81": "Tarn", "82": "Tarn-et-Garonne", "83": "Var",
    "84": "Vaucluse", "85": "Vendée", "86": "Vienne",
    "87": "Haute-Vienne", "88": "Vosges", "89": "Yonne",
    "90": "Territoire de Belfort", "91": "Essonne",
    "92": "Hauts-de-Seine", "93": "Seine-Saint-Denis",
    "94": "Val-de-Marne", "95": "Val-d'Oise", "971": "Guadeloupe",
    "972": "Martinique", "973": "Guyane", "974": "La Réunion",
    "976": "Mayotte",
}

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
    MapImportOntologyOption(id="us-states-50", label="50 États des États-Unis"),
    MapImportOntologyOption(id="us-states-dc-51", label="États-Unis avec Washington D.C."),
    MapImportOntologyOption(id="fr-departments-101", label="101 départements français"),
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


def _department_code(raw_code):
    value = str(raw_code or "").strip().upper()
    normalized = value.replace("_", "-")
    match = re.fullmatch(
        r"(?:(?:FR|DEP|DEPT|DEPARTEMENT|DEPARTMENT)-)?(2A|2B|97[1-4]|976|[0-9]{2})",
        normalized,
    )
    return match.group(1) if match else value


def ontology_matches_code(ontology: MapImportOntology, raw_code):
    code = str(raw_code or "").strip()
    if ontology == "iso3166-alpha2":
        return code.upper() in COUNTRIES and code == code.lower()
    if ontology == "country-capitals":
        match = re.fullmatch(r"([a-z]{2})-c(?:[0-9]+)?", code)
        return bool(match and match.group(1).upper() in COUNTRIES)
    if ontology in {"us-states-50", "us-states-dc-51"}:
        return code in US_STATES and (ontology.endswith("51") or code != "DC")
    if ontology == "fr-departments-101":
        return _department_code(code) in FR_DEPARTMENTS
    return False


def infer_ontology(codes):
    codes = [str(code or "").strip() for code in codes if str(code or "").strip()]
    if not codes:
        return None
    matches = []
    for ontology in (
        "country-capitals",
        "iso3166-alpha2",
        "us-states-50",
        "us-states-dc-51",
        "fr-departments-101",
    ):
        if all(ontology_matches_code(ontology, code) for code in codes):
            matches.append(ontology)
    if matches == ["us-states-50", "us-states-dc-51"]:
        return "us-states-50"
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
    elif ontology in {"us-states-50", "us-states-dc-51"}:
        answer = US_STATES.get(raw_code)
        if answer and (ontology.endswith("51") or raw_code != "DC"):
            return LabelProposal(answer, (), True, ontology)
    elif ontology == "fr-departments-101":
        department_code = _department_code(raw_code)
        answer = FR_DEPARTMENTS.get(department_code)
        if answer:
            aliases = () if raw_code == department_code else (department_code,)
            return LabelProposal(answer, aliases, True, ontology)
    return LabelProposal()
