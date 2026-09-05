/**
 * The server half of `/api/remote.mux`: the thing that decides what to send, and when to send
 * nothing at all.
 *
 * ## Why this is here and not in the coordinator
 *
 * `EventFold` applies frames; this produces them. The two are one argument split in half, and the
 * halves are only correct together: "a whole value is idempotent", "a gap in `seq` means loss", "a
 * snapshot is the truth and deltas are an optimisation" are claims about a round trip, not about
 * either end. Written apart, they drift in the one direction nobody can see — the board keeps
 * rendering, it is wrong, and no error is raised — so the property that matters
 * (`fold(changes(a, b))` applied to `a` is `b`) is asserted here, where both halves exist.
 *
 * Nothing here opens a socket, reads a clock or allocates an id. The caller owns the transport and
 * passes `now` in, for the same reason `backoffDelay` takes its jitter as an argument: a stream
 * whose output depends on a hidden clock cannot be replayed, and a protocol that cannot be replayed
 * cannot be tested.
 *
 * ## The hub keeps no backlog
 *
 * A resync is answered with the current board, never with a replay of the frames the client missed.
 * A replay buffer is state a snapshot can already reproduce, and it adds a failure mode the
 * snapshot path does not have: the buffer runs out, and the client that was furthest behind — the
 * phone on a bad link, the one that most needed the repair — is the one that cannot be repaired.
 *
 * ## Generation is per connection
 *
 * Each accepted connection gets a fresh generation and its own contiguous `seq`. A shared counter
 * looks simpler and is wrong: `hello` and the snapshot answering it go to exactly one client, so on
 * a shared counter every *other* client would see those numbers missing and read them as loss.
 * Somebody opening a phone would make every screen in the house refetch the board.
 *
 * Per-connection numbering also states the reconnect rule exactly: a client that reconnects is a
 * new connection, so its generation is higher, and the frames still in flight from the old socket
 * are identified as stale by data rather than by timing.
 *
 * ## Two clocks, and only one of them is refreshed by a delta
 *
 * `RemoteSnapshot.generatedAt` is refreshed only by a snapshot. Between snapshots the client's copy
 * is the time of the last full board, which is the honest reading: it is when the whole picture was
 * last known to be true.
 *
 * `GovernanceState.generatedAt` is refreshed on every change, because a quota reading is a
 * measurement and its age is part of its meaning. The cost is one small frame per publish whenever
 * the projection restamps that field, and it is worth paying: a cockpit that says a quota was read
 * twenty seconds ago when it was read forty minutes ago is worse than one that says nothing.
 */

import { PROTOCOL_VERSION, type ResyncFrame, type ServerEvent } from "./events.js";
import type { GovernanceState } from "./governance.js";
import type { RemoteSnapshot } from "./snapshot.js";

/**
 * One event without its envelope.
 *
 * The hub decides *what* to say; `generation`, `seq` and `at` are how it says it, and stamping them
 * in one place is what keeps `seq` contiguous. Distributed over the union so that `kind` and
 * `payload` stay correlated — a plain `Omit` on a union collapses to the keys they share and would
 * let a task payload be sent under a run's kind.
 */
type BodyOf<E> = E extends ServerEvent
  ? { readonly kind: E["kind"]; readonly payload: E["payload"] }
  : never;
export type EventBody = BodyOf<ServerEvent>;

/** One frame addressed to one connection. The caller writes it to that socket. */
export interface Delivery {
  readonly to: string;
  readonly frame: ServerEvent;
}

/**
 * What the hub knows about one connection.
 *
 * The counters are not decoration. They are the only evidence available for the question this
 * subsystem exists to answer — whether the stream is behaving as a push or has quietly become a
 * poll — and a count is the cheapest form of evidence there is. See `pollingSuspects`.
 */
export interface Subscriber {
  readonly id: string;
  readonly generation: number;
  /** The last `seq` assigned to this connection. `hello` is 0. */
  readonly seq: number;
  readonly frames: number;
  readonly snapshots: number;
  readonly resyncs: number;
  readonly since: string;
}

