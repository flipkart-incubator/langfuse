/**
 * GET  /api/public/oxford-views?name=<name>&version=<v>&label=<l>
 *   Fetch a single Oxford View by name, optionally filtered by version or label.
 *   Defaults to the "production" label when neither version nor label is given.
 *
 * POST /api/public/oxford-views
 *   Create a new Oxford View version.
 *   Body: { name, prompt: string[], labels?: string[], commitMessage?: string }
 */

import { ApiAuthService } from "@/src/features/public-api/server/apiAuth";
import { cors, runMiddleware } from "@/src/features/public-api/server/cors";
import { RateLimitService } from "@/src/features/public-api/server/RateLimitService";
import { prisma } from "@langfuse/shared/src/db";
import { isPrismaException } from "@/src/utils/exceptions";
import { type NextApiRequest, type NextApiResponse } from "next";
import { z } from "zod";
import {
  UnauthorizedError,
  LangfuseNotFoundError,
  BaseError,
  MethodNotAllowedError,
  ForbiddenError,
  PRODUCTION_LABEL,
  LATEST_PROMPT_LABEL,
  PromptNameSchema,
  COMMIT_MESSAGE_MAX_LENGTH,
} from "@langfuse/shared";
import { logger, traceException, redis } from "@langfuse/shared/src/server";
import { telemetry } from "@/src/features/telemetry";
import { v4 as uuidv4 } from "uuid";

const GetOxfordViewQuerySchema = z.object({
  name: z.string().min(1),
  version: z.coerce.number().int().positive().optional(),
  label: z.string().optional(),
});

const CreateOxfordViewBodySchema = z.object({
  name: PromptNameSchema,
  prompt: z.array(z.string().min(1)).min(1),
  labels: z.array(z.string()).default([]),
  commitMessage: z.string().trim().max(COMMIT_MESSAGE_MAX_LENGTH).optional(),
});

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  await runMiddleware(req, res, cors);

  try {
    const authCheck = await new ApiAuthService(
      prisma,
      redis,
    ).verifyAuthHeaderAndReturnScope(req.headers.authorization);

    if (!authCheck.validKey) throw new UnauthorizedError(authCheck.error);
    if (
      authCheck.scope.accessLevel !== "project" ||
      !authCheck.scope.projectId
    ) {
      throw new ForbiddenError(
        "Access denied: Bearer auth and org api keys are not allowed",
      );
    }

    await telemetry();

    const projectId = authCheck.scope.projectId;

    // ── GET ───────────────────────────────────────────────────────────────────
    if (req.method === "GET") {
      const rateLimitCheck =
        await RateLimitService.getInstance().rateLimitRequest(
          authCheck.scope,
          "prompts",
        );
      if (rateLimitCheck?.isRateLimited()) {
        return rateLimitCheck.sendRestResponseIfLimited(res);
      }

      const { name, version, label } = GetOxfordViewQuerySchema.parse(
        req.query,
      );

      if (version && label) {
        return res
          .status(400)
          .json({ error: "Cannot specify both version and label" });
      }

      let view;
      if (version) {
        view = await prisma.oxfordView.findFirst({
          where: { projectId, name, version },
        });
      } else {
        const targetLabel = label ?? PRODUCTION_LABEL;
        view = await prisma.oxfordView.findFirst({
          where: { projectId, name, labels: { has: targetLabel } },
          orderBy: { version: "desc" },
        });
      }

      if (!view) throw new LangfuseNotFoundError("Oxford View not found");

      return res.status(200).json({
        id: view.id,
        name: view.name,
        version: view.version,
        prompt: view.prompt,
        labels: view.labels,
        type: view.type,
        commitMessage: view.commitMessage,
        createdAt: view.createdAt,
        updatedAt: view.updatedAt,
      });
    }

    // ── POST ──────────────────────────────────────────────────────────────────
    if (req.method === "POST") {
      const rateLimitCheck =
        await RateLimitService.getInstance().rateLimitRequest(
          authCheck.scope,
          "prompts",
        );
      if (rateLimitCheck?.isRateLimited()) {
        return rateLimitCheck.sendRestResponseIfLimited(res);
      }

      const input = CreateOxfordViewBodySchema.parse(req.body);

      const latest = await prisma.oxfordView.findFirst({
        where: { projectId, name: input.name },
        orderBy: { version: "desc" },
      });

      const newVersion = (latest?.version ?? 0) + 1;
      const finalLabels = [...new Set([...input.labels, LATEST_PROMPT_LABEL])];

      // Promote production label: strip it from previous versions if present
      if (finalLabels.includes(PRODUCTION_LABEL)) {
        const previousWithProduction = await prisma.oxfordView.findMany({
          where: {
            projectId,
            name: input.name,
            labels: { has: PRODUCTION_LABEL },
          },
        });
        await Promise.all(
          previousWithProduction.map((v) =>
            prisma.oxfordView.update({
              where: { id: v.id },
              data: { labels: v.labels.filter((l) => l !== PRODUCTION_LABEL) },
            }),
          ),
        );
      }

      // Strip LATEST_PROMPT_LABEL from the previous latest version
      if (latest) {
        await prisma.oxfordView.update({
          where: { id: latest.id },
          data: {
            labels: latest.labels.filter((l) => l !== LATEST_PROMPT_LABEL),
          },
        });
      }

      const created = await prisma.oxfordView.create({
        data: {
          id: uuidv4(),
          name: input.name,
          prompt: input.prompt,
          version: newVersion,
          labels: finalLabels,
          type: "text",
          config: {},
          tags: [],
          commitMessage: input.commitMessage ?? null,
          createdBy: "API",
          project: { connect: { id: projectId } },
        },
      });

      return res.status(201).json({
        id: created.id,
        name: created.name,
        version: created.version,
        prompt: created.prompt,
        labels: created.labels,
        type: created.type,
        commitMessage: created.commitMessage,
        createdAt: created.createdAt,
        updatedAt: created.updatedAt,
      });
    }

    throw new MethodNotAllowedError();
  } catch (error: unknown) {
    logger.error(error);
    traceException(error);

    if (error instanceof BaseError) {
      return res.status(error.httpCode).json({
        error: error.name,
        message: error.message,
      });
    }
    if (isPrismaException(error)) {
      return res.status(500).json({ error: "Internal Server Error" });
    }
    if (error instanceof z.ZodError) {
      return res
        .status(400)
        .json({ message: "Invalid request data", error: error.issues });
    }
    return res.status(500).json({
      message: "Internal server error",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
}
