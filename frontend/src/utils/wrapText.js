// Wraps long text into lines that fit maxWidth, used by sticky notes and text shapes.
export const wrapText = (ctx, text, maxWidth) => {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [""];

  const lines = [];
  let currentLine = words[0];

  for (let i = 1; i < words.length; i += 1) {
    const testLine = `${currentLine} ${words[i]}`;
    const metrics = ctx.measureText(testLine);
    if (metrics.width > maxWidth) {
      lines.push(currentLine);
      currentLine = words[i];
    } else {
      currentLine = testLine;
    }
  }

  lines.push(currentLine);
  return lines;
};
