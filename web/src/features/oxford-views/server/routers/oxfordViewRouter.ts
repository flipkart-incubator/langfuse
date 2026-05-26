import { z } from "zod";
import { auditLog } from "@/src/features/audit-logs/auditLog";
import { throwIfNoProjectAccess } from "@/src/features/rbac/utils/checkProjectAccess";
import {
  createTRPCRouter,
  protectedProjectProcedure,
} from "@/src/server/api/trpc";
import { type OxfordView, Prisma } from "@langfuse/shared/src/db";
import { TRPCError } from "@trpc/server";
import {
  LATEST_PROMPT_LABEL,
  optionalPaginationZod,
  paginationZod,
  PromptType,
  StringNoHTMLNonEmpty,
  TracingSearchType,
  promptsTableCols,
  orderBy,
  singleFilter,
  CreatePromptTRPCSchema,
} from "@langfuse/shared";
import {
  orderByToPrismaSql,
  escapeSqlLikePattern,
  tableColumnsToSqlFilterAndPrefix,
  postgresSearchCondition,
} from "@langfuse/shared/src/server";
import { v4 as uuidv4 } from "uuid";
import { PromptContentSchema } from "@langfuse/shared/src/server";
import { jsonSchema } from "@langfuse/shared";

// ---- helpers ----

const buildPathPrefixFilter = (pathPrefix?: string): Prisma.Sql => {
  if (!pathPrefix) return Prisma.empty;
  const esc = escapeSqlLikePattern(pathPrefix);
  return Prisma.sql` AND (p.name LIKE ${`${esc}/%`} ESCAPE '\\' OR p.name = ${pathPrefix})`;
};

const OxfordViewFilterOptions = z.object({
  projectId: z.string(),
  filter: z.array(singleFilter),
  orderBy: orderBy,
  ...paginationZod,
  pathPrefix: z.string().optional(),
  searchQuery: z.string().optional(),
  searchType: z.array(TracingSearchType).optional(),
});

