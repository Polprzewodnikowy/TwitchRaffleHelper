import { formatURLParams } from "./utils";

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

  deleteEntry(name: string) {
    this.entries.delete(name);
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

  onBroadcasterCommand?: (command: string) => void;
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

  get isEmpty() {
    return this.participants === 0;
  }

  private set keyword(keyword: string) {
    this.raffleKeyword = keyword.trim().toLowerCase().replace(/^\!/, "");
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

  open() {
    this.disabled = false;
  }

  close() {
    this.disabled = true;
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

  deleteEntry(name: string) {
    if (this.isOpen) {
      throw new Error("Cannot modify entries while raffle is open");
    }

    this.raffleEntries.deleteEntry(name);

    this.onEntriesChanged?.(this.entriesArray);
  }

  getWheelURL({
    editable,
    ...params
  }: { editable?: boolean } & Omit<WheelOfNamesParams, "entries"> = {}) {
    const urlParams = formatURLParams({
      ...params,
      entries: this.entriesArray.map(({ name }) => name).join(","),
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
    if (isBroadcaster) {
      if (message.startsWith("!")) {
        this.onBroadcasterCommand?.(message.slice(1));
      }
      return;
    }

    if (!this.isOpen) {
      return;
    }

    if (this.keyword.length > 0) {
      const clean = message.trim().toLowerCase().replace(/^\!/, "");

      if (!clean.startsWith(this.keyword)) {
        return;
      }

      if (!["", " "].includes(clean.charAt(this.keyword.length))) {
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
