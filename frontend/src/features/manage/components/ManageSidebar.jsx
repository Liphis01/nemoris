const sortOptions = [
  { value: "id", label: "Ajout" },
  { value: "title", label: "Titre" },
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
  dueOnly,
  setDueOnly,
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
  setIsCreatingQuestion,
  setSelectedItem,
  startCreateGroup,
  viewMode,
  setViewMode
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

  const toggleButtonStyle = (active, color) => ({
    flex: 1,
    padding: "10px 12px",
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
    fontSize: "13px"
  });

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

          <button
            onClick={() => setMode("menu")}
            style={{
              padding: "8px 10px",
              background: "#1d1d1d",
              border: "1px solid #2f2f2f",
              borderRadius: "10px",
              color: "#aaa",
              cursor: "pointer",
              fontSize: "13px"
            }}
          >
            ←
          </button>

        </div>

        {/* VIEW TOGGLES */}
        <div
          style={{
            display: "flex",
            gap: "10px"
          }}
        >

          <button
            onClick={() => setViewMode("questions")}
            style={toggleButtonStyle(
              viewMode === "questions",
              "#b69cff"
            )}
          >
            📋 Questions
          </button>

          <button
            onClick={() => setViewMode("groups")}
            style={toggleButtonStyle(
              viewMode === "groups",
              "#ffcc7a"
            )}
          >
            📁 Groupes
          </button>

        </div>

        {/* CREATE BUTTON */}
        {viewMode === "questions" ? (
          <button
            onClick={() => {
              setIsCreatingQuestion(true);
              setSelectedItem(null);
            }}
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
            ＋ Nouvelle question
          </button>
        ) : (
          <button
            onClick={() => startCreateGroup?.()}
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
            ＋ Nouveau groupe
          </button>
        )}

      </div>

      {/* FILTERS */}
      <div
        style={{
          padding: "18px",
          borderBottom: "1px solid #262626",
          display: "flex",
          flexDirection: "column",
          gap: "12px"
        }}
      >

        <div
          style={sectionLabelStyle}
        >
          FILTERS
        </div>

        {viewMode === "questions" && (
          <>

            <input
              placeholder="Recherche..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={inputStyle}
            />

            <input
              placeholder="Tags..."
              value={tagFilter}
              onChange={(e) => setTagFilter(e.target.value)}
              style={inputStyle}
            />

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

              Questions dues uniquement

            </label>

            {renderSortControls({
              options: sortOptions,
              value: sortField,
              order: sortOrder,
              onSelect: selectSortField,
              onToggle: toggleSortOrder
            })}

          </>
        )}

        {viewMode === "groups" && (
          <>

            <input
              placeholder="Recherche..."
              value={groupSearch}
              onChange={(e) => setGroupSearch(e.target.value)}
              style={inputStyle}
            />

            <input
              placeholder="Type..."
              value={groupTypeFilter}
              onChange={(e) => setGroupTypeFilter(e.target.value)}
              style={inputStyle}
            />

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
