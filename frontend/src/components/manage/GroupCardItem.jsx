export default function GroupCardItem({
  group,
  selected,
  deleteOpen,
  isRemoving,
  onClick,
  onDeleteOpen,
  closeDelete,
  deleteGroup
}) {
  return (
    <div
      data-delete-card-id={group.id}
      onClick={(event) => {
        if (deleteOpen) {
          closeDelete?.();
          return;
        }
        onClick?.();
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        onDeleteOpen?.();
      }}
      style={{
        padding: "14px",
        borderBottom: "1px solid #2a2a2a",
        cursor: "pointer",
        background: selected ? "#222" : "transparent",
        transition: "0.18s ease, background 0.15s",
        overflow: "hidden",
        position: "relative",
        transform: isRemoving ? "scaleY(0.92)" : "scaleY(1)",
        opacity: isRemoving ? 0 : 1,
        transformOrigin: "top",
      }}
    >
      <div
        style={{
          position: "absolute",
          top: 0,
          right: 0,
          height: "100%",
          width: "52px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          transform: deleteOpen ? "translateX(0)" : "translateX(100%)",
          transition: "transform 0.18s ease",
          background: "rgba(139, 15, 15, 0.95)",
          borderLeft: "1px solid rgba(255,255,255,0.05)",
          zIndex: 1
        }}
      >
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            deleteGroup?.();
          }}
          style={{
            width: "36px",
            height: "36px",
            borderRadius: "999px",
            border: "none",
            background: "#b01d1d",
            color: "white",
            cursor: "pointer",
            fontSize: "16px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center"
          }}
        >
          🗑
        </button>
      </div>
      <div
        style={{
          fontSize: "12px",
          color: "#888",
          marginBottom: "6px"
        }}
      >
        {group.type_group}
      </div>

      <div
        style={{
          fontWeight: "bold",
          marginBottom: "6px"
        }}
      >
        {group.name}
      </div>

      <div
        style={{
          color: "#999",
          fontSize: "14px"
        }}
      >
        {group.question_count || 0} questions
      </div>
    </div>
  );
}