/**
 * The stream's whole state.
 *
 * `state` is never null: a hub with no board has nothing to serve, and a client greeted before the
 * first projection would sit with `needsResync` set and no snapshot able to clear it. So the board
 * exists before the stream does, and the impossible state is unrepresentable rather than handled.
 *
 * `state.generation` is ignored — the hub overwrites it per delivery, because a projection cannot
 * know which connection it is about to be sent to.
 */
export interface Hub {
  readonly state: RemoteSnapshot;
  readonly nextGeneration: number;
  readonly subscribers: ReadonlyMap<string, Subscriber>;
}

/**
 * The result of one call.
 *
 * `closed` is separate from an empty `deliveries` because "nothing to say" and "stop talking to
 * this one" are different instructions to the transport, and collapsing them leaves a socket open
 * that the hub has already forgotten.
 *
 * `notes` are for the operator's log. They are returned rather than logged so this module keeps no
 * side effects, and so a test can assert what an operator would have been told.
 */
export interface HubStep {
  readonly hub: Hub;
  readonly deliveries: readonly Delivery[];
  readonly closed: readonly string[];
  readonly notes: readonly string[];
}

/** A board, and a stream that has not been connected to yet. */
export function openHub(state: RemoteSnapshot): Hub {
  return { state, nextGeneration: 1, subscribers: new Map() };
}

/**
 * Accept a connection: `hello`, then the whole board.
 *
 * Reusing an id replaces the connection that held it. That is safe rather than merely tolerated —
 * the replacement's generation is higher, so anything still arriving from the old socket is
 * discarded by the client's fold on its own terms.
 */
export function subscribe(hub: Hub, id: string, now: string): HubStep {
  const generation = hub.nextGeneration;
  const greeted: Subscriber = {
    id,
    generation,
    seq: 0,
    frames: 1,
    snapshots: 0,
    resyncs: 0,
    since: now,
  };
  const hello: Delivery = {
    to: id,
    frame: {
      kind: "hello",
      generation,
      seq: 0,
      at: now,
      payload: { protocol: PROTOCOL_VERSION, repo: hub.state.repo },
    },
  };
  const served = deliver(greeted, snapshotBody(hub.state), now);
  const subscribers = new Map(hub.subscribers);
  subscribers.set(id, served.subscriber);
  const notes = hub.subscribers.has(id)
    ? [`connection ${id} was replaced; generation ${hub.subscribers.get(id)?.generation ?? 0} is now dead`]
    : [];
  return {
    hub: { ...hub, nextGeneration: generation + 1, subscribers },
    deliveries: [hello, served.delivery],
    closed: [],
    notes,
  };
}

/** Forget a connection the transport has already lost. */
export function unsubscribe(hub: Hub, id: string): Hub {
  if (!hub.subscribers.has(id)) return hub;
  const subscribers = new Map(hub.subscribers);
  subscribers.delete(id);
  return { ...hub, subscribers };
}

/**
 * A new board.
 *
 * Every connection is told the same thing, because the decision is about the change rather than
 * about the connection; what differs per connection is only the numbering.
 *
 * A board that did not change sends nothing at all. That single line is the whole "stop polling"
 * claim: a cockpit hearing silence is being told the board has not moved, at a cost of one
 * comparison on the server and no bytes on the wire. Any design where silence is ambiguous ends up
 * with a client that asks anyway.
 */
export function publish(hub: Hub, next: RemoteSnapshot, now: string): HubStep {
  const plan = planUpdate(hub.state, next);
  const bodies = plan.snapshot ? [snapshotBody(next)] : plan.bodies;
  const subscribers = new Map<string, Subscriber>();
  const deliveries: Delivery[] = [];
  for (const [id, subscriber] of hub.subscribers) {
    let current = subscriber;
    for (const body of bodies) {
      const served = deliver(current, body, now);
      current = served.subscriber;
      deliveries.push(served.delivery);
    }
    subscribers.set(id, current);
  }
  const notes = plan.snapshot ? [`sending the whole board: ${plan.why.join("; ")}`] : [];
  return { hub: { ...hub, state: next, subscribers }, deliveries, closed: [], notes };
}

