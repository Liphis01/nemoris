import AutocompleteInput from "../../../shared/AutocompleteInput";
import ReturnToMenuButton from "../../../shared/ReturnToMenuButton";
import {
  groupTypeFilterOptions,
  questionTypeFilterOptions
} from "../../../shared/questionTypes";
import TagFilterControl from "./TagFilterControl";

const sortOptions = [
  { value: "id", label: "Ajout" },
  { value: "title", label: "Titre" },
  { value: "type", label: "Type" },
  { value: "group", label: "Groupe" },
  { value: "next_review", label: "Prochaine review" },
  { value: "reps", label: "Moins revues" }
];

const groupSortOptions = [
  { value: "id", label: "Ajout" },
  { value: "name", label: "Nom" },
  { value: "type", label: "Type" },
  { value: "question_count", label: "Questions" },
  { value: "media", label: "Media" }
];


export default function ManageSidebar({
  setMode,
  search,
  setSearch,
  tagFilter,
  setTagFilter,
  questionTypeFilter,
  setQuestionTypeFilter,
  dueOnly,
  setDueOnly,
  favoritesOnly,
  setFavoritesOnly,
  sortField,
  sortOrder,
  selectSortField,
  toggleSortOrder,
  groupSearch,
  setGroupSearch,
  groupTypeFilter,
  setGroupTypeFilter,
  groupHasMediaOnly,
  setGroupHasMediaOnly,
  groupSortField,
  groupSortOrder,
  selectGroupSortField,
  toggleGroupSortOrder,
  resetManageFilters,
  setSelectedItem,
  startCreateQuestion,
  startCreateGroup,
  startCreatePlaylist,
  viewMode,
  setViewMode,
  requestManageTransition,
  availableTags = [],
  onOpenTagTree
}) {
  const inputStyle = {
    width: "100%",
    padding: "11px 12px",
    borderRadius: "10px",
    border: "1px solid #2f2f2f",
    background: "#111",
    color: "#eee",
    boxSizing: "border-box",
    outline: "none",
    fontSize: "14px"
  };

  const sectionLabelStyle = {
    fontSize: "11px",
    color: "#666",
    fontWeight: "700",
    letterSpacing: "0.08em"
  };

  const sortControlStyle = {
    ...inputStyle,
    cursor: "pointer",
    height: "40px"
  };

  const filterSelectStyle = {
    ...inputStyle,
    cursor: "pointer",
    height: "42px"
  };

  const clearableInputStyle = {
    ...inputStyle,
    paddingRight: "38px"
  };

  const clearInputButtonStyle = {
    position: "absolute",
    top: "50%",
    right: "8px",
    width: "24px",
    height: "24px",
    transform: "translateY(-50%)",
    border: "none",
    borderRadius: "50%",
    background: "transparent",
    color: "#777",
    cursor: "pointer",
    fontSize: "18px",
    lineHeight: "24px",
    padding: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center"
  };

  // Three toggles have to share a 260px rail, so these stay tight: with the
  // old 13px/8px padding the third label was clipped off the edge.
  const toggleButtonStyle = (active, color) => ({
    flex: 1,
    minWidth: 0,
    padding: "10px 4px",
    borderRadius: "10px",
    border: active
      ? `1px solid ${color}`
      : "1px solid #2d2d2d",
    background: active
      ? `${color}22`
      : "#181818",
    color: active
      ? color
      : "#888",
    cursor: "pointer",
    transition: "all 0.15s ease",
    fontWeight: "600",
    fontSize: "12px",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "5px",
    whiteSpace: "nowrap"
  });

  function runManageTransition(action) {
    if (requestManageTransition) {
      requestManageTransition(action);
      return;
    }

    action?.();
  }

  function renderClearableInput({
    value,
    onChange,
    onClear,
    placeholder,
    ariaLabel,
    suggestions = [],
    onSuggestionSelect
  }) {
    return (
      <div style={{ position: "relative" }}>
        <AutocompleteInput
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onSuggestionSelect={(suggestion) => {
            if (onSuggestionSelect) {
              onSuggestionSelect(suggestion);
              return;
            }

            onChange(suggestion);
          }}
          suggestions={suggestions}
          style={clearableInputStyle}
        />

        {value && (
          <button
            type="button"
            onClick={onClear}
            title={ariaLabel}
            aria-label={ariaLabel}
            style={clearInputButtonStyle}
          >
            ×
          </button>
        )}
      </div>
    );
  }

  function renderSortControls({
    options,
    value,
    order,
    onSelect,
    onToggle,
    accent = "#342a52"
  }) {
    return (
      <>
        <div
          style={{
            height: "1px",
            background: "#242424",
            margin: "2px 0"
          }}
        />

        <div style={sectionLabelStyle}>
          SORT
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0, 1fr) 74px",
            gap: "8px"
          }}
        >
          <select
            value={value}
            onChange={(event) => onSelect?.(event.target.value)}
            style={sortControlStyle}
            aria-label="Critère de tri"
          >
            {options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={() => onToggle?.()}
            title={
              order === "asc"
                ? "Ordre croissant"
                : "Ordre décroissant"
            }
            style={{
              height: "40px",
              borderRadius: "10px",
              border: `1px solid ${accent}`,
              background: "#211a33",
              color: "#cbbcff",
              cursor: "pointer",
              fontWeight: "800",
              fontSize: "13px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "5px"
            }}
            aria-label={
              order === "asc"
                ? "Tri croissant"
                : "Tri décroissant"
            }
          >
            <span aria-hidden="true">
              {order === "asc" ? "↑" : "↓"}
            </span>
            {order === "asc" ? "Asc" : "Desc"}
          </button>
        </div>
      </>
    );
  }

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        minHeight: 0,
        borderRight: "1px solid #262626",
        background: "#151515",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden"
      }}
    >

      {/* HEADER */}
      <div
        style={{
          padding: "18px",
          borderBottom: "1px solid #262626",
          display: "flex",
          flexDirection: "column",
          flexShrink: 0,
          gap: "14px"
        }}
      >

        {/* TOP BAR */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center"
          }}
        >

          <div>
            <div
              style={{
                fontSize: "11px",
                color: "#666",
                fontWeight: "700",
                letterSpacing: "0.08em",
                marginBottom: "4px"
              }}
            >
              MANAGE
            </div>

            <div
              style={{
                fontSize: "24px",
                fontWeight: "800",
                color: "#eee",
                lineHeight: 1
              }}
            >
              Library
            </div>
          </div>

          <ReturnToMenuButton
            onClick={() => runManageTransition(() => {
              setSelectedItem(null);
              resetManageFilters?.();
              setViewMode("questions");
              setMode("menu");
            })}
            style={{
              padding: "8px 10px",
              background: "#1d1d1d",
              border: "1px solid #2f2f2f",
              borderRadius: "10px",
              color: "#aaa",
              cursor: "pointer",
              fontSize: "13px"
            }}
          />

        </div>

        {/* VIEW TOGGLES */}
        <div
          style={{
            display: "flex",
            gap: "10px"
          }}
        >

          <button
            onClick={() => {
              if (viewMode === "questions") return;
              runManageTransition(() => setViewMode("questions"));
            }}
            style={toggleButtonStyle(
              viewMode === "questions",
              "#b69cff"
            )}
          >
            <span>Questions</span>
          </button>

          <button
            onClick={() => {
              if (viewMode === "groups") return;
              runManageTransition(() => setViewMode("groups"));
            }}
            style={toggleButtonStyle(
              viewMode === "groups",
              "#ffcc7a"
            )}
          >
            <span>Groupes</span>
          </button>

          <button
            onClick={() => {
              if (viewMode === "playlists") return;
              runManageTransition(() => setViewMode("playlists"));
            }}
            style={toggleButtonStyle(
              viewMode === "playlists",
              "#7fe3c4"
            )}
          >
            <span>Playlists</span>
          </button>

        </div>

        {/* CREATE BUTTON */}
        {viewMode === "playlists" ? (
          <button
            onClick={() => runManageTransition(() => startCreatePlaylist?.())}
            style={{
              width: "100%",
              padding: "12px",
              borderRadius: "12px",
              border: "1px solid #1f5348",
              background: "#123a33",
              color: "#8ceccd",
              cursor: "pointer",
              fontWeight: "700",
              fontSize: "14px"
            }}
          >
            ＋ Nouvelle playlist
          </button>
        ) : viewMode === "questions" ? (
          <button
            onClick={() => runManageTransition(() => startCreateQuestion?.())}
            style={{
              width: "100%",
              padding: "12px",
              borderRadius: "12px",
              border: "1px solid #3a2f5a",
              background: "#2b2047",
              color: "#d2c2ff",
              cursor: "pointer",
              fontWeight: "700",
              fontSize: "14px"
            }}
          >
            ＋ Nouveau contenu
          </button>
        ) : (
          <button
            onClick={() => runManageTransition(() => startCreateGroup?.())}
            style={{
              width: "100%",
              padding: "12px",
              borderRadius: "12px",
              border: "1px solid #5a4523",
              background: "#3d2b14",
              color: "#ffd58a",
              cursor: "pointer",
              fontWeight: "700",
              fontSize: "14px"
            }}
          >
            ＋ Nouveau contenu
          </button>
        )}

      </div>

      {/* FILTERS */}
      <div
        className="app-scrollbar"
        style={{
          padding: "18px",
          borderBottom: "1px solid #262626",
          display: "flex",
          flexDirection: "column",
          flex: "1 1 auto",
          gap: "12px",
          minHeight: 0,
          overflowY: "auto",
          scrollbarGutter: "stable"
        }}
      >

        <div
          style={sectionLabelStyle}
        >
          FILTERS
        </div>

        {viewMode === "questions" && (
          <>

            {renderClearableInput({
              value: search,
              onChange: setSearch,
              onClear: () => setSearch(""),
              placeholder: "Recherche...",
              ariaLabel: "Effacer la recherche"
            })}

            {/* Picking a theme here filters by its whole subtree, so
                "Sciences" also lists questions tagged only "Linux". */}
            <TagFilterControl
              value={tagFilter}
              onChange={setTagFilter}
              availableTags={availableTags}
            />

            <select
              value={questionTypeFilter}
              onChange={(event) => setQuestionTypeFilter(event.target.value)}
              style={filterSelectStyle}
              aria-label="Filtrer les questions par type"
            >
              {questionTypeFilterOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>

            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: "10px",
                color: "#999",
                fontSize: "14px",
                marginTop: "2px",
                cursor: "pointer"
              }}
            >

              <input
                type="checkbox"
                checked={dueOnly}
                onChange={(e) => setDueOnly(e.target.checked)}
                style={{
                  accentColor: "#b69cff"
                }}
              />

              À réviser uniquement

            </label>

            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: "10px",
                color: "#999",
                fontSize: "14px",
                cursor: "pointer"
              }}
            >

              <input
                type="checkbox"
                checked={favoritesOnly}
                onChange={(e) => setFavoritesOnly(e.target.checked)}
                style={{
                  accentColor: "#ffcc7a"
                }}
              />

              Favoris uniquement

            </label>

            {renderSortControls({
              options: sortOptions,
              value: sortField,
              order: sortOrder,
              onSelect: selectSortField,
              onToggle: toggleSortOrder
            })}

            <button
              type="button"
              onClick={() => onOpenTagTree?.()}
              title="Organiser les tags en réseau"
              style={{
                width: "100%",
                marginTop: "4px",
                padding: "10px 12px",
                borderRadius: "10px",
                border: "1px solid #2d2d2d",
                background: "#181818",
                color: "#9a9a9a",
                cursor: "pointer",
                fontWeight: "600",
                fontSize: "13px",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "8px"
              }}
            >
              <span aria-hidden="true">🏷️</span>
              <span>Gérer les tags</span>
            </button>

          </>
        )}

        {viewMode === "groups" && (
          <>

            {renderClearableInput({
              value: groupSearch,
              onChange: setGroupSearch,
              onClear: () => setGroupSearch(""),
              placeholder: "Recherche...",
              ariaLabel: "Effacer la recherche de groupes"
            })}

            <select
              value={groupTypeFilter}
              onChange={(event) => setGroupTypeFilter(event.target.value)}
              style={filterSelectStyle}
              aria-label="Filtrer les groupes par type"
            >
              {groupTypeFilterOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>

            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: "10px",
                color: "#999",
                fontSize: "14px",
                marginTop: "2px",
                cursor: "pointer"
              }}
            >

              <input
                type="checkbox"
                checked={groupHasMediaOnly}
                onChange={(e) => setGroupHasMediaOnly(e.target.checked)}
                style={{
                  accentColor: "#ffcc7a"
                }}
              />

              Avec media uniquement

            </label>

            {renderSortControls({
              options: groupSortOptions,
              value: groupSortField,
              order: groupSortOrder,
              onSelect: selectGroupSortField,
              onToggle: toggleGroupSortOrder,
              accent: "#5a4523"
            })}

          </>
        )}

      </div>
    </div>
  );
}
