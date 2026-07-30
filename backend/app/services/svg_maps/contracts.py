import re
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
SHAPE_ID_RE = re.compile(r"^s[0-9]{6}$")
DRAFT_SHAPE_REF_RE = re.compile(r"^p[0-9]{6}$")
REPAIR_ZONE_ID_RE = re.compile(r"^d[0-9]{6}$")
MapAdapter = Literal[
    "nemoris-data-code-v1",
    "jetpunk-id-class-v1",
    "generic-svg-v1",
]
MapImportOntology = Literal[
    "auto",
    "generic",
    "iso3166-alpha2",
    "country-capitals",
    "us-states-50",
    "us-states-dc-51",
    "fr-departments-101",
]
MapRepairRole = Literal["unresolved", "decoration", "label", "excluded"]


class MapZoneV2(BaseModel):
    model_config = ConfigDict(extra="forbid")

    code: str = Field(min_length=1, max_length=128)
    shape_ids: list[str] = Field(default_factory=list)
    hit_shape_ids: list[str] = Field(default_factory=list)
    source_keys: list[str] = Field(default_factory=list)

    @model_validator(mode="after")
    def validate_geometry(self):
        if not self.shape_ids and not self.hit_shape_ids:
            raise ValueError("A map zone must contain geometry")

        all_ids = self.shape_ids + self.hit_shape_ids
        if len(all_ids) != len(set(all_ids)):
            raise ValueError("A shape cannot be reused within a zone")

        if any(not SHAPE_ID_RE.fullmatch(value) for value in all_ids):
            raise ValueError("Invalid canonical shape id")

        return self


class MapSourceV2(BaseModel):
    model_config = ConfigDict(extra="forbid")

    sha256: str
    adapter: MapAdapter
    expected_zone_count: int | None = Field(default=None, ge=1, le=50000)
    warning_codes: list[str] = Field(default_factory=list)

    @model_validator(mode="after")
    def validate_hash(self):
        if not SHA256_RE.fullmatch(self.sha256):
            raise ValueError("Invalid source SHA-256")
        return self


class MapPackageV2(BaseModel):
    model_config = ConfigDict(extra="forbid")

    schema_version: Literal[2] = 2
    canonicalizer_version: Literal[1] = 1
    asset_sha256: str
    zones: list[MapZoneV2]
    source: MapSourceV2

    @model_validator(mode="after")
    def validate_identity(self):
        if not SHA256_RE.fullmatch(self.asset_sha256):
            raise ValueError("Invalid canonical asset SHA-256")

        codes = [zone.code for zone in self.zones]
        if len(codes) != len(set(codes)):
            raise ValueError("Map zone codes must be unique")

        shape_ids = [
            shape_id
            for zone in self.zones
            for shape_id in zone.shape_ids + zone.hit_shape_ids
        ]
        if len(shape_ids) != len(set(shape_ids)):
            raise ValueError("Canonical shapes cannot be reused across zones")

        return self


class MapImportDiagnostic(BaseModel):
    model_config = ConfigDict(extra="forbid")

    code: str
    severity: Literal["info", "warning", "error"]
    stage: Literal["parse", "sanitize", "detect", "validate", "fetch", "commit"]
    parameters: dict[str, Any] = Field(default_factory=dict)
    shape_ids: list[str] = Field(default_factory=list)
    requires_acknowledgement: bool = False


class MapImportSummary(BaseModel):
    model_config = ConfigDict(extra="forbid")

    element_count: int = 0
    shape_count: int = 0
    zone_count: int = 0
    multipart_zone_count: int = 0
    hit_shape_count: int = 0
    removed_text_count: int = 0


class MapImportEvidence(BaseModel):
    model_config = ConfigDict(extra="forbid")

    kind: Literal[
        "data-code",
        "id",
        "class",
        "group",
        "title",
        "aria",
        "text",
        "style",
        "geometry",
        "ontology",
    ]
    value: str
    strength: Literal["strong", "medium", "weak"]


class MapZoneProposal(MapZoneV2):
    source_shape_indices: list[int] = Field(default_factory=list, exclude=True)
    proposed_answer: str = ""
    proposed_aliases: list[str] = Field(default_factory=list)
    proposal_verified: bool = False
    proposal_source: str | None = None
    evidence: list[MapImportEvidence] = Field(default_factory=list)


