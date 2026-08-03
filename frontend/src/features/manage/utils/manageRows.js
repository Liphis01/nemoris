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


function mergeTags(...tagLists) {
  const tagIds = new Set();

  tagLists.forEach((tagList) => {
    (tagList || []).forEach((tag) => {
      const value = String(tag || "").trim();
      if (value) tagIds.add(value);
    });
  });

  return [...tagIds];
}


function getGroupInfo(groupId, question, groupById) {
  const group = groupById.get(groupId) || question?.group || null;

  return {
    groupId,
    group,
    name: group?.name || question?.group?.name || `Groupe #${groupId}`,
    type: group?.type_group || question?.group?.type_group || "groupe",
    tags: mergeTags(
      group?.tags,
      question?.group?.tags,
      ["map", "media"].includes(question?.type_q) ? question?.tags : []
    ),
    questions: [],
    mapCount: 0,
    imageCount: 0,
    textCount: 0,
    sequenceCount: 0
  };
}


function orderGroupQuestionsForDisplay(questions, sortField) {
  if (sortField !== "id") {
    return questions;
  }

  // Visual grouped items are kept first because they are usually edited as a
  // set; other question types still remain visible below them.
  const mapQuestions = [];
  const imageQuestions = [];
  const sequenceQuestions = [];
  const otherQuestions = [];

  questions.forEach((question) => {
    if (question.type_q === "map") {
      mapQuestions.push(question);
    } else if (question.type_q === "media") {
      imageQuestions.push(question);
    } else if (question.type_q === "sequence") {
      sequenceQuestions.push(question);
    } else {
      otherQuestions.push(question);
    }
  });

  // A sequence's rank is its content, and ids stop tracking it the moment the
  // list is reordered, so these list by position rather than by id.
  sequenceQuestions.sort((left, right) => (
    (left.data?.position ?? 0) - (right.data?.position ?? 0)
  ));

  return [
    ...mapQuestions,
    ...imageQuestions,
    ...sequenceQuestions,
    ...otherQuestions
  ];
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
      groupInfo.tags = mergeTags(groupInfo.tags, question.tags);
    } else if (question.type_q === "media") {
      groupInfo.imageCount += 1;
      groupInfo.tags = mergeTags(groupInfo.tags, question.tags);
    } else if (question.type_q === "sequence") {
      groupInfo.sequenceCount += 1;
      groupInfo.tags = mergeTags(groupInfo.tags, question.tags);
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
