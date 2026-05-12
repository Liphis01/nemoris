const mainButtonStyle = {
    background: "#1f1f1f",
    color: "#eee",
    border: "1px solid #333",
    padding: "15px",
    borderRadius: "8px",
    cursor: "pointer",
    fontSize: "16px"
};

export default function Menu({ setMode }) {
    return (
        <div style={{ maxWidth: "600px", margin: "auto", textAlign: "center" }}>
            <h1 style={{ marginBottom: "40px" }}>
                Quiz App
            </h1>

            <div style={{ display: "flex", flexDirection: "column", gap: "15px" }}>
                <button
                    onClick={() => setMode("quiz")}
                    style={mainButtonStyle}
                >
                    ▶ Review du jour
                </button>

                <button
                    onClick={() => setMode("manage")}
                    style={mainButtonStyle}
                >
                    🗂 Gestionnaire des questions
                </button>
            </div>
        </div>

    );
}