/**
 * Say something the diff cannot see.
 *
 * Two snapshots do not record *how* an approval was resolved — the verdict, the person and the
 * moment are known to the command that resolved it and to nothing else. Rather than infer a verdict
 * from an approval's disappearance, which would be a guess printed as a fact, the resolving command
 * announces it and the next publish reconciles the board.
 *
 * Does not change the board: the announcement describes something the projection will report on its
 * own, and a hub that edited its own state here would be a second source of truth.
 */
export function announce(hub: Hub, body: EventBody, now: string): HubStep {
  const subscribers = new Map<string, Subscriber>();
  const deliveries: Delivery[] = [];
  for (const [id, subscriber] of hub.subscribers) {
    const served = deliver(subscriber, body, now);
    subscribers.set(id, served.subscriber);
    deliveries.push(served.delivery);
  }
  return { hub: { ...hub, subscribers }, deliveries, closed: [], notes: [] };
}

/**
 * Answer a client that has lost track.
 *
 * A resync naming another generation is not answered, because there is no answer that would help: a
 * snapshot in the current generation is one the client's fold will discard, and a snapshot in the
 * generation it named would be a lie. The connection is closed instead, which puts the client on
 * the path it already has — back off, reconnect, bind a fresh generation, receive a board.
 */
export function resync(hub: Hub, id: string, frame: ResyncFrame, now: string): HubStep {
  const subscriber = hub.subscribers.get(id);
  if (subscriber === undefined) {
    return { hub, deliveries: [], closed: [], notes: [`resync from unknown connection ${id}`] };
  }
  if (frame.generation !== subscriber.generation) {
    return {
      hub: unsubscribe(hub, id),
      deliveries: [],
      closed: [id],
      notes: [
        `connection ${id} asked to resync generation ${frame.generation} but is generation ` +
          `${subscriber.generation}; closing so it rebinds`,
      ],
    };
  }
  const served = deliver(
    { ...subscriber, resyncs: subscriber.resyncs + 1 },
    snapshotBody(hub.state),
    now,
  );
  const subscribers = new Map(hub.subscribers);
  subscribers.set(id, served.subscriber);
  const lost = frame.lastSeq === undefined ? 0 : subscriber.seq - frame.lastSeq;
  const notes =
    lost > 0
      ? [`connection ${id} resynced after losing ${lost} frame${lost === 1 ? "" : "s"}`]
      : [`connection ${id} resynced`];
  return { hub: { ...hub, subscribers }, deliveries: [served.delivery], closed: [], notes };
}

/**
 * Connections that look like they are polling.
 *
 * A healthy connection is greeted once and then hears deltas, so its resync count stays near zero
 * however long it lives. A client that has quietly fallen back to asking asks again and again, and
 * that shows up as resyncs growing in step with everything else it has heard.
 *
 * The rule: more than two resyncs, and resyncs accounting for more than a third of the connection's
 * traffic. One resync after a real gap is not a suspicion, and three across a long healthy session
 * are not either.
 *
 * This names connections, not verdicts. The fix is in the client; the number is the evidence that
 * there is something to fix.
 */
export function pollingSuspects(hub: Hub): readonly string[] {
  const named: string[] = [];
  for (const subscriber of hub.subscribers.values()) {
    if (subscriber.resyncs > 2 && subscriber.resyncs * 3 > subscriber.frames) {
      named.push(subscriber.id);
    }
  }
  return named.sort(compareStrings);
}

/** What an operator needs to see to answer "is this stream behaving?" without reading frames. */
export function hubReport(hub: Hub): readonly string[] {
  const lines = [
    `${hub.subscribers.size} connection${hub.subscribers.size === 1 ? "" : "s"} · ` +
      `next generation ${hub.nextGeneration} · board ${hub.state.tasks.length} tasks, ` +
      `${hub.state.runs.length} runs`,
  ];
  const ordered = [...hub.subscribers.values()].sort((a, b) => compareStrings(a.id, b.id));
  for (const subscriber of ordered) {
    lines.push(
      `  ${subscriber.id} · gen ${subscriber.generation} · ${subscriber.frames} frames · ` +
        `${subscriber.snapshots} snapshots · ${subscriber.resyncs} resyncs · since ${subscriber.since}`,
    );
  }
  const suspects = pollingSuspects(hub);
  if (suspects.length > 0) lines.push(`  polling suspects: ${suspects.join(", ")}`);
  return lines;
}

