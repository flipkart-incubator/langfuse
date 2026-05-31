import { ObservationType } from "@langfuse/shared";

export type TranscriptRole = "user" | "agent" | "tool";

export type TranscriptMessage = {
  id: string;
  role: TranscriptRole;
  name: string | null;
  /**
   * Primary display content: LLM output for agent, input payload for tool/user.
   */
  content: unknown;
  input: unknown;
  output: unknown;
  startTime: Date;
  observationType: string;
  depth: number;
  parentId: string | null;
};

/** Minimal shape required by the transformer — a strict subset of Observation. */
export type TranscriptObservation = {
  id: string;
  type: string;
  name: string | null;
  input: unknown;
  output: unknown;
  parentObservationId: string | null;
  startTime: Date;
};

function resolveRole(
  type: string,
  parentObservationId: string | null,
): TranscriptRole {
  switch (type) {
    case ObservationType.GENERATION:
    case ObservationType.AGENT:
      return "agent";
    case ObservationType.TOOL:
    case ObservationType.RETRIEVER:
    case ObservationType.EMBEDDING:
      return "tool";
    case ObservationType.SPAN:
    case ObservationType.CHAIN:
      // Root spans (no parent) model the overall workflow trigger → User.
      // Nested spans represent sub-steps / tool calls → Tool.
      return parentObservationId === null ? "user" : "tool";
    default:
      // EVENT, GUARDRAIL, EVALUATOR → treat as tool-like side-effects
      return "tool";
  }
}

function buildDepthMap(
  observations: TranscriptObservation[],
): Map<string, number> {
  const parentMap = new Map<string, string | null>(
    observations.map((o) => [o.id, o.parentObservationId]),
  );
  const depths = new Map<string, number>();

  function depth(id: string): number {
    if (depths.has(id)) return depths.get(id)!;
    const parentId = parentMap.get(id);
    const d = parentId ? depth(parentId) + 1 : 0;
    depths.set(id, d);
    return d;
  }

  for (const obs of observations) depth(obs.id);
  return depths;
}

/**
 * Flattens a flat array of observations for a single trace into a
 * chronologically ordered, role-annotated transcript.
 *
 * @param observations  Raw observations for the trace (any order).
 * @param traceInput    Optional trace-level input to prepend as a synthetic
 *                      User message (e.g. the prompt that kicked off the run).
 */
export function flattenTraceToTranscript(
  observations: TranscriptObservation[],
  traceInput?: unknown,
): TranscriptMessage[] {
  const depths = buildDepthMap(observations);

  const sorted = [...observations].sort(
    (a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime(),
  );

  const messages: TranscriptMessage[] = [];

  // Synthetic User message from the trace-level input when provided.
  if (traceInput !== undefined && traceInput !== null) {
    messages.push({
      id: "__trace_input__",
      role: "user",
      name: "User Input",
      content: traceInput,
      input: traceInput,
      output: null,
      startTime: sorted[0]?.startTime ?? new Date(),
      observationType: "TRACE_INPUT",
      depth: -1,
      parentId: null,
    });
  }

  const hasExplicitUserMessage =
    traceInput !== undefined && traceInput !== null;

  for (const obs of sorted) {
    const d = depths.get(obs.id) ?? 0;
    const role = resolveRole(obs.type, obs.parentObservationId);

    // When no explicit user message was supplied, the root SPAN becomes it.
    if (
      !hasExplicitUserMessage &&
      obs.type === ObservationType.SPAN &&
      obs.parentObservationId === null
    ) {
      messages.push({
        id: obs.id,
        role: "user",
        name: obs.name,
        content: obs.input,
        input: obs.input,
        output: obs.output,
        startTime: obs.startTime,
        observationType: obs.type,
        depth: d,
        parentId: obs.parentObservationId,
      });
      continue;
    }

    messages.push({
      id: obs.id,
      role,
      name: obs.name,
      // Agent role: the interesting content is the LLM's output reply.
      // Tool/user roles: the input payload is what defines the call.
      content: role === "agent" ? obs.output : obs.input,
      input: obs.input,
      output: obs.output,
      startTime: obs.startTime,
      observationType: obs.type,
      depth: d,
      parentId: obs.parentObservationId,
    });
  }

  return messages;
}
