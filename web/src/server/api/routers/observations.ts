import {
  createTRPCRouter,
  protectedGetTraceProcedure,
} from "@/src/server/api/trpc";
import { LangfuseNotFoundError, parseIO } from "@langfuse/shared";
import {
  getObservationById,
  getObservationsForTrace,
} from "@langfuse/shared/src/server";
import { z } from "zod";
import { toDomainWithStringifiedMetadata } from "@/src/utils/clientSideDomainTypes";

export const observationsRouter = createTRPCRouter({
  /**
   * Fetch all observations for a trace, including input/output payloads.
   * Used by the AgentTranscript view.
   */
  allForTrace: protectedGetTraceProcedure
    .input(
      z.object({
        traceId: z.string(),
        projectId: z.string(),
        timestamp: z.date().nullish(),
      }),
    )
    .query(async ({ input }) => {
      const observations = await getObservationsForTrace({
        traceId: input.traceId,
        projectId: input.projectId,
        timestamp: input.timestamp ?? undefined,
        includeIO: true,
      });
      return observations.map((obs) => ({
        ...toDomainWithStringifiedMetadata(obs),
        // Stringify input/output so JumpToPlaygroundButton can consume them
        // directly — it expects string | null, same as the byId procedure.
        input: parseIO(obs.input, "full") as string,
        output: parseIO(obs.output, "full") as string,
      }));
    }),

  byId: protectedGetTraceProcedure
    .input(
      z.object({
        observationId: z.string(),
        traceId: z.string(), // required for protectedGetTraceProcedure
        projectId: z.string(), // required for protectedGetTraceProcedure
        startTime: z.date().nullish(),
        verbosity: z.enum(["compact", "truncated", "full"]).default("full"),
      }),
    )
    .query(async ({ input }) => {
      const queryOpts = {
        id: input.observationId,
        projectId: input.projectId,
        fetchWithInputOutput: true,
        traceId: input.traceId,
        startTime: input.startTime ?? undefined,
        renderingProps: {
          truncated: input.verbosity === "truncated",
          shouldJsonParse: false,
        },
      };
      const obs = await getObservationById(queryOpts);
      if (!obs) {
        throw new LangfuseNotFoundError(
          "Observation not found within authorized project",
        );
      }
      return {
        ...toDomainWithStringifiedMetadata(obs),
        input: parseIO(obs.input, input.verbosity) as string,
        output: parseIO(obs.output, input.verbosity) as string,
        internalModel: obs?.internalModelId,
      };
    }),
});
