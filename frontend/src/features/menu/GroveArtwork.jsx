import NemorisPlantArtwork from "./NemorisPlantArtwork";
import "./GroveArtwork.css";

const ARIA_LABEL = "Illustration animée de la plante Nemoris";

const STAGE_BY_KEY = {
  dormant: 0,
  seedling: 1,
  sprout: 3,
  young_grove: 7,
  grove: 14,
  canopy: 30,
  forest: 60,
  ancient_forest: 100,
  sanctuary: 100
};

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function numberFrom(value, fallback = 0) {
  const parsed = Number(value);

  return Number.isFinite(parsed) ? parsed : fallback;
}

function stageFromStatus(status) {
  const key = status?.grove_stage?.key;

  if (key && key in STAGE_BY_KEY) return STAGE_BY_KEY[key];

  const streak = numberFrom(status?.current_streak, 0);

  if (streak >= 100) return 100;
  if (streak >= 60) return 60;
  if (streak >= 30) return 30;
  if (streak >= 14) return 14;
  if (streak >= 7) return 7;
  if (streak >= 3) return 3;
  if (streak >= 1) return 1;

  return 0;
}

function classNames(...values) {
  return values.filter(Boolean).join(" ");
}

function AmbientDrops({ show }) {
  if (!show) return null;

  return (
    <div className="grove-art-drops" aria-hidden="true">
      {[0, 1, 2, 3].map((index) => (
        <span
          className="grove-art-drop"
          key={index}
          style={{
            animationDelay: `${index * 0.16}s`,
            left: `${37 + index * 8}%`
          }}
        />
      ))}
    </div>
  );
}

function DueMarker({ show }) {
  if (!show) return null;

  return (
    <div className="grove-art-due-marker" aria-hidden="true">
      <span />
    </div>
  );
}

function ErrorMark({ show }) {
  if (!show) return null;

  return (
    <div className="grove-art-error-cloud" aria-hidden="true">
      !
    </div>
  );
}

function BloomBurst({ show }) {
  if (!show) return null;

  const sparks = [
    ["20%", "24%"],
    ["76%", "28%"],
    ["28%", "62%"],
    ["69%", "66%"],
    ["50%", "14%"],
    ["48%", "74%"]
  ];

  return (
    <div className="grove-art-bloom" aria-hidden="true">
      {sparks.map(([left, top], index) => (
        <span
          className="grove-art-bloom-spark"
          key={index}
          style={{
            animationDelay: `${index * 0.14}s`,
            left,
            top
          }}
        />
      ))}
    </div>
  );
}

export default function GroveArtwork({
  status,
  loading = false,
  checking = false,
  error = false,
  celebrating = false,
  className = ""
}) {
  const stage = stageFromStatus(status);
  const capacity = clamp(numberFrom(status?.shield_capacity, 0), 0, 3);
  const activeLeaves = clamp(numberFrom(status?.rest_leaves, 0), 0, capacity);
  const fallenLeaves = clamp(numberFrom(status?.fallen_leaves, 0), 0, 3);
  const growthPercent = clamp(numberFrom(status?.shield_growth?.percent, 0), 0, 100);
  const shieldEventType = status?.shield_event?.type;
  const dueCount = numberFrom(status?.due_count, 0);
  const isEligible = Boolean(status?.eligible);
  const isComplete = Boolean(status?.today_complete);
  const showMilestone = Boolean(status?.milestone_reached || celebrating);
  const showWatering = checking || (isEligible && !isComplete);
  const showRegrowing = activeLeaves < capacity && (
    Boolean(status?.shield_growth?.growing) ||
    growthPercent > 0 ||
    fallenLeaves > 0
  );

  const rootClassName = classNames(
    "grove-art",
    "grove-art-plant-scene",
    loading && "grove-art-loading",
    checking && "grove-art-checking",
    error && "grove-art-error",
    isComplete && "grove-art-complete",
    isEligible && "grove-art-eligible",
    dueCount > 0 && !isComplete && "grove-art-due",
    showMilestone && "grove-art-milestone",
    celebrating && "grove-art-celebrating",
    shieldEventType && `grove-art-shield-${shieldEventType}`,
    className
  );

  const plantClassName = classNames(
    "grove-art-plant",
    showMilestone && "is-growing is-blooming",
    shieldEventType === "regrown" && "is-shield-regrown",
    shieldEventType === "growth" && "is-shield-growing",
    (shieldEventType === "protected" || shieldEventType === "broken") && "is-shield-falling"
  );

  return (
    <div className={rootClassName} role="img" aria-label={ARIA_LABEL}>
      <div className="grove-art-ambient" aria-hidden="true" />
      <AmbientDrops show={showWatering} />
      <DueMarker show={dueCount > 0 && !isComplete} />
      <ErrorMark show={Boolean(error)} />
      <BloomBurst show={showMilestone} />

      <NemorisPlantArtwork
        stage={stage}
        shieldLeaves={activeLeaves}
        shieldCapacity={capacity}
        fallenLeaves={fallenLeaves}
        growthPercent={growthPercent}
        showRegrowing={showRegrowing}
        title={null}
        className={plantClassName}
      />
    </div>
  );
}