/** Whether the next board goes out as deltas or as a whole snapshot, and why. */
export type Plan =
  | { readonly snapshot: true; readonly why: readonly string[] }
  | { readonly snapshot: false; readonly bodies: readonly EventBody[] };

/**
 * Deltas when they are both expressible and cheaper; the whole board otherwise.
 *
 * The threshold is not tuned, it is stated: *a delta stream never carries more items than the
 * snapshot it would replace*. Below that line deltas are the optimisation they are meant to be;
 * above it they are a slower way to send a snapshot, plus a window in which the board is half
 * updated.
 */
export function planUpdate(previous: RemoteSnapshot, next: RemoteSnapshot): Plan {
  const why = [...unexpressible(previous, next)];
  if (why.length === 0) {
    const bodies = changes(previous, next);
    const carrying = bodies.filter(isItemFrame).length;
    const carried = next.tasks.length + next.runs.length;
    if (carrying <= carried) return { snapshot: false, bodies };
    why.push(`${carrying} item deltas is more than the ${carried} a snapshot carries`);
  }
  return { snapshot: true, why };
}

/**
 * Changes the delta vocabulary cannot express, named one by one.
 *
 * A protocol is honest about its gaps or it invents encodings for them, and an invented encoding is
 * the kind of thing that works until the day a client written against the written contract meets
 * it. Each of these becomes a full snapshot instead, which is always correct and occasionally
 * wasteful — the right way round.
 *
 * `run.removed` is the gap worth noticing: the union has `task.removed` and no counterpart for
 * runs, so any projection with a time window falls back to a whole board every time a run ages out
 * of it. Cheap here, where a board is one repository; worth a `run.removed` in the next protocol
 * version rather than a workaround in this one.
 */
export function unexpressible(previous: RemoteSnapshot, next: RemoteSnapshot): readonly string[] {
  const reasons: string[] = [];
  if (previous.protocol !== next.protocol) {
    reasons.push(`protocol ${previous.protocol} became ${next.protocol}`);
  }
  if (!equal(previous.repo, next.repo)) {
    reasons.push("the board is about a different repository");
  }
  if (!equal(previous.lifecycle, next.lifecycle)) {
    reasons.push("the lifecycle changed, and no delta carries it");
  }
  if (!equal(previous.notes, next.notes)) {
    reasons.push("the notes changed, and no delta carries them");
  }
  const kept = new Set(next.runs.map((run) => run.id));
  for (const run of previous.runs) {
    if (!kept.has(run.id)) reasons.push(`run ${run.id} left the board, and no delta removes a run`);
  }
  return reasons;
}

/**
 * The smallest ordered set of events that turns `previous` into `next`.
 *
 * Whole values, so each one is idempotent and the order within a kind does not matter. What does
 * matter is that `governance.changed` comes before the approval events: it replaces the entire
 * governance state including `pending`, so a client applying the pair in order ends up with the
 * approvals *and* the toast, while the reverse order would still converge but would replace the
 * list a moment after announcing an addition to it.
 *
 * No `approval.resolved` is produced. Nothing in two snapshots says who decided, or how, or when —
 * only that an approval is gone — and a resolution with an invented verdict is worse than no
 * resolution at all. The disappearance travels in `governance.changed`, and the command that
 * actually decided uses `announce`.
 */
