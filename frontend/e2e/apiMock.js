export const apiBaseUrl = "http://localhost:8000";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type"
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

async function requestJson(request) {
  const text = request.postData();

  return text ? JSON.parse(text) : {};
}

async function fulfillJson(route, body, status = 200) {
  await route.fulfill({
    status,
    contentType: "application/json",
    headers: corsHeaders,
    body: JSON.stringify(body)
  });
}

function defaultTimelineResults(payload) {
  return Object.entries(payload.items || {}).map(([questionId, answer]) => ({
    question_id: Number(questionId),
    quality: 2,
    expected: {
      kind: answer.end ? "interval" : "point",
      start: answer.start,
      ...(answer.end ? { end: answer.end } : {})
    },
    start: {
      distance: 0,
      unit: "days",
      guess: answer.start
    },
    ...(answer.end
      ? {
        end: {
          distance: 0,
          unit: "days",
          guess: answer.end
        }
      }
      : {})
  }));
}

function toDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function questionStatsSummary(question) {
  const history = question.progress?.history || [];
  const reviews = history.length || question.progress?.reps || 0;
  const failed = history.length > 0
    ? history.filter(entry => Number(entry.quality) === 0).length
    : question.progress?.lapses || 0;
  const hard = history.filter(entry => Number(entry.quality) === 1).length;
  const success = history.length > 0
    ? history.filter(entry => Number(entry.quality) > 0).length
    : Math.max(0, reviews - failed);

  return {
    ...clone(question),
    favorite: Boolean(question.data?.favorite),
    reviews,
    success_count: success,
    failed_count: failed,
    hard_count: hard,
    retention: reviews > 0 ? Math.round((success / reviews) * 100) : null,
    difficulty: question.progress?.difficulty || 5,
    lapses: question.progress?.lapses || failed,
    reps: question.progress?.reps || reviews,
    last_review: question.progress?.last_review || null,
    next_review: question.progress?.next_review || toDateKey(new Date())
  };
}

function defaultStats(questions) {
  const today = toDateKey(new Date());
  const loadByType = Array.from({ length: 30 }, (_, index) => {
    const date = new Date();
    date.setDate(date.getDate() + index);
    return {
      date: toDateKey(date),
      total: 0,
      types: {
        text: 0,
        map: 0,
        timeline: 0
      }
    };
  });
  const summaries = questions.map(questionStatsSummary);

  return {
    generated_on: today,
    windows: {
      load_days: 30,
      retention_days: 90,
      retention_start: today
    },
    counts: {
      total: questions.length,
      due_total: 0,
      overdue: 0,
      due_today: 0,
      new: questions.filter(question => !question.progress?.reps).length,
      by_type: {
        text: { total: 0, due: 0, overdue: 0, due_today: 0, new: 0 },
        map: { total: 0, due: 0, overdue: 0, due_today: 0, new: 0 },
        timeline: { total: 0, due: 0, overdue: 0, due_today: 0, new: 0 }
      }
    },
    load_by_type: loadByType,
    retention_by_type: {
      text: { reviews: 0, success: 0, failed: 0, hard: 0, retention: null },
      map: { reviews: 0, success: 0, failed: 0, hard: 0, retention: null },
      timeline: { reviews: 0, success: 0, failed: 0, hard: 0, retention: null }
    },
    hard_questions: summaries.filter(question => question.reviews > 0),
    favorite_questions: summaries.filter(question => question.favorite),
    weak_spots: {
      map: summaries.filter(question => question.type_q === "map" && question.reviews > 0),
      timeline: summaries.filter(question => question.type_q === "timeline" && question.reviews > 0)
    }
  };
}

function markQuestionsAnswered(state, count) {
  // The real backend recomputes due_count from the DB on every /review/summary
  // call; this mock has no such source of truth, so newly-answered questions
  // (first pass, not a revise) must explicitly bring the count down or the
  // menu never reports the session as complete after returning from review.
  state.reviewSummary.due_count = Math.max(0, (state.reviewSummary.due_count || 0) - count);
  state.reviewSummary.has_due = state.reviewSummary.due_count > 0;
  state.reviewSummary.session_count = (
    state.reviewSummary.due_count + (state.reviewSummary.new_count || 0)
  );
}

