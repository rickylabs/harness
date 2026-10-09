/**
 * `@rickylabs/host-orchid`: the Orchid dispatch and evidence adapter. Reads Orchid's private receipt root
 * (dispatch, launch, binding, stop, teardown and Claude status records) into contract shapes.
 *
 * This file is the package's only entry and re-exports its public API, nothing else. `orchidHost` is the
 * implementation a consumer passes where it needs Orchid reads; the named functions are the same API.
 */
import { readOrchidDispatches } from "./src/adapters/dispatch-reader.js";
import { verifyOrchidOpenCodeBinding } from "./src/adapters/native-binding-reader.js";
import { bindOrchidDispatchEvidence } from "./src/application/bind-dispatch-evidence.js";
import {
  matchesOrchidNativeRootIdentity, orchidAGYStoreDirectory, orchidOpenCodeSessionID, resolveOrchidNativeRoot,
} from "./src/application/native-binding-registry.js";

export { readOrchidDispatches } from "./src/adapters/dispatch-reader.js";
export { readOrchidNativeBinding, verifyOrchidOpenCodeBinding } from "./src/adapters/native-binding-reader.js";
export { bindOrchidDispatchEvidence } from "./src/application/bind-dispatch-evidence.js";
export {
  matchesOrchidNativeRootIdentity, orchidAGYStoreDirectory, orchidOpenCodeSessionID, resolveOrchidNativeRoot,
} from "./src/application/native-binding-registry.js";

/** The Orchid reads a telemetry composition root injects. */
export const orchidHost = Object.freeze({
  readDispatches: readOrchidDispatches,
  bindDispatchEvidence: bindOrchidDispatchEvidence,
  resolveNativeRoot: resolveOrchidNativeRoot,
  matchesNativeRootIdentity: matchesOrchidNativeRootIdentity,
  agyStoreDirectory: orchidAGYStoreDirectory,
  openCodeSessionID: orchidOpenCodeSessionID,
  verifyOpenCodeBinding: verifyOrchidOpenCodeBinding,
});
