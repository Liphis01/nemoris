const cardStyle = {
    background: "#181818",
    border: "1px solid #2a2a2a",
    borderRadius: "18px",
    padding: "22px",
    cursor: "pointer",
    transition: "all 0.15s ease",
    textAlign: "left"
};

const badgeStyle = {
    display: "inline-flex",
    alignItems: "center",
    padding: "4px 10px",
    borderRadius: "999px",
    fontSize: "11px",
    fontWeight: "700",
    letterSpacing: "0.04em",
    marginBottom: "14px"
};

export default function Menu({ setMode }) {

    return (
        <div
            style={{
                minHeight: "100vh",
                background: "#111",
                color: "#eee",
                display: "flex",
                justifyContent: "center",
                padding: "60px 20px",
                boxSizing: "border-box"
            }}
        >

            <div
                style={{
                    width: "100%",
                    maxWidth: "950px"
                }}
            >

                {/* HEADER */}
                <div
                    style={{
                        marginBottom: "40px"
                    }}
                >

                    <div
                        style={{
                            color: "#777",
                            fontSize: "13px",
                            marginBottom: "10px",
                            letterSpacing: "0.08em"
                        }}
                    >
                        SPACED REPETITION SYSTEM
                    </div>

                    <h1
                        style={{
                            margin: 0,
                            fontSize: "52px",
                            lineHeight: 1,
                            fontWeight: "800",
                            marginBottom: "14px"
                        }}
                    >
                        Quiz App
                    </h1>
                </div>

                {/* MAIN GRID */}
                <div
                    style={{
                        display: "grid",
                        gridTemplateColumns: "1.4fr 1fr",
                        gap: "18px"
                    }}
                >

                    {/* REVIEW */}
                    <div
                        onClick={() => setMode("quiz")}
                        style={{
                            ...cardStyle,
                            minHeight: "240px",
                            display: "flex",
                            flexDirection: "column",
                            justifyContent: "space-between",
                            background:
                                "linear-gradient(180deg, #1a1a1a 0%, #151515 100%)"
                        }}
                        onMouseEnter={(e) => {
                            e.currentTarget.style.transform = "translateY(-2px)";
                            e.currentTarget.style.border =
                                "1px solid #3a3a3a";
                            e.currentTarget.style.background =
                                "linear-gradient(180deg, #202020 0%, #181818 100%)";
                        }}
                        onMouseLeave={(e) => {
                            e.currentTarget.style.transform = "translateY(0px)";
                            e.currentTarget.style.border =
                                "1px solid #2a2a2a";
                            e.currentTarget.style.background =
                                "linear-gradient(180deg, #1a1a1a 0%, #151515 100%)";
                        }}
                    >

                        <div>

                            <div
                                style={{
                                    ...badgeStyle,
                                    background: "#3d2b14",
                                    color: "#ffcc7a"
                                }}
                            >
                                REVIEW
                            </div>

                            <div
                                style={{
                                    fontSize: "34px",
                                    fontWeight: "800",
                                    marginBottom: "14px",
                                    lineHeight: 1.05
                                }}
                            >
                                Révision du jour
                            </div>

                            <div
                                style={{
                                    color: "#8a8a8a",
                                    lineHeight: 1.6,
                                    maxWidth: "520px"
                                }}
                            >
                                Lance une session de review avec les questions dues :
                                texte, maps, images et futurs types.
                            </div>

                        </div>

                        <div
                            style={{
                                display: "flex",
                                justifyContent: "space-between",
                                alignItems: "center",
                                marginTop: "30px"
                            }}
                        >

                            <div
                                style={{
                                    color: "#666",
                                    fontSize: "13px"
                                }}
                            >
                                Spaced repetition
                            </div>

                            <div
                                style={{
                                    fontSize: "28px"
                                }}
                            >
                                →
                            </div>

                        </div>

                    </div>

                    {/* RIGHT COLUMN */}
                    <div
                        style={{
                            display: "flex",
                            flexDirection: "column",
                            gap: "18px"
                        }}
                    >

                        {/* MANAGE */}
                        <div
                            onClick={() => setMode("manage")}
                            style={{
                                ...cardStyle,
                                flex: 1
                            }}
                            onMouseEnter={(e) => {
                                e.currentTarget.style.transform =
                                    "translateY(-2px)";
                                e.currentTarget.style.border =
                                    "1px solid #3a3a3a";
                                e.currentTarget.style.background = "#1d1d1d";
                            }}
                            onMouseLeave={(e) => {
                                e.currentTarget.style.transform =
                                    "translateY(0px)";
                                e.currentTarget.style.border =
                                    "1px solid #2a2a2a";
                                e.currentTarget.style.background = "#181818";
                            }}
                        >

                            <div
                                style={{
                                    ...badgeStyle,
                                    background: "#2b2047",
                                    color: "#b69cff"
                                }}
                            >
                                MANAGE
                            </div>

                            <div
                                style={{
                                    fontSize: "22px",
                                    fontWeight: "700",
                                    marginBottom: "10px"
                                }}
                            >
                                Gestionnaire
                            </div>

                            <div
                                style={{
                                    color: "#888",
                                    fontSize: "14px",
                                    lineHeight: 1.5
                                }}
                            >
                                Modifier les questions, tags,
                                groupes, collections et maps.
                            </div>

                        </div>

                        {/* FUTURE BLOCK */}
                        <div
                            style={{
                                ...cardStyle,
                                background:
                                    "linear-gradient(180deg, #171717 0%, #141414 100%)"
                            }}
                        >

                            <div
                                style={{
                                    color: "#666",
                                    fontSize: "11px",
                                    fontWeight: "700",
                                    letterSpacing: "0.08em",
                                    marginBottom: "12px"
                                }}
                            >
                                TYPES SUPPORTÉS
                            </div>

                            <div
                                style={{
                                    display: "flex",
                                    flexWrap: "wrap",
                                    gap: "8px"
                                }}
                            >

                                {[
                                    ["TEXT", "#2b2047", "#b69cff"],
                                    ["MAP", "#3d2b14", "#ffcc7a"],
                                    ["IMAGE", "#163524", "#7ee2a8"],
                                    ["AUDIO", "#3a1d2d", "#ff9ccc"]
                                ].map(([label, bg, color]) => (
                                    <div
                                        key={label}
                                        style={{
                                            background: bg,
                                            color,
                                            padding: "5px 10px",
                                            borderRadius: "999px",
                                            fontSize: "11px",
                                            fontWeight: "700"
                                        }}
                                    >
                                        {label}
                                    </div>
                                ))}

                            </div>

                        </div>

                    </div>

                </div>

            </div>

        </div>
    );
}