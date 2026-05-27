/**
 * GET /api/public/oxford-views/:viewName?version=<v>&label=<l>
 *   Fetch a single Oxford View by URL path name,
 *   optionally filtered by version or label.
 *   Defaults to the "production" label.
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
} from "@langfuse/shared";
import { logger, traceException, redis } from "@langfuse/shared/src/server";
import { telemetry } from "@/src/features/telemetry";

const QuerySchema = z.object({
  viewName: z.string().min(1),
  version: z.coerce.number().int().positive().optional(),
  label: z.string().optional(),
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

    if (req.method !== "GET") throw new MethodNotAllowedError();

    const rateLimitCheck =
      await RateLimitService.getInstance().rateLimitRequest(
        authCheck.scope,
        "prompts",
      );
    if (rateLimitCheck?.isRateLimited()) {
      return rateLimitCheck.sendRestResponseIfLimited(res);
    }

    const { viewName, version, label } = QuerySchema.parse(req.query);
    const projectId = authCheck.scope.projectId;

    if (version && label) {
      return res
        .status(400)
        .json({ error: "Cannot specify both version and label" });
    }

    let view;
    if (version) {
      view = await prisma.oxfordView.findFirst({
        where: { projectId, name: viewName, version },
      });
    } else {
      const targetLabel = label ?? PRODUCTION_LABEL;
      view = await prisma.oxfordView.findFirst({
        where: { projectId, name: viewName, labels: { has: targetLabel } },
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
