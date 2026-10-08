import "./styles/index.css";

import React from "react";
import ReactDOM from "react-dom/client";

import { rendererErrorEvents } from "../../shared/logging";
import { requireValue } from "../../shared/validation";
import App from "./App";
import { installRendererDiagnostics, reportRendererError } from "./services/diagnostics";

installRendererDiagnostics();
ReactDOM.createRoot(requireValue(document.getElementById("root")), {
  onUncaughtError: (error, info) => {
    reportRendererError(rendererErrorEvents.reactError, error, info.componentStack ?? undefined);
  },
  onCaughtError: (error, info) => {
    reportRendererError(rendererErrorEvents.reactError, error, info.componentStack ?? undefined);
  },
  onRecoverableError: (error, info) => {
    reportRendererError(rendererErrorEvents.reactError, error, info.componentStack ?? undefined);
  },
}).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
