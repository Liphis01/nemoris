export const containerStyle = {
    height: "100vh",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    margin: "0 auto",
    padding: "20px",
    boxSizing: "border-box",
    maxWidth: "1200px"
};

export const topBarStyle = {
    flexShrink: 0
};

export const tableWrapperStyle = {
    flex: 1,
    overflow: "auto",
    minHeight: 0
};

export const tableStyle = {
    width: "100%",
    borderCollapse: "collapse",
    backgroundColor: "#1e1e1e",
    borderRadius: "8px",
    overflow: "hidden"
};

export const theadStyle = {
    backgroundColor: "#2a2a2a",
    position: "sticky",
    top: 0,
    zIndex: 1
};

export const headerRowStyle = {
    borderBottom: "1px solid #2a2a2a"
};

export const headerStyle = {
    padding: "12px",
    borderBottom: "1px solid #333",
    cursor: "pointer",
    textAlign: "left",
    color: "#aaa",
    // fontWeight: "600",
    // userSelect: "none",
    // background: "#2a2a2a"
};

export const rowStyle = {
    borderBottom: "1px solid #2a2a2a"
};

export const cellStyle = {
    width: "100%",
    padding: "6px",
    borderRadius: "4px",
    border: "1px solid #333",
    background: "#1a1a1a",
    color: "#eee",
    boxSizing: "border-box"
};

export const tdStyle = {
    padding: "8px",
    verticalAlign: "middle"
};

export const toolbarStyle = {
    display: "flex",
    gap: "10px",
    marginBottom: "15px",
    alignItems: "center",
    justifyContent: "center",
    flexWrap: "wrap"
};

export const searchInputStyle = {
    padding: "8px",
    borderRadius: "6px",
    border: "1px solid #333",
    background: "#1a1a1a",
    color: "#eee"
};

export const resultCountStyle = {
    marginBottom: "10px",
    color: "#888"
};

export const buttonStyle = {
    background: "#2a2a2a",
    color: "#eee",
    border: "1px solid #333",
    padding: "8px 14px",
    borderRadius: "6px",
    cursor: "pointer",
    transition: "all 0.1s"
};

export const addButtonStyle = {
    background: "#3a7afe",
    color: "white",
    border: "none",
    padding: "6px 10px",
    borderRadius: "5px",
    cursor: "pointer"
};

export const deleteButtonStyle = {
    background: "#ff4d4f",
    color: "white",
    border: "none",
    padding: "5px 8px",
    borderRadius: "5px",
    cursor: "pointer"
};

export const iconButtonStyle = {
    background: "#2a2a2a",
    color: "#eee",
    border: "1px solid #333",
    borderRadius: "6px",
    padding: "6px 10px",
    cursor: "pointer"
};

export const previewImageStyle = (mousePos) => ({
    position: "fixed",
    top: mousePos.y + 20,
    left: mousePos.x + 20,
    maxWidth: "300px",
    maxHeight: "300px",
    borderRadius: "10px",
    pointerEvents: "none",
    boxShadow: "0 0 15px rgba(0,0,0,0.5)",
    zIndex: 9999,
    background: "#000"
});