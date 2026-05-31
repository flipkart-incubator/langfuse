import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authorizeRequestOrThrow } from "@/src/features/playground/server/authorizeRequest";
import { env } from "@langfuse/shared/src/env";
import { ForbiddenError, UnauthorizedError } from "@langfuse/shared";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// ---------------------------------------------------------------------------
// Zod schemas — exported so the Python consumer can mirror these exactly.
// ---------------------------------------------------------------------------

/** The request body accepted by this Next.js route. */
export const AgentResumeRequestSchema = z.object({
  traceId: z.string().min(1),
  observationId: z.string().min(1),
  projectId: z.string().min(1),
  modifiedPrompt: z.string(),
  mockedResponse: z.string(),
});
export type AgentResumeRequest = z.infer<typeof AgentResumeRequestSchema>;

/**
 * The payload forwarded to the external agent backend.
 * The Python service should validate the incoming POST body against this shape.
 */
export const WebhookPayloadSchema = z.object({
  /** Identifies the original trace in Langfuse. */
  traceId: z.string(),
  /** The observation (generation span) the user selected as the resume point. */
  observationId: z.string(),
  /** The prompt the user edited in the debugger UI. */
  modifiedPrompt: z.string(),
  /** The mocked LLM response to inject when the agent resumes. */
  mockedResponse: z.string(),
  /** ISO-8601 timestamp of when the resume was triggered. */
  resumedAt: z.iso.datetime(),
  /** Fixed discriminator so consumers can identify the event type. */
  source: z.literal("langfuse-debugger"),
});
export type WebhookPayload = z.infer<typeof WebhookPayloadSchema>;

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest) {
  // 1. Parse and validate request body.
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = AgentResumeRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: z.treeifyError(parsed.error) },
      { status: 400 },
    );
  }

  const { traceId, observationId, projectId, modifiedPrompt, mockedResponse } =
    parsed.data;

  // 2. Authenticate — must be a signed-in project member.
  try {
    await authorizeRequestOrThrow(projectId);
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
    }
    if (err instanceof ForbiddenError) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    throw err;
  }

  // 3. Ensure the webhook target is configured.
  const webhookUrl = env.AGENT_RESUME_WEBHOOK_URL;
  if (!webhookUrl) {
    return NextResponse.json(
      { error: "AGENT_RESUME_WEBHOOK_URL is not configured" },
      { status: 503 },
    );
  }

  // 4. Build and dispatch the webhook payload.
  const payload: WebhookPayload = {
    traceId,
    observationId,
    modifiedPrompt,
    mockedResponse,
    resumedAt: new Date().toISOString(),
    source: "langfuse-debugger",
  };

  const webhookRes = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!webhookRes.ok) {
    const text = await webhookRes.text().catch(() => "(no body)");
    return NextResponse.json(
      {
        error: `Upstream webhook returned ${webhookRes.status}: ${text}`,
      },
      { status: 502 },
    );
  }

  return NextResponse.json({ ok: true });
}
