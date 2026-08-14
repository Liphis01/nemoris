import { requestJson } from "./http";


function firstDefined(...values) {
  return values.find(value => value !== undefined && value !== null);
}


export function getStudySummary(scope = {}) {
  const params = new URLSearchParams();
  const scopeType = scope.scopeType || scope.type;

  if (scopeType) {
    params.set("scope_type", scopeType);
  }

  if (scopeType === "group") {
    const groupId = firstDefined(scope.groupId, scope.group_id, scope.id);
    if (groupId !== undefined) params.set("group_id", String(groupId));
  }

  if (scopeType === "collection") {
    const collectionId = firstDefined(
      scope.collectionId,
      scope.collection_id,
      scope.id
    );
    if (collectionId !== undefined) {
      params.set("collection_id", String(collectionId));
    }
  }

  if (scopeType === "tag") {
    const tag = firstDefined(scope.tag, scope.key, scope.id, scope.label);
    if (tag) params.set("tag", String(tag));
  }

  if (scopeType === "pack") {
    const packGuid = firstDefined(scope.packGuid, scope.pack_guid, scope.id);
    if (packGuid) params.set("pack_guid", String(packGuid));
  }

  const query = params.toString();

  return requestJson(`/study/summary${query ? `?${query}` : ""}`);
}
