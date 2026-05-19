import ManageSidebar from "./ManageSidebar";
import ManageList from "./ManageList";
import ManageInspector from "./ManageInspector";
import { useEffect, useState } from "react";

export default function Manage(props) {
  // Manage coordinates the three panels. The heavy data/state logic lives in
  // useManageLibrary; this component handles panel-specific selection effects.
  const [editingZone, setEditingZone] = useState(null);
  const [highlightedQuestionIds, setHighlightedQuestionIds] = useState([]);
  const [highlightedGroupIds, setHighlightedGroupIds] = useState([]);
  const {
    allQuestions,
    clearOpenQuestionId,
    openQuestionId,
    setSelectedItem,
    setViewMode
  } = props;

  useEffect(() => {
    // Highlights are transient breadcrumbs after create/save/navigation actions.
    if (highlightedQuestionIds.length === 0 && highlightedGroupIds.length === 0) {
      return;
    }

    const timeout = window.setTimeout(() => {
      setHighlightedQuestionIds([]);
      setHighlightedGroupIds([]);
    }, 2800);

    return () => window.clearTimeout(timeout);
  }, [highlightedQuestionIds, highlightedGroupIds]);

  useEffect(() => {
    if (!openQuestionId) return;

    // External navigation asks Manage to open a question by id. Once resolved,
    // consume the signal so normal local selection can continue.
    const question = allQuestions?.find(
      (item) => item.id === openQuestionId
    );

    if (!question) return;

    setViewMode?.("questions");
    setSelectedItem?.(question);
    setEditingZone(question.type_q === "map" ? question : null);
    setHighlightedQuestionIds([question.id]);
    clearOpenQuestionId?.();
  }, [allQuestions, clearOpenQuestionId, openQuestionId, setSelectedItem, setViewMode]);

  async function createQuestionWithHighlight() {
    // Wrap the shared create action with UI selection/highlight behavior for
    // this workspace.
    const created = await props.createQuestion?.();

    if (created?.id) {
      props.setViewMode?.("questions");
      props.setSelectedItem?.(created);
      setEditingZone(created.type_q === "map" ? created : null);
      setHighlightedQuestionIds([created.id]);
    }

    return created;
  }

  async function createGroupWithHighlight() {
    const created = await props.createGroup?.();

    if (created?.id) {
      props.setViewMode?.("groups");
      props.setSelectedItem?.(created);
      setEditingZone(null);
      setHighlightedGroupIds([created.id]);
    }

    return created;
  }

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "260px 380px 1fr",
        height: "100%",
        background: "#121212",
        color: "#eee",
        overflow: "hidden"
      }}
    >
      <ManageSidebar {...props} />

      <ManageList
        {...props}
        editingZone={editingZone}
        setEditingZone={setEditingZone}
        highlightedQuestionIds={highlightedQuestionIds}
        highlightedGroupIds={highlightedGroupIds}
      />

      <ManageInspector
        {...props}
        editingZone={editingZone}
        setEditingZone={setEditingZone}
        createQuestion={createQuestionWithHighlight}
        createGroup={createGroupWithHighlight}
        setHighlightedQuestionIds={setHighlightedQuestionIds}
      />
    </div>
  );
}
