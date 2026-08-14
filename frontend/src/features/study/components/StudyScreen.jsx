import { useEffect, useMemo, useState } from "react";
import ReturnToMenuButton from "../../../shared/ReturnToMenuButton";
import { getMediaKind, resolveMediaUrl } from "../../../shared/media";
import { getStudySummary } from "../../../api/study";
import SvgMap from "../../map/components/SvgMap";
import { formatDuration, formatRecordPercent } from "../../training/trainingRecordUtils";
import { mapModeLabels } from "../../review/mapModes";
import { imageModeLabels } from "../../review/imageModes";
import { textModeLabels } from "../../review/textModes";
import { sequenceModeLabels } from "../../review/sequenceModes";
import "./StudyScreen.css";


const TABS = [
  { id: "overview", label: "Vue" },
  { id: "learn", label: "Apprendre" },
  { id: "train", label: "Entraîner" },
  { id: "weak", label: "Faibles" },
  { id: "history", label: "Historique" }
];

const BUCKETS = [
  { key: "unseen", label: "Nouveau", color: "#8fc7ff" },
  { key: "learning", label: "Apprentissage", color: "#f0c36a" },
  { key: "fragile", label: "Fragile", color: "#ff9c9c" },
  { key: "stable", label: "Stable", color: "#7ee2a8" },
  { key: "mastered", label: "Maîtrisé", color: "#a7f3c1" }
];

const MODE_LABELS = {
  ...mapModeLabels,
  ...imageModeLabels,
  ...textModeLabels,
  ...sequenceModeLabels,
  event_to_date: "Date",
  cloze_prompt: "Texte à trous",
  cell_prompt: "Cellule",
  row_prompt: "Ligne",
  collect_members: "Membres",
  collect_quota: "Quota",
  answer_enumeration: "Liste"
};

const DIRECT_MODE_GROUP_TYPES = new Set(["map", "media", "text", "sequence"]);
const DIRECT_GROUP_MODES = {
  map: Object.keys(mapModeLabels),
  media: Object.keys(imageModeLabels),
  text: Object.keys(textModeLabels),
  sequence: Object.keys(sequenceModeLabels)
};
const AUDIO_MEDIA_MODES = new Set([
  "type_prompt",
  "multiple_choice_label",
  "multiple_choice_media"
]);
const LEARN_SUPPORTED_FAMILIES = new Set(["map", "media"]);
const CONFUSION_PRACTICE_MODES = {
  mapMode: "multiple_choice",
  imageMode: "multiple_choice_media",
  textMode: "match",
  sequenceMode: "multiple_choice"
};


function stableScopeKey(scope) {
  if (!scope) return "";

  return [
    scope.scopeType || scope.type || "",
    scope.groupId || scope.group_id || "",
    scope.collectionId || scope.collection_id || "",
    scope.packGuid || scope.pack_guid || "",
    scope.tag || scope.key || scope.id || "",
    scope.id || ""
  ].join(":");
}


function numberLabel(value) {
  return Number(value || 0).toLocaleString("fr-FR");
}


function questionCountLabel(count) {
  const value = Number(count || 0);

  return `${numberLabel(value)} question${value > 1 ? "s" : ""}`;
}


function formatDate(value) {
  if (!value) return "—";

  const date = new Date(`${value}T00:00:00`);

  if (Number.isNaN(date.getTime())) return value;

  return date.toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "short",
    year: "numeric"
  });
}


function modeLabel(mode) {
  return MODE_LABELS[mode] || String(mode || "").replaceAll("_", " ");
}


function scopeTypeLabel(scope) {
  if (scope?.type === "group") return scope.type_group || "groupe";
  if (scope?.type === "collection") return "playlist";
  if (scope?.type === "tag") return "tag";
  if (scope?.type === "pack") return "pack";

  return "scope";
}


function scopeTitle(scope) {
  if (!scope) return "Study";

  if (scope.type === "tag") {
    return `#${scope.label || scope.name || scope.id || scope.tag || ""}`;
  }

  return (
    scope.name ||
    scope.label ||
    scope.packGuid ||
    scope.pack_guid ||
    `${scopeTypeLabel(scope)} #${scope.id || ""}`
  );
}


function scopeToTrainingScope(scope) {
  if (!scope) return null;

  if (scope.type === "group") {
    return {
      type: "group",
      id: scope.id || scope.groupId || scope.group_id,
      name: scope.name,
      type_group: scope.type_group,
      audio_only: scope.audio_only,
      reverse_mode_enabled: scope.reverse_mode_enabled
    };
  }

  if (scope.type === "collection") {
    return {
      type: "collection",
      id: scope.id || scope.collectionId || scope.collection_id,
      name: scope.name
    };
  }

  if (scope.type === "tag") {
    const tagId = scope.id || scope.tag || scope.key;

    return {
      type: "tag",
      id: tagId,
      key: tagId,
      label: scope.label || scope.name || tagId,
      name: scope.label || scope.name || tagId
    };
  }

  return null;
}


