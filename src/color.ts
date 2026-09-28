import convert from "color-convert";

type Color = [number, number, number];

export class ColorAdjuster {
  targetLuminance: number;
  private cache: Map<string, string>;

  constructor(targetLuminance: number) {
    this.targetLuminance = targetLuminance;
    this.cache = new Map();
  }

  static getLinear = ([r, g, b]: Color): Color => {
    return [Math.pow(r, 2.2), Math.pow(g, 2.2), Math.pow(b, 2.2)];
  };

  static getLuminance = (rgb: Color): number => {
    const [r, g, b] = ColorAdjuster.getLinear([
      rgb[0] / 255,
      rgb[1] / 255,
      rgb[2] / 255,
    ]);

    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };

  static adjustLuminance = (rgb: Color, target: number): Color => {
    const hsl = convert.rgb.hsl(rgb);

    let min = 0;
    let max = 100;

    const h = hsl[0];
    const l = hsl[2] > 50 ? -hsl[2] : hsl[2] - 100;
    let s = hsl[1] * Math.pow(l / 100, 7) + 100;

    let d = (max - min) / 2;
    let mid = min + d;

    while (d > 100 / 65536) {
      const luminance = ColorAdjuster.getLuminance(
        convert.hsl.rgb([h, s, mid]),
      );

      if (luminance > target) {
        max = mid;
      } else {
        min = mid;
      }

      d /= 2;
      mid = min + d;
    }

    return convert.hsl.rgb([h, s, mid]);
  };

  getReadableColor = (color: string): string => {
    const cached = this.cache.get(color);

    if (cached) {
      return cached;
    }

    const rgb = convert.hex.rgb(color.slice(1));

    const luminance = ColorAdjuster.getLuminance(rgb);

    if (luminance < this.targetLuminance) {
      const rgbAdjusted = ColorAdjuster.adjustLuminance(
        rgb,
        this.targetLuminance,
      );

      const hexAdjusted = `#${convert.rgb.hex(rgbAdjusted)}`;

      this.cache.set(color, hexAdjusted);

      return hexAdjusted;
    }

    return color;
  };
}
