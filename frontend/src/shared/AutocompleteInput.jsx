import { useId, useMemo, useState } from "react";

function splitLayoutStyle(style = {}) {
  const {
    alignSelf,
    flex,
    margin,
    marginBottom,
    marginLeft,
    marginRight,
    marginTop,
    maxWidth,
    minWidth,
    width,
    ...inputStyle
  } = style;

  return {
    inputStyle: {
      boxSizing: "border-box",
      ...inputStyle,
      width: "100%"
    },
    wrapperStyle: {
      alignSelf,
      flex,
      margin,
      marginBottom,
      marginLeft,
      marginRight,
      marginTop,
      maxWidth,
      minWidth,
      position: "relative",
      width: width || "100%"
    }
  };
}

function paddingPart(padding, index) {
  if (!padding) return null;

  const parts = String(padding).trim().split(/\s+/);

  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return parts[1];
  if (parts.length === 3) return parts[1];

  return parts[index];
}

function getTextPadding(inputStyle) {
  return {
    left: inputStyle.paddingLeft || paddingPart(inputStyle.padding, 3) || "12px",
    right: inputStyle.paddingRight || paddingPart(inputStyle.padding, 1) || "12px"
  };
}

function valueChangeEvent(value) {
  return {
    currentTarget: { value },
    target: { value }
  };
}

export default function AutocompleteInput({
  suggestions = [],
  value,
  onChange,
  onSuggestionSelect,
  placeholder,
  style,
  ...inputProps
}) {
  const generatedId = useId();
  const helperId = `${generatedId}-autocomplete`;
  const [isHelperOpen, setIsHelperOpen] = useState(false);
  const { inputStyle, wrapperStyle } = splitLayoutStyle(style);
  const textPadding = getTextPadding(inputStyle);
  const query = String(value || "").trim().toLowerCase();
  const visibleSuggestions = useMemo(() => {
    const uniqueSuggestions = Array.from(new Set(
      suggestions
        .map(suggestion => String(suggestion || "").trim())
        .filter(Boolean)
    ));

    if (!query) return uniqueSuggestions;

    return uniqueSuggestions.filter(suggestion =>
      suggestion.toLowerCase().includes(query)
    );
  }, [query, suggestions]);
  const showHelper = isHelperOpen && visibleSuggestions.length > 0;

  function chooseSuggestion(suggestion) {
    if (onSuggestionSelect) {
      onSuggestionSelect(suggestion);
    } else {
      onChange?.(valueChangeEvent(suggestion));
    }

    setIsHelperOpen(false);
  }

  function handleChange(event) {
    setIsHelperOpen(true);
    onChange?.(event);
  }

  function handleBlur(event) {
    setIsHelperOpen(false);
    inputProps.onBlur?.(event);
  }

  function handleFocus(event) {
    setIsHelperOpen(true);
    inputProps.onFocus?.(event);
  }

  function handleKeyDown(event) {
    if (event.key === "Enter" && showHelper) {
      event.preventDefault();
      event.stopPropagation();
      chooseSuggestion(visibleSuggestions[0]);
      return;
    }

    if (event.key === "Escape") {
      setIsHelperOpen(false);
    }

    inputProps.onKeyDown?.(event);
  }

  return (
    <div style={wrapperStyle}>
      <input
        {...inputProps}
        value={value || ""}
        onBlur={handleBlur}
        onChange={handleChange}
        onFocus={handleFocus}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        aria-autocomplete="list"
        aria-controls={showHelper ? helperId : undefined}
        aria-expanded={showHelper}
        style={inputStyle}
      />

      {showHelper && (
        <div
          id={helperId}
          role="listbox"
          className="app-scrollbar"
          style={{
            background: "#161616",
            border: "1px solid #333",
            borderRadius: "8px",
            boxShadow: "0 14px 32px rgba(0, 0, 0, 0.35)",
            boxSizing: "border-box",
            left: 0,
            maxHeight: "180px",
            overflowY: "auto",
            position: "absolute",
            right: 0,
            top: "calc(100% + 4px)",
            zIndex: 30
          }}
        >
          {visibleSuggestions.map((suggestion, index) => (
            <button
              key={suggestion}
              type="button"
              role="option"
              aria-selected={index === 0}
              onMouseDown={(event) => {
                event.preventDefault();
                chooseSuggestion(suggestion);
              }}
              style={{
                background: index === 0 ? "#242424" : "transparent",
                border: "none",
                boxSizing: "border-box",
                color: "#eee",
                cursor: "pointer",
                display: "block",
                font: "inherit",
                padding: `8px ${textPadding.right} 8px ${textPadding.left}`,
                textAlign: "left",
                width: "100%"
              }}
            >
              {suggestion}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
