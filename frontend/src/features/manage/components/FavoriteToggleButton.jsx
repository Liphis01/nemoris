export default function FavoriteToggleButton({
  favorite,
  onToggle
}) {
  return (
    <button
      type="button"
      aria-label={favorite ? "Retirer des favoris" : "Ajouter aux favoris"}
      title={favorite ? "Retirer des favoris" : "Ajouter aux favoris"}
      onClick={(event) => {
        event.stopPropagation();
        onToggle?.();
      }}
      style={{
        alignItems: "center",
        background: favorite ? "#3d3215" : "#181818",
        border: favorite
          ? "1px solid rgba(255, 204, 122, 0.48)"
          : "1px solid #303030",
        borderRadius: "999px",
        color: favorite ? "#ffcc7a" : "#666",
        cursor: "pointer",
        display: "inline-flex",
        flexShrink: 0,
        fontSize: "15px",
        height: "24px",
        justifyContent: "center",
        lineHeight: 1,
        padding: 0,
        width: "24px"
      }}
    >
      {favorite ? "★" : "☆"}
    </button>
  );
}
