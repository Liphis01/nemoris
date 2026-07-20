import { useRef, useState } from "react";
import { uploadMedia } from "../../../api/questions";

export default function MapMediaInput({ value, onChange, style }) {
  const fileInputRef = useRef(null);
  const [uploading, setUploading] = useState(false);

  function handlePickFile() {
    fileInputRef.current?.click();
  }

  async function handleFileChange(event) {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file) return;

    setUploading(true);

    try {
      const result = await uploadMedia(file);
      onChange(result.url);
    } finally {
      setUploading(false);
    }
  }

  return (
    <div style={{ alignItems: "center", display: "flex", gap: "8px", minWidth: 0 }}>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/svg+xml"
        onChange={handleFileChange}
        style={{ display: "none" }}
      />
      <button
        type="button"
        onClick={handlePickFile}
        disabled={uploading}
        style={{
          background: "#222",
          border: "1px solid #333",
          borderRadius: "8px",
          color: "#eee",
          cursor: uploading ? "default" : "pointer",
          flexShrink: 0,
          fontSize: "13px",
          opacity: uploading ? 0.6 : 1,
          padding: "9px 12px"
        }}
      >
        {uploading ? "Import…" : "📁 Importer un SVG"}
      </button>
      <input
        value={value || ""}
        onChange={(event) => onChange(event.target.value)}
        placeholder="ou colle une URL"
        style={{ ...style, flex: 1, minWidth: 0 }}
      />
    </div>
  );
}
