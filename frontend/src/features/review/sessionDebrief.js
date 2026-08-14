export const REVIEW_TYPE_LABELS = {
  cloze: "Texte à trous",
  enumeration: "Énumération",
  grid: "Grille",
  map: "Carte",
  media: "Média",
  numeric: "Numérique",
  sequence: "Séquence",
  set: "Ensemble",
  text: "Texte",
  timeline: "Chronologie"
};

const POSITIVE_STATUSES = new Set(["success", "hard"]);

function firstDefined(...values) {
  return values.find(value => value !== undefined && value !== null);
}

function numberOrNull(value) {
  const number = Number(value);

  return Number.isFinite(number) ? number : null;
}

function questionIdFor(item) {
  return numberOrNull(item?.question_id ?? item?.id);
}

function dateKey(value) {
  if (!value) return null;

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return [
      value.getFullYear(),
      String(value.getMonth() + 1).padStart(2, "0"),
      String(value.getDate()).padStart(2, "0")
    ].join("-");
  }

  const match = String(value).match(/^(\d{4}-\d{2}-\d{2})/);

  return match ? match[1] : null;
}

function addDaysKey(key, days) {
  const [year, month, day] = String(key || "").split("-").map(Number);

  if (!year || !month || !day) return null;

  const date = new Date(year, month - 1, day);
  date.setDate(date.getDate() + days);

  return dateKey(date);
}

function latestHistory(progress) {
  const history = Array.isArray(progress?.history) ? progress.history : [];

  return history.length ? history[history.length - 1] : null;
}

function previousMissCount(progress) {
  return (progress?.history || []).filter(entry =>
    Number(entry?.quality) === 0
  ).length;
}

function presentationItems(presentation) {
  if (Array.isArray(presentation?.items)) {
    return presentation.items;
  }

  return questionIdFor(presentation) !== null ? [presentation] : [];
}

function resultRows(response) {
  if (Array.isArray(response?.items)) return response.items;
  if (Array.isArray(response?.results)) return response.results;

  return response ? [response] : [];
}

function labelForItem(item, fallbackId) {
  return firstDefined(
    item?.label,
    item?.answer,
    item?.question,
    fallbackId !== null ? `Question ${fallbackId}` : "Question"
  );
}

function promptForItem(item) {
  return firstDefined(item?.question, item?.label, item?.answer, "");
}

function statusForResult(typeQ, row, progress, fallbackQuality) {
  const history = latestHistory(progress);
  const quality = numberOrNull(firstDefined(
    row?.effective_quality,
    row?.quality,
    history?.effective_quality,
    history?.quality,
    fallbackQuality
  ));
  const userMarkedClose = Boolean(firstDefined(
    row?.user_marked_close,
    history?.user_marked_close,
    history?.answer_event?.context?.user_marked_close
  ));
  const backendMatched = firstDefined(
    row?.backend_matched,
    history?.backend_matched,
    history?.answer_event?.context?.backend_matched
  );

  if (row?.status === "unattempted" || quality === null) return "unattempted";
  if (typeQ === "timeline" && quality === 1) return "close";
  if (userMarkedClose) return "close";
  if (row?.correct === false && !userMarkedClose) return "miss";
  if (backendMatched === false && quality <= 0) return "miss";
  if (quality <= 0) return "miss";
  if (quality === 1) return "hard";

  return "success";
}

function selectedConfusionLabel(event, itemById) {
  const expectedId = numberOrNull(event?.expected_card_id);
  const selectedId = numberOrNull(event?.resolved_response_id);

  if (expectedId === null || selectedId === null || selectedId === expectedId) {
    return null;
  }

  const selected = itemById.get(selectedId);

  return labelForItem(selected, selectedId);
}

