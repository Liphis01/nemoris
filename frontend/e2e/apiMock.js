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

export async function mockApi(page, options = {}) {
  const state = {
    answerRequests: [],
    createdQuestions: [],
    deletedGroupIds: [],
    mapAnswerRequests: [],
    questionUpdates: [],
    review: clone(options.review || []),
    reviewSettings: {
      catchup_daily_target: 50,
      ...(options.reviewSettings || {})
    },
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

    if (method === "GET" && path === "/review/settings") {
      await fulfillJson(route, state.reviewSettings);
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

    if (method === "POST" && path === "/answer") {
      state.answerRequests.push(await requestJson(request));
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
      state.mapAnswerRequests.push(await requestJson(request));
      await fulfillJson(route, {});
      return;
    }

    if (method === "POST" && path === "/answer_timeline") {
      const payload = await requestJson(request);
      const results = state.timelineResults || defaultTimelineResults(payload);

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
