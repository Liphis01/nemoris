export function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }

  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${stableStringify(value[key])}`
    ).join(",")}}`;
  }

  const serialized = JSON.stringify(value);
  return serialized === undefined ? "undefined" : serialized;
}

export function buildQuestionSavePayload(source) {
  const type_q = source?.type_q || "text";
  const tags = Array.isArray(source?.tags) ? source.tags : [];
  const pendingTag = (source?._pendingTagInput || "").trim();

  return {
    question: source?.question || "",
    answer: source?.answer || "",
    media: source?.media || null,
    answer_media: source?.answer_media || null,
    type_q,
    tags: pendingTag && !tags.includes(pendingTag)
      ? [...tags, pendingTag]
      : tags,
    data: source?.data || {}
  };
}

export function buildQuestionDraft(source) {
  return {
    question: source?.question || "",
    answer: source?.answer || "",
    media: source?.media || "",
    answer_media: source?.answer_media || "",
    type_q: source?.type_q || "text",
    tags: source?.tags || [],
    data: source?.data || {}
  };
}

export function payloadsMatch(left, right) {
  return stableStringify(left) === stableStringify(right);
}
