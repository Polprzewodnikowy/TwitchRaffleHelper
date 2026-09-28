import { convertURLParams, parseHashData } from "./utils";

export interface TwitchAuthData {
  readonly access_token: string;
  readonly refresh_token: string;
}

export interface TwitchUser {
  readonly avatar: string;
  readonly id: string;
  readonly name: string;
}

export interface TwitchSubscription {
  readonly id: string;
}

type TwitchErrorCause = "unauthorized" | "other";

export class TwitchError extends Error {
  constructor(cause: TwitchErrorCause) {
    super(undefined, { cause });
  }
}

export class TwitchApi {
  private clientId: string;
  private scope: string;
  private token: string;

  user: TwitchUser;

  saveAuth?: (auth?: TwitchAuthData) => void;
  loadAuth?: () => TwitchAuthData;

  constructor(clientId: string, scope: string[]) {
    this.clientId = clientId;
    this.scope = scope.join(" ");
    this.token = "none";
    this.user = { avatar: "none", id: "none", name: "none" };
  }

  async init() {
    const users = await this.getUsers();

    if (users.length < 1) {
      throw new TwitchError("other");
    }

    this.user = users[0];
  }

  startAuth(redirect: string): string {
    const params = {
      client_id: this.clientId,
      force_verify: true,
      redirect_uri: redirect,
      response_type: "token",
      scope: this.scope,
    };
    return `https://id.twitch.tv/oauth2/authorize?${convertURLParams(params)}`;
  }

  updateAuth(hash: string) {
    if (hash.charAt(0) !== "#") {
      return;
    }

    this.saveAuth?.(parseHashData(hash) as TwitchAuthData);
  }

  async checkAuth() {
    const authData = this.loadAuth?.();

    if (!authData) {
      throw new TwitchError("unauthorized");
    }

    const validateResponse = await fetch(
      "https://id.twitch.tv/oauth2/validate",
      { headers: { Authorization: `OAuth ${authData.access_token}` } },
    );

    if (validateResponse.ok) {
      this.token = authData.access_token;
      return;
    }

    const refreshResponse = await fetch("https://id.twitch.tv/oauth2/token", {
      method: "POST",
      body: convertURLParams({
        client_id: this.clientId,
        grant_type: "refresh_token",
        refresh_token: authData.refresh_token,
      }),
    });

    if (refreshResponse.ok) {
      const data = await refreshResponse.json();
      this.token = data.access_token;
      this.saveAuth?.(data);
      return;
    }

    this.saveAuth?.();

    throw new TwitchError("unauthorized");
  }

  private async call<
    P extends { [key: string]: boolean | number | string } = {},
    D extends object = {},
    R extends object = {},
  >(
    endpoint: string,
    options?: {
      method?: string;
      data?: D;
      params?: P;
      retry?: boolean;
    },
  ): Promise<R> {
    const params = convertURLParams(options?.params).toString();

    const query = params.length > 0 ? `?${params}` : "";

    const url = `https://api.twitch.tv/helix/${endpoint}${query}`;

    const response = await fetch(url, {
      method: options?.method || "GET",
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Client-Id": this.clientId,
        ...(options?.data && { "Content-Type": "application/json" }),
      },
      body: options?.data ? JSON.stringify(options?.data) : undefined,
    });

    if (!response.ok) {
      if (response.status === 401) {
        if (!options?.retry) {
          await this.checkAuth();
          return this.call<P, D, R>(endpoint, { ...options, retry: true });
        } else {
          throw new TwitchError("unauthorized");
        }
      } else {
        throw new TwitchError("other");
      }
    }

    return response.json();
  }

  async getUsers(login?: string): Promise<TwitchUser[]> {
    interface Response {
      readonly data: {
        readonly id: string;
        readonly display_name: string;
        readonly profile_image_url: string;
      }[];
    }

    const users = await this.call<{}, {}, Response>("users", {
      params: login ? { login } : undefined,
    });

    return users.data.map(({ display_name, id, profile_image_url }) => ({
      avatar: profile_image_url,
      id: id,
      name: display_name,
    }));
  }

  async subscribe<T extends object>({
    type,
    version,
    condition,
    sessionId,
  }: {
    type: string;
    version: string;
    condition: T;
    sessionId: string;
  }): Promise<TwitchSubscription> {
    interface Request {
      readonly type: string;
      readonly version: string;
      readonly condition: T;
      readonly transport: {
        method: string;
        session_id: string;
      };
    }

    interface Response {
      readonly data: {
        readonly id: string;
      }[];
    }

    const subscription = await this.call<{}, Request, Response>(
      "eventsub/subscriptions",
      {
        method: "POST",
        data: {
          type,
          version,
          condition,
          transport: {
            method: "websocket",
            session_id: sessionId,
          },
        },
      },
    );

    return { id: subscription.data[0].id };
  }
}

