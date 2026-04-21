import { useState } from "react";

export default function MapEditor({ q }) {
  const [items, setItems] = useState(q.data?.items || []);

  function addItem(value) {
    setItems([...items, value]);
  }

  return (
    <div>
      <h2>Map Editor</h2>

      {items.map((item, i) => (
        <div key={i}>{item}</div>
      ))}

      <input
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            addItem(e.target.value);
            e.target.value = "";
          }
        }}
      />
    </div>
  );
}