function compactScopeId(scope) {
  return (
    scope?.groupId ||
    scope?.group_id ||
    scope?.collectionId ||
    scope?.collection_id ||
    scope?.packGuid ||
    scope?.pack_guid ||
    scope?.key ||
    scope?.id ||
    "scope"
  );
}


function practiceScopeForIds(label, questionIds, summary, extra = {}) {
  const ids = (questionIds || [])
    .map(value => Number(value))
    .filter(value => Number.isFinite(value));

  if (ids.length === 0) return null;

  return {
    type: "questions",
    id: [
      "practice",
      summary?.scope?.type || "scope",
      compactScopeId(summary?.scope),
      label,
      ids.join("-")
    ].join(":"),
    label,
    name: label,
    questionIds: ids,
    ...extra
  };
}


function practiceScopeFromEntry(entry, summary) {
  const extra = entry?.id === "commonly_confused_pairs"
    ? CONFUSION_PRACTICE_MODES
    : {};

  return practiceScopeForIds(
    entry?.label || "Pratique ciblée",
    entry?.question_ids || entry?.questionIds || [],
    summary,
    extra
  );
}


function groupToTrainingScope(group) {
  if (!group?.id) return null;

  return {
    type: "group",
    id: group.id,
    name: group.name,
    type_group: group.type_group,
    audio_only: group.audio_only,
    reverse_mode_enabled: group.reverse_mode_enabled
  };
}


function modesForGroup(group, backendModes = null) {
  let modes = backendModes?.length
    ? backendModes
    : DIRECT_GROUP_MODES[group?.type_group] || [];

  if (group?.type_group === "media" && group.audio_only) {
    modes = modes.filter(mode => AUDIO_MEDIA_MODES.has(mode));
  }

  if (group?.type_group === "text" && !group.reverse_mode_enabled) {
    modes = modes.filter(mode => mode !== "type_reverse");
  }

  return modes;
}


function recordLabel(record) {
  const percent = formatRecordPercent(record);
  const time = formatDuration(record?.best_time_ms);

  if (percent === "—" && time === "—") return "Aucun record";
  if (time === "—") return percent;

  return `${percent} · ${time}`;
}


function learnFamilyLabel(family) {
  if (family === "map") return "Carte";
  if (family === "media") return "Média";

  return "Learn";
}


function learnItemButtonLabel(item, index, family, revealed) {
  if (revealed && item?.answer) return item.answer;

  if (family === "map" && item?.code) return `Zone ${item.code}`;
  if (family === "media") return `Média ${index + 1}`;

  return `Item ${index + 1}`;
}


function firstAnswerLetter(answer) {
  const letters = Array.from(String(answer || "").trim());

  return letters[0]?.toLocaleUpperCase("fr-FR") || "—";
}


function primaryCategory(item, scope) {
  const tag = (item?.tags || []).find(value => String(value || "").trim());

  return tag || scope?.name || scope?.label || "—";
}


function learnMediaSource(item) {
  const pool = Array.isArray(item?.media_pool) ? item.media_pool : [];

  return pool[0] || item?.media || "";
}


function buildLearnChoices(items, activeIndex) {
  const activeItem = items[activeIndex];

  if (!activeItem?.answer) return [];

  const offsets = [0, 1, -1, 2, -2, 3, -3, 4, -4];
  const seen = new Set();
  const choices = [];

  offsets.forEach(offset => {
    const item = items[activeIndex + offset];
    const label = String(item?.answer || "").trim();
    const key = label.toLocaleLowerCase("fr-FR");

    if (!item || !label || seen.has(key)) return;

    seen.add(key);
    choices.push({
      id: item.id,
      label
    });
  });

  return choices
    .slice(0, 4)
    .sort((left, right) => left.label.localeCompare(right.label, "fr-FR"));
}


function relatedLearnItems(items, activeIndex) {
  return [-2, -1, 1, 2]
    .map(offset => items[activeIndex + offset])
    .filter(item => item?.answer)
    .slice(0, 4);
}


function recommendationFor(summary) {
  const counts = summary?.counts || {};
  const buckets = summary?.buckets || {};

  if ((summary?.recent_misses?.item_count || 0) > 0) {
    return {
      title: "Reprendre les erreurs récentes",
      detail: `${numberLabel(summary.recent_misses.item_count)} item${summary.recent_misses.item_count > 1 ? "s" : ""} à stabiliser`,
      targetTab: "weak"
    };
  }

  if ((summary?.confusions?.event_count || 0) > 0) {
    return {
      title: "Clarifier les confusions",
      detail: `${numberLabel(summary.confusions.event_count)} confusion${summary.confusions.event_count > 1 ? "s" : ""} récente${summary.confusions.event_count > 1 ? "s" : ""}`,
      targetTab: "weak"
    };
  }

  if ((counts.due_now || 0) > 0) {
    return {
      title: "Faire la review due",
      detail: questionCountLabel(counts.due_now),
      mode: "quiz"
    };
  }

  if ((buckets.unseen || 0) > 0) {
    return {
      title: "Apprendre les nouveaux items",
      detail: questionCountLabel(buckets.unseen),
      targetTab: "learn"
    };
  }

  return {
    title: "Entretenir ce scope",
    detail: questionCountLabel(counts.active_questions || 0),
    targetTab: "train"
  };
}


