import MapFileInput from "../../map/components/MapFileInput";
import {
  buttonStyle,
  inputStyle,
  labelStyle,
  panelStyle
} from "./QuestionEditorStyles";

const stackedLabelStyle = {
  ...labelStyle,
  display: "block",
  marginBottom: "8px"
};

const stackedInputStyle = {
  ...inputStyle,
  marginBottom: "18px"
};

export default function CreateMapGroupEditor({
  groupDraft,
  onCancel,
  onCreate,
  setGroupDraft
}) {
  const isMapGroup = groupDraft.type_group === "map";

  return (
    <div style={panelStyle}>
      <div style={{ marginBottom: "22px", color: "#888" }}>
        Nouveau groupe
      </div>

      <label style={stackedLabelStyle}>Nom du groupe</label>
      <input
        style={stackedInputStyle}
        value={groupDraft.name}
        onChange={(e) => setGroupDraft({ ...groupDraft, name: e.target.value })}
        placeholder="Ex : Carte Europe"
      />

      <label style={stackedLabelStyle}>Type de groupe</label>
      <select
        style={stackedInputStyle}
        value={groupDraft.type_group}
        onChange={(e) => setGroupDraft({ ...groupDraft, type_group: e.target.value })}
      >
        <option value="map">map</option>
        <option value="image">image</option>
      </select>

      <label style={stackedLabelStyle}>
        {isMapGroup ? "Media / URL (optionnel)" : "Image de couverture / URL (optionnel)"}
      </label>
      {isMapGroup ? (
        <MapFileInput
          style={stackedInputStyle}
          value={groupDraft.media}
          onChange={(e) => setGroupDraft({ ...groupDraft, media: e.target.value })}
        />
      ) : (
        <input
          style={stackedInputStyle}
          value={groupDraft.media || ""}
          onChange={(e) => setGroupDraft({ ...groupDraft, media: e.target.value })}
          placeholder="https://... ou /static/image.jpg"
        />
      )}

      <div style={{ display: "flex", gap: "10px", marginTop: "10px" }}>
        <button
          type="button"
          onClick={onCreate}
          style={{ ...buttonStyle, marginRight: "12px" }}
        >
          Créer le groupe
        </button>
        <button
          type="button"
          onClick={onCancel}
          style={{ ...buttonStyle, background: "#641c1c", marginRight: "12px" }}
        >
          Annuler
        </button>
      </div>
    </div>
  );
}
