import { useEffect, useMemo, useState } from "react";
import {
  createCollection,
  deleteCollection,
  getCollection,
  listCollectionQuestionCandidates,
  listCollectionQuestions,
  updateCollection
} from "../../../api/collections";
import ReviewQuestionRenderer from "../../review/components/ReviewQuestionRenderer";
import TrainingTimerPanel from "../../review/components/TrainingTimerPanel";
import ReturnToMenuButton from "../../../shared/ReturnToMenuButton";
import { useTrainingSession } from "../hooks/useTrainingSession";
import {
  formatDuration,
  formatPercent,
  formatRecordPercent
} from "../trainingRecordUtils";
import {
  defaultMapMode,
  MAP_MODES,
  mapModeDetails,
  mapModeLabels
} from "../../review/mapModes";
import {
  defaultImageMode,
  IMAGE_MODES,
  imageModeDetails,
  imageModeLabels
} from "../../review/imageModes";
import "./TrainingSession.css";


const panelStyle = {
  background: "#181818",
  border: "1px solid #262626",
  borderRadius: "8px",
  boxSizing: "border-box"
};

const buttonStyle = {
  background: "#232323",
  border: "1px solid #333",
  borderRadius: "8px",
  color: "#eee",
  cursor: "pointer",
  fontSize: "14px",
  fontWeight: "700",
  padding: "11px 14px"
};

const primaryButtonStyle = {
  ...buttonStyle,
  background: "#233228",
  border: "1px solid #385544",
  color: "#d7f5df"
};

const disabledButtonStyle = {
  ...buttonStyle,
  color: "#777",
  cursor: "not-allowed",
  opacity: 0.55
};

const completionMetricStyle = {
  background: "#141414",
  border: "1px solid #282828",
  borderRadius: "8px",
  display: "flex",
  flexDirection: "column",
  gap: "6px",
  padding: "14px"
};

const completionMetricLabelStyle = {
  color: "#777",
  fontSize: "11px",
  fontWeight: "800",
  textTransform: "uppercase"
};

const recordBadgeStyle = {
  background: "#233228",
  border: "1px solid #385544",
  borderRadius: "999px",
  color: "#d7f5df",
  fontSize: "13px",
  fontWeight: "800",
  padding: "8px 12px"
};

const COLLECTION_CANDIDATE_PAGE_SIZE = 50;


function normalizeText(value) {
  return String(value || "").trim().toLowerCase();
}


function modeConfigForGroup(group) {
  if (group?.type_group === "map") {
    return {
      defaultMode: defaultMapMode,
      details: mapModeDetails,
      labels: mapModeLabels,
      modes: MAP_MODES
    };
  }

  if (group?.type_group === "image") {
    return {
      defaultMode: defaultImageMode,
      details: imageModeDetails,
      labels: imageModeLabels,
      modes: IMAGE_MODES
    };
  }

  return null;
}


function recordForMode(group, mode) {
  const config = modeConfigForGroup(group);

  return group?.training_records?.[mode] || (
    mode === config?.defaultMode ? group?.training_record : null
  );
}


function isVisualQuestion(question) {
  return ["image", "map", "timeline"].includes(question?.type_q);
}


function modeGlyph(mode) {
  if (mode === "type_all") return "Aa";
  if (mode === "click_prompt") return ">";
  if (mode === "type_prompt") return "T";
  if (mode === "multiple_choice") return "4";
  if (mode === "multiple_choice_label") return "A4";
  if (mode === "multiple_choice_image") return "I4";

  return "?";
}


function questionCountLabel(count) {
  const value = Number(count) || 0;

  return `${value} question${value > 1 ? "s" : ""}`;
}


function recordTimeLabel(record) {
  return record?.best_time_ms ? formatDuration(record.best_time_ms) : "—";
}


function recordPercentValue(record) {
  const percent = Number(record?.best_found_percent);

  if (!Number.isFinite(percent)) return null;

  return Math.min(Math.max(percent, 0), 100);
}


function groupTotalPercent(group) {
  const config = modeConfigForGroup(group);

  if (!config) {
    return recordPercentValue(group?.training_record);
  }

  if (config.modes.length === 0) return null;

  const total = config.modes.reduce((sum, mode) => (
    sum + (recordPercentValue(recordForMode(group, mode)) || 0)
  ), 0);

  return total / config.modes.length;
}


function formatTotalPercent(percent) {
  return Number.isFinite(percent) ? `${Math.round(percent)}%` : "—";
}


function percentBarWidth(percent) {
  return Number.isFinite(percent)
    ? `${Math.min(Math.max(percent, 0), 100)}%`
    : "0%";
}


function groupAccent(group) {
  if (group?.type_group === "map") return "map";
  if (group?.type_group === "image") return "image";

  return "neutral";
}


function collectionPercent(collection) {
  return recordPercentValue(collection?.training_record);
}


function questionTypeLabel(type) {
  if (type === "map") return "Map";
  if (type === "image") return "Image";
  if (type === "timeline") return "Timeline";
  return "Texte";
}


function questionTitle(question) {
  if (question?.title) {
    return question.title;
  }

  if (question?.type_q === "map" || question?.type_q === "image") {
    return question.answer || question.question || `Question #${question.id}`;
  }

  return question?.question || question?.answer || `Question #${question?.id}`;
}


function sectionKeyForQuestion(question) {
  const groupId = question?.group?.id ?? question?.group_id;

  if (groupId !== undefined && groupId !== null) {
    return `group-${groupId}`;
  }

  const groupName = question?.group?.name || question?.group_name;

  if (groupName) {
    return `group-name-${normalizeText(groupName)}`;
  }

  return "ungrouped";
}


function sectionTitleForQuestion(question) {
  return question?.group?.name || question?.group_name || "Sans groupe";
}


function questionAnswerPreview(question) {
  return question?.answer_preview || question?.answer || "";
}


function buildQuestionSections(questions, sortByTitle = false) {
  const sectionMap = new Map();

  questions.forEach(question => {
    const key = sectionKeyForQuestion(question);

    if (!sectionMap.has(key)) {
      sectionMap.set(key, {
        key,
        title: sectionTitleForQuestion(question),
        questions: []
      });
    }

    sectionMap.get(key).questions.push(question);
  });

  const sections = [...sectionMap.values()];

  if (sortByTitle) {
    return sections.sort((a, b) => a.title.localeCompare(b.title));
  }

  return sections;
}