function EmptyStudy({ setMode }) {
  return (
    <div className="study-screen">
      <div className="study-shell">
        <header className="study-header">
          <div>
            <div className="study-overline">Study</div>
            <h1>Étudier</h1>
          </div>
          <ReturnToMenuButton onClick={() => setMode("menu")} className="study-back" />
        </header>

        <section className="study-empty-panel">
          <h2>Aucun scope sélectionné</h2>
          <div className="study-empty-actions">
            <button type="button" onClick={() => setMode("training")}>
              Entraînement
            </button>
            <button type="button" onClick={() => setMode("packs")}>
              Packs
            </button>
            <button type="button" onClick={() => setMode("menu")}>
              Menu
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}


function MetricCard({ label, value, tone = "neutral" }) {
  return (
    <div className={`study-metric-card study-metric-${tone}`}>
      <span>{label}</span>
      <strong>{numberLabel(value)}</strong>
    </div>
  );
}


function BucketCard({ bucket, count, total }) {
  const value = Number(count || 0);
  const denominator = Math.max(1, Number(total || 0));
  const percent = Math.round((value / denominator) * 100);

  return (
    <div className="study-bucket-card">
      <div className="study-bucket-head">
        <span>{bucket.label}</span>
        <strong>{numberLabel(value)}</strong>
      </div>
      <div className="study-bucket-bar" aria-hidden="true">
        <span
          style={{
            background: bucket.color,
            width: `${Math.min(Math.max(percent, 0), 100)}%`
          }}
        />
      </div>
    </div>
  );
}


function UpcomingLoad({ upcomingLoad }) {
  const days = (upcomingLoad?.by_day || []).slice(0, 14);
  const max = Math.max(1, ...days.map(day => Number(day.total || 0)));

  if (days.length === 0) {
    return (
      <div className="study-panel">
        <div className="study-panel-head">
          <h2>Charge à venir</h2>
          <span>0</span>
        </div>
        <div className="study-muted">Aucune carte planifiée.</div>
      </div>
    );
  }

  return (
    <div className="study-panel">
      <div className="study-panel-head">
        <h2>Charge à venir</h2>
        <span>{numberLabel(upcomingLoad?.total || 0)}</span>
      </div>
      <div className="study-load-chart" aria-label="Charge des 14 prochains jours">
        {days.map(day => {
          const height = Math.round((Number(day.total || 0) / max) * 100);

          return (
            <div className="study-load-day" key={day.date} title={`${formatDate(day.date)} · ${day.total}`}>
              <span style={{ height: `${height}%` }} />
              <small>{new Date(`${day.date}T00:00:00`).getDate()}</small>
            </div>
          );
        })}
      </div>
    </div>
  );
}


function ActionButton({
  children,
  disabled = false,
  onClick,
  primary = false
}) {
  return (
    <button
      type="button"
      className={`study-action-button${primary ? " study-action-primary" : ""}`}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}


function OverviewTab({
  onStartTraining,
  setActiveTab,
  setMode,
  summary
}) {
  const counts = summary.counts || {};
  const buckets = summary.buckets || {};
  const activeQuestions = counts.active_questions || 0;
  const trainingScope = scopeToTrainingScope(summary.scope);
  const recommendation = recommendationFor(summary);

  function runRecommendation() {
    if (recommendation.mode) {
      setMode(recommendation.mode);
      return;
    }

    setActiveTab(recommendation.targetTab || "train");
  }

  return (
    <div className="study-tab-grid">
      <section className="study-panel study-overview-main">
        <div className="study-panel-head">
          <h2>Progression</h2>
          <span>{questionCountLabel(counts.total_atomic_questions)}</span>
        </div>

        <div className="study-bucket-grid">
          {BUCKETS.map(bucket => (
            <BucketCard
              bucket={bucket}
              count={buckets[bucket.key]}
              key={bucket.key}
              total={activeQuestions}
            />
          ))}
        </div>
      </section>

      <section className="study-panel study-next-panel">
        <div className="study-panel-head">
          <h2>Prochaine action</h2>
          <span>{scopeTypeLabel(summary.scope)}</span>
        </div>

        <div className="study-recommendation">
          <strong>{recommendation.title}</strong>
          <span>{recommendation.detail}</span>
        </div>

        <div className="study-action-grid">
          <ActionButton primary onClick={runRecommendation}>
            Continuer
          </ActionButton>
          <ActionButton
            disabled={!trainingScope || !onStartTraining}
            onClick={() => onStartTraining?.(trainingScope)}
          >
            Entraîner
          </ActionButton>
          <ActionButton
            disabled={(counts.due_now || 0) <= 0}
            onClick={() => setMode("quiz")}
          >
            Réviser due
          </ActionButton>
          <ActionButton onClick={() => setActiveTab("weak")}>
            Items faibles
          </ActionButton>
        </div>
      </section>

      <div className="study-metric-grid">
        <MetricCard label="Due" value={counts.due_now} tone="due" />
        <MetricCard label="Suspendues" value={counts.suspended} />
        <MetricCard label="Indisponibles" value={counts.unavailable} />
        <MetricCard label="Lapses" value={summary.lapses?.total} tone="risk" />
      </div>

      <UpcomingLoad upcomingLoad={summary.upcoming_load} />
    </div>
  );
}


function TrainingModeButton({
  mode,
  onStartTraining,
  scope
}) {
  const canPassMode = DIRECT_MODE_GROUP_TYPES.has(scope?.type_group);

  return (
    <button
      type="button"
      className="study-mode-button"
      onClick={() => onStartTraining?.(scope, canPassMode ? mode : null)}
    >
      {modeLabel(mode)}
    </button>
  );
}


function TrainingGroupRow({ group, onStartTraining }) {
  const scope = groupToTrainingScope(group);
  const modes = modesForGroup(group);

  return (
    <div className="study-group-row">
      <div className="study-group-copy">
        <span className="study-scope-chip">{group.type_group || "groupe"}</span>
        <strong>{group.name || `Groupe #${group.id}`}</strong>
        <span>{recordLabel(group.training_record || group.previous_training_record)}</span>
      </div>

      <div className="study-group-actions">
        {modes.length > 0 && DIRECT_MODE_GROUP_TYPES.has(group.type_group) ? (
          modes.map(mode => (
            <TrainingModeButton
              group={group}
              key={mode}
              mode={mode}
              onStartTraining={onStartTraining}
              scope={scope}
            />
          ))
        ) : (
          <ActionButton
            disabled={!scope}
            onClick={() => onStartTraining?.(scope)}
          >
            Démarrer
          </ActionButton>
        )}
      </div>
    </div>
  );
}


function TrainTab({ onStartTraining, summary }) {
  const scope = summary.scope;
  const trainingScope = scopeToTrainingScope(scope);
  const groups = summary.training?.groups || [];
  const groupModes = summary.available_modes?.[0]?.training_modes || [];
  const filteredGroupModes = modesForGroup(scope, groupModes);
  const isDirectModeGroup = (
    scope?.type === "group" &&
    DIRECT_MODE_GROUP_TYPES.has(scope.type_group)
  );

  return (
    <div className="study-two-column">
      <section className="study-panel">
        <div className="study-panel-head">
          <h2>Scope actif</h2>
          <span>{recordLabel(summary.training?.training_record || summary.training?.previous_training_record)}</span>
        </div>

        {trainingScope ? (
          <div className="study-mode-grid">
            {isDirectModeGroup && filteredGroupModes.length > 0 ? (
              filteredGroupModes.map(mode => (
                <TrainingModeButton
                  key={mode}
                  mode={mode}
                  onStartTraining={onStartTraining}
                  scope={trainingScope}
                />
              ))
            ) : (
              <ActionButton
                primary
                disabled={!onStartTraining}
                onClick={() => onStartTraining?.(trainingScope)}
              >
                Démarrer l'entraînement
              </ActionButton>
            )}
          </div>
        ) : (
          <div className="study-muted">
            Ce pack se travaille par groupe.
          </div>
        )}
      </section>

      <section className="study-panel">
        <div className="study-panel-head">
          <h2>Groupes</h2>
          <span>{numberLabel(groups.length)}</span>
        </div>

        {groups.length > 0 ? (
          <div className="study-group-list">
            {groups.map(group => (
              <TrainingGroupRow
                group={group}
                key={group.id}
                onStartTraining={onStartTraining}
              />
            ))}
          </div>
        ) : (
          <div className="study-muted">Aucun groupe entraînable dans ce scope.</div>
        )}
      </section>
    </div>
  );
}


function StudyMediaPreview({ item }) {
  const media = learnMediaSource(item);
  const src = resolveMediaUrl(media);
  const kind = getMediaKind(media);

  if (!src) {
    return (
      <div className="study-learn-empty-visual">
        Aucun média
      </div>
    );
  }

  if (kind === "audio") {
    return (
      <div className="study-learn-media-frame study-learn-media-audio">
        <audio controls src={src}>
          Audio non pris en charge.
        </audio>
      </div>
    );
  }

  if (kind === "video") {
    return (
      <div className="study-learn-media-frame">
        <video controls src={src}>
          Vidéo non prise en charge.
        </video>
      </div>
    );
  }

  return (
    <div className="study-learn-media-frame">
      <img alt="Média à apprendre" src={src} />
    </div>
  );
}


function StudyLearnVisual({ activeItem, isRevealed, learn }) {
  if (learn.family === "map") {
    const mapSrc = resolveMediaUrl(learn.group?.media);
    const activeCode = activeItem?.code;

    if (!mapSrc || !activeCode) {
      return (
        <div className="study-learn-empty-visual">
          Carte indisponible
        </div>
      );
    }

    return (
      <div className="study-learn-map-frame">
        <SvgMap
          svgPath={mapSrc}
          found={isRevealed ? [activeCode] : []}
          missed={[]}
          dueItems={[]}
          selected={activeCode}
          focusCode={activeCode}
          focusVersion={activeItem?.id || 0}
          clickableCodes={[]}
          zoneLabels={isRevealed ? { [activeCode]: activeItem.answer } : {}}
        />
      </div>
    );
  }

  return <StudyMediaPreview item={activeItem} />;
}


function LearnHintBlock({
  activeHints,
  activeItem,
  choices,
  isRevealed,
  related,
  scope
}) {
  return (
    <div className="study-learn-hints">
      {activeHints.firstLetter && (
        <div className="study-learn-hint-block">
          <span>Première lettre</span>
          <strong>{firstAnswerLetter(activeItem?.answer)}</strong>
        </div>
      )}

      {activeHints.category && (
        <div className="study-learn-hint-block">
          <span>Catégorie</span>
          <strong>{primaryCategory(activeItem, scope)}</strong>
        </div>
      )}

      {activeHints.choices && (
        <div className="study-learn-hint-block">
          <span>Choix réduits</span>
          <div className="study-learn-choice-row">
            {choices.map(choice => (
              <span
                className={isRevealed && choice.id === activeItem?.id ? "is-correct" : ""}
                key={`${choice.id}-${choice.label}`}
              >
                {choice.label}
              </span>
            ))}
          </div>
        </div>
      )}

      {activeHints.related && (
        <div className="study-learn-hint-block">
          <span>Repères proches</span>
          <div className="study-learn-related-list">
            {related.length > 0 ? related.map(item => (
              <strong key={item.id}>{item.answer}</strong>
            )) : (
              <strong>—</strong>
            )}
          </div>
        </div>
      )}
    </div>
  );
}


function LearnTab({ onStartTraining, setActiveTab, setMode, summary }) {
  const buckets = summary.buckets || {};
  const counts = summary.counts || {};
  const trainingScope = scopeToTrainingScope(summary.scope);
  const learn = summary.learn || {};
  const items = useMemo(
    () => (Array.isArray(learn.items) ? learn.items : []),
    [learn.items]
  );
  const [activeIndex, setActiveIndex] = useState(0);
  const [revealedItemIds, setRevealedItemIds] = useState(() => new Set());
  const [hintsByItemId, setHintsByItemId] = useState({});
  const maxIndex = Math.max(items.length - 1, 0);
  const safeActiveIndex = Math.min(activeIndex, maxIndex);
  const activeItem = items[safeActiveIndex] || null;
  const activeItemId = activeItem?.id;
  const isRevealed = activeItemId !== undefined && revealedItemIds.has(activeItemId);
  const activeHints = activeItemId !== undefined ? (hintsByItemId[activeItemId] || {}) : {};
  const choices = useMemo(
    () => buildLearnChoices(items, safeActiveIndex),
    [items, safeActiveIndex]
  );
  const related = useMemo(
    () => relatedLearnItems(items, safeActiveIndex),
    [items, safeActiveIndex]
  );

  useEffect(() => {
    setActiveIndex(0);
    setRevealedItemIds(new Set());
    setHintsByItemId({});
  }, [learn.family, learn.item_count, summary.scope?.id, summary.scope?.type]);

  function selectLearnItem(index) {
    setActiveIndex(Math.min(Math.max(index, 0), maxIndex));
  }

  function toggleReveal() {
    if (activeItemId === undefined) return;

    setRevealedItemIds(previous => {
      const next = new Set(previous);

      if (next.has(activeItemId)) {
        next.delete(activeItemId);
      } else {
        next.add(activeItemId);
      }

      return next;
    });
  }

  function toggleHint(key) {
    if (activeItemId === undefined) return;

    setHintsByItemId(previous => ({
      ...previous,
      [activeItemId]: {
        ...(previous[activeItemId] || {}),
        [key]: !(previous[activeItemId] || {})[key]
      }
    }));
  }

  if (!learn.supported || !LEARN_SUPPORTED_FAMILIES.has(learn.family)) {
    return (
      <div className="study-two-column">
        <section className="study-panel study-learn-panel">
          <div className="study-panel-head">
            <h2>Nouveaux items</h2>
            <span>{questionCountLabel(buckets.unseen)}</span>
          </div>

          <div className="study-large-number">{numberLabel(buckets.unseen || 0)}</div>
          <div className="study-muted">
            {questionCountLabel(counts.active_questions)} actives dans ce scope.
          </div>

          <div className="study-action-row">
            <ActionButton
              primary
              disabled={!trainingScope || !onStartTraining}
              onClick={() => onStartTraining?.(trainingScope)}
            >
              Entraîner le scope
            </ActionButton>
            <ActionButton onClick={() => setActiveTab("weak")}>
              Voir les fragiles
            </ActionButton>
          </div>
        </section>

        <section className="study-panel">
          <div className="study-panel-head">
            <h2>Modes disponibles</h2>
            <span>{numberLabel(summary.available_modes?.length || 0)}</span>
          </div>
          <div className="study-mode-summary-list">
            {(summary.available_modes || []).map((entry, index) => (
              <div className="study-mode-summary" key={`${entry.scope}-${entry.type_q}-${index}`}>
                <strong>{entry.type_group || entry.type_q || entry.scope}</strong>
                <span>
                  {(entry.training_modes || []).map(modeLabel).join(" · ") || "Lecture seule"}
                </span>
              </div>
            ))}
          </div>
        </section>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <section className="study-panel study-learn-panel">
        <div className="study-panel-head">
          <h2>Parcours guidé</h2>
          <span>{learnFamilyLabel(learn.family)}</span>
        </div>
        <div className="study-muted">
          Aucun item prêt à apprendre dans ce groupe.
        </div>
      </section>
    );
  }

  return (
    <div className="study-learn-layout">
      <section className="study-panel study-learn-workspace">
        <div className="study-panel-head">
          <h2>Parcours guidé</h2>
          <span>
            {safeActiveIndex + 1} / {numberLabel(learn.item_count || items.length)}
          </span>
        </div>

        <div className="study-learn-stage">
          <StudyLearnVisual
            activeItem={activeItem}
            isRevealed={isRevealed}
            learn={learn}
          />

          <div className="study-learn-card">
            <div className="study-chip-row">
              <span className="study-scope-chip">{learnFamilyLabel(learn.family)}</span>
              <span className="study-signal-chip study-signal-neutral">Lecture seule</span>
              {activeItem?.signals?.bucket && (
                <span className="study-signal-chip study-signal-neutral">
                  {activeItem.signals.bucket}
                </span>
              )}
            </div>

            <h3>{isRevealed ? activeItem.answer : "Réponse masquée"}</h3>
            <div className="study-learn-meta">
              {learn.family === "map" && activeItem?.code && (
                <span>Zone {activeItem.code}</span>
              )}
              {learn.family === "media" && (
                <span>{getMediaKind(learnMediaSource(activeItem)) || "media"}</span>
              )}
              {activeItem?.aliases?.length > 0 && isRevealed && (
                <span>{activeItem.aliases.join(" · ")}</span>
              )}
            </div>

            <LearnHintBlock
              activeHints={activeHints}
              activeItem={activeItem}
              choices={choices}
              isRevealed={isRevealed}
              related={related}
              scope={summary.scope}
            />

            <div className="study-action-row">
              <ActionButton onClick={() => toggleHint("firstLetter")}>
                Première lettre
              </ActionButton>
              <ActionButton onClick={() => toggleHint("category")}>
                Catégorie
              </ActionButton>
              <ActionButton onClick={() => toggleHint("choices")}>
                Choix
              </ActionButton>
              <ActionButton onClick={() => toggleHint("related")}>
                Repères
              </ActionButton>
              <ActionButton primary onClick={toggleReveal}>
                {isRevealed ? "Masquer" : "Révéler la réponse"}
              </ActionButton>
            </div>
          </div>
        </div>

        <div className="study-learn-navigation">
          <ActionButton
            disabled={safeActiveIndex <= 0}
            onClick={() => selectLearnItem(safeActiveIndex - 1)}
          >
            Précédent
          </ActionButton>
          <ActionButton
            disabled={safeActiveIndex >= items.length - 1}
            onClick={() => selectLearnItem(safeActiveIndex + 1)}
          >
            Suivant
          </ActionButton>
          <ActionButton
            disabled={!trainingScope || !onStartTraining}
            onClick={() => onStartTraining?.(trainingScope)}
          >
            Entraîner
          </ActionButton>
          <ActionButton
            disabled={(counts.due_now || 0) <= 0}
            onClick={() => setMode("quiz")}
          >
            Réviser due
          </ActionButton>
        </div>
      </section>

      <section className="study-panel study-learn-index-panel">
        <div className="study-panel-head">
          <h2>Items</h2>
          <span>{questionCountLabel(learn.item_count || items.length)}</span>
        </div>
        <div className="study-learn-index app-scrollbar" aria-label="Items à apprendre">
          {items.map((item, index) => (
            <button
              type="button"
              aria-current={index === safeActiveIndex ? "true" : undefined}
              className={index === safeActiveIndex ? "is-active" : ""}
              key={item.id}
              onClick={() => selectLearnItem(index)}
            >
              <span>{index + 1}</span>
              <strong>
                {learnItemButtonLabel(
                  item,
                  index,
                  learn.family,
                  revealedItemIds.has(item.id)
                )}
              </strong>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}


function SignalChips({ signals }) {
  const chips = [];

  if (signals?.due) chips.push(["Due", "due"]);
  if ((signals?.recent_misses || 0) > 0) {
    chips.push([`${signals.recent_misses} erreur${signals.recent_misses > 1 ? "s" : ""}`, "risk"]);
  }
  if ((signals?.lapses || 0) > 0) {
    chips.push([`${signals.lapses} lapse${signals.lapses > 1 ? "s" : ""}`, "risk"]);
  }
  if (signals?.bucket) chips.push([signals.bucket, "neutral"]);

  return (
    <div className="study-chip-row">
      {chips.map(([label, tone]) => (
        <span className={`study-signal-chip study-signal-${tone}`} key={label}>
          {label}
        </span>
      ))}
    </div>
  );
}


function WeakItemRow({ item, onStartTraining }) {
  const groupScope = item.group ? groupToTrainingScope(item.group) : null;
  const title = item.answer || item.question || `Question #${item.id}`;

  return (
    <div className="study-item-row">
      <div className="study-item-copy">
        <strong>{title}</strong>
        <span>
          {item.group?.name || item.type_q || "question"}
          {item.signals?.next_review ? ` · ${formatDate(item.signals.next_review)}` : ""}
        </span>
        <SignalChips signals={item.signals} />
      </div>

      {groupScope && (
        <ActionButton onClick={() => onStartTraining?.(groupScope)}>
          Entraîner groupe
        </ActionButton>
      )}
    </div>
  );
}


function PracticeEntryPanel({ onStartTraining, summary }) {
  const entries = summary.practice?.entry_points || [];

  if (entries.length === 0) return null;

  return (
    <section className="study-panel study-practice-panel">
      <div className="study-panel-head">
        <h2>Pratique ciblée</h2>
        <span>{numberLabel(entries.filter(entry => entry.enabled).length)}</span>
      </div>

      <div className="study-practice-grid">
        {entries.map(entry => {
          const practiceScope = practiceScopeFromEntry(entry, summary);

          return (
            <button
              type="button"
              className="study-practice-button"
              disabled={!entry.enabled || !practiceScope || !onStartTraining}
              key={entry.id}
              onClick={() => onStartTraining?.(practiceScope)}
            >
              <strong>{entry.label}</strong>
              <span>{questionCountLabel(entry.count)}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}


function WeakItemsTab({ onStartTraining, summary }) {
  const weakItems = summary.weak_items || [];
  const recentItems = summary.recent_misses?.items || [];

  return (
    <div className="study-weak-layout">
      <PracticeEntryPanel
        onStartTraining={onStartTraining}
        summary={summary}
      />

      <div className="study-two-column">
        <section className="study-panel">
          <div className="study-panel-head">
            <h2>Items faibles</h2>
            <span>{numberLabel(weakItems.length)}</span>
          </div>

          {weakItems.length > 0 ? (
            <div className="study-item-list">
              {weakItems.map(item => (
                <WeakItemRow
                  item={item}
                  key={item.id}
                  onStartTraining={onStartTraining}
                />
              ))}
            </div>
          ) : (
            <div className="study-muted">Aucun item faible détecté.</div>
          )}
        </section>

        <section className="study-panel">
          <div className="study-panel-head">
            <h2>Erreurs récentes</h2>
            <span>{numberLabel(summary.recent_misses?.event_count || 0)}</span>
          </div>

          {recentItems.length > 0 ? (
            <div className="study-item-list">
              {recentItems.map(item => (
                <WeakItemRow
                  item={item}
                  key={item.id}
                  onStartTraining={onStartTraining}
                />
              ))}
            </div>
          ) : (
            <div className="study-muted">Aucune erreur récente.</div>
          )}
        </section>
      </div>
    </div>
  );
}


function ConfusionRow({ item, onStartTraining, summary }) {
  const expected = item.expected?.answer || item.expected?.question || `#${item.expected_id}`;
  const selected = item.selected?.answer || item.selected?.question || `#${item.selected_id}`;
  const practiceScope = practiceScopeForIds(
    `Confusion · ${expected} / ${selected}`,
    [item.expected_id, item.selected_id],
    summary,
    CONFUSION_PRACTICE_MODES
  );

  return (
    <div className="study-confusion-row">
      <div>
        <span>Attendu</span>
        <strong>{expected}</strong>
      </div>
      <div>
        <span>Choisi</span>
        <strong>{selected}</strong>
      </div>
      <div>
        <span>Fois</span>
        <strong>{numberLabel(item.count)}</strong>
      </div>
      <ActionButton
        disabled={!practiceScope || !onStartTraining}
        onClick={() => onStartTraining?.(practiceScope)}
      >
        Entraîner paire
      </ActionButton>
    </div>
  );
}


function HistoryTab({ onStartTraining, summary }) {
  const confusions = summary.confusions?.items || [];
  const record = summary.training?.training_record;
  const previousRecord = summary.training?.previous_training_record;

  return (
    <div className="study-two-column">
      <section className="study-panel">
        <div className="study-panel-head">
          <h2>Confusions</h2>
          <span>{numberLabel(summary.confusions?.event_count || 0)}</span>
        </div>

        {confusions.length > 0 ? (
          <div className="study-confusion-list">
            {confusions.map(item => (
              <ConfusionRow
                item={item}
                key={`${item.expected_id}-${item.selected_id}`}
                onStartTraining={onStartTraining}
                summary={summary}
              />
            ))}
          </div>
        ) : (
          <div className="study-muted">Aucune confusion récente.</div>
        )}
      </section>

      <section className="study-panel">
        <div className="study-panel-head">
          <h2>Records</h2>
          <span>{record ? "Actuel" : previousRecord ? "Ancien" : "—"}</span>
        </div>

        <div className="study-record-grid">
          <MetricCard label="Score" value={record?.best_found_percent ?? previousRecord?.best_found_percent ?? 0} />
          <div className="study-record-card">
            <span>Temps</span>
            <strong>{formatDuration(record?.best_time_ms || previousRecord?.best_time_ms)}</strong>
          </div>
        </div>

        {previousRecord && !record && (
          <div className="study-muted">
            Record issu d'un contenu modifié.
          </div>
        )}
      </section>
    </div>
  );
}


function StudyContent({
  activeTab,
  onStartTraining,
  setActiveTab,
  setMode,
  summary
}) {
  if (activeTab === "learn") {
    return (
      <LearnTab
        onStartTraining={onStartTraining}
        setActiveTab={setActiveTab}
        setMode={setMode}
        summary={summary}
      />
    );
  }

  if (activeTab === "train") {
    return <TrainTab onStartTraining={onStartTraining} summary={summary} />;
  }

  if (activeTab === "weak") {
    return <WeakItemsTab onStartTraining={onStartTraining} summary={summary} />;
  }

  if (activeTab === "history") {
    return (
      <HistoryTab
        onStartTraining={onStartTraining}
        summary={summary}
      />
    );
  }

  return (
    <OverviewTab
      onStartTraining={onStartTraining}
      setActiveTab={setActiveTab}
      setMode={setMode}
      summary={summary}
    />
  );
}


export default function StudyScreen({
  onStartTraining = null,
  scope,
  setMode
}) {
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState("overview");
  const [reloadNonce, setReloadNonce] = useState(0);
  const scopeKey = useMemo(() => stableScopeKey(scope), [scope]);

  useEffect(() => {
    if (!scopeKey || !scope) {
      setSummary(null);
      return undefined;
    }

    let cancelled = false;

    setLoading(true);
    setError("");

    getStudySummary(scope)
      .then((nextSummary) => {
        if (cancelled) return;

        setSummary(nextSummary);
        setLoading(false);
      })
      .catch((loadError) => {
        console.error(loadError);

        if (!cancelled) {
          setError(loadError.message || "Impossible de charger Study.");
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [reloadNonce, scope, scopeKey]);

  useEffect(() => {
    setActiveTab("overview");
  }, [scopeKey]);

  if (!scope) {
    return <EmptyStudy setMode={setMode} />;
  }

  const displayScope = summary?.scope || scope;

  return (
    <div className="study-screen">
      <div className="study-shell">
        <header className="study-header">
          <div className="study-title-block">
            <div className="study-overline">Study · {scopeTypeLabel(displayScope)}</div>
            <h1>{scopeTitle(displayScope)}</h1>
            <p>
              {summary
                ? `${questionCountLabel(summary.counts?.total_atomic_questions)} · ${formatDate(summary.generated_on)}`
                : "Chargement"}
            </p>
          </div>

          <ReturnToMenuButton onClick={() => setMode("menu")} className="study-back" />
        </header>

        {loading && (
          <div className="study-state-panel">Chargement du scope...</div>
        )}

        {!loading && error && (
          <div className="study-state-panel study-error-panel" role="alert">
            <strong>{error}</strong>
            <button type="button" onClick={() => setReloadNonce(value => value + 1)}>
              Réessayer
            </button>
          </div>
        )}

        {!loading && !error && summary && (
          <>
            <nav className="study-tabs" role="tablist" aria-label="Study">
              {TABS.map(tab => (
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTab === tab.id}
                  className={activeTab === tab.id ? "is-active" : ""}
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                >
                  {tab.label}
                </button>
              ))}
            </nav>

            <main className="study-content app-scrollbar" role="tabpanel">
              <StudyContent
                activeTab={activeTab}
                onStartTraining={onStartTraining}
                setActiveTab={setActiveTab}
                setMode={setMode}
                summary={summary}
              />
            </main>
          </>
        )}
      </div>
    </div>
  );
}