export function createReviewResultRecords({
  attemptKey,
  presentation,
  response,
  submittedQualities = {},
  reviewDate = null
}) {
  const items = presentationItems(presentation);
  const contextItems = Array.isArray(presentation?.context_items)
    ? presentation.context_items
    : [];
  const labelItems = [...items, ...contextItems];
  const itemById = new Map(
    labelItems
      .map(item => [questionIdFor(item), item])
      .filter(([id]) => id !== null)
  );
  const scheduledItemById = new Map(
    items
      .map(item => [questionIdFor(item), item])
      .filter(([id]) => id !== null)
  );
  const rows = resultRows(response);
  const rowById = new Map(
    rows
      .map(row => [
        questionIdFor(row) ?? questionIdFor(presentation),
        row
      ])
      .filter(([id]) => id !== null)
  );
  const ids = new Set([
    ...Object.keys(submittedQualities || {}).map(Number),
    ...scheduledItemById.keys(),
    ...rowById.keys()
  ]);

  if (ids.size === 0 && questionIdFor(presentation) !== null) {
    ids.add(questionIdFor(presentation));
  }

  return [...ids]
    .map(questionId => {
      const item = scheduledItemById.get(questionId) || (
        questionIdFor(presentation) === questionId ? presentation : null
      );
      const row = rowById.get(questionId) || {};

      if (!item && !row) return null;
      if (row.scheduled === false) return null;

      const typeQ = firstDefined(
        row.type_q,
        presentation?.type_q,
        item?.type_q
      );
      const progress = row.progress || (
        questionIdFor(presentation) === questionId ? response?.progress : null
      );
      const history = latestHistory(progress);
      const answerEvent = history?.answer_event || null;
      const quality = numberOrNull(firstDefined(
        row.effective_quality,
        row.quality,
        history?.effective_quality,
        history?.quality,
        submittedQualities?.[questionId],
        submittedQualities?.[String(questionId)]
      ));
      const status = statusForResult(
        typeQ,
        row,
        progress,
        firstDefined(
          submittedQualities?.[questionId],
          submittedQualities?.[String(questionId)]
        )
      );
      const previousProgress = item?.progress || null;
      const previousInterval = numberOrNull(previousProgress?.interval);
      const nextInterval = numberOrNull(progress?.interval);
      const previousNextReview = dateKey(previousProgress?.next_review);
      const nextReview = dateKey(progress?.next_review || history?.next_review);
      const selectedLabel = selectedConfusionLabel(answerEvent, itemById);

      return {
        attemptKey: `${attemptKey || "attempt"}:${questionId}`,
        questionId,
        type_q: typeQ || "text",
        typeLabel: REVIEW_TYPE_LABELS[typeQ] || typeQ || "Question",
        presentationKind: firstDefined(
          presentation?.presentation_kind,
          answerEvent?.presentation_kind,
          "single_card"
        ),
        groupId: firstDefined(presentation?.group_id, item?.group_id, null),
        groupName: firstDefined(presentation?.name, null),
        label: labelForItem(item || row, questionId),
        prompt: promptForItem(item || row),
        expected: firstDefined(
          row.expected,
          answerEvent?.expected_value,
          item?.answer,
          item?.label,
          ""
        ),
        quality,
        status,
        previousMissCount: previousMissCount(previousProgress),
        previousInterval,
        nextInterval,
        previousNextReview,
        nextReview,
        reviewDate: dateKey(reviewDate),
        answerEvent,
        confusion: selectedLabel
          ? {
            expected: labelForItem(item || row, questionId),
            selected: selectedLabel
          }
          : null
      };
    })
    .filter(Boolean);
}

function emptyStats(key, label) {
  return {
    key,
    label,
    total: 0,
    success: 0,
    close: 0,
    miss: 0,
    unattempted: 0
  };
}

function addRecordToStats(stats, record) {
  stats.total += 1;

  if (POSITIVE_STATUSES.has(record.status)) {
    stats.success += 1;
  } else if (record.status === "close") {
    stats.close += 1;
  } else if (record.status === "miss") {
    stats.miss += 1;
  } else {
    stats.unattempted += 1;
  }
}

function sortStats(a, b) {
  if (b.miss !== a.miss) return b.miss - a.miss;
  if (b.close !== a.close) return b.close - a.close;
  if (b.total !== a.total) return b.total - a.total;

  return String(a.label).localeCompare(String(b.label));
}

