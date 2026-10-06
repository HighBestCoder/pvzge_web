import { LearningProviderError } from "./provider.js";

let playToken = null;

export function configureApiAuth(token) {
  playToken = typeof token === "string" && token.length > 0 ? token : null;
}

function isSameOriginApi(path) {
  if (typeof path !== "string") return false;
  if (path.startsWith("/api/")) return true;
  if (typeof location === "undefined") return false;
  try {
    const url = new URL(path, location.href);
    return url.origin === location.origin && url.pathname.startsWith("/api/");
  } catch { return false; }
}

export async function requestJson(path, { method = "GET", body, signal, fetchImpl = fetch, keepalive = false } = {}) {
  const token = playToken;
  const authenticated = isSameOriginApi(path) && token !== null;
  let response;
  try {
    response = await fetchImpl(path, {
      method, credentials: isSameOriginApi(path) ? "omit" : "same-origin", signal, keepalive,
      headers: {
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(authenticated ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    if (error?.name === "AbortError") throw error;
    throw new LearningProviderError("NETWORK_ERROR", "学习服务连接失败");
  }
  if (response.status === 401 && authenticated) {
    globalThis.dispatchEvent(new CustomEvent("play:authorization-required", { detail: { token } }));
  }
  if (response.status === 204) return null;
  let payload;
  try { payload = await response.json(); }
  catch { throw new LearningProviderError("INVALID_JSON", "学习服务返回了无效 JSON", response.status); }
  if (!response.ok) {
    const code = typeof payload?.error?.code === "string" ? payload.error.code : `HTTP_${response.status}`;
    const message = typeof payload?.error?.message === "string" ? payload.error.message : "学习服务请求失败";
    throw new LearningProviderError(code, message, response.status);
  }
  return payload;
}
