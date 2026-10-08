const namedColors: Record<string, string> = {
  black: "#000000",
  silver: "#c0c0c0",
  gray: "#808080",
  white: "#ffffff",
  maroon: "#800000",
  red: "#ff0000",
  purple: "#800080",
  fuchsia: "#ff00ff",
  green: "#008000",
  lime: "#00ff00",
  olive: "#808000",
  yellow: "#ffff00",
  navy: "#000080",
  blue: "#0000ff",
  teal: "#008080",
  aqua: "#00ffff",
};

export function tagChipStyle(color: string) {
  const value = color.trim().toLowerCase();
  const resolved = namedColors[value] ?? value;
  const backgroundColor = /^#[\da-f]{6}$/.test(resolved)
    ? resolved
    : /^#[\da-f]{3}$/.test(resolved)
      ? `#${Array.from(resolved.slice(1))
          .map((digit) => digit.repeat(2))
          .join("")}`
      : "#202832";
  const channelLuminance = (offset: number) => {
    const channel = parseInt(backgroundColor.slice(offset, offset + 2), 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  };
  const luminance =
    channelLuminance(1) * 0.2126 + channelLuminance(3) * 0.7152 + channelLuminance(5) * 0.0722;
  const contrastBlack = (luminance + 0.05) / 0.05;
  const contrastWhite = 1.05 / (luminance + 0.05);
  return { backgroundColor, color: contrastBlack >= contrastWhite ? "#000000" : "#ffffff" };
}
