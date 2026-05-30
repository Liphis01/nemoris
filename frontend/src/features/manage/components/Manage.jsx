import ManageSidebar from "./ManageSidebar";
import ManageList from "./ManageList";
import ManageInspector from "./ManageInspector";
import { useCallback, useEffect, useRef, useState } from "react";

export default function Manage(props) {
  // Manage coordinates the three panels. The heavy data/state logic lives in
  // useManageLibrary; this component handles panel-specific selection effects.
  const [editingZone, setEditingZone] = useState(null);
  const [highlightedQuestionIds, setHighlightedQuestionIds] = useState([]);
  const [highlightedGroupIds, setHighlightedGroupIds] = useState([]);
  const [autosaveStatus, setAutosaveStatus] = useState(null);
  const pendingSaveHandlerRef = useRef(null);
  const transitionInProgressRef = useRef(false);
  const autosaveTimeoutRef = useRef(null);
  const {
    allQuestions,
    clearOpenQuestionId,
    openQuestionId,
    setSelectedItem,
    setViewMode
  } = props;

  const showAutosaveStatus = useCallback((status) => {
    if (autosaveTimeoutRef.current) {
      window.clearTimeout(autosaveTimeoutRef.current);
      autosaveTimeoutRef.current = null;
    }

    setAutosaveStatus(status);

    if (status?.type === "success") {
      autosaveTimeoutRef.current = window.setTimeout(() => {
        setAutosaveStatus(null);
        autosaveTimeoutRef.current = null;
      }, 2500);
    }
  }, []);

  const registerPendingSaveHandler = useCallback((handler) => {
    pendingSaveHandlerRef.current = typeof handler === "function"
      ? handler
      : null;

    return () => {
      if (pendingSaveHandlerRef.current === handler) {
        pendingSaveHandlerRef.current = null;
      }
    };
  }, []);

  const requestManageTransition = useCallback(async (action) => {
    if (transitionInProgressRef.current) {
      return;
    }

    transitionInProgressRef.current = true;
    showAutosaveStatus(null);

    try {
      const saveHandler = pendingSaveHandlerRef.current;
      const saveResult = saveHandler
        ? await saveHandler()
        : { saved: false };

      await action?.();

      if (saveResult?.saved) {
        showAutosaveStatus({
          type: "success",
          message: "Enregistré"
        });
      }
    } catch (error) {
      console.error(error);
      showAutosaveStatus({
        type: "error",
        message: "Enregistrement impossible"
      });
    } finally {
      transitionInProgressRef.current = false;
    }
  }, [showAutosaveStatus]);

  useEffect(() => {
    return () => {
      if (autosaveTimeoutRef.current) {
        window.clearTimeout(autosaveTimeoutRef.current);
      }
    };
  }, []);

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

  async function createQuestionWithHighlight(draftOverride) {
    // Wrap the shared create action with UI selection/highlight behavior for
    // this workspace.
    const created = await props.createQuestion?.(draftOverride);

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
        overflow: "hidden",
        position: "relative"
      }}
    >
      {autosaveStatus && (
        <div
          aria-live="polite"
          style={{
            position: "absolute",
            left: "50%",
            bottom: "18px",
            transform: "translateX(-50%)",
            zIndex: 20,
            display: "inline-flex",
            alignItems: "center",
            gap: "8px",
            padding: "8px 12px",
            borderRadius: "8px",
            border: "1px solid #303030",
            borderLeft: autosaveStatus.type === "error"
              ? "3px solid #f87171"
              : "3px solid #86efac",
            background: autosaveStatus.type === "error"
              ? "rgba(33, 23, 23, 0.96)"
              : "rgba(24, 30, 26, 0.96)",
            color: autosaveStatus.type === "error" ? "#f2b8b8" : "#cce8d3",
            boxShadow: "0 10px 24px rgba(0, 0, 0, 0.32)",
            fontSize: "13px",
            fontWeight: "600",
            lineHeight: 1.2,
            pointerEvents: "none"
          }}
        >
          <span
            aria-hidden="true"
            style={{
              width: "6px",
              height: "6px",
              borderRadius: "50%",
              background: autosaveStatus.type === "error" ? "#f87171" : "#86efac",
              flexShrink: 0
            }}
          />
          {autosaveStatus.message}
        </div>
      )}

      <ManageSidebar
        {...props}
        requestManageTransition={requestManageTransition}
      />

      <ManageList
        {...props}
        editingZone={editingZone}
        setEditingZone={setEditingZone}
        highlightedQuestionIds={highlightedQuestionIds}
        highlightedGroupIds={highlightedGroupIds}
        requestManageTransition={requestManageTransition}
      />

      <ManageInspector
        {...props}
        editingZone={editingZone}
        setEditingZone={setEditingZone}
        createQuestion={createQuestionWithHighlight}
        createGroup={createGroupWithHighlight}
        setHighlightedQuestionIds={setHighlightedQuestionIds}
        registerPendingSaveHandler={registerPendingSaveHandler}
        requestManageTransition={requestManageTransition}
      />
    </div>
  );
}
