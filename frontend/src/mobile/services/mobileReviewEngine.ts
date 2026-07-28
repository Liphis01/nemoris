import { Rating, State, createEmptyCard, fsrs } from "ts-fsrs";

export const MOBILE_SUPPORTED_TYPES = new Set(["text", "media"]);
export const FSRS_VERSION = "6.3.1";

const scheduler = fsrs({
  request_retention: 0.9,
  maximum_interval: 36500,
  enable_fuzz: false,
  enable_short_term: false,
  learning_steps: [],
  relearning_steps: []
});

function numberOr(value: unknown, fallback: number): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function dateString(value: unknown): string | null {
  if (!value) return null;
  const text = String(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

function reviewDateAtNoon(day: string): Date {
  return new Date(`${day}T12:00:00.000Z`);
}

function addDays(day: string, days: number): string {
  const date = reviewDateAtNoon(day);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function daysBetween(from: string | null, to: string): number {
  if (!from) return 0;
  const delta = reviewDateAtNoon(to).getTime() - reviewDateAtNoon(from).getTime();
  return Math.max(0, Math.round(delta / 86400000));
}

export function localReviewDateString(now = new Date()): string {
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

export function appQualityToFsrsRating(quality: number): Rating {
  if (![0, 1, 2, 3].includes(Number(quality))) {
    throw new Error("Review quality must be between 0 and 3");
  }
  return Number(quality) + 1 as Rating;
}

export function progressHasStarted(progress: any): boolean {
  if (!progress) return false;
  return (
    numberOr(progress.reps, 0) > 0 ||
    Boolean(progress.last_review) ||
    Array.isArray(progress.history) && progress.history.length > 0
  );
}

export function progressInRelearning(progress: any, today: string): boolean {
  if (!progress || dateString(progress.next_review) !== today) return false;
  const history = Array.isArray(progress.history) ? progress.history : [];
  const latest = history[history.length - 1];
  return Boolean(
    latest &&
    latest.quality === 0 &&
    dateString(latest.reviewed_on) === today
  );
}

export function isMobileReviewQuestion(question: any): boolean {
  return MOBILE_SUPPORTED_TYPES.has(String(question?.type_q || ""));
}

export function isUploadedMedia(media: unknown): boolean {
  return String(media || "").trim().startsWith("/static/");
}

export function isExternalMedia(media: unknown): boolean {
  return /^https?:\/\//.test(String(media || "").trim());
}

export function selectDueMobileReviewItems({
  questions = [],
  progresses = [],
  today = localReviewDateString()
}: {
  questions: any[];
  progresses?: any[];
  today?: string;
}) {
  const progressByQuestionId = new Map(
    progresses.map((progress: any) => [Number(progress.question_id), progress])
  );

  return questions
    .filter(isMobileReviewQuestion)
    .map((question: any) => ({
      ...question,
      progress: progressByQuestionId.get(Number(question.id)) || question.progress || null
    }))
    .filter((question: any) => (
      progressHasStarted(question.progress) &&
      (!question.progress.next_review || dateString(question.progress.next_review)! <= today)
    ))
    .sort((left: any, right: any) => Number(left.id) - Number(right.id));
}

export function createInitialProgress(questionId: number, today: string) {
  return {
    question_id: questionId,
    stability: 1.0,
    difficulty: 5.0,
    reps: 0,
    lapses: 0,
    interval: 0,
    ideal_interval: null,
    last_review: null,
    next_review: today,
    ideal_next_review: null,
    fsrs_card: {
      card_id: questionId || 0,
      state: State.New,
      step: 0,
      stability: null,
      difficulty: null,
      due: reviewDateAtNoon(today).toISOString(),
      last_review: null
    },
    fsrs_version: FSRS_VERSION,
    history: []
  };
}

function memoryStateFor(progress: any) {
  if (!progress || numberOr(progress.reps, 0) <= 0) return null;
  return {
    stability: numberOr(progress.stability, 1.0),
    difficulty: numberOr(progress.difficulty, 5.0)
  };
}

function fsrsCardSnapshot(questionId: number, state: any, nextReview: string, lastReview: string) {
  return {
    card_id: questionId || 0,
    state: State.Review,
    step: null,
    stability: state.stability,
    difficulty: state.difficulty,
    due: reviewDateAtNoon(nextReview).toISOString(),
    last_review: reviewDateAtNoon(lastReview).toISOString()
  };
}

function lastHistoryEntry(progress: any) {
  const history = Array.isArray(progress?.history) ? progress.history : [];
  return history[history.length - 1] || null;
}

function isRepeatLapse(progress: any, today: string, quality: number) {
  const latest = lastHistoryEntry(progress);
  return Boolean(
    quality === 0 &&
    latest &&
    latest.quality === 0 &&
    dateString(latest.reviewed_on) === today
  );
}

export function scheduleAnswer(progress: any, question: any, quality: number, today: string) {
  const rating = appQualityToFsrsRating(quality);
  const repeatLapse = isRepeatLapse(progress, today, quality);

  if (progressInRelearning(progress, today)) {
    const stability = numberOr(progress.stability, 1.0);
    const interval = quality === 0 ? 0 : Math.max(1, scheduler.next_interval(stability, 0));
    const nextReview = quality === 0 ? today : addDays(today, interval);
    return {
      stability,
      difficulty: numberOr(progress.difficulty, 5.0),
      reps: numberOr(progress.reps, 0),
      lapses: numberOr(progress.lapses, 0),
      interval,
      next_review: nextReview,
      last_review: dateString(progress.last_review) || today,
      fsrs_card: fsrsCardSnapshot(Number(question.id), {
        stability,
        difficulty: numberOr(progress.difficulty, 5.0)
      }, nextReview, dateString(progress.last_review) || today),
      fsrs_rating: rating,
      fsrs_state: State.Review,
      skip_history: true
    };
  }

  const elapsedDays = daysBetween(dateString(progress.last_review), today);
  const nextState = scheduler.next_state(memoryStateFor(progress), elapsedDays, rating);
  const baseInterval = quality === 0
    ? 0
    : Math.max(1, scheduler.next_interval(nextState.stability, elapsedDays));
  const nextReview = quality === 0 ? today : addDays(today, baseInterval);

  return {
    stability: nextState.stability,
    difficulty: nextState.difficulty,
    reps: numberOr(progress.reps, 0) + 1,
    lapses: numberOr(progress.lapses, 0) + (quality === 0 && !repeatLapse ? 1 : 0),
    interval: baseInterval,
    ideal_interval: baseInterval,
    next_review: nextReview,
    ideal_next_review: nextReview,
    last_review: today,
    fsrs_card: fsrsCardSnapshot(Number(question.id), nextState, nextReview, today),
    fsrs_rating: rating,
    fsrs_state: State.Review,
    fsrs_version: FSRS_VERSION,
    repeat_lapse: repeatLapse
  };
}

export function applyMobileAnswer({
  question,
  progress,
  quality,
  today = localReviewDateString(),
  reviewedAt = new Date()
}: {
  question: any;
  progress?: any;
  quality: number;
  today?: string;
  reviewedAt?: Date;
}) {
  if (!isMobileReviewQuestion(question)) {
    throw new Error("Mobile v1 can only schedule text and media questions.");
  }

  const baseProgress = progress || createInitialProgress(Number(question.id), today);
  const scheduling = scheduleAnswer(baseProgress, question, quality, today);
  const nextProgress = {
    ...baseProgress,
    stability: scheduling.stability,
    difficulty: scheduling.difficulty,
    reps: scheduling.reps,
    lapses: scheduling.lapses,
    interval: scheduling.interval,
    ideal_interval: scheduling.ideal_interval ?? scheduling.interval,
    last_review: scheduling.last_review,
    next_review: scheduling.next_review,
    ideal_next_review: scheduling.ideal_next_review ?? scheduling.next_review,
    fsrs_card: scheduling.fsrs_card,
    fsrs_version: scheduling.fsrs_version || FSRS_VERSION
  };

  if (scheduling.skip_history) {
    return { progress: nextProgress, reviewLog: null, historyEntry: null };
  }

  const historyEntry: any = {
    reviewed_on: scheduling.last_review,
    quality,
    stability: scheduling.stability,
    difficulty: scheduling.difficulty,
    reps: scheduling.reps,
    lapses: scheduling.lapses,
    interval: scheduling.interval,
    next_review: scheduling.next_review,
    ideal_interval: scheduling.ideal_interval ?? scheduling.interval,
    ideal_next_review: scheduling.ideal_next_review ?? scheduling.next_review,
    fsrs_rating: scheduling.fsrs_rating,
    fsrs_state: scheduling.fsrs_state,
    fsrs_version: FSRS_VERSION
  };

  if (scheduling.repeat_lapse) {
    historyEntry.repeat_lapse = true;
  }

  nextProgress.history = [
    ...(Array.isArray(baseProgress.history) ? baseProgress.history : []),
    historyEntry
  ];

  const reviewLog = {
    question_id: Number(question.id),
    question_guid: question.guid || null,
    reviewed_on: today,
    reviewed_at: reviewedAt.toISOString(),
    quality,
    stability: historyEntry.stability,
    difficulty: historyEntry.difficulty,
    reps: historyEntry.reps,
    lapses: historyEntry.lapses,
    interval: historyEntry.interval,
    next_review: historyEntry.next_review,
    ideal_interval: historyEntry.ideal_interval,
    ideal_next_review: historyEntry.ideal_next_review,
    data: historyEntry
  };

  return { progress: nextProgress, reviewLog, historyEntry };
}

