import { formatURLParams, ParamValue, parseURLParams } from "./utils";

export interface TwitchAuthData {
  readonly access_token?: string;
  readonly scope?: string;
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
  cause: TwitchErrorCause;

  constructor(cause?: TwitchErrorCause) {
    super();
    this.cause = cause ?? "other";
  }
}

export class TwitchApi {
  private clientId: string;
  private scope: string[];
  private token: string;

  user: TwitchUser;

  saveAuth?: (auth?: TwitchAuthData) => void;
  loadAuth?: () => TwitchAuthData;

  constructor(clientId: string, scope: string[]) {
    this.clientId = clientId;
    this.scope = scope;
    this.token = "none";
    this.user = { avatar: "none", id: "none", name: "none" };
  }

  async init() {
    const users = await this.getUsers();

    if (users.length < 1) {
      throw new TwitchError();
    }

    this.user = users[0];
  }

  getAuthURL(redirect: string): string {
    const params = formatURLParams({
      client_id: this.clientId,
      force_verify: true,
      redirect_uri: redirect,
      response_type: "token",
      scope: this.scope.join(" "),
    });

    return `https://id.twitch.tv/oauth2/authorize?${params}`;
  }

  updateAuth(hash: string) {
    if (hash.charAt(0) !== "#") {
      return;
    }

    const params = parseURLParams(hash.slice(1));

    if (
      typeof params.access_token !== "string" ||
      typeof params.scope !== "string"
    ) {
      return;
    }

    this.saveAuth?.({
      access_token: params.access_token,
      scope: params.scope,
    });
  }

  async checkAuth() {
    const authData = this.loadAuth?.();

    if (!(authData && authData.access_token && authData.scope)) {
      throw new TwitchError("unauthorized");
    }

    const authScope = authData.scope.split(" ");

    for (let permission of this.scope) {
      if (!authScope.includes(permission)) {
        this.saveAuth?.();

        throw new TwitchError("unauthorized");
      }
    }

    const validateResponse = await fetch(
      "https://id.twitch.tv/oauth2/validate",
      { headers: { Authorization: `OAuth ${authData.access_token}` } },
    );

    if (validateResponse.ok) {
      this.token = authData.access_token;

      return;
    }

    this.saveAuth?.();

    throw new TwitchError("unauthorized");
  }

  private async call<
    Params extends Record<string, ParamValue> | void = void,
    Data extends Record<string, unknown> | void = void,
    Response extends Record<string, unknown> | undefined = undefined,
  >(
    endpoint: string,
    options?: {
      data?: Data;
      method?: string;
      params?: Params;
    },
  ): Promise<Response> {
    const params = formatURLParams(options?.params);

    const query = params.size > 0 ? `?${params}` : "";

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
        throw new TwitchError("unauthorized");
      } else {
        throw new TwitchError();
      }
    }

    const text = await response.text();

    if (text.length > 0) {
      return JSON.parse(text);
    } else {
      return undefined as Response;
    }
  }

  async getUsers(login?: string): Promise<TwitchUser[]> {
    const users = await this.call<
      {
        readonly login?: string;
      },
      void,
      {
        readonly data: {
          readonly id: string;
          readonly display_name: string;
          readonly profile_image_url: string;
        }[];
      }
    >("users", {
      params: { login },
    });

    return users.data.map(({ display_name, id, profile_image_url }) => ({
      avatar: profile_image_url,
      id: id,
      name: display_name,
    }));
  }

  async subscribe<T extends Record<string, unknown>>({
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
    const subscription = await this.call<
      void,
      {
        readonly type: string;
        readonly version: string;
        readonly condition: T;
        readonly transport: {
          method: string;
          session_id: string;
        };
      },
      {
        readonly data: {
          readonly id: string;
        }[];
      }
    >("eventsub/subscriptions", {
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
    });

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

  onOpen?: () => void;
  onClose?: (error?: unknown) => void;
  onHandlerError?: (error?: unknown) => void;

  constructor(twitchApi: TwitchApi) {
    this.twitchApi = twitchApi;

    const params = formatURLParams({
      keepalive_timeout_seconds: this.KEEPALIVE_TIMEOUT,
    });
    this.socket = new WebSocket(`wss://eventsub.wss.twitch.tv/ws?${params}`);

    this.socket.onmessage = this.socketOnMessage.bind(this);
    this.socket.onclose = this.socketOnClose.bind(this);
    this.socket.onerror = this.socketOnClose.bind(this);

    this.sessionId = "none";
    this.handlers = {};
  }

  async add<
    Condition extends Record<string, unknown> = Record<string, unknown>,
    EventData extends Record<string, unknown> = Record<string, unknown>,
  >(
    params: {
      type: string;
      version: string;
      condition: Condition;
    },
    handler: (event: EventData) => Promise<void> | void,
  ) {
    const { id } = await this.twitchApi.subscribe({
      ...params,
      sessionId: this.sessionId,
    });

    this.handlers[id] = handler;
  }

  close() {
    this.socketClose();
  }

  private refreshTimeout() {
    clearTimeout(this.timeout);
    this.timeout = setTimeout(() => {
      this.socketClose();
    }, this.DISCONNECT_TIMEOUT * 1000);
  }

  private socketClose(error?: unknown) {
    clearTimeout(this.timeout);
    this.timeout = undefined;

    if (this.oldSocket) {
      this.oldSocket.onmessage = null;
      this.oldSocket.onclose = null;
      this.oldSocket.onerror = null;

      this.oldSocket.close();
    }

    this.socket.onmessage = null;

    if (error) {
      this.socket.onclose = null;
      this.socket.onerror = null;

      this.onClose?.(error);
    }

    this.socket.close();
  }

  private async socketOnMessage(event: MessageEvent) {
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

        this.onOpen?.();
      }

      if (message_type === "session_reconnect") {
        const {
          session: { reconnect_url },
        } = payload;

        this.oldSocket = this.socket;

        this.socket = new WebSocket(reconnect_url);

        this.socket.onmessage = this.socketOnReconnectMessage.bind(this);
        this.socket.onclose = this.socketOnClose.bind(this);
        this.socket.onerror = this.socketOnClose.bind(this);
      }

      if (message_type === "notification") {
        const {
          event,
          subscription: { id },
        } = payload;

        if (id in this.handlers) {
          try {
            await this.handlers[id](event);
          } catch (error) {
            this.onHandlerError?.(error);
          }
        }
      }

      if (message_type === "revocation") {
        const {
          subscription: { status },
        } = payload;

        if (["user_removed", "authorization_revoked"].includes(status)) {
          this.socket.onmessage = null;
          this.socket.onclose = null;
          this.socket.onerror = null;

          this.socketClose();

          this.onClose?.(new TwitchError("unauthorized"));
        }
      }
    } catch (error) {
      this.socketClose(error);
    }
  }

  private socketOnReconnectMessage(event: MessageEvent) {
    this.refreshTimeout();

    try {
      const {
        metadata: { message_type },
      } = JSON.parse(event.data);

      if (message_type === "session_welcome") {
        this.socket.onmessage = this.socketOnMessage.bind(this);

        if (this.oldSocket) {
          this.oldSocket.onclose = null;

          this.oldSocket.close();
        }
      } else {
        this.socketClose();
      }
    } catch (error) {
      this.socketClose(error);
    }
  }

  private socketOnClose() {
    this.onClose?.();
  }
}
