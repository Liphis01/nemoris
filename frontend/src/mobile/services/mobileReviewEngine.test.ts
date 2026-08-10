import { describe, expect, it } from "vitest";
import {
  applyMobileAnswer,
  createInitialProgress,
  progressInRelearning,
  selectDueMobileReviewItems
} from "./mobileReviewEngine";
import reviewFixtures from "../fixtures/review-fixtures.json";

const today = "2026-07-28";

function question(overrides = {}) {
  return {
    id: 42,
    guid: "q-guid",
    type_q: "text",
    question: "Capital?",
    answer: "Paris",
    ...overrides
  };
}

function startedProgress(overrides = {}) {
  return {
    question_id: 42,
    stability: 2.5,
    difficulty: 5.5,
    reps: 3,
    lapses: 0,
    interval: 4,
    ideal_interval: 4,
    last_review: "2026-07-20",
    next_review: today,
    ideal_next_review: today,
    fsrs_card: null,
    fsrs_version: "6.3.1",
    history: [
      {
        reviewed_on: "2026-07-20",
        quality: 2,
        stability: 2.5,
        difficulty: 5.5,
        reps: 3,
        lapses: 0,
        interval: 4,
        next_review: today
      }
    ],
    ...overrides
  };
}

describe("mobileReviewEngine", () => {
  it("selects only started due text/media questions", () => {
    const due = question({ id: 1, type_q: "text" });
    const future = question({ id: 2, type_q: "media" });
    const map = question({ id: 3, type_q: "map" });
    const newText = question({ id: 4, type_q: "text" });
    const cloze = question({ id: 5, type_q: "cloze" });
    const numeric = question({ id: 6, type_q: "numeric" });
    const grid = question({ id: 7, type_q: "grid" });
    const set = question({ id: 8, type_q: "set" });
    const enumeration = question({ id: 9, type_q: "enumeration" });

    const result = selectDueMobileReviewItems({
      questions: [future, map, newText, due, cloze, numeric, grid, set, enumeration],
      progresses: [
        startedProgress({ question_id: 1, next_review: today }),
        startedProgress({ question_id: 2, next_review: "2026-08-01" }),
        startedProgress({ question_id: 3, next_review: today }),
        startedProgress({ question_id: 5, next_review: today }),
        startedProgress({ question_id: 6, next_review: today }),
        startedProgress({ question_id: 7, next_review: today }),
        startedProgress({ question_id: 8, next_review: today }),
        startedProgress({ question_id: 9, next_review: today })
      ],
      today
    });

    expect(result.map((item) => item.id)).toEqual([1]);
  });

  it("matches backend-generated initial scheduling fixtures", () => {
    for (const fixture of reviewFixtures.cases) {
      const result = applyMobileAnswer({
        question: question({ id: fixture.question_id }),
        progress: createInitialProgress(fixture.question_id, fixture.today),
        quality: fixture.quality,
        today: fixture.today,
        reviewedAt: new Date("2026-07-28T15:00:00Z")
      });

      expect(result.progress.interval).toBe(fixture.expected.interval);
      expect(result.progress.next_review).toBe(fixture.expected.next_review);
      expect(result.progress.fsrs_version).toBe(reviewFixtures.fsrs_version);
      expect(result.progress.stability).toBeCloseTo(fixture.expected.stability, 4);
      expect(result.progress.difficulty).toBeCloseTo(fixture.expected.difficulty, 4);
      expect(result.progress.fsrs_card.state).toBe(fixture.expected.fsrs_state);
      expect(result.historyEntry.fsrs_rating).toBe(fixture.expected.fsrs_rating);
      expect(result.reviewLog.question_guid).toBe("q-guid");
    }
  });

  it("keeps Again due today and appends a revlog snapshot", () => {
    const result = applyMobileAnswer({
      question: question(),
      progress: createInitialProgress(42, today),
      quality: 0,
      today,
      reviewedAt: new Date("2026-07-28T15:00:00Z")
    });

    expect(result.progress.next_review).toBe(today);
    expect(result.progress.interval).toBe(0);
    expect(result.progress.lapses).toBe(1);
    expect(result.progress.history).toHaveLength(1);
    expect(result.reviewLog.data.quality).toBe(0);
  });

  it("freezes same-day relearning retries without appending history", () => {
    const progress = startedProgress({
      next_review: today,
      history: [
        {
          reviewed_on: today,
          quality: 0,
          stability: 1.2,
          difficulty: 6,
          reps: 4,
          lapses: 1,
          interval: 0,
          next_review: today
        }
      ]
    });

    expect(progressInRelearning(progress, today)).toBe(true);

    const result = applyMobileAnswer({
      question: question(),
      progress,
      quality: 0,
      today
    });

    expect(result.historyEntry).toBeNull();
    expect(result.reviewLog).toBeNull();
    expect(result.progress.history).toHaveLength(1);
    expect(result.progress.next_review).toBe(today);
  });

});
