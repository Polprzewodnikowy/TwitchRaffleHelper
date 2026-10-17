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

export type ParamValue =
  | boolean
  | number
  | string
  | (boolean | number | string | null)[]
  | null
  | undefined;

export const formatURLParams = (
  params: Record<string, ParamValue> | null | undefined | void,
) => {
  const searchParams = new URLSearchParams();

  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined) {
        continue;
      }

      if (Array.isArray(value)) {
        for (const v of value) {
          searchParams.append(key, v === null ? "" : v!.toString());
        }
      } else {
        searchParams.append(key, value === null ? "" : value!.toString());
      }
    }
  }

  return searchParams;
};

export const parseURLParams = (params: string) => {
  const result: Record<string, ParamValue> = {};

  const searchParams = new URLSearchParams(params);

  for (const [entryKey, entryValue] of searchParams) {
    let value: boolean | number | string | null = entryValue;

    if (entryValue === "") {
      value = null;
    } else if (entryValue === "true") {
      value = true;
    } else if (entryValue === "false") {
      value = false;
    } else if (!isNaN(entryValue as unknown as number)) {
      value = parseFloat(entryValue);
    }

    if (result[entryKey] !== undefined) {
      if (Array.isArray(result[entryKey])) {
        result[entryKey].push(value);
      } else {
        result[entryKey] = [result[entryKey], value];
      }
    } else {
      result[entryKey] = value;
    }
  }

  return result;
};
