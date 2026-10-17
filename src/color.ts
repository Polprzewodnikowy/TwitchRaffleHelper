import { oklch, formatCss } from "culori";

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

  getReadableColor = (color: string = "#FFFFFF"): string => {
    const cached = this.cache.get(color);

    if (cached) {
      return cached;
    }

    const c = oklch(color);

    if (c && c.l < this.target) {
      c.c *= 1 - (this.target - c.l) / 5;

      c.l = this.target;

      const fixed = formatCss(c);

      this.cache.set(color, fixed);

      return fixed;
    }

    this.cache.set(color, color);

    return color;
  };
}
