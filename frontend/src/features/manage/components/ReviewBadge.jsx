function startOfToday() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today;
}

function parseReviewDate(value) {
  if (!value) return null;

  const dateOnly = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  const date = dateOnly
    ? new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]))
    : new Date(value);

  if (Number.isNaN(date.getTime())) return null;

  date.setHours(0, 0, 0, 0);
  return date;
}

function getReviewState(progress) {
  if (!progress) {
    return {
      label: "New",
      tone: "new",
      date: null,
      daysUntil: null
    };
  }

  const reps = progress.reps || 0;
  const reviewDate = parseReviewDate(progress.next_review);

  if (reps === 0) {
    return {
      label: "New",
      tone: "new",
      date: reviewDate,
      daysUntil: 0
    };
  }

  if (!reviewDate) {
    return {
      label: "No",
      tone: "quiet",
      date: null,
      daysUntil: null
    };
  }

  const daysUntil = Math.ceil(
    (reviewDate.getTime() - startOfToday().getTime()) / 86400000
  );

  if (daysUntil <= 0) {
    return {
      label: "Due",
      tone: "due",
      date: reviewDate,
      daysUntil
    };
  }

  if (daysUntil === 1) {
    return {
      label: "1d",
      tone: "scheduled",
      date: reviewDate,
      daysUntil
    };
  }

  return {
    label: `${daysUntil}d`,
    tone: "scheduled",
    date: reviewDate,
    daysUntil
  };
}

function getToneStyle(tone) {
  if (tone === "due") {
    return {
      background: "#3a211c",
      borderColor: "#613025",
      primary: "#ff9a7a",
      secondary: "#b87968"
    };
  }

  if (tone === "new") {
    return {
      background: "#1b2b32",
      borderColor: "#25414b",
      primary: "#82d6f4",
      secondary: "#77a6b5"
    };
  }

  return {
    background: "#202020",
    borderColor: "#303030",
    primary: "#d0d0d0",
    secondary: "#777"
  };
}

export default function ReviewBadge({ progress }) {
  const reviewState = getReviewState(progress);
  const tone = getToneStyle(reviewState.tone);

  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: "42px",
        minWidth: "42px",
        height: "20px",
        padding: "0 6px",
        borderRadius: "999px",
        border: `1px solid ${tone.borderColor}`,
        background: tone.background,
        boxSizing: "border-box",
        overflow: "hidden"
      }}
    >
      <span
        style={{
          color: tone.primary,
          fontSize: "10px",
          fontWeight: 700,
          lineHeight: "18px",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap"
        }}
      >
        {reviewState.label}
      </span>
    </div>
  );
}