export function changes(previous: RemoteSnapshot, next: RemoteSnapshot): readonly EventBody[] {
  const bodies: EventBody[] = [];

  const heldTasks = new Map(previous.tasks.map((task) => [task.number, task]));
  for (const task of next.tasks) {
    if (!equal(heldTasks.get(task.number), task)) {
      bodies.push({ kind: "task.upserted", payload: task });
    }
  }
  const keptTasks = new Set(next.tasks.map((task) => task.number));
  for (const task of previous.tasks) {
    if (!keptTasks.has(task.number)) {
      bodies.push({ kind: "task.removed", payload: { number: task.number } });
    }
  }

  const heldRuns = new Map(previous.runs.map((run) => [run.id, run]));
  for (const run of next.runs) {
    if (!equal(heldRuns.get(run.id), run)) bodies.push({ kind: "run.upserted", payload: run });
  }

  if (previous.complete !== next.complete || !equal(previous.anomalies, next.anomalies)) {
    bodies.push({
      kind: "anomalies.changed",
      payload: { complete: next.complete, anomalies: next.anomalies },
    });
  }

  const settled = withoutPending(previous.governance);
  const arriving = withoutPending(next.governance);
  const held = new Map(previous.governance.pending.map((approval) => [approval.id, approval]));
  const kept = new Set(next.governance.pending.map((approval) => approval.id));
  const gone = previous.governance.pending.some((approval) => !kept.has(approval.id));
  if (!equal(settled, arriving) || gone) {
    bodies.push({ kind: "governance.changed", payload: next.governance });
  }
  for (const approval of next.governance.pending) {
    if (!equal(held.get(approval.id), approval)) {
      bodies.push({ kind: "approval.requested", payload: approval });
    }
  }

  return bodies;
}

/** Everything about the budget picture except who is waiting on a person. */
function withoutPending(governance: GovernanceState): unknown {
  const { pending, ...rest } = governance;
  return rest;
}

function isItemFrame(body: EventBody): boolean {
  return (
    body.kind === "task.upserted" || body.kind === "task.removed" || body.kind === "run.upserted"
  );
}

function snapshotBody(state: RemoteSnapshot): EventBody {
  return { kind: "snapshot", payload: state };
}

/**
 * Number one frame and hand it to one connection.
 *
 * The single place `seq` advances, and the single cast in this module: TypeScript cannot see that
 * spreading an envelope onto a `{kind, payload}` pair drawn from the union lands back in the union,
 * although `BodyOf` guarantees the two fields stay correlated.
 *
 * A snapshot payload leaves with the connection's own generation stamped into it, replacing
 * whatever the projection put there. That field means "the connection this belongs to", and only
 * the hub is in a position to know it.
 */
function deliver(
  subscriber: Subscriber,
  body: EventBody,
  now: string,
): { readonly subscriber: Subscriber; readonly delivery: Delivery } {
  const seq = subscriber.seq + 1;
  const payload =
    body.kind === "snapshot" ? { ...body.payload, generation: subscriber.generation } : body.payload;
  const frame = {
    kind: body.kind,
    payload,
    generation: subscriber.generation,
    seq,
    at: now,
  } as ServerEvent;
  return {
    subscriber: {
      ...subscriber,
      seq,
      frames: subscriber.frames + 1,
      snapshots: subscriber.snapshots + (body.kind === "snapshot" ? 1 : 0),
    },
    delivery: { to: subscriber.id, frame },
  };
}

function compareStrings(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/**
 * Structural equality over the data these payloads are made of.
 *
 * Hand-written rather than imported: this package is loaded by a browser and by a phone, so it
 * takes no dependency and reaches for no Node builtin. Key order is not compared, because two
 * projections of the same board that serialise their fields in a different order are the same
 * board, and treating them as different would put a delta on the wire for nothing.
 *
 * `NaN` compares equal to itself here, which `===` does not. A single division by zero in a percent
 * would otherwise make one field differ from itself on every read, and the stream would send a
 * change forever about a board that never moved — precisely the failure this module exists to
 * prevent, arriving through the back door.
 */
function equal(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a === "number" && typeof b === "number") return a !== a && b !== b;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  const leftIsArray = Array.isArray(a);
  if (leftIsArray !== Array.isArray(b)) return false;
  if (leftIsArray) {
    const left = a as readonly unknown[];
    const right = b as readonly unknown[];
    if (left.length !== right.length) return false;
    for (let index = 0; index < left.length; index += 1) {
      if (!equal(left[index], right[index])) return false;
    }
    return true;
  }
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = Object.keys(left);
  if (keys.length !== Object.keys(right).length) return false;
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(right, key)) return false;
    if (!equal(left[key], right[key])) return false;
  }
  return true;
}
