import { captureProcessDiagnostics, SessionLogger } from "../../src/main/logging";
import { requireValue } from "../../src/shared/validation";

const logger = new SessionLogger({
  directory: requireValue(process.argv[2]),
  startup: { application: "logging-test-process" },
});
captureProcessDiagnostics(logger);
logger.write("DEBUG", "test.buffered-before-crash");
if (process.argv[3] === "rejection") {
  void Promise.reject(new Error("Test unhandled rejection"));
} else {
  setImmediate(() => {
    throw new Error("Test uncaught exception");
  });
}
