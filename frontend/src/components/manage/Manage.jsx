import ManageSidebar from "./ManageSidebar";
import ManageList from "./ManageList";
import ManagePreview from "./ManagePreview";

export default function Manage(props) {

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

      <ManageList {...props} />

      <ManagePreview {...props} />
    </div>
  );
}