export class TwitchEventSub {
  private KEEPALIVE_TIMEOUT = 10;
  private DISCONNECT_TIMEOUT = 15;

  private twitchApi: TwitchApi;
  private socket: WebSocket;
  private oldSocket?: WebSocket;
  private sessionId: string;
  private handlers: { [id: string]: (event: any) => Promise<void> | void };
  private timeout?: number;

  onConnect?: () => void;
  onDisconnect?: () => void;

  constructor(twitchApi: TwitchApi) {
    this.twitchApi = twitchApi;
    this.socket = new WebSocket(
      `wss://eventsub.wss.twitch.tv/ws?keepalive_timeout_seconds=${this.KEEPALIVE_TIMEOUT}`,
    );
    this.socket.onmessage = this.onMessage.bind(this);
    this.socket.onclose = this.onClose.bind(this);
    this.socket.onerror = this.onClose.bind(this);
    this.sessionId = "none";
    this.handlers = {};
  }

  close({ onDisconnect }: { onDisconnect: boolean } = { onDisconnect: true }) {
    clearTimeout(this.timeout);
    this.timeout = undefined;

    if (this.oldSocket) {
      this.oldSocket.onclose = null;
      this.oldSocket.onerror = null;
      this.oldSocket.close();
    }

    if (!onDisconnect) {
      this.socket.onclose = null;
      this.socket.onerror = null;
    }

    this.socket.close();
  }

  async add<C extends object = {}, R extends object = {}>(
    params: {
      type: string;
      version: string;
      condition: C;
    },
    handler: (event: R) => Promise<void> | void,
  ) {
    const { id } = await this.twitchApi.subscribe({
      ...params,
      sessionId: this.sessionId,
    });

    this.handlers[id] = handler;
  }

  private refreshTimeout() {
    clearTimeout(this.timeout);
    this.timeout = setTimeout(() => {
      this.close({ onDisconnect: false });
      this.onDisconnect?.();
    }, this.DISCONNECT_TIMEOUT * 1000);
  }

  private async onMessage(event: MessageEvent) {
    this.refreshTimeout();

    try {
      const {
        metadata: { message_type },
        payload,
      } = JSON.parse(event.data);

      if (message_type === "session_welcome") {
        const {
          session: { id: session_id },
        } = payload;

        this.sessionId = session_id;
        this.onConnect?.();
      }

      if (message_type === "session_reconnect") {
        const {
          session: { reconnect_url },
        } = payload;

        this.oldSocket = this.socket;
        this.socket = new WebSocket(reconnect_url);
        this.socket.onmessage = this.onReconnectMessage.bind(this);
        this.socket.onclose = this.onClose.bind(this);
        this.socket.onerror = this.onClose.bind(this);
      }

      if (message_type === "notification") {
        const {
          event,
          subscription: { id },
        } = payload;

        if (id in this.handlers) {
          await this.handlers[id](event);
        }
      }

      if (message_type === "revocation") {
        const {
          subscription: { status },
        } = payload;

        if (status === "authorization_revoked") {
          this.close();
        }
      }
    } catch {
      this.close();
    }
  }

  private onReconnectMessage(event: MessageEvent) {
    this.refreshTimeout();

    try {
      const {
        metadata: { message_type },
      } = JSON.parse(event.data);

      if (message_type === "session_welcome") {
        this.socket.onmessage = this.onMessage.bind(this);
        if (this.oldSocket) {
          this.oldSocket.onclose = null;
          this.oldSocket.onerror = null;
          this.oldSocket.close();
        }
      } else {
        this.close();
      }
    } catch {
      this.close();
    }
  }

  private onClose() {
    this.onDisconnect?.();
  }
}