class MapImportInterpretationSummary(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    title: str
    adapter: MapAdapter
    ontology: MapImportOntology
    strength: Literal["strong", "mixed", "weak"]
    automatic_eligible: bool
    selectable: bool = True
    zone_count: int
    shape_count: int
    unassigned_shape_count: int = 0
    verified_label_count: int = 0
    reason_codes: list[str] = Field(default_factory=list)


class MapImportInterpretation(MapImportInterpretationSummary):
    zones: list[MapZoneProposal] = Field(default_factory=list)

    @model_validator(mode="after")
    def validate_counts(self):
        if self.zone_count != len(self.zones):
            raise ValueError("Interpretation zone count does not match zones")
        assigned = {
            shape_id
            for zone in self.zones
            for shape_id in zone.shape_ids + zone.hit_shape_ids
        }
        if self.shape_count != len(assigned):
            raise ValueError("Interpretation shape count does not match zones")
        return self


class MapImportOntologyOption(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: MapImportOntology
    label: str


class MapImportDraft(BaseModel):
    model_config = ConfigDict(extra="forbid")

    draft_id: str
    status: Literal["analyzed", "committed"] = "analyzed"
    route: Literal["automatic", "assisted", "manual"]
    target_group_id: int | None = None
    name: str | None = None
    preview_url: str
    summary: MapImportSummary
    analysis_version: Literal[1] = 1
    ontology: MapImportOntology = "auto"
    selection_required: bool = False
    selected_interpretation_id: str | None = None
    available_ontologies: list[MapImportOntologyOption] = Field(default_factory=list)
    interpretations: list[MapImportInterpretationSummary] = Field(
        default_factory=list
    )
    zones: list[MapZoneProposal] = Field(default_factory=list)
    diagnostics: list[MapImportDiagnostic] = Field(default_factory=list)
    can_commit: bool
    acknowledgements: list[str] = Field(default_factory=list)
    expected_zone_count: int | None = None
    source_sha256: str
    asset_sha256: str
    manifest: MapPackageV2 | None = None
    question_defaults: dict[str, dict[str, Any]] = Field(default_factory=dict)
    created_at: str
    updated_at: str


class MapRepairZoneState(BaseModel):
    model_config = ConfigDict(extra="forbid")

    zone_id: str
    code: str = Field(min_length=1, max_length=128)
    source_keys: list[str] = Field(default_factory=list)
    proposed_answer: str = ""
    proposed_aliases: list[str] = Field(default_factory=list)
    proposal_verified: bool = False
    proposal_source: str | None = None

    @model_validator(mode="after")
    def validate_identity(self):
        if not REPAIR_ZONE_ID_RE.fullmatch(self.zone_id):
            raise ValueError("Invalid repair zone id")
        return self


class MapRepairBranchState(BaseModel):
    model_config = ConfigDict(extra="forbid")

    interpretation_id: str
    adapter: MapAdapter
    ontology: MapImportOntology
    base_zones: list[MapRepairZoneState] = Field(default_factory=list)
    base_assignments: dict[str, str] = Field(default_factory=dict)
    base_roles: dict[str, MapRepairRole] = Field(default_factory=dict)
    required_shape_refs: list[str] = Field(default_factory=list)
    optional_shape_refs: list[str] = Field(default_factory=list)
    operations: list[dict[str, Any]] = Field(default_factory=list)
    cursor: int = Field(default=0, ge=0)

    @model_validator(mode="after")
    def validate_branch(self):
        zone_ids = [zone.zone_id for zone in self.base_zones]
        codes = [zone.code for zone in self.base_zones]
        if len(zone_ids) != len(set(zone_ids)):
            raise ValueError("Repair zone ids must be unique")
        if len(codes) != len(set(codes)):
            raise ValueError("Repair zone codes must be unique")
        if self.cursor > len(self.operations):
            raise ValueError("Repair history cursor is invalid")

        known_zone_ids = set(zone_ids)
        for shape_ref, zone_id in self.base_assignments.items():
            if not DRAFT_SHAPE_REF_RE.fullmatch(shape_ref):
                raise ValueError("Invalid repair shape reference")
            if zone_id not in known_zone_ids:
                raise ValueError("Repair assignment references an unknown zone")
        for shape_ref in self.base_roles:
            if not DRAFT_SHAPE_REF_RE.fullmatch(shape_ref):
                raise ValueError("Invalid repair shape reference")
        if set(self.base_assignments).intersection(self.base_roles):
            raise ValueError("A repair shape cannot be assigned and classified")
        for shape_ref in self.required_shape_refs + self.optional_shape_refs:
            if not DRAFT_SHAPE_REF_RE.fullmatch(shape_ref):
                raise ValueError("Invalid repair shape reference")
        if set(self.required_shape_refs).intersection(self.optional_shape_refs):
            raise ValueError("A repair shape cannot have two risk levels")
        if len(self.operations) > 200:
            raise ValueError("Repair history exceeds its bounded limit")
        structural_types = {
            "create_zone",
            "assign_to_zone",
            "set_role",
            "merge_zones",
            "explode_zone",
            "reset_branch",
        }
        for operation in self.operations:
            operation_type = operation.get("type")
            if operation_type not in structural_types:
                raise ValueError("Invalid repair history action")
            for shape_ref in operation.get("shape_refs", []):
                if not DRAFT_SHAPE_REF_RE.fullmatch(str(shape_ref)):
                    raise ValueError("Invalid repair history shape reference")
            for zone_id in [
                operation.get("zone_id"),
                operation.get("primary_zone_id"),
                *(operation.get("zone_ids") or []),
            ]:
                if zone_id and not REPAIR_ZONE_ID_RE.fullmatch(str(zone_id)):
                    raise ValueError("Invalid repair history zone id")
            if operation.get("zone") is not None:
                MapRepairZoneState.model_validate(operation["zone"])
            for entry in operation.get("new_zones", []):
                if not DRAFT_SHAPE_REF_RE.fullmatch(
                    str(entry.get("shape_ref") or "")
                ):
                    raise ValueError("Invalid repair history shape reference")
                MapRepairZoneState.model_validate(entry.get("zone"))
        return self


class MapRepairState(BaseModel):
    model_config = ConfigDict(extra="forbid")

    repair_version: Literal[1] = 1
    revision: int = Field(default=0, ge=0)
    active_interpretation_id: str
    branches: dict[str, MapRepairBranchState] = Field(default_factory=dict)
    created_at: str
    updated_at: str

    @model_validator(mode="after")
    def validate_active_branch(self):
        if self.active_interpretation_id not in self.branches:
            raise ValueError("Active repair interpretation is missing")
        if any(key != branch.interpretation_id for key, branch in self.branches.items()):
            raise ValueError("Repair branch key does not match its interpretation")
        return self


def validate_map_package(value):
    """Validate a group data.map value and reject unknown versions."""
    return MapPackageV2.model_validate(value)


def merge_map_package(group_data, package):
    """Preserve all non-map group metadata while replacing its map contract."""
    merged = dict(group_data or {})
    merged["map"] = MapPackageV2.model_validate(package).model_dump(mode="json")
    return merged