const generateOxfordViewQuery = (
  select: Prisma.Sql,
  projectId: string,
  filterCondition: Prisma.Sql,
  orderCondition: Prisma.Sql,
  limit: number,
  page: number,
  pathFilter: Prisma.Sql = Prisma.empty,
  searchFilter: Prisma.Sql = Prisma.empty,
  pathPrefix?: string,
) => {
  const prefix = pathPrefix ?? "";

  const latestCTE = Prisma.sql`
    latest AS (
      SELECT p.*
      FROM oxford_views p
      WHERE (p.name, p.version) IN (
        SELECT name, MAX(version)
        FROM oxford_views p
        WHERE p.project_id = ${projectId}
          ${filterCondition}
          ${pathFilter}
          ${searchFilter}
        GROUP BY name
      )
        AND p.project_id = ${projectId}
        ${filterCondition}
        ${pathFilter}
        ${searchFilter}
    )`;

  const orderAndLimit = Prisma.sql`
    ${orderCondition.sql ? Prisma.sql`ORDER BY p.sort_priority, ${Prisma.raw(orderCondition.sql.replace(/ORDER BY /i, ""))}` : Prisma.empty}
    LIMIT ${limit} OFFSET ${page * limit}`;

  if (prefix) {
    return Prisma.sql`
    WITH ${latestCTE},
    individual_prompts_in_folder AS (
      SELECT
        p.id,
        SUBSTRING(p.name, CHAR_LENGTH(${prefix}) + 2) as name,
        p.version,
        p.project_id,
        p.prompt,
        p.type,
        p.updated_at,
        p.created_at,
        p.labels,
        p.tags,
        p.config,
        p.created_by,
        2 as sort_priority,
        'prompt'::text as row_type
      FROM latest p
      WHERE SUBSTRING(p.name, CHAR_LENGTH(${prefix}) + 2) NOT LIKE '%/%'
        AND SUBSTRING(p.name, CHAR_LENGTH(${prefix}) + 2) != ''
        AND p.name != ${prefix}
    ),
    subfolder_representatives AS (
      SELECT
        p.id,
        SPLIT_PART(SUBSTRING(p.name, CHAR_LENGTH(${prefix}) + 2), '/', 1) as name,
        p.version,
        p.project_id,
        p.prompt,
        p.type,
        p.updated_at,
        p.created_at,
        p.labels,
        p.tags,
        p.config,
        p.created_by,
        1 as sort_priority,
        'folder'::text as row_type,
        ROW_NUMBER() OVER (PARTITION BY SPLIT_PART(SUBSTRING(p.name, CHAR_LENGTH(${prefix}) + 2), '/', 1) ORDER BY p.version DESC) AS rn
      FROM latest p
      WHERE SUBSTRING(p.name, CHAR_LENGTH(${prefix}) + 2) LIKE '%/%'
    ),
    combined AS (
      SELECT
        id, name, version, project_id, prompt, type, updated_at, created_at, labels, tags, config, created_by, sort_priority, row_type
      FROM individual_prompts_in_folder
      UNION ALL
      SELECT
        id, name, version, project_id, prompt, type, updated_at, created_at, labels, tags, config, created_by, sort_priority, row_type
      FROM subfolder_representatives WHERE rn = 1
    )
    SELECT
      ${select}
    FROM combined p
    ${orderAndLimit};`;
  }

  // Root level: folders first, then individual prompts not in any folder
  return Prisma.sql`
    WITH ${latestCTE},
    root_level_prompts AS (
      SELECT
        p.id,
        p.name,
        p.version,
        p.project_id,
        p.prompt,
        p.type,
        p.updated_at,
        p.created_at,
        p.labels,
        p.tags,
        p.config,
        p.created_by,
        2 as sort_priority,
        'prompt'::text as row_type
      FROM latest p
      WHERE p.name NOT LIKE '%/%'
    ),
    folder_representatives AS (
      SELECT
        p.id,
        SPLIT_PART(p.name, '/', 1) as name,
        p.version,
        p.project_id,
        p.prompt,
        p.type,
        p.updated_at,
        p.created_at,
        p.labels,
        p.tags,
        p.config,
        p.created_by,
        1 as sort_priority,
        'folder'::text as row_type,
        ROW_NUMBER() OVER (PARTITION BY SPLIT_PART(p.name, '/', 1) ORDER BY p.version DESC) AS rn
      FROM latest p
      WHERE p.name LIKE '%/%'
    ),
    combined AS (
      SELECT
        id, name, version, project_id, prompt, type, updated_at, created_at, labels, tags, config, created_by, sort_priority, row_type
      FROM root_level_prompts
      UNION ALL
      SELECT
        id, name, version, project_id, prompt, type, updated_at, created_at, labels, tags, config, created_by, sort_priority, row_type
      FROM folder_representatives WHERE rn = 1
    )
    SELECT
      ${select}
    FROM combined p
    ${orderAndLimit};`;
};

// ---- router ----

