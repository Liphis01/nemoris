export default function ManageSidebar({
  setMode,
  search,
  setSearch,
  filterTheme,
  setFilterTheme,
  filterDue,
  setFilterDue,
  filteredQuestions
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

      <h2 style={{ marginTop: 0 }}>
        Manage
      </h2>

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
    </div>
  );
}