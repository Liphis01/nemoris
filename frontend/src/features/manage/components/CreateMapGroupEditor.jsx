import MapFileInput from "../../map/components/MapFileInput";
import { resolveMediaUrl } from "../../../shared/media";
import { questionTypeChipStyles } from "../../../shared/questionTypes";
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
  const typeStyle = questionTypeChipStyles[groupDraft.type_group] || questionTypeChipStyles.map;
  const mapPreviewSrc = isMapGroup && groupDraft.media
    ? `/maps/${groupDraft.media}`
    : "";
  const imagePreviewSrc = !isMapGroup && groupDraft.media
    ? resolveMediaUrl(groupDraft.media)
    : "";
  const canCreate = Boolean(groupDraft.name) && (
    !isMapGroup || Boolean(groupDraft.media)
  );

  return (
    <div style={panelStyle}>
      <div style={{ marginBottom: "22px", color: "#888" }}>
        Nouveau groupe
      </div>

      <div
        style={{
          alignItems: "center",
          background: typeStyle.background,
          border: `1px solid ${typeStyle.color}`,
          borderRadius: "8px",
          color: typeStyle.color,
          display: "inline-flex",
          fontSize: "12px",
          fontWeight: 800,
          marginBottom: "18px",
          padding: "6px 10px",
          textTransform: "uppercase"
        }}
      >
        {isMapGroup ? "Groupe carte" : "Groupe d'images"}
      </div>

      <label style={stackedLabelStyle}>Nom du groupe</label>
      <input
        style={stackedInputStyle}
        value={groupDraft.name}
        onChange={(e) => setGroupDraft({ ...groupDraft, name: e.target.value })}
        placeholder={isMapGroup ? "Ex : Carte Europe" : "Ex : Drapeaux"}
      />

      <label style={stackedLabelStyle}>
        {isMapGroup ? "Fichier SVG de la carte" : "Image de couverture / URL (optionnel)"}
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

      <div
        style={{
          alignItems: "center",
          background: "#111",
          border: "1px solid #2d2d2d",
          borderRadius: "10px",
          display: "flex",
          height: "190px",
          justifyContent: "center",
          marginBottom: "18px",
          overflow: "hidden",
          padding: "12px"
        }}
      >
        {mapPreviewSrc ? (
          <img
            src={mapPreviewSrc}
            alt="Aperçu carte"
            style={{
              height: "100%",
              objectFit: "contain",
              width: "100%"
            }}
          />
        ) : imagePreviewSrc ? (
          <img
            src={imagePreviewSrc}
            alt="Aperçu groupe"
            style={{
              height: "100%",
              objectFit: "contain",
              width: "100%"
            }}
          />
        ) : (
          <span style={{ color: "#666", fontSize: "13px" }}>
            {isMapGroup ? "Aucun SVG sélectionné" : "Aucune image de couverture"}
          </span>
        )}
      </div>

      <div style={{ display: "flex", gap: "10px", marginTop: "10px" }}>
        <button
          type="button"
          onClick={onCreate}
          disabled={!canCreate}
          style={{
            ...buttonStyle,
            cursor: canCreate ? "pointer" : "not-allowed",
            marginRight: "12px",
            opacity: canCreate ? 1 : 0.6
          }}
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
