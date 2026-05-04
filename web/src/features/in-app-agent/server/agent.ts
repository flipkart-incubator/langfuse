import {
  EventType,
  type AGUIEvent,
  type BaseEvent,
  type RunAgentInput,
} from "@ag-ui/core";
import { ClaudeAgentAdapter } from "@ag-ui/claude-agent-sdk";
import { z } from "zod";

const ASSISTANT_TITLE = "Langfuse Assistant";
const ASSISTANT_SYSTEM_PROMPT = [
  "You are the persistent in-app assistant for Langfuse.",
  "Be concise, factual, and useful.",
  "If you are not confident in the answer, say that directly instead of guessing.",
  "Use markdown when it improves clarity.",
].join(" ");

export const AgentStateSchema = z.looseObject({
  claudeSessionId: z.string().optional(),
});

export type AgentState = z.infer<typeof AgentStateSchema>;

type CreateAgUiStreamOptions = {
  claudeSdkEnv: Record<string, string | undefined>;
  model: string;
};

export function createAgUiStream(params: {
  input: RunAgentInput;
  state: AgentState;
  signal: AbortSignal;
  options: CreateAgUiStreamOptions;
}) {
  const encoder = new TextEncoder();

  const adapter = new ClaudeAgentAdapter({
    permissionMode: "dontAsk",
    title: ASSISTANT_TITLE,
    systemPrompt: ASSISTANT_SYSTEM_PROMPT,
    env: params.options.claudeSdkEnv,
    includePartialMessages: true,
    model: params.options.model,
    effort: "low",
  });

  const adapterInput = params.state.claudeSessionId
    ? {
        ...params.input,
        forwardedProps: {
          ...(z
            .record(z.string(), z.unknown())
            .safeParse(params.input.forwardedProps).data ?? {}),
          resume: params.state.claudeSessionId,
        },
      }
    : params.input;

  return new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const closeController = () => {
        if (closed) {
          return;
        }

        closed = true;
        controller.close();
      };

      const abort = () => {
        void adapter.interrupt().catch(() => undefined);
        closeController();
      };

      const subscription = adapter.run(adapterInput).subscribe({
        next(event) {
          if (closed || params.signal.aborted) {
            abort();
            return;
          }

          for (const agUiEvent of normalizeAdapterEvent(event)) {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify(agUiEvent)}\n\n`),
            );
          }
        },
        error(error) {
          console.error("Error in agent execution:", error);

          const message =
            error instanceof Error ? error.message : "Unknown assistant error";

          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({
                type: EventType.RUN_ERROR,
                message,
              } satisfies AGUIEvent)}\n\n`,
            ),
          );
          closeController();
        },
        complete() {
          closeController();
        },
      });

      params.signal.addEventListener(
        "abort",
        () => {
          subscription.unsubscribe();
          abort();
        },
        { once: true },
      );
    },
  });
}

function normalizeAdapterEvent(event: BaseEvent): AGUIEvent[] {
  if (event.type === EventType.CUSTOM && event.name === "system:init") {
    let sessionId: string | undefined;

    if (event.value && typeof event.value === "object") {
      if (
        "session_id" in event.value &&
        typeof event.value.session_id === "string"
      ) {
        sessionId = event.value.session_id;
      } else if (
        "sessionId" in event.value &&
        typeof event.value.sessionId === "string"
      ) {
        sessionId = event.value.sessionId;
      }
    }

    return sessionId
      ? [
          {
            type: EventType.STATE_DELTA,
            delta: [
              {
                op: "add",
                path: "/claudeSessionId",
                value: sessionId,
              },
            ],
          },
        ]
      : [];
  }

  return [event as AGUIEvent];
}
