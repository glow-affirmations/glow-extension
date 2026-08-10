const DIRECTION_TAG_PATTERN = /\[[^\]\r\n]*\]/g;

export function displayAffirmationText(text: string): string {
  return text
    .replace(DIRECTION_TAG_PATTERN, " ")
    .replace(/[ \t]+([,.;:!?])/g, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]*\n[ \t]*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
