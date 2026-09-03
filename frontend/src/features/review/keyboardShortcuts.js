export function eventDigit(event, { min = 0, max = 9 } = {}) {
  const keyDigit = /^[0-9]$/.test(event?.key || "")
    ? Number(event.key)
    : null;
  const codeMatch = /^(?:Digit|Numpad)([0-9])$/.exec(event?.code || "");
  const digit = keyDigit ?? (codeMatch ? Number(codeMatch[1]) : null);

  if (digit === null || digit < min || digit > max) return null;

  return digit;
}
