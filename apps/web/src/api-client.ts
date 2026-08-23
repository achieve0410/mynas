import type { z } from "zod";

export const SESSION_KEY = "mynas.sessionToken";
export const RETURN_TO_KEY = "mynas.returnTo";

export class ApiError extends Error {
  public constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export const sessionToken = (): string | null => window.localStorage.getItem(SESSION_KEY);

const messageFor = async (response: Response): Promise<string> => {
  const body: unknown = await response.json().catch(() => null);
  if (
    typeof body === "object" &&
    body !== null &&
    "error" in body &&
    typeof body.error === "object" &&
    body.error !== null &&
    "message" in body.error &&
    typeof body.error.message === "string"
  ) {
    return body.error.message;
  }
  return `request failed with status ${response.status}`;
};

export const request = async (path: string, init: RequestInit = {}): Promise<Response> => {
  const headers = new Headers(init.headers);
  const token = sessionToken();
  if (token !== null) {
    headers.set("authorization", `Bearer ${token}`);
  }
  if (init.body !== undefined && typeof init.body === "string") {
    headers.set("content-type", "application/json");
  }
  const response = await fetch(path, { ...init, headers });
  if (!response.ok) {
    const message = await messageFor(response);
    if (response.status === 401 && token !== null && sessionToken() === token) {
      window.localStorage.removeItem(SESSION_KEY);
      window.sessionStorage.setItem(RETURN_TO_KEY, window.location.pathname);
      window.location.assign("/login");
    }
    throw new ApiError(response.status, message);
  }
  return response;
};

export const json = async <T>(path: string, schema: z.ZodType<T>, init?: RequestInit): Promise<T> =>
  schema.parse(await (await request(path, init)).json());