function recommendationFor(summary) {
  if (summary.skippedRetryCount > 0) {
    return {
      label: "Travailler les erreurs",
      mode: "training",
      text: `${summary.skippedRetryCount} question${summary.skippedRetryCount > 1 ? "s" : ""} en réapprentissage ont été laissées de côté.`
    };
  }

  if (summary.recurringMisses.length > 0) {
    return {
      label: "Travailler les erreurs",
      mode: "training",
      text: `Commence par ${summary.recurringMisses.length} erreur${summary.recurringMisses.length > 1 ? "s" : ""} récurrente${summary.recurringMisses.length > 1 ? "s" : ""}.`
    };
  }

  if (summary.newMisses.length > 0) {
    return {
      label: "Revoir les ratés",
      mode: "training",
      text: `Reprends ${summary.newMisses.length} nouveau${summary.newMisses.length > 1 ? "x" : ""} raté${summary.newMisses.length > 1 ? "s" : ""} tant que c'est frais.`
    };
  }

  if (summary.tomorrowCount > 0) {
    return {
      label: "Voir le calendrier",
      mode: "calendar",
      text: `${summary.tomorrowCount} question${summary.tomorrowCount > 1 ? "s" : ""} reviennent demain.`
    };
  }

  if (summary.completedCount === 0) {
    return {
      label: "Retour au menu",
      mode: "menu",
      text: "Rien n'était dû dans cette session."
    };
  }

  return {
    label: "Retour au menu",
    mode: "menu",
    text: "Aucune erreur à reprendre immédiatement."
  };
}

export function buildSessionDebrief({
  records = [],
  reviewDate = null,
  skippedRetryCount = 0
} = {}) {
  const cleanRecords = records.filter(Boolean);
  const completedRecords = cleanRecords.filter(
    record => record.status !== "unattempted"
  );
  const typeStats = new Map();
  const groupStats = new Map();
  const tomorrow = addDaysKey(dateKey(reviewDate) || dateKey(new Date()), 1);

  cleanRecords.forEach(record => {
    const typeKey = record.type_q || "text";
    if (!typeStats.has(typeKey)) {
      typeStats.set(typeKey, emptyStats(typeKey, record.typeLabel));
    }
    addRecordToStats(typeStats.get(typeKey), record);

    const groupKey = record.groupId !== null && record.groupId !== undefined
      ? `group:${record.groupId}`
      : `single:${record.type_q}`;
    const groupLabel = record.groupName || record.typeLabel;

    if (!groupStats.has(groupKey)) {
      groupStats.set(groupKey, emptyStats(groupKey, groupLabel));
    }
    addRecordToStats(groupStats.get(groupKey), record);
  });

  const missedRecords = cleanRecords.filter(record => record.status === "miss");
  const newMisses = missedRecords.filter(record => record.previousMissCount === 0);
  const recurringMisses = missedRecords.filter(record => record.previousMissCount > 0);
  const closeRecords = cleanRecords.filter(record => record.status === "close");
  const successfulRecords = cleanRecords.filter(record =>
    POSITIVE_STATUSES.has(record.status)
  );
  const intervalChanges = cleanRecords.filter(record =>
    record.previousInterval !== null &&
    record.nextInterval !== null &&
    record.previousInterval !== record.nextInterval
  );
  const tomorrowRecords = cleanRecords.filter(record => record.nextReview === tomorrow);
  const confusions = cleanRecords
    .filter(record => record.confusion)
    .map(record => ({
      questionId: record.questionId,
      expected: record.confusion.expected,
      selected: record.confusion.selected,
      typeLabel: record.typeLabel,
      groupName: record.groupName
    }));
  const summary = {
    records: cleanRecords,
    completedCount: completedRecords.length,
    successCount: successfulRecords.length,
    closeCount: closeRecords.length,
    missCount: missedRecords.length,
    newMisses,
    recurringMisses,
    intervalChanges,
    tomorrow,
    tomorrowCount: tomorrowRecords.length,
    tomorrowRecords,
    confusions,
    skippedRetryCount,
    typeStats: [...typeStats.values()].sort(sortStats),
    groupStats: [...groupStats.values()].sort(sortStats)
  };

  return {
    ...summary,
    recommendation: recommendationFor(summary)
  };
}

export function formatQualityLabel(record) {
  if (record.status === "unattempted") return "Non répondu";
  if (record.status === "close") return "Proche";

  return {
    0: "Faux",
    1: "Dur",
    2: record.type_q === "timeline" ? "Exact" : "Bon",
    3: "Facile"
  }[record.quality] || "Noté";
}

export function formatIntervalChange(record) {
  const before = record.previousInterval;
  const after = record.nextInterval;

  if (before === null || after === null) return "Intervalle mis à jour";

  return `${before} j -> ${after} j`;
}