export async function mockApi(page, options = {}) {
  const state = {
    answerRequests: [],
    createdQuestions: [],
    deletedGroupIds: [],
    mapAnswerRequests: [],
    questionUpdates: [],
    review: clone(options.review || []),
    stats: clone(options.stats || defaultStats(options.questions || [])),
    reviewSettings: {
      catchup_daily_target: 20,
      pace_tier: "regulier",
      pace_tier_resolved: "regulier",
      effective_daily_target: 20,
      pace_tiers: [
        { key: "leger", daily_target: 10, estimated_minutes: 3 },
        { key: "regulier", daily_target: 20, estimated_minutes: 5 },
        { key: "soutenu", daily_target: 40, estimated_minutes: 10 },
        { key: "intensif", daily_target: 80, estimated_minutes: 20 }
      ],
      ...(options.reviewSettings || {})
    },
    reviewSummary: {
      due_count: options.review?.length || 0,
      has_due: (options.review?.length || 0) > 0,
      new_count: 0,
      session_count: options.review?.length || 0,
      ...(options.reviewSummary || {})
    },
    syncStatus: {
      signed_in: false,
      account_email: null,
      server_url: "",
      server_key: "",
      last_server_version: 0,
      auto_sync_enabled: false,
      local_change_seq: 0,
      last_synced_change_seq: 0,
      collection_dirty: false,
      last_auto_sync_at: null,
      last_auto_sync_status: null,
      last_auto_sync_error: null,
      code_schema_version: "0016",
      server_meta: null,
      ...(options.syncStatus || {})
    },
    profile: clone(options.profile ?? null),
    profileUpdates: [],
    questions: clone(options.questions || []),
    groups: clone(options.groups || []),
    nextQuestionId: options.nextQuestionId || 100,
    timelineResults: clone(options.timelineResults || null)
  };

  await page.route(`${apiBaseUrl}/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();

    if (method === "OPTIONS") {
      await route.fulfill({
        status: 204,
        headers: corsHeaders,
        body: ""
      });
      return;
    }

    if (method === "GET" && path === "/review/startup_notice") {
      await fulfillJson(route, null);
      return;
    }

    if (method === "GET" && path === "/sync/status") {
      await fulfillJson(route, state.syncStatus);
      return;
    }

    if (method === "PUT" && path === "/sync/preferences") {
      const payload = await requestJson(request);
      state.syncStatus.auto_sync_enabled = Boolean(payload.auto_sync_enabled);
      await fulfillJson(route, state.syncStatus);
      return;
    }

    if (method === "POST" && path === "/sync/auto") {
      await fulfillJson(route, { status: "idle" });
      return;
    }

    if (method === "POST" && path === "/sync/push") {
      state.syncStatus.last_server_version += 1;
      await fulfillJson(route, {
        status: "pushed",
        version: state.syncStatus.last_server_version
      });
      return;
    }

    if (method === "POST" && path === "/sync/pull") {
      await fulfillJson(route, {
        status: "pulled",
        version: state.syncStatus.server_meta?.version || 1
      });
      return;
    }

    if (method === "GET" && path === "/profile") {
      await fulfillJson(route, {
        signed_in: state.syncStatus.signed_in,
        account_email: state.syncStatus.account_email,
        profile: state.profile
      });
      return;
    }

    if (method === "PUT" && path === "/profile") {
      const payload = await requestJson(request);
      state.profile = { ...payload, updated_at: new Date().toISOString() };
      state.profileUpdates.push(payload);
      await fulfillJson(route, {
        signed_in: state.syncStatus.signed_in,
        account_email: state.syncStatus.account_email,
        profile: state.profile
      });
      return;
    }

    if (method === "GET" && path === "/review/summary") {
      await fulfillJson(route, state.reviewSummary);
      return;
    }

    if (method === "GET" && path === "/review/settings") {
      await fulfillJson(route, state.reviewSettings);
      return;
    }

    if (method === "GET" && path === "/review/intake") {
      await fulfillJson(route, {
        quota: state.reviewSummary.new_count || 0,
        due_count: state.reviewSummary.due_count || 0
      });
      return;
    }

    if (method === "PUT" && path === "/review/settings") {
      state.reviewSettings = {
        ...state.reviewSettings,
        ...(await requestJson(request))
      };
      await fulfillJson(route, state.reviewSettings);
      return;
    }

    if (method === "POST" && path === "/review/rebalance") {
      await fulfillJson(route, {});
      return;
    }

    if (method === "GET" && path === "/review") {
      await fulfillJson(route, state.review);
      return;
    }

    if (method === "GET" && path === "/stats") {
      await fulfillJson(route, state.stats);
      return;
    }

    if (method === "POST" && path === "/answer") {
      state.answerRequests.push(await requestJson(request));
      markQuestionsAnswered(state, 1);
      await fulfillJson(route, {});
      return;
    }

    if (method === "POST" && path === "/answer/revise") {
      state.answerRequests.push({
        ...(await requestJson(request)),
        revised: true
      });
      await fulfillJson(route, {});
      return;
    }

    if (method === "POST" && path === "/answer_map") {
      const payload = await requestJson(request);

      state.mapAnswerRequests.push(payload);
      markQuestionsAnswered(state, Object.keys(payload.items || {}).length || 1);
      await fulfillJson(route, {});
      return;
    }

    if (method === "POST" && path === "/answer_timeline") {
      const payload = await requestJson(request);
      const results = state.timelineResults || defaultTimelineResults(payload);

      markQuestionsAnswered(state, Object.keys(payload.items || {}).length || 1);
      await fulfillJson(route, { results });
      return;
    }

    if (method === "GET" && path === "/questions") {
      await fulfillJson(route, state.questions);
      return;
    }

    if (method === "POST" && path === "/questions") {
      const payload = await requestJson(request);
      const created = {
        id: state.nextQuestionId,
        progress: null,
        ...payload
      };

      state.nextQuestionId += 1;
      state.createdQuestions.push(created);
      state.questions.push(created);
      await fulfillJson(route, created);
      return;
    }

    const questionMatch = path.match(/^\/questions\/(\d+)$/);

    if (questionMatch && method === "PUT") {
      const id = Number(questionMatch[1]);
      const payload = await requestJson(request);

      state.questionUpdates.push({ id, payload });
      state.questions = state.questions.map((question) =>
        question.id === id
          ? { ...question, ...payload }
          : question
      );
      await fulfillJson(
        route,
        state.questions.find(question => question.id === id) || { id, ...payload }
      );
      return;
    }

    if (questionMatch && method === "DELETE") {
      const id = Number(questionMatch[1]);

      state.questions = state.questions.filter(question => question.id !== id);
      await fulfillJson(route, {});
      return;
    }

    if (method === "GET" && path === "/groups") {
      await fulfillJson(route, state.groups);
      return;
    }

    if (method === "POST" && path === "/groups") {
      const payload = await requestJson(request);
      const created = {
        id: state.groups.length + 1,
        question_count: 0,
        ...payload
      };

      state.groups.push(created);
      await fulfillJson(route, created);
      return;
    }

    const groupSuspendMatch = path.match(/^\/groups\/(\d+)\/suspend$/);

    if (groupSuspendMatch && method === "POST") {
      const id = Number(groupSuspendMatch[1]);
      const { suspended } = await requestJson(request);
      let updated = 0;

      state.questions = state.questions.map((question) => {
        if ((question.group_id ?? question.group?.id ?? null) !== id) {
          return question;
        }

        updated += 1;
        return { ...question, suspended };
      });

      await fulfillJson(route, {
        group_id: id,
        suspended,
        updated_count: updated
      });
      return;
    }

    const groupMatch = path.match(/^\/groups\/(\d+)$/);

    if (groupMatch && method === "DELETE") {
      const id = Number(groupMatch[1]);

      state.deletedGroupIds.push(id);
      state.groups = state.groups.filter(group => group.id !== id);
      state.questions = state.questions.filter((question) =>
        (question.group_id ?? question.group?.id ?? null) !== id
      );
      await fulfillJson(route, {});
      return;
    }

    await fulfillJson(route, { detail: `Unhandled ${method} ${path}` }, 404);
  });

  return state;
}
