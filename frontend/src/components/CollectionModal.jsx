import { useEffect, useState } from "react";

export default function CollectionModal({ q, onClose }) {
  const [collections, setCollections] = useState([]);
  const [selected, setSelected] = useState(q.collections || []);
  const [newName, setNewName] = useState("");

  useEffect(() => {
    fetch("http://localhost:8000/collections")
      .then(res => res.json())
      .then(setCollections);
  }, []);

  function toggle(id) {
    if (selected.includes(id)) {
      setSelected(selected.filter(x => x !== id));
    } else {
      setSelected([...selected, id]);
    }
  }

  async function save() {
    await fetch(`http://localhost:8000/questions/${q.id}/collections`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ collection_ids: selected })
    });

    onClose();
  }

  async function createCollection() {
    const res = await fetch("http://localhost:8000/collections", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ name: newName })
    });

    const created = await res.json();

    setCollections([...collections, created]);
    setNewName("");
  }

  return (
    <div style={overlay}>
      <div style={modal} onClick={(e) => e.stopPropagation()}>

        <h3>Collections</h3>

        <div style={{ maxHeight: "200px", overflow: "auto" }}>
          {collections.map(c => (
            <div key={c.id}>
              <label>
                <input
                  type="checkbox"
                  checked={selected.includes(c.id)}
                  onChange={() => toggle(c.id)}
                />
                {c.name}
              </label>
            </div>
          ))}
        </div>

        <div style={{ marginTop: "10px" }}>
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Nouvelle collection"
          />
          <button onClick={createCollection}>+</button>
        </div>

        <button onClick={save}>Sauvegarder</button>

      </div>
    </div>
  );
}

const overlay = {
  position: "fixed",
  top: 0,
  left: 0,
  width: "100%",
  height: "100%",
  background: "rgba(0,0,0,0.6)",
  display: "flex",
  justifyContent: "center",
  alignItems: "center"
};

const modal = {
  background: "#1e1e1e",
  padding: "20px",
  borderRadius: "10px",
  width: "300px"
};