export const oxfordViewRouter = createTRPCRouter({
  hasAny: protectedProjectProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ input, ctx }) => {
      throwIfNoProjectAccess({
        session: ctx.session,
        projectId: input.projectId,
        scope: "prompts:read",
      });

      const view = await ctx.prisma.oxfordView.findFirst({
        where: { projectId: input.projectId },
        select: { id: true },
        take: 1,
      });

      return view !== null;
    }),

  all: protectedProjectProcedure
    .input(OxfordViewFilterOptions)
    .query(async ({ input, ctx }) => {
      throwIfNoProjectAccess({
        session: ctx.session,
        projectId: input.projectId,
        scope: "prompts:read",
      });

      const orderByCondition = orderByToPrismaSql(
        input.orderBy,
        promptsTableCols,
      );

      const filterCondition = tableColumnsToSqlFilterAndPrefix(
        input.filter ?? [],
        promptsTableCols,
        "prompts",
      );

      const pathFilter = buildPathPrefixFilter(input.pathPrefix);

      const additionalConditions = input.searchType?.includes("id")
        ? [
            Prisma.sql`EXISTS (SELECT 1 FROM UNNEST(p.tags) AS tag WHERE tag ILIKE ${`%${input.searchQuery}%`})`,
          ]
        : [];

      const searchCondition = postgresSearchCondition({
        searchQuery: input.searchQuery,
        searchType: input.searchType,
        tablePrefix: "p",
        metadataColumns: ["name"],
        contentColumns: { content: ["prompt"] },
        additionalConditions,
      });

      const [views, viewCount] = await Promise.all([
        ctx.prisma.$queryRaw<
          Array<OxfordView & { row_type: "folder" | "prompt" }>
        >(
          generateOxfordViewQuery(
            Prisma.sql`
          p.id,
          p.name,
          p.version,
          p.project_id as "projectId",
          p.prompt,
          p.type,
          p.updated_at as "updatedAt",
          p.created_at as "createdAt",
          p.labels,
          p.tags,
          p.row_type`,
            input.projectId,
            filterCondition,
            orderByCondition,
            input.limit,
            input.page,
            pathFilter,
            searchCondition,
            input.pathPrefix,
          ),
        ),
        ctx.prisma.$queryRaw<Array<{ totalCount: bigint }>>(
          generateOxfordViewQuery(
            Prisma.sql`count(*) AS "totalCount"`,
            input.projectId,
            filterCondition,
            Prisma.empty,
            1,
            0,
            pathFilter,
            searchCondition,
            input.pathPrefix,
          ),
        ),
      ]);

      return {
        prompts: views,
        totalCount: viewCount.length > 0 ? Number(viewCount[0]?.totalCount) : 0,
      };
    }),

  count: protectedProjectProcedure
    .input(
      z.object({
        projectId: z.string(),
        searchQuery: z.string().optional(),
        searchType: z.array(TracingSearchType).optional(),
        pathPrefix: z.string().optional(),
        filter: z.array(singleFilter).optional(),
      }),
    )
    .query(async ({ input, ctx }) => {
      throwIfNoProjectAccess({
        session: ctx.session,
        projectId: input.projectId,
        scope: "prompts:read",
      });

      const filterCondition =
        input.filter && input.filter.length > 0
          ? tableColumnsToSqlFilterAndPrefix(
              input.filter,
              promptsTableCols,
              "prompts",
            )
          : Prisma.empty;

      const pathFilter = buildPathPrefixFilter(input.pathPrefix);

      const additionalConditions = input.searchType?.includes("id")
        ? [
            Prisma.sql`EXISTS (SELECT 1 FROM UNNEST(p.tags) AS tag WHERE tag ILIKE ${`%${input.searchQuery}%`})`,
          ]
        : [];

      const searchCondition = postgresSearchCondition({
        searchQuery: input.searchQuery,
        searchType: input.searchType,
        tablePrefix: "p",
        metadataColumns: ["name"],
        contentColumns: { content: ["prompt"] },
        additionalConditions,
      });

      const count = await ctx.prisma.$queryRaw<Array<{ totalCount: bigint }>>(
        generateOxfordViewQuery(
          Prisma.sql` count(*) AS "totalCount"`,
          input.projectId,
          filterCondition,
          Prisma.empty,
          1,
          0,
          pathFilter,
          searchCondition,
          input.pathPrefix,
        ),
      );

      return { totalCount: count[0].totalCount };
    }),

  byId: protectedProjectProcedure
    .input(z.object({ projectId: z.string(), id: z.string() }))
    .query(async ({ input, ctx }) => {
      throwIfNoProjectAccess({
        session: ctx.session,
        projectId: input.projectId,
        scope: "prompts:read",
      });
      return ctx.prisma.oxfordView.findFirst({
        where: { id: input.id, projectId: input.projectId },
      });
    }),

  create: protectedProjectProcedure
    .input(CreatePromptTRPCSchema)
    .mutation(async ({ input, ctx }) => {
      throwIfNoProjectAccess({
        session: ctx.session,
        projectId: input.projectId,
        scope: "prompts:CUD",
      });

      const {
        projectId,
        name,
        prompt,
        type = PromptType.Text,
        labels = [],
        config,
        tags,
        commitMessage,
      } = input;

      const latestView = await ctx.prisma.oxfordView.findFirst({
        where: { projectId, name },
        orderBy: [{ version: "desc" }],
      });

      if (latestView && latestView.type !== type) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "Previous versions have different type. Create a new oxford view with a different name.",
        });
      }

      const finalLabels = [...new Set([...labels, LATEST_PROMPT_LABEL])];
      const finalTags = [...new Set(tags ?? latestView?.tags ?? [])];
      const newId = uuidv4();
      const newVersion = latestView?.version ? latestView.version + 1 : 1;

      // Remove finalLabels from previous versions
      const previousWithLabels = await ctx.prisma.oxfordView.findMany({
        where: {
          projectId,
          name,
          labels: { hasSome: finalLabels },
          id: { not: newId },
        },
      });

      const updates = previousWithLabels.map((v) =>
        ctx.prisma.oxfordView.update({
          where: { id: v.id },
          data: { labels: v.labels.filter((l) => !finalLabels.includes(l)) },
        }),
      );

      const [createdView] = await ctx.prisma.$transaction([
        ctx.prisma.oxfordView.create({
          data: {
            id: newId,
            prompt,
            name,
            createdBy: ctx.session.user.id,
            labels: finalLabels,
            type,
            tags: finalTags,
            version: newVersion,
            project: { connect: { id: projectId } },
            config: jsonSchema.parse(config),
            commitMessage,
          },
        }),
        ...updates,
      ]);

      await auditLog(
        {
          session: ctx.session,
          resourceType: "prompt",
          resourceId: createdView.id,
          action: "create",
          after: createdView,
        },
        ctx.prisma,
      );

      return createdView;
    }),

  duplicateView: protectedProjectProcedure
    .input(
      z.object({
        projectId: z.string(),
        viewId: z.string(),
        name: StringNoHTMLNonEmpty,
        isSingleVersion: z.boolean(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      throwIfNoProjectAccess({
        session: ctx.session,
        projectId: input.projectId,
        scope: "prompts:CUD",
      });

      const nameExists = await ctx.prisma.oxfordView.findFirst({
        where: { projectId: input.projectId, name: input.name },
      });
      if (nameExists) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Oxford View name "${input.name}" already exists.`,
        });
      }

      const existing = await ctx.prisma.oxfordView.findUnique({
        where: { id: input.viewId, projectId: input.projectId },
      });
      if (!existing) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Oxford View not found.",
        });
      }

      const viewsToCopy = await ctx.prisma.oxfordView.findMany({
        where: {
          projectId: input.projectId,
          name: existing.name,
          version: input.isSingleVersion ? existing.version : undefined,
        },
      });

      const toCreate = viewsToCopy.map((v) => ({
        id: uuidv4(),
        name: input.name,
        version: input.isSingleVersion ? 1 : v.version,
        labels: input.isSingleVersion
          ? [...new Set([LATEST_PROMPT_LABEL, ...v.labels])]
          : v.labels,
        type: v.type,
        prompt: PromptContentSchema.parse(v.prompt),
        config: jsonSchema.parse(v.config),
        tags: v.tags,
        projectId: input.projectId,
        createdBy: ctx.session.user.id,
        commitMessage: v.commitMessage,
        createdAt: new Date(),
        updatedAt: new Date(),
      }));

      await ctx.prisma.oxfordView.createMany({ data: toCreate });

      const created = await ctx.prisma.oxfordView.findFirst({
        where: {
          projectId: input.projectId,
          name: input.name,
          version: input.isSingleVersion ? 1 : existing.version,
        },
      });

      await auditLog(
        {
          session: ctx.session,
          resourceType: "prompt",
          resourceId: created?.id ?? input.name,
          action: "create",
          after: created,
        },
        ctx.prisma,
      );

      return created;
    }),

  duplicateFolder: protectedProjectProcedure
    .input(
      z.object({
        projectId: z.string(),
        sourcePath: StringNoHTMLNonEmpty,
        targetPath: StringNoHTMLNonEmpty,
        isSingleVersion: z.boolean(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      throwIfNoProjectAccess({
        session: ctx.session,
        projectId: input.projectId,
        scope: "prompts:CUD",
      });

      const { projectId, sourcePath, targetPath, isSingleVersion } = input;
      const escapedTarget = escapeSqlLikePattern(targetPath);
      const escapedSource = escapeSqlLikePattern(sourcePath);

      const existingTarget = await ctx.prisma.oxfordView.findFirst({
        where: { projectId, name: { startsWith: `${escapedTarget}/` } },
      });
      if (existingTarget) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Oxford Views already exist under "${targetPath}/".`,
        });
      }

      const sourceViews = await ctx.prisma.oxfordView.findMany({
        where: { projectId, name: { startsWith: `${escapedSource}/` } },
        orderBy: [{ name: "asc" }, { version: "asc" }],
      });

      if (sourceViews.length === 0) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `No Oxford Views found under "${sourcePath}/".`,
        });
      }

      const viewsByName = new Map<string, typeof sourceViews>();
      for (const v of sourceViews) {
        const existing = viewsByName.get(v.name) ?? [];
        existing.push(v);
        viewsByName.set(v.name, existing);
      }

      const toCreate: Array<{
        id: string;
        name: string;
        version: number;
        labels: string[];
        type: string;
        prompt: ReturnType<typeof PromptContentSchema.parse>;
        config: ReturnType<typeof jsonSchema.parse>;
        tags: string[];
        projectId: string;
        createdBy: string;
        commitMessage: string | null;
        createdAt: Date;
        updatedAt: Date;
      }> = [];

      for (const [originalName, versions] of viewsByName) {
        const latestVersion =
          versions.find((v) => v.labels.includes(LATEST_PROMPT_LABEL)) ??
          versions.reduce((a, b) => (a.version > b.version ? a : b));

        const newName = `${targetPath}${originalName.slice(sourcePath.length)}`;
        const versionsToCopy = isSingleVersion ? [latestVersion] : versions;

        for (const v of versionsToCopy) {
          toCreate.push({
            id: uuidv4(),
            name: newName,
            version: isSingleVersion ? 1 : v.version,
            labels: isSingleVersion
              ? [...new Set([LATEST_PROMPT_LABEL, ...v.labels])]
              : v.labels,
            type: v.type,
            prompt: PromptContentSchema.parse(v.prompt),
            config: jsonSchema.parse(v.config),
            tags: v.tags,
            projectId,
            createdBy: ctx.session.user.id,
            commitMessage: v.commitMessage,
            createdAt: new Date(),
            updatedAt: new Date(),
          });
        }
      }

      await ctx.prisma.oxfordView.createMany({ data: toCreate });

      await auditLog(
        {
          session: ctx.session,
          resourceType: "prompt",
          resourceId: targetPath,
          action: "create",
          after: { copiedCount: toCreate.length },
        },
        ctx.prisma,
      );

      return {
        copiedPromptNames: toCreate
          .map((v) => v.name)
          .filter((v, i, a) => a.indexOf(v) === i),
        copiedCount: toCreate.length,
      };
    }),

  filterOptions: protectedProjectProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ input, ctx }) => {
      const [names, tags, labels] = await Promise.all([
        ctx.prisma.oxfordView.groupBy({
          where: { projectId: input.projectId },
          by: ["name"],
          take: 1000,
          orderBy: { name: "asc" },
        }),
        ctx.prisma.$queryRaw<{ value: string }[]>`
          SELECT tags.tag as value
          FROM oxford_views, UNNEST(oxford_views.tags) AS tags(tag)
          WHERE oxford_views.project_id = ${input.projectId}
          GROUP BY tags.tag
          ORDER BY tags.tag ASC;
        `,
        ctx.prisma.$queryRaw<{ value: string }[]>`
          SELECT labels.label as value
          FROM oxford_views, UNNEST(oxford_views.labels) AS labels(label)
          WHERE oxford_views.project_id = ${input.projectId}
          GROUP BY labels.label
          ORDER BY labels.label ASC;
        `,
      ]);

      return {
        name: names
          .filter((n) => n.name !== null)
          .map((n) => ({ value: n.name })),
        labels,
        tags,
      };
    }),

  delete: protectedProjectProcedure
    .input(
      z.object({
        projectId: z.string(),
        promptName: z.string().optional(),
        pathPrefix: z.string().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const { projectId, promptName, pathPrefix } = input;
      if (!promptName && !pathPrefix) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Either promptName or pathPrefix must be provided",
        });
      }

      throwIfNoProjectAccess({
        session: ctx.session,
        projectId,
        scope: "prompts:CUD",
      });

      const escapedPathPrefix = pathPrefix
        ? escapeSqlLikePattern(pathPrefix)
        : undefined;

      const views = await ctx.prisma.oxfordView.findMany({
        where: {
          projectId,
          name: promptName
            ? promptName
            : { startsWith: `${escapedPathPrefix}/` },
        },
      });

      for (const v of views) {
        await auditLog(
          {
            session: ctx.session,
            resourceType: "prompt",
            resourceId: v.id,
            action: "delete",
            before: v,
          },
          ctx.prisma,
        );
      }

      await ctx.prisma.oxfordView.deleteMany({
        where: { projectId, id: { in: views.map((v) => v.id) } },
      });

      return { deletedNames: [...new Set(views.map((v) => v.name))] };
    }),

  deleteVersion: protectedProjectProcedure
    .input(z.object({ promptVersionId: z.string(), projectId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const { projectId } = input;

      throwIfNoProjectAccess({
        session: ctx.session,
        projectId,
        scope: "prompts:CUD",
      });

      const view = await ctx.prisma.oxfordView.findFirstOrThrow({
        where: { id: input.promptVersionId, projectId },
      });

      await auditLog(
        {
          session: ctx.session,
          resourceType: "prompt",
          resourceId: input.promptVersionId,
          action: "delete",
          before: view,
        },
        ctx.prisma,
      );

      const transaction: ReturnType<
        | typeof ctx.prisma.oxfordView.delete
        | typeof ctx.prisma.oxfordView.update
      >[] = [
        ctx.prisma.oxfordView.delete({
          where: { id: input.promptVersionId, projectId },
        }),
      ];

      if (view.labels.includes(LATEST_PROMPT_LABEL)) {
        const newLatest = await ctx.prisma.oxfordView.findFirst({
          where: {
            projectId,
            name: view.name,
            id: { not: input.promptVersionId },
          },
          orderBy: [{ version: "desc" }],
        });
        if (newLatest) {
          transaction.push(
            ctx.prisma.oxfordView.update({
              where: { id: newLatest.id, projectId },
              data: { labels: { push: LATEST_PROMPT_LABEL } },
            }),
          );
        }
      }

      await ctx.prisma.$transaction(transaction);
    }),

  setLabels: protectedProjectProcedure
    .input(
      z.object({
        promptId: z.string(),
        projectId: z.string(),
        labels: z.array(z.string()),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      throwIfNoProjectAccess({
        session: ctx.session,
        projectId: input.projectId,
        scope: "prompts:CUD",
      });

      const view = await ctx.prisma.oxfordView.findUnique({
        where: { id: input.promptId, projectId: input.projectId },
      });
      if (!view)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Oxford View not found.",
        });

      const newLabels = [...new Set(input.labels)];
      const prevLabeled = await ctx.prisma.oxfordView.findMany({
        where: {
          projectId: input.projectId,
          name: view.name,
          labels: { hasSome: newLabels },
          id: { not: input.promptId },
        },
        orderBy: [{ version: "desc" }],
      });

      const toExec = [
        ctx.prisma.oxfordView.update({
          where: { id: view.id, projectId: input.projectId },
          data: { labels: newLabels },
        }),
        ...prevLabeled.map((prev) =>
          ctx.prisma.oxfordView.update({
            where: { id: prev.id, projectId: input.projectId },
            data: { labels: prev.labels.filter((l) => !newLabels.includes(l)) },
          }),
        ),
      ];

      await ctx.prisma.$transaction(toExec);

      await auditLog(
        {
          session: ctx.session,
          resourceType: "prompt",
          resourceId: view.id,
          action: "setLabel",
          after: { ...view, labels: newLabels },
        },
        ctx.prisma,
      );
    }),

  allLabels: protectedProjectProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ input, ctx }) => {
      throwIfNoProjectAccess({
        session: ctx.session,
        projectId: input.projectId,
        scope: "prompts:read",
      });
      const labels = await ctx.prisma.$queryRaw<{ label: string }[]>`
        SELECT DISTINCT UNNEST(labels) AS label
        FROM oxford_views
        WHERE project_id = ${input.projectId}
        AND labels IS NOT NULL;
      `;
      return labels.map((l) => l.label);
    }),

  allNames: protectedProjectProcedure
    .input(
      z.object({ projectId: z.string(), type: z.enum(PromptType).optional() }),
    )
    .query(async ({ input, ctx }) => {
      throwIfNoProjectAccess({
        session: ctx.session,
        projectId: input.projectId,
        scope: "prompts:read",
      });
      return ctx.prisma.oxfordView.findMany({
        where: { projectId: input.projectId, type: input.type },
        select: { id: true, name: true },
        distinct: ["name"],
      });
    }),

  allVersions: protectedProjectProcedure
    .input(
      z.object({
        projectId: z.string(),
        name: z.string(),
        ...optionalPaginationZod,
      }),
    )
    .query(async ({ input, ctx }) => {
      throwIfNoProjectAccess({
        session: ctx.session,
        projectId: input.projectId,
        scope: "prompts:read",
      });

      const [views, totalCount] = await Promise.all([
        ctx.prisma.oxfordView.findMany({
          where: { projectId: input.projectId, name: input.name },
          ...(input.limit !== undefined && input.page !== undefined
            ? { take: input.limit, skip: input.page * input.limit }
            : undefined),
          orderBy: [{ version: "desc" }],
        }),
        ctx.prisma.oxfordView.count({
          where: { projectId: input.projectId, name: input.name },
        }),
      ]);

      const userIds = views
        .map((v) => v.createdBy)
        .filter((id) => id !== "API");
      const users = await ctx.prisma.user.findMany({
        select: { id: true, name: true },
        where: {
          id: { in: userIds },
          organizationMemberships: { some: { orgId: ctx.session.orgId } },
        },
      });

      const joined = views.map((v) => {
        const user = users.find((u) => u.id === v.createdBy);
        return { ...v, creator: v.createdBy === "API" ? "API" : user?.name };
      });

      return { promptVersions: joined, totalCount };
    }),

  updateTags: protectedProjectProcedure
    .input(
      z.object({
        projectId: z.string(),
        promptName: z.string(),
        tags: z.array(z.string()),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      throwIfNoProjectAccess({
        session: ctx.session,
        projectId: input.projectId,
        scope: "prompts:CUD",
      });

      await ctx.prisma.oxfordView.updateMany({
        where: { name: input.promptName, projectId: input.projectId },
        data: { tags: { set: input.tags } },
      });

      await auditLog(
        {
          session: ctx.session,
          resourceType: "prompt",
          resourceId: input.promptName,
          action: "updateTags",
          after: input.tags,
        },
        ctx.prisma,
      );
    }),
});
