export default function MapRow({
  q,
  setEditingQuestion,
  setEditingTagsQuestion
}) {
  return (
    <tr>
      <td>🗺️</td>

      <td colSpan={2}>
        {q.media} ({q.zones.length} zones)
      </td>

      <td>
        <button onClick={() => setEditingTagsQuestion(q)}>
          🏷️
        </button>
      </td>

      <td>map</td>

      <td>-</td>

      <td>
        {q.zones.filter(z => z.next_review).length} à revoir
      </td>

      <td>
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