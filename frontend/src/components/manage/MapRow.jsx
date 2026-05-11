import { cellStyle } from "./styles";

export default function MapRow({
  q,
  setEditingQuestion,
  setEditingTagsQuestion
}) {
  return (
    <tr>
      <td style={cellStyle}>🗺️</td>

      <td colSpan={2} style={{ ...cellStyle, fontWeight: "600", color: "#aaa" }}>
        {q.media} ({q.zones.length} zones)
      </td>

      <td colSpan={4} style={cellStyle}>
        <button onClick={() => setEditingTagsQuestion(q)}>
          🏷️
        </button>
      </td>

      <td style={cellStyle}>map</td>

      <td style={cellStyle}>-</td>

      <td style={cellStyle}>
        {q.zones.filter(z => z.next_review).length} à revoir
      </td>

      <td style={cellStyle}>
        <button
          onClick={() =>
            setEditingQuestion({
              type_q: "map",
              media: q.media
            })
          }
        >
          ✏️
        </button>
      </td>
    </tr>
  );
}