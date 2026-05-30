import AutocompleteInput from "../../../shared/AutocompleteInput";

const mapFiles = Object.keys(import.meta.glob("/public/maps/**/*.svg"))
  .map(path => path.replace(/^\/public\/maps\//, ""))
  .sort((left, right) => left.localeCompare(right));

export default function MapFileInput({
  placeholder = "world.svg",
  ...inputProps
}) {
  return (
    <AutocompleteInput
      {...inputProps}
      placeholder={placeholder}
      suggestions={mapFiles}
    />
  );
}
