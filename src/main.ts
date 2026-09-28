import { ColorAdjuster } from "./color";
import { Control } from "./control";
import { Raffle } from "./raffle";
import { TwitchApi, TwitchError, TwitchEventSub } from "./twitch";
import { Observable } from "./utils";

const hash = window.location.hash;

if (hash) {
  history.replaceState("", document.title, window.location.pathname);
}

type TwitchStatus =
  | "init"
  | "unauthorized"
  | "authorizing"
  | "disconnected"
  | "connecting"
  | "connected";

const TWITCH_CLIENT_ID = import.meta.env.VITE_TWITCH_CLIENT_ID;
const TWITCH_SCOPE = ["user:read:chat"];

const twitchApi = new TwitchApi(TWITCH_CLIENT_ID, TWITCH_SCOPE);
const twitchStatus = new Observable<TwitchStatus>("init");
let twitchEventSub: TwitchEventSub | null = null;
let twitchReconnectTimeout: number | undefined = undefined;

const control = new Control();

const defaultKeyword = localStorage.getItem("keyword") ?? "!raffle";

const raffle = new Raffle(defaultKeyword);

const colorAdjuster = new ColorAdjuster(0.25);

const keywordInput = control.addInputHandler(
  "keywordInput",
  (event) => {
    const keyword = event.target.value;
    raffle.setKeyword(keyword);
    localStorage.setItem("keyword", keyword);
  },
  defaultKeyword,
);

const raffleButtons = {
  open: control.addButtonHandler("openRaffleButton", (event) => {
    raffle.toggle();
    keywordInput.disabled = true;
    event.target.show(false);
    raffleButtons.close.show(true);
    raffleButtons.reset.disabled = true;
    raffleButtons.copyWheelURL.disabled = true;
    raffleButtons.openWheelSite.disabled = true;
  }),

  close: control.addButtonHandler("closeRaffleButton", (event) => {
    const empty = raffle.participants === 0;
    raffle.toggle();
    keywordInput.disabled = false;
    event.target.show(false);
    raffleButtons.open.show(true);
    raffleButtons.reset.disabled = empty;
    raffleButtons.copyWheelURL.disabled = empty;
    raffleButtons.openWheelSite.disabled = empty;
  }),

  reset: control.addButtonHandler("resetRaffleButton", () => {
    raffle.reset();
    raffleButtons.reset.disabled = true;
    raffleButtons.copyWheelURL.disabled = true;
    raffleButtons.openWheelSite.disabled = true;
  }),

  copyWheelURL: control.addButtonHandler("copyParticipantsButton", () => {
    navigator.clipboard.writeText(
      raffle
        .get()
        .map(({ name }) => name)
        .join("\n"),
    );
  }),

  openWheelSite: control.addButtonHandler("openWheelButton", () => {
    window.open(raffle.getWheelURL());
  }),
};

raffle.onEntriesChanged = (entries) => {
  control.getSpanElement("raffleParticipants").innerText = `${entries.length}`;

  control.setListEntries(
    "raffleEntries",
    entries.map(({ color, name }) => ({
      color: colorAdjuster.getReadableColor(color || "#FFFFFF"),
      text: name,
    })),
  );
};

const setUserData = (name?: string, avatar?: string) => {
  const avatarEl = control.getImgElement("userAvatar");

  if (avatar) {
    avatarEl.src = avatar;
    avatarEl.classList.remove("hidden");
  } else {
    avatarEl.classList.add("hidden");
  }

  control.getSpanElement("userName").innerText = name || "";
};

control.getImgElement("userAvatar").onclick = () => {
  twitchEventSub?.close({ onDisconnect: false });
  clearTimeout(twitchReconnectTimeout);
  twitchStatus.update("unauthorized");
};

twitchApi.saveAuth = (auth) => {
  if (auth) {
    try {
      localStorage.setItem("twitchAuth", JSON.stringify(auth));
    } catch {}
  } else {
    localStorage.removeItem("twitchAuth");
  }
};

twitchApi.loadAuth = () => {
  try {
    return JSON.parse(localStorage.getItem("twitchAuth") || "");
  } catch {}
};

const twitchMessageSub = async () => {
  interface ChannelChatMessageCondition {
    readonly broadcaster_user_id: string;
    readonly user_id: string;
  }
  interface ChannelChatMessageEvent {
    readonly broadcaster_user_id: string;
    readonly chatter_user_id: string;
    readonly chatter_user_login: string;
    readonly chatter_user_name: string;
    readonly color: string;
    readonly message: { readonly text: string };
  }
  return twitchEventSub?.add<
    ChannelChatMessageCondition,
    ChannelChatMessageEvent
  >(
    {
      type: "channel.chat.message",
      version: "1",
      condition: {
        broadcaster_user_id: twitchApi.user.id,
        user_id: twitchApi.user.id,
      },
    },
    (event) =>
      raffle.handleTwitchChatMessage({
        color: event.color,
        isBroadcaster: event.chatter_user_id === event.broadcaster_user_id,
        login: event.chatter_user_login,
        message: event.message.text,
        name: event.chatter_user_name,
      }),
  );
};

const twitchRun = async () => {
  if (twitchStatus.get() !== "disconnected") {
    return;
  }

  const onError = ({ error }: { error?: unknown }) => {
    const isUnauthorized =
      error instanceof TwitchError && error.cause === "unauthorized";

    twitchEventSub?.close({ onDisconnect: false });
    twitchEventSub = null;

    twitchStatus.update(isUnauthorized ? "unauthorized" : "disconnected");

    if (!isUnauthorized) {
      twitchReconnectTimeout = setTimeout(() => {
        twitchReconnectTimeout = undefined;

        twitchRun();
      }, 5000);
    }
  };

  try {
    twitchStatus.update("connecting");

    await twitchApi.init();

    setUserData(twitchApi.user.name, twitchApi.user.avatar);

    twitchEventSub = new TwitchEventSub(twitchApi);

    twitchEventSub.onConnect = async () => {
      try {
        await Promise.all([twitchMessageSub()]);

        twitchStatus.update("connected");
      } catch (error) {
        onError({ error });
      }
    };

    twitchEventSub.onDisconnect = () => {
      onError({});
    };
  } catch (error) {
    onError({ error });
  }
};

control.addButtonHandler("authStartButton", () => {
  const url = twitchApi.startAuth(import.meta.env.VITE_PUBLIC_URL);

  window.location.href = url;
});

twitchStatus.subscribe((status) => {
  if (status === "unauthorized") {
    setUserData();
    twitchApi.saveAuth?.();
  }

  let view = {
    init: "init",
    unauthorized: "auth",
    authorizing: "auth",
    disconnected: "init",
    connecting: "init",
    connected: "raffle",
  }[status];

  if (view === "init") {
    control.getDivElement("overlay").classList.remove("hidden");
  } else {
    control.getDivElement("overlay").classList.add("hidden");
  }

  control.showView(view);
});

const run = async () => {
  try {
    twitchApi.updateAuth(hash);

    await twitchApi.checkAuth();

    twitchStatus.update("disconnected");

    twitchRun();
  } catch {
    twitchStatus.update("unauthorized");
  }
};

run();
