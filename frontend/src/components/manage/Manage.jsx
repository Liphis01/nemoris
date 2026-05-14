import ManageSidebar from "./ManageSidebar";
import ManageList from "./ManageList";
import ManagePreview from "./ManagePreview";
import { useState } from "react";

export default function Manage(props) {
  const [editing, setEditing] = useState(null);

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "260px 380px 1fr",
        height: "100%",
        background: "#121212",
        color: "#eee",
        overflow: "hidden"
      }}
    >
      <ManageSidebar {...props} />

      <ManageList {...props} editing={editing} setEditing={setEditing} />

      <ManagePreview {...props} editing={editing} setEditing={setEditing} />
    </div>
  );
}