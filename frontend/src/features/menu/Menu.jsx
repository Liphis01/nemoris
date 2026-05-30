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

export default function Menu({
    setMode,
    startupNotice,
    onDismissStartupNotice
}) {

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
                            fontSize: "70px",
                            lineHeight: 1,
                            fontWeight: "800",
                            marginBottom: "14px"
                        }}
                    >
                        Nemoris
                    </h1>
                </div>

                {startupNotice && (
                    <div
                        style={{
                            alignItems: "center",
                            background: "linear-gradient(180deg, #17211b 0%, #141b16 100%)",
                            border: "1px solid rgba(126, 226, 168, 0.24)",
                            borderRadius: "14px",
                            color: "#d8f6e2",
                            display: "flex",
                            gap: "14px",
                            justifyContent: "space-between",
                            marginBottom: "22px",
                            padding: "14px 16px",
                            boxShadow: "0 14px 34px rgba(0, 0, 0, 0.18)"
                        }}
                    >
                        <div style={{ textAlign: "left" }}>
                            <div
                                style={{
                                    color: "#7ee2a8",
                                    fontSize: "11px",
                                    fontWeight: "800",
                                    letterSpacing: "0.06em",
                                    marginBottom: "4px",
                                    textTransform: "uppercase"
                                }}
                            >
                                Calendrier rééquilibré
                            </div>

                            <div
                                style={{
                                    color: "#cfe9d8",
                                    fontSize: "14px",
                                    lineHeight: 1.45
                                }}
                            >
                                {startupNotice.moved} question{startupNotice.moved > 1 ? "s" : ""} déplacée{startupNotice.moved > 1 ? "s" : ""} pour garder environ {startupNotice.daily_target}/jour.
                            </div>
                        </div>

                        <button
                            type="button"
                            onClick={onDismissStartupNotice}
                            style={{
                                alignItems: "center",
                                background: "rgba(126, 226, 168, 0.08)",
                                border: "1px solid rgba(126, 226, 168, 0.22)",
                                borderRadius: "999px",
                                color: "#a7e7bc",
                                cursor: "pointer",
                                display: "inline-flex",
                                fontSize: "16px",
                                height: "30px",
                                justifyContent: "center",
                                lineHeight: 1,
                                padding: 0,
                                width: "30px"
                            }}
                            aria-label="Masquer"
                            title="Masquer"
                        >
                            ×
                        </button>
                    </div>
                )}

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

                        {/* CALENDAR */}
                        <div
                            onClick={() => setMode("calendar")}
                            style={{
                                ...cardStyle,
                                flex: 1,
                                background:
                                    "linear-gradient(180deg, #171a18 0%, #141614 100%)"
                            }}
                            onMouseEnter={(e) => {
                                e.currentTarget.style.transform =
                                    "translateY(-2px)";
                                e.currentTarget.style.border =
                                    "1px solid #3a3a3a";
                                e.currentTarget.style.background =
                                    "linear-gradient(180deg, #1d241f 0%, #171a18 100%)";
                            }}
                            onMouseLeave={(e) => {
                                e.currentTarget.style.transform =
                                    "translateY(0px)";
                                e.currentTarget.style.border =
                                    "1px solid #2a2a2a";
                                e.currentTarget.style.background =
                                    "linear-gradient(180deg, #171a18 0%, #141614 100%)";
                            }}
                        >

                            <div
                                style={{
                                    ...badgeStyle,
                                    background: "#163524",
                                    color: "#7ee2a8"
                                }}
                            >
                                CALENDAR
                            </div>

                            <div
                                style={{
                                    fontSize: "22px",
                                    fontWeight: "700",
                                    marginBottom: "10px"
                                }}
                            >
                                Calendrier
                            </div>

                            <div
                                style={{
                                    color: "#888",
                                    fontSize: "14px",
                                    lineHeight: 1.5
                                }}
                            >
                                Voir les questions dues par jour et préparer les prochaines reviews.
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
