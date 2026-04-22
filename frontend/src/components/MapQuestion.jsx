import { useState } from "react";

export default function MapQuestion({ 
    q,
}) {
  const [input, setInput] = useState("");
  const [found, setFound] = useState([]);

  const items = q.data?.items || [];

  function handleSubmit() {
    const normalized = input.trim().toLowerCase();

    const match = items.find(
      (item) => item.toLowerCase() === normalized
    );

    if (match && !found.includes(match)) {
      setFound([...found, match]);
    }

    setInput("");
  }

  return (
    <div>
      <h3>{q.question}</h3>

      <input
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
        placeholder="Tape une réponse..."
      />

      <p>{found.length} / {items.length}</p>

      <div style={{ marginTop: "20px" }}>
        {items.map((item) => (
          <span
            key={item}
            style={{
              marginRight: "10px",
              color: found.includes(item) ? "green" : "gray"
            }}
          >
            {found.includes(item) ? item : "???"}
          </span>
        ))}
      </div>
    </div>
  );
}