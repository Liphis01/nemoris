export default function ManageSidebar({
  setMode,
  search,
  setSearch,
  filterTheme,
  setFilterTheme,
  filterDue,
  setFilterDue,
  filteredQuestions,
  allGroups,
  isCreating,
  setIsCreating,
  setSelectedQuestion,
  startCreateGroup,
  viewMode,
  setViewMode
}) {
  const sidebarStyle = {
    borderRight: "1px solid #2a2a2a",
    padding: "20px",
    overflow: "auto",
    background: "#181818"
  };

  const inputStyle = {
    width: "100%",
    padding: "10px",
    marginBottom: "10px",
    borderRadius: "8px",
    border: "1px solid #333",
    background: "#111",
    color: "#eee",
    boxSizing: "border-box"
  };

  const buttonToggleStyle = (isActive) => ({
    flex: 1,
    padding: "10px",
    background: isActive ? "#5a5a8a" : "#2a2a2a",
    color: "#eee",
    border: "1px solid #333",
    borderRadius: "6px",
    cursor: "pointer",
    transition: "all 0.2s",
    // fontWeight: isActive ? "bold" : "normal"
  });

  return (
    <div style={sidebarStyle}>

      <button
        onClick={() => setMode("menu")}
        style={{
          width: "100%",
          marginBottom: "20px",
          padding: "10px",
          background: "#2a2a2a",
          color: "#eee",
          border: "1px solid #333",
          borderRadius: "8px",
          cursor: "pointer"
        }}
      >
        ⬅ Retour
      </button>

      <div style={{ display: "flex", gap: "10px", marginBottom: "20px" }}>
        <button
          onClick={() => setViewMode("questions")}
          style={buttonToggleStyle(viewMode === "questions")}
        >
          📋 Questions
        </button>
        <button
          onClick={() => setViewMode("groups")}
          style={buttonToggleStyle(viewMode === "groups")}
        >
          📁 Groupes
        </button>
      </div>

      {viewMode === "questions" && (
        <button
          onClick={() => {
            setIsCreating(true);
            setSelectedQuestion(null);
          }}
          style={{
            width: "100%",
            marginBottom: "20px",
            padding: "10px",
            background: "#4a4a4a",
            color: "#eee",
            border: "1px solid #333",
            borderRadius: "8px",
            cursor: "pointer"
          }}
        >
          ➕ Nouvelle question
        </button>
      )}

      {viewMode === "groups" && (
        <button
          onClick={() => startCreateGroup?.()}
          style={{
            width: "100%",
            marginBottom: "20px",
            padding: "10px",
            background: "#3f5b83",
            color: "#eee",
            border: "1px solid #333",
            borderRadius: "8px",
            cursor: "pointer"
          }}
        >
          ➕ Nouveau groupe
        </button>
      )}

      <h2 style={{ marginTop: 0 }}>
        {viewMode === "questions" ? "Questions" : "Groupes"}
      </h2>

      {viewMode === "questions" && (
        <>
          <input
            placeholder="Recherche..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={inputStyle}
          />

          <input
            placeholder="Filtrer tags..."
            value={filterTheme}
            onChange={(e) => setFilterTheme(e.target.value)}
            style={inputStyle}
          />

          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              marginTop: "10px",
              color: "#aaa"
            }}
          >
            <input
              type="checkbox"
              checked={filterDue}
              onChange={(e) => setFilterDue(e.target.checked)}
            />
            À réviser
          </label>

          <div
            style={{
              marginTop: "25px",
              color: "#666",
              fontSize: "14px"
            }}
          >
            {filteredQuestions.length} résultats
          </div>
        </>
      )}

      {viewMode === "groups" && (
        <div
          style={{
            marginTop: "25px",
            color: "#666",
            fontSize: "14px"
          }}
        >
          {allGroups.length} groupes
        </div>
      )}
    </div>
  );
}