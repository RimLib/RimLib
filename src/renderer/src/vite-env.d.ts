/// <reference types="vite/client" />

import type { AppDiagnosticsApi } from "../../shared/logging";
import type { ModStoreApi } from "../../shared/types";

declare global {
  interface Window {
    modStore?: ModStoreApi;
    appDiagnostics?: AppDiagnosticsApi;
  }
}