function RecordMetric({ label, value }) {
  return (
    <div className="training-record-metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}


function TrainingScoreMeter({ percent }) {
  return (
    <span
      className="training-total-score"
      aria-label={`Score total ${formatTotalPercent(percent)}`}
    >
      <strong>{formatTotalPercent(percent)}</strong>
      <span className="training-total-score-label">total</span>
      <span className="training-total-score-bar" aria-hidden="true">
        <span style={{ width: percentBarWidth(percent) }} />
      </span>
    </span>
  );
}


function GroupTile({ group, onSelect, selected }) {
  const config = modeConfigForGroup(group);
  const totalPercent = groupTotalPercent(group);
  const accent = groupAccent(group);

  return (
    <button
      type="button"
      aria-pressed={selected}
      aria-label={`Sélectionner ${group.name}`}
      className={`training-scope-tile training-scope-tile-${accent}${selected ? " is-selected" : ""}`}
      onClick={onSelect}
    >
      <span className="training-scope-tile-main">
        <span className={`training-scope-badge training-scope-badge-${accent}`}>
          {group.type_group || "groupe"}
        </span>
        <strong>{group.name}</strong>
        <span>
          {questionCountLabel(group.question_count)}
          {config ? ` · ${config.modes.length} modes` : ""}
        </span>
      </span>

      <TrainingScoreMeter percent={totalPercent} />
    </button>
  );
}


function TagTile({ tag, startScope }) {
  return (
    <button
      type="button"
      aria-label={`Démarrer le tag ${tag.name}`}
      className="training-scope-tile training-tag-tile"
      onClick={() => startScope({
        type: "tag",
        name: tag.name
      })}
    >
      <span className="training-scope-tile-main">
        <span className="training-scope-badge training-scope-badge-tag">
          tag
        </span>
        <strong>#{tag.name}</strong>
        <span>{questionCountLabel(tag.count)}</span>
      </span>

      <span className="training-scope-score">
        <strong>→</strong>
        <span>démarrer</span>
      </span>
    </button>
  );
}


function CollectionTile({ collection, onSelect, selected }) {
  const percent = collectionPercent(collection);
  const generated = Boolean(collection.generated);

  return (
    <button
      type="button"
      aria-pressed={selected}
      aria-label={`Sélectionner ${collection.name}`}
      className={`training-scope-tile training-scope-tile-collection${generated ? " is-generated" : ""}${selected ? " is-selected" : ""}`}
      onClick={onSelect}
    >
      <span className="training-scope-tile-main">
        <strong>{collection.name}</strong>
        <span>
          {questionCountLabel(collection.question_count)}
          {generated ? " · générée automatiquement" : ""}
        </span>
      </span>

      <TrainingScoreMeter percent={percent} />
    </button>
  );
}


function CollectionDetailPanel({
  collection,
  onDelete,
  onEdit,
  startScope
}) {
  if (!collection) {
    return (
      <aside className="training-detail-panel training-detail-empty" aria-label="Détails de la collection">
        Sélectionne une collection.
      </aside>
    );
  }

  const record = collection.training_record;
  const generated = Boolean(collection.generated);

  return (
    <aside
      className={`training-detail-panel training-detail-panel-collection${generated ? " is-generated" : ""}`}
      aria-label="Détails de la collection"
    >
      <div className="training-detail-head">
        <h2>{collection.name}</h2>
        <p>
          {questionCountLabel(collection.question_count)}
          {generated ? " · Générée automatiquement" : ""}
        </p>
      </div>

      <div className="training-detail-metrics">
        <RecordMetric
          label="Score"
          value={formatRecordPercent(record)}
        />
        <RecordMetric
          label="Temps"
          value={recordTimeLabel(record)}
        />
      </div>

      <div className="training-collection-actions">
        <button
          type="button"
          className="training-start-button"
          disabled={(collection.question_count || 0) <= 0}
          onClick={() => startScope({
            ...collection,
            type: "collection"
          })}
        >
          <strong>Démarrer</strong>
          <span>{questionCountLabel(collection.question_count)}</span>
        </button>

        {!generated && (
          <>
            <button
              type="button"
              className="training-secondary-button"
              onClick={() => onEdit(collection)}
            >
              Modifier
            </button>

            <button
              type="button"
              className="training-secondary-button training-danger-button"
              onClick={() => onDelete(collection)}
            >
              Supprimer
            </button>
          </>
        )}
      </div>
    </aside>
  );
}


function ComposerQuestionRow({
  question,
  onRemove,
  onToggle,
  selected,
  tray
}) {
  const preview = questionAnswerPreview(question);

  if (tray) {
    return (
      <div className="training-composer-tray-row">
        <span>
          <strong>{questionTitle(question)}</strong>
          <span>{questionTypeLabel(question.type_q)}</span>
        </span>
        <button
          type="button"
          aria-label={`Retirer ${questionTitle(question)}`}
          className="training-composer-icon-button"
          onClick={() => onRemove(question.id)}
        >
          x
        </button>
      </div>
    );
  }

  return (
    <label className="training-composer-result-row">
      <input
        aria-label={`Sélectionner ${questionTitle(question)}`}
        checked={selected}
        onChange={() => onToggle(question)}
        type="checkbox"
      />
      <span className="training-composer-result-main">
        <span className="training-composer-result-title">
          <strong>{questionTitle(question)}</strong>
          <span className="training-scope-badge training-scope-badge-neutral">
            {questionTypeLabel(question.type_q)}
          </span>
        </span>
        {preview && (
          <span className="training-composer-preview">
            {preview}
          </span>
        )}
        <span className="training-composer-meta">
          <span>{question.group?.name || "Sans groupe"}</span>
          {(question.tags || []).slice(0, 4).map(tag => (
            <span key={tag}>#{tag}</span>
          ))}
          {question.has_media && <span>media</span>}
        </span>
      </span>
    </label>
  );
}


function CollectionComposer({
  collection,
  filterGroups,
  filterTags,
  onCancel,
  onSaved,
  setSelectedCollectionId
}) {
  const editing = Boolean(collection?.id);
  const [name, setName] = useState(collection?.name || "");
  const [searchDraft, setSearchDraft] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [groupFilter, setGroupFilter] = useState("");
  const [tagFilter, setTagFilter] = useState("");
  const [selectedOnly, setSelectedOnly] = useState(false);
  const [selectedItemsById, setSelectedItemsById] = useState(() => new Map());
  const [candidateItems, setCandidateItems] = useState([]);
  const [candidateTotal, setCandidateTotal] = useState(0);
  const [expandedResultSections, setExpandedResultSections] = useState(() => new Set());
  const [expandedTraySections, setExpandedTraySections] = useState(() => new Set());
  const [candidatesLoading, setCandidatesLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [selectedLoading, setSelectedLoading] = useState(false);
  const [candidateError, setCandidateError] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setName(collection?.name || "");
    setSearchDraft("");
    setDebouncedSearch("");
    setTypeFilter("");
    setGroupFilter("");
    setTagFilter("");
    setSelectedOnly(false);
    setSelectedItemsById(new Map());
    setExpandedResultSections(new Set());
    setExpandedTraySections(new Set());
    setCandidateItems([]);
    setCandidateTotal(0);
    setCandidateError("");
    setError("");
  }, [collection?.id, collection?.name]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearch(searchDraft.trim());
    }, 250);

    return () => window.clearTimeout(timer);
  }, [searchDraft]);

  useEffect(() => {
    let cancelled = false;

    if (!editing) {
      setSelectedLoading(false);
      return () => {
        cancelled = true;
      };
    }

    setSelectedLoading(true);
    setError("");

    Promise.all([
      getCollection(collection.id),
      listCollectionQuestions(collection.id)
    ])
      .then(([collectionData, selectedQuestions]) => {
        if (cancelled) return;

        const nextSelected = new Map();

        (selectedQuestions || []).forEach(question => {
          nextSelected.set(question.id, question);
        });

        setName(collectionData?.name || "");
        setSelectedItemsById(nextSelected);
      })
      .catch((loadError) => {
        console.error(loadError);

        if (!cancelled) {
          setError(loadError.message || "Impossible de charger la collection.");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setSelectedLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [collection?.id, editing]);

  useEffect(() => {
    setExpandedResultSections(new Set());

    if (selectedOnly) {
      setCandidatesLoading(false);
      return undefined;
    }

    const controller = new AbortController();

    setCandidatesLoading(true);
    setCandidateError("");

    listCollectionQuestionCandidates({
      search: debouncedSearch,
      type_q: typeFilter,
      group_id: groupFilter,
      tag: tagFilter,
      limit: COLLECTION_CANDIDATE_PAGE_SIZE,
      offset: 0,
      sort: "recent"
    }, { signal: controller.signal })
      .then((data) => {
        if (controller.signal.aborted) return;

        setCandidateItems(data?.items || []);
        setCandidateTotal(Number(data?.total) || 0);
      })
      .catch((loadError) => {
        if (loadError.name === "AbortError" || controller.signal.aborted) {
          return;
        }

        console.error(loadError);
        setCandidateError(loadError.message || "Impossible de charger les questions.");
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setCandidatesLoading(false);
        }
      });

    return () => controller.abort();
  }, [debouncedSearch, groupFilter, selectedOnly, tagFilter, typeFilter]);

  const selectedItems = useMemo(
    () => [...selectedItemsById.values()],
    [selectedItemsById]
  );
  const selectedIds = useMemo(
    () => new Set(selectedItemsById.keys()),
    [selectedItemsById]
  );
  const resultItems = selectedOnly ? selectedItems : candidateItems;
  const resultSections = useMemo(
    () => buildQuestionSections(resultItems, selectedOnly),
    [resultItems, selectedOnly]
  );
  const traySections = useMemo(
    () => buildQuestionSections(selectedItems, true),
    [selectedItems]
  );
  const hasMoreCandidates = !selectedOnly && candidateItems.length < candidateTotal;

  function toggleQuestion(question) {
    setSelectedItemsById(prev => {
      const next = new Map(prev);

      if (next.has(question.id)) {
        next.delete(question.id);
      } else {
        next.set(question.id, question);
      }

      return next;
    });
  }

  function setQuestionsSelected(questions, selected) {
    setSelectedItemsById(prev => {
      const next = new Map(prev);

      questions.forEach(question => {
        if (selected) {
          next.set(question.id, question);
        } else {
          next.delete(question.id);
        }
      });

      return next;
    });
  }

  function removeSelectedQuestion(questionId) {
    setSelectedItemsById(prev => {
      const next = new Map(prev);
      next.delete(questionId);
      return next;
    });
  }

  function clearFilters() {
    setSearchDraft("");
    setTypeFilter("");
    setGroupFilter("");
    setTagFilter("");
    setSelectedOnly(false);
  }

  function toggleSectionExpanded(sectionKey, target) {
    const setter = target === "tray"
      ? setExpandedTraySections
      : setExpandedResultSections;

    setter(prev => {
      const next = new Set(prev);

      if (next.has(sectionKey)) {
        next.delete(sectionKey);
      } else {
        next.add(sectionKey);
      }

      return next;
    });
  }

  async function loadMoreCandidates() {
    if (loadingMore || !hasMoreCandidates) return;

    setLoadingMore(true);
    setCandidateError("");

    try {
      const data = await listCollectionQuestionCandidates({
        search: debouncedSearch,
        type_q: typeFilter,
        group_id: groupFilter,
        tag: tagFilter,
        limit: COLLECTION_CANDIDATE_PAGE_SIZE,
        offset: candidateItems.length,
        sort: "recent"
      });

      setCandidateTotal(Number(data?.total) || 0);
      setCandidateItems(prev => {
        const next = [...prev];
        const seen = new Set(prev.map(question => question.id));

        (data?.items || []).forEach(question => {
          if (!seen.has(question.id)) {
            next.push(question);
            seen.add(question.id);
          }
        });

        return next;
      });
    } catch (loadError) {
      console.error(loadError);
      setCandidateError(loadError.message || "Impossible de charger la suite.");
    } finally {
      setLoadingMore(false);
    }
  }

  async function handleSave(event) {
    event.preventDefault();

    const trimmedName = name.trim();

    if (!trimmedName || selectedItemsById.size === 0) return;

    setSaving(true);
    setError("");

    try {
      const payload = {
        name: trimmedName,
        question_ids: [...selectedItemsById.keys()]
      };
      const saved = editing
        ? await updateCollection(collection.id, payload)
        : await createCollection(payload);

      setSelectedCollectionId(saved.id);
      await onSaved(saved);
    } catch (saveError) {
      console.error(saveError);
      setError(saveError.message || "Impossible d'enregistrer la collection.");
    } finally {
      setSaving(false);
    }
  }

  const saveDisabled = (
    !name.trim() ||
    selectedItemsById.size === 0 ||
    saving ||
    selectedLoading
  );

  return (
    <div className="training-composer-screen">
      <form className="training-composer-shell" onSubmit={handleSave}>
        <header className="training-composer-savebar">
          <div className="training-composer-title">
            <div className="training-selector-overline">Collection</div>
            <h1>{editing ? "Modifier la collection" : "Nouvelle collection"}</h1>
          </div>

          <label className="training-composer-name">
            <span>Nom</span>
            <input
              aria-label="Nom de la collection"
              className="training-search-input"
              onChange={(event) => setName(event.target.value)}
              placeholder="Nom de la collection"
              value={name}
            />
          </label>

          <div className="training-composer-save-actions">
            <span className="training-composer-count">
              {questionCountLabel(selectedItemsById.size)}
            </span>
            <button
              type="button"
              className="training-secondary-button"
              onClick={onCancel}
            >
              Annuler
            </button>
            <button
              type="submit"
              className="training-start-button training-composer-save-button"
              disabled={saveDisabled}
            >
              <strong>{saving ? "Enregistrement..." : "Enregistrer"}</strong>
              <span>{questionCountLabel(selectedItemsById.size)}</span>
            </button>
          </div>
        </header>

        {error && (
          <div className="training-selector-error" role="alert">
            {error}
          </div>
        )}

        <div className="training-composer-layout">
          <aside className="training-composer-filters app-scrollbar" aria-label="Filtres">
            <div className="training-composer-filter-group">
              <label>
                <span>Recherche</span>
                <input
                  aria-label="Rechercher une question"
                  className="training-search-input"
                  onChange={(event) => setSearchDraft(event.target.value)}
                  placeholder="Question, réponse, alias, tag, groupe..."
                  value={searchDraft}
                />
              </label>
            </div>

            <div className="training-composer-filter-group">
              <label>
                <span>Type</span>
                <select
                  aria-label="Filtrer par type"
                  className="training-search-input"
                  onChange={(event) => setTypeFilter(event.target.value)}
                  value={typeFilter}
                >
                  <option value="">Tous les types</option>
                  <option value="text">Texte</option>
                  <option value="map">Map</option>
                  <option value="image">Image</option>
                  <option value="timeline">Timeline</option>
                </select>
              </label>

              <label>
                <span>Groupe</span>
                <select
                  aria-label="Filtrer par groupe"
                  className="training-search-input"
                  onChange={(event) => setGroupFilter(event.target.value)}
                  value={groupFilter}
                >
                  <option value="">Tous les groupes</option>
                  {(filterGroups || []).map(group => (
                    <option key={group.id} value={group.id}>
                      {group.name}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                <span>Tag</span>
                <select
                  aria-label="Filtrer par tag"
                  className="training-search-input"
                  onChange={(event) => setTagFilter(event.target.value)}
                  value={tagFilter}
                >
                  <option value="">Tous les tags</option>
                  {(filterTags || []).map(tag => (
                    <option key={tag.name} value={tag.name}>
                      #{tag.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <label className="training-composer-selected-toggle">
              <input
                checked={selectedOnly}
                onChange={(event) => setSelectedOnly(event.target.checked)}
                type="checkbox"
              />
              <span>Sélection seulement</span>
            </label>

            <button
              type="button"
              className="training-secondary-button"
              onClick={clearFilters}
            >
              Réinitialiser les filtres
            </button>
          </aside>

          <main className="training-composer-results app-scrollbar" aria-label="Questions disponibles">
            <div className="training-composer-panel-head">
              <div>
                <strong>
                  {selectedOnly ? "Questions sélectionnées" : "Résultats"}
                </strong>
                <span>
                  {selectedOnly
                    ? questionCountLabel(selectedItems.length)
                    : `${candidateItems.length} / ${candidateTotal}`}
                </span>
              </div>
            </div>

            {selectedLoading && (
              <div className="training-selector-state">
                Chargement de la sélection...
              </div>
            )}

            {candidatesLoading && !selectedOnly && (
              <div className="training-selector-state">
                Recherche...
              </div>
            )}

            {candidateError && (
              <div className="training-selector-error" role="alert">
                {candidateError}
              </div>
            )}

            {!selectedLoading && !candidatesLoading && !candidateError && (
              resultSections.length === 0 ? (
                <div className="training-composer-empty">
                  <strong>
                    {selectedOnly
                      ? "Aucune question sélectionnée."
                      : "Aucun résultat."}
                  </strong>
                  <button
                    type="button"
                    className="training-secondary-button"
                    onClick={clearFilters}
                  >
                    Effacer les filtres
                  </button>
                </div>
              ) : (
                <div className="training-composer-section-list">
                  {resultSections.map(section => {
                    const expanded = expandedResultSections.has(section.key);
                    const sectionIds = section.questions.map(question => question.id);
                    const selectedCount = sectionIds.filter(id =>
                      selectedIds.has(id)
                    ).length;
                    const allSelected = (
                      section.questions.length > 0 &&
                      selectedCount === section.questions.length
                    );

                    return (
                      <section
                        className="training-composer-section"
                        key={section.key}
                      >
                        <div className="training-composer-section-head">
                          <button
                            type="button"
                            aria-expanded={expanded}
                            aria-label={`${expanded ? "Replier" : "Déplier"} ${section.title}`}
                            className="training-composer-section-toggle"
                            onClick={() => toggleSectionExpanded(section.key, "results")}
                          >
                            <span
                              aria-hidden="true"
                              className={`training-composer-section-caret${expanded ? " is-expanded" : ""}`}
                            >
                              &gt;
                            </span>
                            <span>
                              <strong>{section.title}</strong>
                              <span>{selectedCount} / {section.questions.length}</span>
                            </span>
                          </button>
                          <div className="training-composer-section-actions">
                            <button
                              type="button"
                              className="training-secondary-button"
                              onClick={() => setQuestionsSelected(section.questions, !allSelected)}
                            >
                              {allSelected
                                ? "Retirer le groupe visible"
                                : "Ajouter le groupe visible"}
                            </button>
                          </div>
                        </div>

                        {expanded && (
                          <div className="training-composer-result-list">
                            {section.questions.map(question => (
                              <ComposerQuestionRow
                                key={question.id}
                                onToggle={toggleQuestion}
                                question={question}
                                selected={selectedIds.has(question.id)}
                              />
                            ))}
                          </div>
                        )}
                      </section>
                    );
                  })}
                </div>
              )
            )}

            {hasMoreCandidates && !candidatesLoading && !candidateError && (
              <button
                type="button"
                className="training-secondary-button training-composer-load-more"
                disabled={loadingMore}
                onClick={loadMoreCandidates}
              >
                {loadingMore ? "Chargement..." : "Charger plus"}
              </button>
            )}
          </main>

          <aside className="training-composer-tray app-scrollbar" aria-label="Questions sélectionnées">
            <div className="training-composer-panel-head">
              <div>
                <strong>Sélection</strong>
                <span>{questionCountLabel(selectedItems.length)}</span>
              </div>
              <button
                type="button"
                className="training-secondary-button"
                disabled={selectedItems.length === 0}
                onClick={() => setSelectedItemsById(new Map())}
              >
                Vider
              </button>
            </div>

            {traySections.length === 0 ? (
              <div className="training-composer-empty">
                <strong>Aucune question.</strong>
              </div>
            ) : (
              <div className="training-composer-tray-list">
                {traySections.map(section => (
                  <section
                    className="training-composer-tray-section"
                    key={section.key}
                  >
                    <div className="training-composer-tray-section-head">
                      <button
                        type="button"
                        aria-expanded={expandedTraySections.has(section.key)}
                        aria-label={`${expandedTraySections.has(section.key) ? "Replier" : "Déplier"} ${section.title}`}
                        className="training-composer-section-toggle"
                        onClick={() => toggleSectionExpanded(section.key, "tray")}
                      >
                        <span
                          aria-hidden="true"
                          className={`training-composer-section-caret${expandedTraySections.has(section.key) ? " is-expanded" : ""}`}
                        >
                          &gt;
                        </span>
                        <span>
                          <strong>{section.title}</strong>
                          <span>{questionCountLabel(section.questions.length)}</span>
                        </span>
                      </button>
                      <div className="training-composer-section-actions">
                        <button
                          type="button"
                          className="training-secondary-button"
                          onClick={() => setQuestionsSelected(section.questions, false)}
                        >
                          Retirer le groupe
                        </button>
                      </div>
                    </div>

                    {expandedTraySections.has(section.key) && (
                      <div className="training-composer-tray-items">
                        {section.questions.map(question => (
                          <ComposerQuestionRow
                            key={question.id}
                            onRemove={removeSelectedQuestion}
                            question={question}
                            tray
                          />
                        ))}
                      </div>
                    )}
                  </section>
                ))}
              </div>
            )}
          </aside>
        </div>
      </form>
    </div>
  );
}


function ModeAction({ config, group, mode, startScope }) {
  const record = recordForMode(group, mode);
  const complete = record?.best_found_percent >= 100;

  return (
    <button
      type="button"
      className={`training-mode-action${complete ? " is-complete" : ""}`}
      onClick={() => startScope({
        ...group,
        type: "group"
      }, mode)}
      aria-label={`Démarrer ${config.labels[mode]} pour ${group.name}`}
    >
      <span className="training-mode-glyph" aria-hidden="true">
        {modeGlyph(mode)}
      </span>

      <span className="training-mode-copy">
        <strong>{config.labels[mode]}</strong>
        <span>{config.details[mode]}</span>
      </span>

      <span className="training-mode-record">
        <strong>{formatRecordPercent(record)}</strong>
        <span>{recordTimeLabel(record)}</span>
      </span>
    </button>
  );
}


function GroupDetailPanel({ group, startScope }) {
  if (!group) {
    return (
      <aside className="training-detail-panel training-detail-empty" aria-label="Détails du groupe">
        Sélectionne un groupe.
      </aside>
    );
  }

  const config = modeConfigForGroup(group);
  const totalPercent = groupTotalPercent(group);
  const accent = groupAccent(group);

  return (
    <aside
      className={`training-detail-panel training-detail-panel-${accent}`}
      aria-label="Détails du groupe"
    >
      <div className="training-detail-head">
        <span className={`training-scope-badge training-scope-badge-${accent}`}>
          {group.type_group || "groupe"}
        </span>
        <h2>{group.name}</h2>
        <p>{questionCountLabel(group.question_count)}</p>
      </div>

      <div
        className="training-detail-metrics training-detail-metrics-single"
        aria-label="Score du groupe"
      >
        <RecordMetric label="Score total" value={formatTotalPercent(totalPercent)} />
      </div>

      {config ? (
        <>
          <div className="training-detail-section-title">
            Modes d'entrainement
          </div>
          <div className="training-mode-list">
            {config.modes.map(mode => (
              <ModeAction
                config={config}
                group={group}
                key={mode}
                mode={mode}
                startScope={startScope}
              />
            ))}
          </div>
        </>
      ) : (
        <button
          type="button"
          className="training-start-button"
          onClick={() => startScope({
            ...group,
            type: "group"
          })}
        >
          <strong>Démarrer ce groupe</strong>
          <span>{questionCountLabel(group.question_count)}</span>
        </button>
      )}
    </aside>
  );
}


function ScopeSelector({
  scopes,
  scopesError,
  scopesLoading,
  startScope,
  loadScopes,
  selectedCollectionId,
  selectedGroupId,
  setMode,
  setSelectedCollectionId,
  setSelectedGroupId
}) {
  const [scopeType, setScopeType] = useState("group");
  const [search, setSearch] = useState("");
  const [composerCollection, setComposerCollection] = useState(null);
  const [composerOpen, setComposerOpen] = useState(false);
  const normalizedSearch = normalizeText(search);
  const groups = useMemo(
    () => (scopes.groups || []).filter(group =>
      normalizeText(`${group.name} ${group.type_group}`).includes(normalizedSearch)
    ),
    [normalizedSearch, scopes.groups]
  );
  const collections = useMemo(
    () => (scopes.collections || []).filter(collection =>
      normalizeText(collection.name).includes(normalizedSearch)
    ),
    [normalizedSearch, scopes.collections]
  );
  const tags = useMemo(
    () => (scopes.tags || []).filter(tag =>
      normalizeText(tag.name).includes(normalizedSearch)
    ),
    [normalizedSearch, scopes.tags]
  );
  const activeRows = scopeType === "group"
    ? groups
    : scopeType === "collection"
      ? collections
      : tags;
  const selectedGroup = useMemo(
    () => groups.find(group => group.id === selectedGroupId) || null,
    [groups, selectedGroupId]
  );
  const selectedCollection = useMemo(
    () => collections.find(collection => collection.id === selectedCollectionId) || null,
    [collections, selectedCollectionId]
  );

  useEffect(() => {
    if (scopeType !== "group") {
      return;
    }

    setSelectedGroupId(currentId => {
      if (groups.length === 0) return null;

      if (groups.some(group => group.id === currentId)) {
        return currentId;
      }

      return groups[0].id;
    });
  }, [groups, scopeType, setSelectedGroupId]);

  useEffect(() => {
    if (scopeType !== "collection" || composerOpen) {
      return;
    }

    setSelectedCollectionId(currentId => {
      if (collections.length === 0) return null;

      if (collections.some(collection => collection.id === currentId)) {
        return currentId;
      }

      return collections[0].id;
    });
  }, [composerOpen, collections, scopeType, setSelectedCollectionId]);

  function openNewCollection() {
    setScopeType("collection");
    setComposerCollection(null);
    setComposerOpen(true);
  }

  function openEditCollection(collection) {
    if (collection?.generated) {
      return;
    }

    setComposerCollection(collection);
    setComposerOpen(true);
  }

  async function handleCollectionSaved() {
    await loadScopes();
    setComposerOpen(false);
    setComposerCollection(null);
  }

  async function handleDeleteCollection(collection) {
    if (!window.confirm(`Supprimer la collection "${collection.name}" ?`)) {
      return;
    }

    await deleteCollection(collection.id);
    setSelectedCollectionId(null);
    await loadScopes();
  }

  if (!scopesLoading && !scopesError && scopeType === "collection" && composerOpen) {
    return (
      <CollectionComposer
        collection={composerCollection}
        filterGroups={scopes.groups || []}
        filterTags={scopes.tags || []}
        onCancel={() => {
          setComposerOpen(false);
          setComposerCollection(null);
        }}
        onSaved={handleCollectionSaved}
        setSelectedCollectionId={setSelectedCollectionId}
      />
    );
  }

  return (
    <div className="training-selector-panel">
      <div className="training-selector-header">
        <div className="training-selector-title">
          <div className="training-selector-overline">Training</div>
          <h1>
            Entrainement
          </h1>
        </div>

        <ReturnToMenuButton
          onClick={() => setMode("menu")}
          className="training-selector-back"
        />
      </div>

      {scopesLoading && (
        <div className="training-selector-state">
          Chargement des choix...
        </div>
      )}

      {!scopesLoading && scopesError && (
        <div className="training-selector-error" role="alert">
          <div>{scopesError}</div>
          <button type="button" onClick={loadScopes} className="training-secondary-button">
            Recharger
          </button>
        </div>
      )}

      {!scopesLoading && !scopesError && (
        <>
          <div className="training-selector-controls">
            <div className="training-segmented" aria-label="Type de scope">
              <button
                type="button"
                aria-pressed={scopeType === "group"}
                onClick={() => {
                  setScopeType("group");
                  setComposerOpen(false);
                }}
                className={scopeType === "group" ? "is-active" : ""}
              >
                Groupes
              </button>
              <button
                type="button"
                aria-pressed={scopeType === "collection"}
                onClick={() => setScopeType("collection")}
                className={scopeType === "collection" ? "is-active" : ""}
              >
                Collections
              </button>
              <button
                type="button"
                aria-pressed={scopeType === "tag"}
                onClick={() => {
                  setScopeType("tag");
                  setComposerOpen(false);
                }}
                className={scopeType === "tag" ? "is-active" : ""}
              >
                Tags
              </button>
            </div>
            {scopeType === "collection" && (
              <button
                type="button"
                className="training-secondary-button"
                onClick={openNewCollection}
              >
                Nouvelle collection
              </button>
            )}
            <input
              aria-label="Rechercher un entrainement"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Recherche..."
              className="training-search-input"
            />
          </div>

          {activeRows.length === 0 ? (
            <div className="training-selector-state">
              Aucun choix disponible.
            </div>
          ) : (
            <div className={`training-selector-body training-selector-body-${scopeType}`}>
              {scopeType === "group" ? (
                <>
                  <section className="training-list-column" aria-label="Liste des groupes">
                    <div className="training-scope-grid" aria-label="Groupes d'entrainement">
                      {groups.map(group => (
                        <GroupTile
                          group={group}
                          key={group.id}
                          onSelect={() => setSelectedGroupId(group.id)}
                          selected={selectedGroupId === group.id}
                        />
                      ))}
                    </div>
                  </section>

                  <div className="training-detail-column">
                    <GroupDetailPanel
                      group={selectedGroup}
                      startScope={startScope}
                    />
                  </div>
                </>
              ) : scopeType === "collection" ? (
                <>
                  <section className="training-list-column" aria-label="Liste des collections">
                    <div className="training-scope-grid" aria-label="Collections d'entrainement">
                      {collections.map(collection => (
                        <CollectionTile
                          collection={collection}
                          key={collection.id}
                          onSelect={() => setSelectedCollectionId(collection.id)}
                          selected={selectedCollectionId === collection.id}
                        />
                      ))}
                    </div>
                  </section>

                  <div className="training-detail-column">
                    <CollectionDetailPanel
                      collection={selectedCollection}
                      onDelete={handleDeleteCollection}
                      onEdit={openEditCollection}
                      startScope={startScope}
                    />
                  </div>
                </>
              ) : (
                <div className="training-scope-grid" aria-label="Tags d'entrainement">
                  {tags.map(tag => (
                    <TagTile
                      key={tag.name}
                      startScope={startScope}
                      tag={tag}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}


export default function TrainingSession({ setMode }) {
  const session = useTrainingSession(true);
  const [selectedCollectionId, setSelectedCollectionId] = useState(null);
  const [selectedGroupId, setSelectedGroupId] = useState(null);
  const currentQuestion = session.questions[session.currentIndex];
  const activeGroupMode = (
    session.activeScope?.groupMode ||
    session.activeScope?.mapMode ||
    session.activeScope?.imageMode
  );
  const activeModeConfig = modeConfigForGroup(session.activeScope);
  const activeRecord = activeGroupMode
    ? recordForMode(session.activeScope, activeGroupMode)
    : session.activeScope?.training_record || null;
  const displayedRecord = session.recordResult?.training_record || activeRecord;
  const completedPercent = formatPercent(
    session.attemptFoundCount,
    session.allQuestionIds.length
  );
  const hasActiveQuestion = Boolean(
    session.activeScope &&
    !session.trainingLoading &&
    !session.trainingError &&
    !session.isComplete &&
    currentQuestion &&
    session.currentIndex < session.questions.length
  );
  const useCompactVisualLayout = hasActiveQuestion && isVisualQuestion(currentQuestion);
  const compactTrainingElapsedMs = ["group", "collection"].includes(
    session.activeScope?.type
  )
    ? session.completedRunElapsedMs
    : null;

  if (useCompactVisualLayout) {
    return (
      <div
        data-visual-session-shell
        style={{
          background: "#111",
          boxSizing: "border-box",
          color: "#eee",
          display: "flex",
          flexDirection: "column",
          height: "calc(100dvh - 48px)",
          overflow: "hidden"
        }}
      >
        <div
          style={{
            display: "flex",
            flex: 1,
            flexDirection: "column",
            margin: "0 auto",
            maxWidth: "1280px",
            minHeight: 0,
            width: "100%"
          }}
        >
          <div
            data-visual-session-bar
            style={{
              alignItems: "center",
              background: "#181818",
              border: "1px solid #262626",
              borderRadius: "14px",
              boxSizing: "border-box",
              display: "grid",
              flexShrink: 0,
              gap: "12px",
              gridTemplateColumns: "minmax(0, 1fr) minmax(280px, 520px) minmax(0, 1fr)",
              marginBottom: "10px",
              minHeight: "72px",
              padding: "10px 14px"
            }}
          >
            <div
              data-visual-session-actions
              style={{
                alignItems: "center",
                display: "flex",
                flexWrap: "wrap",
                gap: "8px",
                justifyContent: "flex-start",
                minWidth: 0
              }}
            >
              <ReturnToMenuButton
                onClick={session.returnToScopeSelector}
                style={{
                  ...buttonStyle,
                  borderRadius: "9px",
                  fontSize: "13px",
                  padding: "8px 11px"
                }}
              />
            </div>

            <div
              data-visual-session-status
              style={{
                alignItems: "center",
                display: "flex",
                flexDirection: "column",
                gap: "4px",
                justifyContent: "center",
                minWidth: 0,
                textAlign: "center"
              }}
            >
              <div
                style={{
                  color: "#f0c36a",
                  fontSize: "11px",
                  fontWeight: 900,
                  textTransform: "uppercase"
                }}
              >
                Training
              </div>
              <strong
                data-visual-session-title
                style={{
                  color: "#f3f3f3",
                  display: "block",
                  fontSize: "17px",
                  fontWeight: 900,
                  lineHeight: 1.1,
                  maxWidth: "100%",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap"
                }}
              >
                {session.labelForActiveScope}
              </strong>
              <div
                style={{
                  alignItems: "center",
                  color: "#888",
                  display: "flex",
                  flexWrap: "wrap",
                  fontSize: "12px",
                  fontWeight: 800,
                  gap: "6px 8px",
                  justifyContent: "center",
                  lineHeight: 1.2
                }}
              >
                <span>
                  Question {session.currentIndex + 1} / {session.questions.length}
                </span>
                {(currentQuestion.tags || []).map(tag => (
                  <span
                    key={tag}
                    style={{
                      background: "#2b2047",
                      borderRadius: "999px",
                      color: "#b69cff",
                      fontSize: "11px",
                      fontWeight: 700,
                      padding: "3px 8px"
                    }}
                  >
                    #{tag}
                  </span>
                ))}
              </div>
            </div>

            <div
              data-visual-session-secondary
              style={{
                alignItems: "center",
                display: "flex",
                justifyContent: "flex-end",
                minWidth: 0
              }}
            >
              {compactTrainingElapsedMs !== null ? (
                <TrainingTimerPanel
                  elapsedMs={compactTrainingElapsedMs}
                  bestTimeMs={displayedRecord?.best_time_ms}
                  variant="prominent"
                />
              ) : (
                <div
                  style={{
                    background: "#141414",
                    border: "1px solid #282828",
                    borderRadius: "10px",
                    color: "#9a9a9a",
                    fontSize: "12px",
                    fontWeight: 800,
                    padding: "8px 10px",
                    textTransform: "uppercase"
                  }}
                >
                  En cours
                </div>
              )}
            </div>
          </div>

          <div
            data-visual-renderer
            style={{
              flex: 1,
              minHeight: 0,
              overflow: "hidden"
            }}
          >
            <ReviewQuestionRenderer
              q={currentQuestion}
              currentIndex={session.currentIndex}
              showAnswer={session.showAnswer}
              setShowAnswer={session.setShowAnswer}
              handleTextAnswer={session.handleTextAnswer}
              currentTextQuality={null}
              selectedTextQuality={null}
              handleMapComplete={session.handleMapComplete}
              handleImageComplete={session.handleImageComplete}
              handleTimelineComplete={session.handleTimelineComplete}
              submitMapAnswer={session.submitMapTrainingAnswer}
              submitImageAnswer={session.submitImageTrainingAnswer}
              submitTimelineAnswer={session.submitTimelineTrainingAnswer}
              trainingMode
              trainingElapsedMs={null}
              trainingBestTimeMs={null}
              compactVisualLayout
            />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        background: "#111",
        color: "#eee",
        minHeight: "100vh",
        padding: "30px 24px 80px"
      }}
    >
      <div style={{ margin: "0 auto", maxWidth: "1050px" }}>
        {!session.activeScope && (
          <ScopeSelector
            scopes={session.scopes}
            scopesError={session.scopesError}
            scopesLoading={session.scopesLoading}
            startScope={session.startScope}
            loadScopes={session.loadScopes}
            selectedCollectionId={selectedCollectionId}
            selectedGroupId={selectedGroupId}
            setMode={setMode}
            setSelectedCollectionId={setSelectedCollectionId}
            setSelectedGroupId={setSelectedGroupId}
          />
        )}

        {session.activeScope && (
          <>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "flex-start",
                gap: "20px",
                marginBottom: "24px"
              }}
            >
              <div>
                <div
                  style={{
                    color: "#666",
                    fontSize: "12px",
                    fontWeight: "800",
                    marginBottom: "8px",
                    textTransform: "uppercase"
                  }}
                >
                  Training session
                </div>
                <h1
                  style={{
                    fontSize: "36px",
                    lineHeight: 1,
                    margin: "0 0 10px"
                  }}
                >
                  {session.labelForActiveScope}
                </h1>
                <div style={{ color: "#777", fontSize: "14px" }}>
                  {session.allQuestionIds.length} items dans ce scope
                  {activeGroupMode && activeModeConfig
                    ? ` · ${activeModeConfig.labels[activeGroupMode]}`
                    : ""}
                </div>
              </div>

              <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
                <ReturnToMenuButton
                  onClick={session.returnToScopeSelector}
                  style={buttonStyle}
                />
              </div>
            </div>

            {session.trainingLoading && (
              <div style={{ ...panelStyle, color: "#777", padding: "60px", textAlign: "center" }}>
                Preparation de l'entrainement...
              </div>
            )}

            {!session.trainingLoading && session.trainingError && (
              <div style={{ ...panelStyle, borderColor: "#3a1d1d", color: "#ff9c9c", padding: "60px", textAlign: "center" }}>
                {session.trainingError}
              </div>
            )}

            {!session.trainingLoading &&
              !session.trainingError &&
              session.questions.length === 0 && (
              <div style={{ ...panelStyle, color: "#777", padding: "60px", textAlign: "center" }}>
                Aucun item dans ce scope.
              </div>
            )}

            {session.isComplete && (
              <div style={{ ...panelStyle, padding: "54px", textAlign: "center" }}>
                <div
                  style={{
                    color: "#f3f3f3",
                    fontSize: "28px",
                    fontWeight: "800",
                    marginBottom: "10px"
                  }}
                >
                  Entraînement terminé
                </div>
                <div style={{ color: "#888", marginBottom: "26px" }}>
                  {session.failedCount} item{session.failedCount > 1 ? "s" : ""} a revoir.
                </div>

                {session.recordEligible && (
                  <div
                    style={{
                      display: "grid",
                      gap: "10px",
                      gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
                      margin: "0 auto 22px",
                      maxWidth: "620px"
                    }}
                  >
                    <div style={completionMetricStyle}>
                      <span style={completionMetricLabelStyle}>Score</span>
                      <strong>{completedPercent}</strong>
                    </div>
                    <div style={completionMetricStyle}>
                      <span style={completionMetricLabelStyle}>Trouvés</span>
                      <strong>
                        {session.attemptFoundCount} / {session.allQuestionIds.length}
                      </strong>
                    </div>
                    <div style={completionMetricStyle}>
                      <span style={completionMetricLabelStyle}>Temps</span>
                      <strong>{formatDuration(session.completedRunElapsedMs)}</strong>
                    </div>
                  </div>
                )}

                {session.recordSaveStatus === "saving" && (
                  <div style={{ color: "#888", marginBottom: "18px" }}>
                    Enregistrement du record...
                  </div>
                )}

                {session.recordSaveStatus === "error" && (
                  <div style={{ color: "#ff9c9c", marginBottom: "18px" }}>
                    {session.recordSaveError}
                  </div>
                )}

                {session.recordResult && (
                  <div
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      gap: "8px",
                      justifyContent: "center",
                      marginBottom: "18px"
                    }}
                  >
                    {session.recordResult.is_new_best_percent && (
                      <span style={recordBadgeStyle}>
                        Nouveau meilleur score
                      </span>
                    )}
                    {session.recordResult.is_new_best_time && (
                      <span style={recordBadgeStyle}>
                        Nouveau record de temps
                      </span>
                    )}
                  </div>
                )}

                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: "10px",
                    justifyContent: "center"
                  }}
                >
                  <button
                    type="button"
                    onClick={session.restartFullScope}
                    style={primaryButtonStyle}
                  >
                    Recommencer
                  </button>
                  <button
                    type="button"
                    disabled={session.failedCount === 0}
                    onClick={session.retryFailedItems}
                    style={session.failedCount === 0
                      ? disabledButtonStyle
                      : buttonStyle}
                  >
                    Revoir les erreurs
                  </button>
                  <button
                    type="button"
                    onClick={session.returnToScopeSelector}
                    style={buttonStyle}
                  >
                    ← Retour
                  </button>
                </div>
              </div>
            )}

            {!session.trainingLoading &&
              !session.trainingError &&
              currentQuestion &&
              session.currentIndex < session.questions.length && (
              <>
                <div
                  style={{
                    alignItems: "center",
                    display: "flex",
                    justifyContent: "space-between",
                    gap: "16px",
                    marginBottom: "18px"
                  }}
                >
                  <div style={{ color: "#888", fontSize: "14px" }}>
                    Question {session.currentIndex + 1} / {session.questions.length}
                  </div>

                  <div
                    style={{
                      display: "flex",
                      gap: "6px",
                      flexWrap: "wrap",
                      justifyContent: "flex-end"
                    }}
                  >
                    {(currentQuestion.tags || []).map(tag => (
                      <div
                        key={tag}
                        style={{
                          background: "#2b2047",
                          borderRadius: "999px",
                          color: "#b69cff",
                          fontSize: "11px",
                          fontWeight: "600",
                          padding: "4px 10px"
                        }}
                      >
                        #{tag}
                      </div>
                    ))}
                  </div>
                </div>

                <ReviewQuestionRenderer
                  q={currentQuestion}
                  currentIndex={session.currentIndex}
                  showAnswer={session.showAnswer}
                  setShowAnswer={session.setShowAnswer}
                  handleTextAnswer={session.handleTextAnswer}
                  currentTextQuality={null}
                  selectedTextQuality={null}
                  handleMapComplete={session.handleMapComplete}
                  handleImageComplete={session.handleImageComplete}
                  handleTimelineComplete={session.handleTimelineComplete}
                  submitMapAnswer={session.submitMapTrainingAnswer}
                  submitImageAnswer={session.submitImageTrainingAnswer}
                  submitTimelineAnswer={session.submitTimelineTrainingAnswer}
                  trainingMode
                  trainingElapsedMs={session.recordEligible ? session.completedRunElapsedMs : null}
                  trainingBestTimeMs={session.recordEligible ? displayedRecord?.best_time_ms : null}
                />
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
