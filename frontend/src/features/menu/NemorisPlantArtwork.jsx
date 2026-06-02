import stage0Image from "./assets/nemoris/stages/1_dormant_seed.png";
import stage1Image from "./assets/nemoris/stages/2_young_sprout.png";
import stage3Image from "./assets/nemoris/stages/3_first_bud.png";
import stage7Image from "./assets/nemoris/stages/4_medium_plant.png";
import stage14Image from "./assets/nemoris/stages/5_larger_plant.png";
import stage30Image from "./assets/nemoris/stages/6_open_flower.png";
import stage60Image from "./assets/nemoris/stages/7_richer_flower.png";
import stage100Image from "./assets/nemoris/stages/8_final_rare_flower.png";
import shieldBudImage from "./assets/nemoris/shields/bud.png";
import fallenLeafImage from "./assets/nemoris/shields/fallen_leaf.png";
import shieldLeafImage from "./assets/nemoris/shields/full_leaf.png";
import "./NemorisPlantArtwork.css";

const STAGES = [0, 1, 3, 7, 14, 30, 60, 100];

const STAGE_IMAGES = {
  0: stage0Image,
  1: stage1Image,
  3: stage3Image,
  7: stage7Image,
  14: stage14Image,
  30: stage30Image,
  60: stage60Image,
  100: stage100Image
};

const SHIELD_SLOTS = [
  {
    left: "37%",
    top: "57%",
    width: "16%",
    rotate: "-32deg",
    flip: true
  },
  {
    left: "64%",
    top: "49%",
    width: "17%",
    rotate: "36deg",
    flip: false
  },
  {
    left: "58%",
    top: "68%",
    width: "14%",
    rotate: "-46deg",
    flip: false
  }
];

const FALLEN_LEAF_SLOTS = [
  {
    left: "38%",
    top: "84%",
    width: "17%",
    rotate: "-13deg"
  },
  {
    left: "55%",
    top: "86%",
    width: "15%",
    rotate: "17deg"
  },
  {
    left: "47%",
    top: "89%",
    width: "13%",
    rotate: "4deg"
  }
];

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function clampStage(stage) {
  const n = typeof stage === "number" ? stage : Number(stage);
  if (!Number.isFinite(n)) return 0;
  if (n >= 100) return 100;

  return STAGES.reduce((best, current) => (n >= current ? current : best), 0);
}

function classNames(...values) {
  return values.filter(Boolean).join(" ");
}

function ShieldLeaf({ slot, index }) {
  return (
    <img
      alt=""
      aria-hidden="true"
      className={classNames(
        "nemoris-plant__shield-leaf",
        "grove-art-shield-active",
        `nemoris-plant__shield-leaf--${index + 1}`
      )}
      data-shield-index={index}
      src={shieldLeafImage}
      style={{
        left: slot.left,
        top: slot.top,
        width: slot.width,
        "--shield-rotate": slot.rotate,
        "--shield-flip": slot.flip ? "-1" : "1"
      }}
    />
  );
}

function RegrowingBud({ slot, growthPercent }) {
  const percent = clamp(Number(growthPercent || 0), 0, 100);
  const scale = 0.4 + (percent / 100) * 0.6;
  const opacity = 0.42 + (percent / 100) * 0.58;

  return (
    <img
      alt=""
      aria-hidden="true"
      className="nemoris-plant__regrowing-bud grove-art-regrowing-bud"
      data-shield-state="regrowing"
      src={shieldBudImage}
      style={{
        left: slot.left,
        top: slot.top,
        width: `calc(${slot.width} * 0.68)`,
        "--growth-opacity": opacity,
        "--growth-scale": scale,
        "--shield-rotate": slot.rotate,
        "--shield-flip": slot.flip ? "-1" : "1"
      }}
    />
  );
}

function FallenLeaf({ slot, index, growthPercent }) {
  const percent = clamp(Number(growthPercent || 0), 0, 100);
  const opacity = clamp(0.96 - (percent / 100) * 0.34, 0.48, 0.96);

  return (
    <img
      alt=""
      aria-hidden="true"
      className={classNames(
        "nemoris-plant__fallen-leaf",
        "grove-art-fallen-leaf",
        `nemoris-plant__fallen-leaf--${index + 1}`
      )}
      data-fallen-index={index}
      data-shield-state="fallen"
      src={fallenLeafImage}
      style={{
        left: slot.left,
        top: slot.top,
        width: slot.width,
        "--fallen-opacity": opacity,
        "--fallen-rotate": slot.rotate,
        "--fallen-delay": `${index * 0.18}s`
      }}
    />
  );
}

export default function NemorisPlantArtwork({
  stage = 0,
  shieldLeaves = 0,
  shieldCapacity = 0,
  fallenLeaves = 0,
  growthPercent = 0,
  showRegrowing = false,
  title = "Nemoris habit plant",
  className = "",
  style,
  ...props
}) {
  const resolvedStage = clampStage(stage);
  const capacity = clamp(Number(shieldCapacity || 0), 0, SHIELD_SLOTS.length);
  const activeLeaves = clamp(Number(shieldLeaves || 0), 0, capacity);
  const fallenCount = clamp(Number(fallenLeaves || 0), 0, FALLEN_LEAF_SLOTS.length);
  const regrowingSlot = showRegrowing && activeLeaves < capacity
    ? SHIELD_SLOTS[activeLeaves]
    : null;

  return (
    <div
      className={classNames(
        "nemoris-plant",
        `nemoris-plant--stage-${resolvedStage}`,
        className
      )}
      data-stage={resolvedStage}
      role={title ? "img" : "presentation"}
      aria-label={title || undefined}
      aria-hidden={title ? undefined : "true"}
      style={style}
      {...props}
    >
      <img
        alt=""
        aria-hidden="true"
        className="nemoris-plant__body"
        src={STAGE_IMAGES[resolvedStage]}
      />

      <div className="nemoris-plant__shield-layer" aria-hidden="true">
        {SHIELD_SLOTS.slice(0, activeLeaves).map((slot, index) => (
          <ShieldLeaf key={`${slot.left}-${slot.top}`} slot={slot} index={index} />
        ))}
        {regrowingSlot && (
          <RegrowingBud slot={regrowingSlot} growthPercent={growthPercent} />
        )}
      </div>

      <div className="nemoris-plant__fallen-layer" aria-hidden="true">
        {FALLEN_LEAF_SLOTS.slice(0, fallenCount).map((slot, index) => (
          <FallenLeaf
            key={`${slot.left}-${slot.top}`}
            slot={slot}
            index={index}
            growthPercent={growthPercent}
          />
        ))}
      </div>
    </div>
  );
}
