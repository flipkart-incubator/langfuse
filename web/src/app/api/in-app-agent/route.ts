import { RunAgentInputSchema } from "@ag-ui/core";

import { env } from "@/src/env.mjs";
import {
  AgentStateSchema,
  createAgUiStream,
} from "@/src/features/in-app-agent/server/agent";
import { TRPCError } from "@trpc/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(request: Request) {
  if (!env.NEXT_PUBLIC_LANGFUSE_CLOUD_REGION) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Assistant is not available in self-hosted deployments.",
    });
  }

  if (!env.LANGFUSE_AWS_BEDROCK_MODEL || !env.LANGFUSE_AWS_BEDROCK_REGION) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Assistant is not configured",
    });
  }

  const body = await request.json().catch(() => null);
  const parsedInput = RunAgentInputSchema.safeParse(body);

  if (!parsedInput.success) {
    return Response.json({ error: "Invalid AG-UI payload" }, { status: 400 });
  }

  const input = parsedInput.data;
  const parsedState = AgentStateSchema.safeParse(input.state);

  if (!parsedState.success) {
    return Response.json({ error: "Invalid agent state" }, { status: 400 });
  }

  const stream = createAgUiStream({
    input,
    state: parsedState.data,
    signal: request.signal,
    options: {
      model: env.LANGFUSE_AWS_BEDROCK_MODEL,
      claudeSdkEnv: {
        CLAUDE_CODE_USE_BEDROCK: "1",
        AWS_DEFAULT_REGION: env.LANGFUSE_AWS_BEDROCK_REGION,
        AWS_REGION: env.LANGFUSE_AWS_BEDROCK_REGION,
        AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID,
        AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY,
      },
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Content-Encoding": "none",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
