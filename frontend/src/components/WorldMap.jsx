import {
  ComposableMap,
  Geographies,
  Geography
} from "react-simple-maps";

const geoUrl =
  "https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json";

export default function WorldMap({ found, items }) {
  function isFound(countryName) {
    return items.includes(countryName) && found.includes(countryName);
  }

  return (
    <ComposableMap projectionConfig={{ scale: 150 }}>
      <Geographies geography={geoUrl}>
        {({ geographies }) =>
          geographies.map((geo) => {
            const name = geo.properties.name;

            return (
              <Geography
                key={geo.rsmKey}
                geography={geo}
                style={{
                  default: {
                    fill: isFound(name) ? "#2ecc71" : "#444",
                    outline: "none"
                  },
                  hover: {
                    fill: "#888",
                    outline: "none"
                  },
                  pressed: {
                    fill: "#555",
                    outline: "none"
                  }
                }}
              />
            );
          })
        }
      </Geographies>
    </ComposableMap>
  );
}