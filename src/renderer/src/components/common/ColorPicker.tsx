import { Check, Palette } from "lucide-react";
export function ColorPicker({
  colors,
  color,
  onChange,
}: {
  colors: string[];
  color: string;
  onChange: (color: string) => void;
}) {
  return (
    <div className="color-field">
      <span>Color</span>
      <div className="color-grid" role="radiogroup" aria-label="Tag color">
        {colors.map((value) => (
          <button
            key={value}
            type="button"
            className={`color-swatch ${value === color ? "selected" : ""}`}
            role="radio"
            aria-checked={value === color}
            aria-label={`Use color ${value}`}
            style={{ backgroundColor: value }}
            onClick={() => {
              onChange(value);
            }}
          >
            {value === color && <Check size={15} aria-hidden />}
          </button>
        ))}
        <label
          className="custom-color-swatch"
          style={{ backgroundColor: color }}
          title="Custom tag color"
        >
          <Palette size={16} aria-hidden />
          <input
            type="color"
            aria-label="Custom tag color"
            value={color}
            onChange={(event) => {
              onChange(event.target.value);
            }}
          />
        </label>
      </div>
    </div>
  );
}
