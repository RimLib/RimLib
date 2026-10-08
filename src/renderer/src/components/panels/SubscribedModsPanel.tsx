import { modPanelModes } from "../../utils/uiConstants";
import {
  ModsPanel,
  type ModsPanelProps,
  ModsPanelView,
  type ModsPanelViewProps,
} from "./ModsPanel";

export function SubscribedModsPanel(props: Omit<ModsPanelProps, "mode">) {
  return <ModsPanel {...props} mode={modPanelModes.subscribed} />;
}

export function SubscribedModsPanelView(props: Omit<ModsPanelViewProps, "mode">) {
  return <ModsPanelView {...props} mode={modPanelModes.subscribed} />;
}
