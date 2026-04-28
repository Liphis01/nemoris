import { useState, useEffect } from "react";

export default function Manage({
    setMode,
    allQuestions,
    filteredQuestions,
    questionInputRef,
    setAllQuestions,
    updateQuestion,
    deleteQuestion,
    newRow,
    setNewRow,
    createQuestion,
    handleUpload,
    deleteImage,
    search,
    setSearch,
    filterTheme,
    setFilterTheme,
    filterDue,
    setFilterDue,
    handleSort,
    sortField,
    sortOrder,
    editingQuestion,
    setEditingQuestion
}) {
    const [hoveredImage, setHoveredImage] = useState(null);
    const [mousePos, setMousePos] = useState({ x: 0, y: 0 });

    const containerStyle = {
        height: "100vh",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden", // empêche scroll global
        margin: "0 auto",
        padding: "20px",
        boxSizing: "border-box",
        maxWidth: "1200px"
    };

    const headerStyle = {
        padding: "12px",
        borderBottom: "1px solid #333",
        cursor: "pointer",
        textAlign: "left",
        color: "#aaa"
    };

    const cellStyle = {
        width: "100%",
        padding: "6px",
        borderRadius: "4px",
        border: "1px solid #333",
        background: "#1a1a1a",
        color: "#eee",
        boxSizing: "border-box"
    };

    function handleNewRowKeyDown(e) {
        if (e.key === "Enter") {
            e.preventDefault();
            createQuestion();

            setTimeout(() => {
                questionInputRef.current?.focus();
            }, 0);
        }
    }

    return (
        <div
            // style={{ maxWidth: "1200px", margin: "auto" }}
            style={containerStyle}
        >
            <div style = {{flexShrink: 0}}>
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
                <div
                    style={{
                        display: "flex",
                        gap: "10px",
                        marginBottom: "15px",
                        alignItems: "center",
                        justifyContent: "center",
                        flexWrap: "wrap"
                    }}
                >
                    <input
                        placeholder="Recherche..."
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        style={{
                            padding: "8px",
                            borderRadius: "6px",
                            border: "1px solid #333",
                            background: "#1a1a1a",
                            color: "#eee"
                        }}
                    />

                    <input
                        placeholder="Filtrer par thème"
                        value={filterTheme}
                        onChange={(e) => setFilterTheme(e.target.value)}
                        style={{
                            padding: "8px",
                            borderRadius: "6px",
                            border: "1px solid #333",
                            background: "#1a1a1a",
                            color: "#eee"
                        }}
                    />

                    <label>
                        <input
                            type="checkbox"
                            checked={filterDue}
                            onChange={(e) => setFilterDue(e.target.checked)}
                        />
                        À réviser
                    </label>
                </div>
                <div style={{ marginBottom: "10px", color: "#888" }}>
                    {filteredQuestions.length} résultats
                </div>
            </div>

            <div style={{ flex: 1, overflow: "auto", minHeight: "0" }}>
                <table
                    style={{
                        width: "100%",
                        borderCollapse: "collapse",
                        backgroundColor: "#1e1e1e",
                        borderRadius: "8px",
                        overflow: "hidden"
                    }}
                >
                    <thead style={{
                        backgroundColor: "#2a2a2a",
                        position: "sticky",
                        top: 0,
                        zIndex: 1
                    }}>
                        <tr
                            style={{ borderBottom: "1px solid #2a2a2a" }}
                            onMouseEnter={(e) => e.currentTarget.style.background = "#2a2a2a"}
                            onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
                        >
                            <th style={headerStyle}
                                onClick={() => handleSort("id")}>
                                ID {sortField === "id" ? (sortOrder === "asc" ? "⬇️" : "⬆️") : ""}
                            </th>
                            <th style={headerStyle}
                                onClick={() => handleSort("question")}>
                                Question {sortField === "question" ? (sortOrder === "asc" ? "⬇️" : "⬆️") : ""}
                            </th>

                            <th style={headerStyle}
                                onClick={() => handleSort("answer")}>
                                Réponse {sortField === "answer" ? (sortOrder === "asc" ? "⬇️" : "⬆️") : ""}
                            </th>

                            <th style={headerStyle}
                                onClick={() => handleSort("theme")}>
                                Thème {sortField === "theme" ? (sortOrder === "asc" ? "⬇️" : "⬆️") : ""}
                            </th>

                            <th style={headerStyle}
                                onClick={() => handleSort("type_q")}>
                                Type {sortField === "type_q" ? (sortOrder === "asc" ? "⬇️" : "⬆️") : ""}
                            </th>

                            <th style={headerStyle}
                                onClick={() => handleSort("fichier")}>
                                Fichier {sortField === "fichier" ? (sortOrder === "asc" ? "⬇️" : "⬆️") : ""}
                            </th>

                            <th style={headerStyle}
                                onClick={() => handleSort("next_review")}>
                                Review {sortField === "next_review" ? (sortOrder === "asc" ? "⬇️" : "⬆️") : ""}
                            </th>

                            <th></th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr>
                            <td>new</td>

                            <td>
                                <input
                                    style={cellStyle}
                                    ref={questionInputRef}
                                    autoFocus
                                    value={newRow.question}
                                    onChange={(e) =>
                                        setNewRow({ ...newRow, question: e.target.value })
                                    }
                                    onKeyDown={handleNewRowKeyDown}
                                    placeholder="Question"
                                />
                            </td>

                            <td>
                                <input
                                    style={cellStyle}
                                    value={newRow.answer}
                                    onChange={(e) =>
                                        setNewRow({ ...newRow, answer: e.target.value })
                                    }
                                    onKeyDown={handleNewRowKeyDown}
                                    placeholder="Réponse"
                                />
                            </td>

                            <td>
                                <input
                                    style={cellStyle}
                                    value={newRow.theme}
                                    onChange={(e) =>
                                        setNewRow({ ...newRow, theme: e.target.value })
                                    }
                                    onKeyDown={handleNewRowKeyDown}
                                    placeholder="Thème"
                                />
                            </td>


                            <td>
                                <select
                                    value={newRow.type_q}
                                    onChange={(e) =>
                                        setNewRow({ ...newRow, type_q: e.target.value })
                                    }
                                    onKeyDown={handleNewRowKeyDown}
                                    style={{
                                        ...cellStyle,
                                        padding: "6px",
                                        background: "#1a1a1a",
                                        color: "#eee"
                                    }}
                                >
                                    <option value="text">text</option>
                                    <option value="image">image</option>
                                    <option value="map">map</option>
                                </select>
                            </td>

                            <td
                                onMouseEnter={(e) => {
                                    if (newRow.fichier) {
                                        setHoveredImage(newRow.fichier);
                                        setMousePos({ x: e.clientX, y: e.clientY });
                                    }
                                }}
                                onMouseMove={(e) => {
                                    setMousePos({ x: e.clientX, y: e.clientY });
                                }}
                                onMouseLeave={() => setHoveredImage(null)}
                            >
                                {/* <input
                                    style={cellStyle}
                                    value={newRow.fichier || ""}
                                    onChange={(e) =>
                                        setNewRow({ ...newRow, fichier: e.target.value })
                                    }
                                    onKeyDown={handleNewRowKeyDown}
                                    placeholder="URL de l'image"
                                /> */}

                                {newRow.fichier && (
                                    <button onClick={() => setNewRow({ ...newRow, fichier: "" })}>
                                        ❌
                                    </button>
                                )}

                                <input
                                    type="file"
                                    accept="image/*"
                                    onChange={(e) =>
                                        setNewRow({ ...newRow, fichier: URL.createObjectURL(e.target.files[0]) })
                                    }
                                />

                            </td>

                            <td>-</td>

                            <td>
                                <button
                                    onClick={createQuestion}
                                    style={{
                                        background: "#3a7afe",
                                        color: "white",
                                        border: "none",
                                        padding: "6px 10px",
                                        borderRadius: "5px",
                                        cursor: "pointer"
                                    }}
                                >
                                    ➕
                                </button>
                            </td>
                        </tr>


                        {filteredQuestions.map((q, index) => (
                            <tr
                                key={q.id}

                            >
                                <td
                                    onClick={() => {
                                        if (q.type_q === "map") {
                                            setEditingQuestion(q);
                                        }
                                    }}
                                    style={{ cursor: "pointer" }}
                                >
                                    {q.id}
                                </td>

                                <td>
                                    <input
                                        style={cellStyle}
                                        value={q.question}
                                        onChange={(e) => {
                                            const updated = [...allQuestions];
                                            updated[index].question = e.target.value;
                                            setAllQuestions(updated);
                                        }}
                                        onBlur={() => updateQuestion(q.id, { question: q.question })}
                                    />
                                </td>

                                <td>
                                    <input
                                        style={cellStyle}
                                        value={q.answer === "" ? q.data.items.length : q.answer}
                                        onChange={(e) => {
                                            const updated = [...allQuestions];
                                            updated[index].answer = e.target.value;
                                            setAllQuestions(updated);
                                        }}
                                        onBlur={() => updateQuestion(q.id, { answer: q.answer })}
                                    />
                                </td>

                                <td>
                                    <input
                                        style={cellStyle}
                                        value={q.theme}
                                        onChange={(e) => {
                                            const updated = [...allQuestions];
                                            updated[index].theme = e.target.value;
                                            setAllQuestions(updated);
                                        }}
                                        onBlur={() => updateQuestion(q.id, { theme: q.theme })}
                                    />
                                </td>

                                <td>
                                    <select
                                        value={q.type_q}
                                        onChange={(e) => {
                                            // onChange={(e) =>
                                            //     updateQuestion(q.id, { type_q: e.target.value })
                                            // }
                                            const updated = [...allQuestions];
                                            updated[index].type_q = e.target.value;
                                            setAllQuestions(updated);
                                        }}
                                        style={{
                                            ...cellStyle,
                                            padding: "6px",
                                            background: "#1a1a1a",
                                            color: "#eee"
                                        }}
                                    >
                                        <option value="text">text</option>
                                        <option value="image">image</option>
                                        <option value="map">map</option>
                                    </select>
                                </td>

                                <td
                                    onMouseEnter={(e) => {
                                        if (q.type_q === "text" && q.fichier) {
                                            setHoveredImage(q.fichier);
                                            setMousePos({ x: e.clientX, y: e.clientY });
                                        }
                                    }}
                                    onMouseMove={(e) => {
                                        setMousePos({ x: e.clientX, y: e.clientY });
                                    }}
                                    onMouseLeave={() => setHoveredImage(null)}
                                >
                                    {q.type_q === "map" && <input
                                        style={cellStyle}
                                        value={q.fichier || ""}
                                        onChange={(e) => {
                                            const updated = [...allQuestions];
                                            updated[index].fichier = e.target.value;
                                            setAllQuestions(updated);
                                        }}
                                        onBlur={() => updateQuestion(q.id, { fichier: q.fichier })}
                                    />}

                                    {/* {q.fichier && (
                                        <button onClick={() => deleteImage(q.id)}>
                                            ❌
                                        </button>
                                    )} */}

                                    {q.type_q !== "map" && <input
                                        type="file"
                                        accept="image/*"
                                        onChange={(e) => handleUpload(e, q)}
                                    />}

                                </td>

                                <td>{q.next_review || "-"}</td>

                                <td>
                                    <button
                                        onClick={() => deleteQuestion(q.id)}
                                        style={{
                                            background: "#ff4d4f",
                                            color: "white",
                                            border: "none",
                                            padding: "5px 8px",
                                            borderRadius: "5px",
                                            cursor: "pointer"
                                        }}
                                    >
                                        🗑
                                    </button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {
                hoveredImage && (
                    <img
                        src={hoveredImage}
                        alt="preview"
                        style={{
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
                        }}
                    />
                )
            }

        </div >
    );
}