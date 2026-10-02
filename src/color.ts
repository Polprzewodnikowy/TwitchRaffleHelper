import convert from "color-convert";

type Color = [number, number, number];

export class ColorAdjuster {
  private cache: Map<string, string>;
  private target: number;

  constructor(targetLuminance: number) {
    this.cache = new Map();
    this.target = 0;

    this.targetLuminance = targetLuminance;
  }

  set targetLuminance(value: number) {
    if (value < 0.0 || value > 1.0) {
      throw new RangeError();
    }

    this.cache.clear();
    this.target = value;
  }

  public get targetLuminance(): number {
    return this.target;
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

    if (luminance >= this.target) {
      this.cache.set(color, color);

      return color;
    }

    const rgbAdjusted = ColorAdjuster.adjustLuminance(rgb, this.target);

    const hexAdjusted = `#${convert.rgb.hex(rgbAdjusted)}`;

    this.cache.set(color, hexAdjusted);

    return hexAdjusted;
  };
}
