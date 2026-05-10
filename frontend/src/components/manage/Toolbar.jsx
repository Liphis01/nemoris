import { toolbarStyle, searchInputStyle } from "./styles";

export default function Toolbar({
  setMode,
  search,
  setSearch,
  filterTheme,
  setFilterTheme,
  filterDue,
  setFilterDue,
  count
}) {
  return (
    <div style={{ flexShrink: 0 }}>

      <button
        onClick={() => setMode("menu")}
        style={{
          alignSelf: "flex-start",
          marginBottom: "20px",
          background: "#2a2a2a",
          color: "#eee",
          border: "1px solid #333",
          padding: "8px 14px",
          borderRadius: "6px",
          cursor: "pointer",
          transition: "all 0.1s"
        }}
        onMouseEnter={(e) => e.target.style.opacity = "0.8"}
        onMouseLeave={(e) => e.target.style.opacity = "1"}
        onMouseDown={(e) => e.target.style.transform = "scale(0.95)"}
        onMouseUp={(e) => e.target.style.transform = "scale(1)"}
      >
        ⬅ Retour
      </button>

      <h2 style={{ marginBottom: "20px" }}>
        Gestion des questions
      </h2>

      <div style={toolbarStyle}>
        <input
          placeholder="Recherche..."
          style={searchInputStyle}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />

        <input
          placeholder="Filtrer tags"
          style={searchInputStyle}
          value={filterTheme}
          onChange={(e) => setFilterTheme(e.target.value)}
        />

        <label>
          <input
            style={{ marginRight: "6px" }}
            type="checkbox"
            checked={filterDue}
            onChange={(e) => setFilterDue(e.target.checked)}
          />
          À réviser
        </label>
      </div>

      <div style={{ color: "#888", marginBottom: "10px" }}>
        {count} résultats
      </div>
    </div >
  );
}