export class Observable<T> {
  private value: T;

  private listeners: ((status: T) => void)[] = [];

  constructor(value: T) {
    this.value = value;
  }

  get(): T {
    return this.value;
  }

  update(value: T) {
    if (this.value === value) {
      return;
    }

    this.value = value;

    this.listeners.forEach((listener) => listener(this.value));
  }

  subscribe(func: (value: T) => void) {
    this.listeners.push(func);
    func(this.value);
  }
}

export const convertURLParams = (
  params: {
    [key: string]: boolean | number | string | number[] | string[];
  } = {},
  { join }: { join?: string } = { join: "," },
) =>
  new URLSearchParams(
    Object.entries(params)
      .map(
        ([key, value]) =>
          `${key}=${encodeURIComponent(Array.isArray(value) ? value.join(join) : value)}`,
      )
      .join("&"),
  );

export const parseHashData = (hash: string): { [key: string]: any } =>
  hash
    .slice(1)
    .split("&")
    .reduce((params, param) => {
      const [key, value] = param.split("=");
      return { ...params, [key]: value };
    }, {});
