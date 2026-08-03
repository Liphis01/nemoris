import { createElement } from "react";
import katex from "katex";
import "katex/dist/katex.min.css";

const DELIMITERS = [
  { open: "$$", close: "$$", display: true },
  { open: "\\[", close: "\\]", display: true },
  { open: "\\(", close: "\\)", display: false },
  { open: "$", close: "$", display: false }
];

function isEscaped(value, index) {
  let slashCount = 0;

  for (let cursor = index - 1; cursor >= 0 && value[cursor] === "\\"; cursor -= 1) {
    slashCount += 1;
  }

  return slashCount % 2 === 1;
}

function findNextDelimiter(value, start) {
  let match = null;

  for (const delimiter of DELIMITERS) {
    let index = value.indexOf(delimiter.open, start);

    while (index !== -1 && isEscaped(value, index)) {
      index = value.indexOf(delimiter.open, index + delimiter.open.length);
    }

    if (index !== -1 && (!match || index < match.index)) {
      match = { ...delimiter, index };
    }
  }

  return match;
}

function splitRichText(value) {
  const source = String(value ?? "");
  const segments = [];
  let cursor = 0;

  while (cursor < source.length) {
    const delimiter = findNextDelimiter(source, cursor);

    if (!delimiter) {
      segments.push({ type: "text", value: source.slice(cursor) });
      break;
    }

    const mathStart = delimiter.index + delimiter.open.length;
    let closeIndex = source.indexOf(delimiter.close, mathStart);

    while (closeIndex !== -1 && isEscaped(source, closeIndex)) {
      closeIndex = source.indexOf(delimiter.close, closeIndex + delimiter.close.length);
    }

    if (closeIndex === -1) {
      segments.push({ type: "text", value: source.slice(cursor) });
      break;
    }

    const math = source.slice(mathStart, closeIndex).trim();

    if (!math) {
      segments.push({
        type: "text",
        value: source.slice(cursor, closeIndex + delimiter.close.length)
      });
      cursor = closeIndex + delimiter.close.length;
      continue;
    }

    if (delimiter.index > cursor) {
      segments.push({ type: "text", value: source.slice(cursor, delimiter.index) });
    }

    segments.push({
      type: "math",
      value: math,
      display: delimiter.display
    });
    cursor = closeIndex + delimiter.close.length;
  }

  return segments.length ? segments : [{ type: "text", value: "" }];
}

export function RichText({
  as = "span",
  children,
  className,
  compact = false,
  style
}) {
  const segments = splitRichText(children);

  return createElement(
    as,
    { className, style: { whiteSpace: "pre-wrap", ...style } },
    segments.map((segment, index) => {
      if (segment.type === "text") {
        return <span key={index}>{segment.value}</span>;
      }

      const displayMode = segment.display && !compact;
      const html = katex.renderToString(segment.value, {
        displayMode,
        output: "html",
        strict: false,
        throwOnError: false
      });

      return (
        <span
          key={index}
          className={displayMode ? "rich-text-math-display" : "rich-text-math-inline"}
          dangerouslySetInnerHTML={{ __html: html }}
        />
      );
    })
  );
}

export default RichText;
