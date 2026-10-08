import { applicationName } from "../../../shared/application";

export function AppTopBar() {
  return (
    <div className="app-topbar">
      <div className="app-topbar-window-space" aria-hidden />
      <div className="app-topbar-title">{applicationName}</div>
      <div className="app-topbar-actions" aria-hidden />
    </div>
  );
}
