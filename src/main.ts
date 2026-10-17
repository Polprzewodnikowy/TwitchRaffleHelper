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

const colorAdjuster = new ColorAdjuster(0.7);

const raffleEntriesList = control.getUlElement("raffleEntries");

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
    raffle.open();

    keywordInput.disabled = true;

    event.target.show(false);
    raffleButtons.close.show(true);

    raffleButtons.reset.disabled = true;

    raffleButtons.copyParticipants.disabled = true;
    raffleButtons.openWheelSite.setAttribute("disabled", "");

    raffleEntriesList.classList.remove("editable");
  }),

  close: control.addButtonHandler("closeRaffleButton", (event) => {
    raffle.close();

    keywordInput.disabled = false;

    event.target.show(false);
    raffleButtons.open.show(true);

    raffleButtons.reset.disabled = raffle.isEmpty;

    raffleButtons.copyParticipants.disabled = raffle.isEmpty;
    if (!raffle.isEmpty) {
      raffleButtons.openWheelSite.removeAttribute("disabled");
    }

    raffleEntriesList.classList.add("editable");
  }),

  reset: control.addButtonHandler("resetRaffleButton", () => {
    raffle.reset();

    raffleButtons.reset.disabled = true;
    raffleButtons.copyParticipants.disabled = true;
    raffleButtons.openWheelSite.setAttribute("disabled", "");
  }),

  copyParticipants: control.addButtonHandler("copyParticipantsButton", () => {
    navigator.clipboard.writeText(
      raffle
        .get()
        .map(({ name }) => name)
        .join("\n"),
    );
  }),

  openWheelSite: control.addAnchorHandler("openWheelButton", (event) => {
    event.preventDefault();
    window.open(event.target.href);
  }),
};

raffle.onBroadcasterCommand = (message) => {
  const parts = message.split(" ");

  if (parts.length === 0) {
    return;
  }

  const command = parts[0];

  if (command === "key" && !raffle.isOpen) {
    const keyword = parts.slice(1).join(" ");
    keywordInput.value = keyword;
    keywordInput.dispatchEvent(new Event("input"));
    raffleButtons.open.click();
  }

  if (command === "open" && !raffle.isOpen) {
    raffleButtons.open.click();
  }

  if (command === "close" && raffle.isOpen) {
    raffleButtons.close.click();
  }

  if (command === "reset" && !raffle.isOpen) {
    raffleButtons.reset.click();
  }
};

raffle.onEntriesChanged = (entries) => {
  control.getSpanElement("raffleParticipants").innerText = `${entries.length}`;

  control.setListEntries(
    "raffleEntries",
    entries.map(({ color, name }) => ({
      color: colorAdjuster.getReadableColor(color),
      text: name,
      button: {
        text: "-",
        title: "Delete participant",
        onClick: () => {
          raffle.deleteEntry(name);
          if (raffle.participants === 0) {
            raffleButtons.reset.disabled = true;
            raffleButtons.copyParticipants.disabled = true;
            raffleButtons.openWheelSite.setAttribute("disabled", "");
          }
        },
      },
    })),
  );

  raffleButtons.openWheelSite.href = raffle.getWheelURL();
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
  if (twitchEventSub) {
    twitchEventSub.onClose = undefined;
    twitchEventSub.close();
  }

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

const twitchMessageSub = async () =>
  twitchEventSub?.add<
    {
      readonly broadcaster_user_id: string;
      readonly user_id: string;
    },
    {
      readonly broadcaster_user_id: string;
      readonly chatter_user_id: string;
      readonly chatter_user_login: string;
      readonly chatter_user_name: string;
      readonly color: string;
      readonly message: { readonly text: string };
    }
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

const twitchRun = async () => {
  if (twitchStatus.get() !== "disconnected") {
    return;
  }

  const onError = (error?: unknown) => {
    const isUnauthorized =
      error instanceof TwitchError && error.cause === "unauthorized";

    if (twitchEventSub) {
      twitchEventSub.onClose = undefined;
      twitchEventSub.close();
    }

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

    twitchEventSub.onOpen = async () => {
      await Promise.all([twitchMessageSub()]);

      twitchStatus.update("connected");
    };

    twitchEventSub.onClose = (error) => {
      onError(error);
    };

    twitchEventSub.onHandlerError = (error) => {
      console.error(error);
    };
  } catch (error) {
    onError(error);
  }
};

control.getAnchorElement("authStartButton").href = twitchApi.getAuthURL(
  import.meta.env.VITE_PUBLIC_URL,
);

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

(async () => {
  try {
    twitchApi.updateAuth(hash);

    await twitchApi.checkAuth();

    twitchStatus.update("disconnected");

    twitchRun();
  } catch (error) {
    twitchStatus.update("unauthorized");
  }
})();
