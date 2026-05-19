export function getQuestionGroupId(question) {
  // The backend sometimes sends group_id directly and sometimes nested group
  // metadata. Normalize both shapes for row grouping.
  const groupId = question?.group_id ?? question?.group?.id;

  if (
    groupId === null ||
    groupId === undefined ||
    groupId === ""
  ) {
    return null;
  }

  return String(groupId);
}


function getGroupInfo(groupId, question, groupById) {
  const group = groupById.get(groupId) || question?.group || null;

  return {
    groupId,
    group,
    name: group?.name || question?.group?.name || `Groupe #${groupId}`,
    type: group?.type_group || question?.group?.type_group || "groupe",
    questions: [],
    mapCount: 0,
    textCount: 0
  };
}


function orderGroupQuestionsForDisplay(questions, sortField) {
  if (sortField !== "id") {
    return questions;
  }

  // Map zones are kept first inside a group because they are usually edited as
  // a visual set; other question types still remain visible below them.
  const mapQuestions = [];
  const otherQuestions = [];

  questions.forEach((question) => {
    if (question.type_q === "map") {
      mapQuestions.push(question);
    } else {
      otherQuestions.push(question);
    }
  });

  return [...mapQuestions, ...otherQuestions];
}


export function buildVisibleRows(questions, allGroups, expandedGroupIds, sortField = "id") {
  // Convert a flat question list into render rows. Group headers are runtime UI
  // rows only; they do not represent database questions.
  const groupById = new Map(
    (allGroups || []).map((group) => [String(group.id), group])
  );
  const groupInfoById = new Map();
  const topRows = [];

  questions.forEach((question) => {
    const groupId = getQuestionGroupId(question);

    if (!groupId) {
      topRows.push({
        type: "question",
        key: `question:${question.id}`,
        question,
        nested: false
      });
      return;
    }

    let groupInfo = groupInfoById.get(groupId);

    if (!groupInfo) {
      groupInfo = getGroupInfo(groupId, question, groupById);
      groupInfoById.set(groupId, groupInfo);
      topRows.push({
        type: "groupHeader",
        key: `group:${groupId}`,
        groupId,
        groupInfo
      });
    }

    groupInfo.questions.push(question);

    if (question.type_q === "map") {
      groupInfo.mapCount += 1;
    } else {
      groupInfo.textCount += 1;
    }
  });

  return topRows.flatMap((row) => {
    // Collapsed groups render as one header row. Expanded groups render the
    // header plus nested atomic questions.
    if (row.type !== "groupHeader" || !expandedGroupIds.has(row.groupId)) {
      return [row];
    }

    return [
      row,
      ...orderGroupQuestionsForDisplay(row.groupInfo.questions, sortField).map(
        (question) => ({
          type: "question",
          key: `question:${question.id}`,
          question,
          nested: true,
          groupId: row.groupId
        })
      )
    ];
  });
}
