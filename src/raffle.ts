import { convertURLParams } from "./utils";

interface WheelOfNamesParams {
  readonly backgroundImage?: string;
  readonly centerImage?: string;
  readonly centerSize?: "xs" | "s" | "m" | "l" | "xl" | "xxl";
  readonly colors?: string[];
  readonly confetti?: boolean;
  readonly description?: string;
  readonly displayWinnerDialog?: boolean;
  readonly entries?: string[];
  readonly hideOverlayText?: boolean;
  readonly pageBackgroundColor?: string;
  readonly pageGradient?: boolean;
  readonly removeBackground?: boolean;
  readonly spinTime?: number;
  readonly title?: string;
  readonly winnerMessage?: string;
}

interface Entry {
  readonly color: string;
}

class Entries {
  private entries: Map<string, Entry>;
  private backupEntries: typeof this.entries;

  constructor() {
    this.entries = new Map();
    this.backupEntries = new Map();
  }

  get() {
    return this.entries;
  }

  addEntry(name: string, entry: Entry) {
    if (this.entries.has(name)) {
      return false;
    }

    this.entries.set(name, entry);

    return true;
  }

  resetEntries() {
    if (this.entries.size === 0) {
      return;
    }

    this.backupEntries = new Map(this.entries);

    this.entries.clear();
  }

  restoreEntries() {
    if (this.backupEntries.size === 0) {
      return;
    }

    const backup = new Map(this.entries);

    this.entries = new Map(this.backupEntries);

    this.backupEntries = backup;
  }
}

export class Raffle {
  private disabled: boolean;
  private raffleEntries: Entries;
  private raffleKeyword: string = "";

  onEntriesChanged?: (entries: ({ name: string } & Entry)[]) => void;

  constructor(keyword: string) {
    this.disabled = true;
    this.raffleEntries = new Entries();
    this.keyword = keyword;
  }

  get isOpen(): boolean {
    return !this.disabled;
  }

  get participants() {
    return this.entries.size;
  }

  private set keyword(keyword: string) {
    this.raffleKeyword = keyword.trim().toLowerCase();
  }

  private get keyword() {
    return this.raffleKeyword;
  }

  private get entries() {
    return this.raffleEntries.get();
  }

  private get entriesArray() {
    return Array.from(this.entries).map(([name, entry]) => ({
      name,
      ...entry,
    }));
  }

  get() {
    return this.entriesArray;
  }

  toggle() {
    this.disabled = !this.disabled;
  }

  reset() {
    if (this.isOpen) {
      throw new Error("Cannot reset entries while raffle is open");
    }

    this.raffleEntries.resetEntries();

    this.onEntriesChanged?.(this.entriesArray);
  }

  restore() {
    if (this.isOpen) {
      throw new Error("Cannot restore entries while raffle is open");
    }

    this.raffleEntries.restoreEntries();

    this.onEntriesChanged?.(this.entriesArray);
  }

  setKeyword(keyword: string) {
    if (this.isOpen) {
      throw new Error("Cannot modify keyword while raffle is open");
    }

    this.keyword = keyword;
  }

  getWheelURL({
    editable,
    ...params
  }: { editable?: boolean } & Omit<WheelOfNamesParams, "entries"> = {}) {
    if (this.participants === 0) {
      throw new Error("There are no entries to be raffled");
    }

    const urlParams = convertURLParams({
      ...params,
      entries: this.entriesArray.map(({ name }) => name),
    });

    return `https://wheelofnames.com/${editable ? "" : "view"}?${urlParams}`;
  }

  handleTwitchChatMessage({
    color,
    isBroadcaster,
    login,
    message,
    name,
  }: {
    color: string;
    isBroadcaster: boolean;
    login: string;
    message: string;
    name: string;
  }) {
    if (this.disabled) {
      return;
    }

    if (isBroadcaster) {
      return;
    }

    if (this.keyword.length > 0) {
      if (!message.trim().toLowerCase().startsWith(this.keyword)) {
        return;
      }

      if (!["", " "].includes(message.charAt(this.keyword.length))) {
        return;
      }
    }

    if (name.trim().toLowerCase() !== login.trim()) {
      name = `${name} (${login})`;
    }

    if (!this.raffleEntries.addEntry(name, { color })) {
      return;
    }

    this.onEntriesChanged?.(this.entriesArray);
  }
}
