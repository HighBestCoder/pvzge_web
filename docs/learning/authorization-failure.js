import { clearMatchingPlaySelection } from "./play-selection.js";

export function handleAuthorizationFailure({ token, storage, entry, nativeSync, panel, navigate }) {
  entry?.stop();
  nativeSync?.stop();
  panel.showError("存档授权已失效，正在返回选择页面", false);
  if (typeof token === "string") clearMatchingPlaySelection(storage, token);
  navigate("/");
}
