import { useRouter } from "next/router";
import { ActionButton } from "@/src/components/ActionButton";
import Page from "@/src/components/layouts/page";
import { usePostHogClientCapture } from "@/src/features/posthog-analytics/usePostHogClientCapture";
import { OxfordViewsTable } from "@/src/features/oxford-views/components/oxford-views-table";
import { useHasProjectAccess } from "@/src/features/rbac/utils/checkProjectAccess";
import { PlusIcon } from "lucide-react";
import { api } from "@/src/utils/api";
import { OxfordViewDetail } from "@/src/features/oxford-views/components/oxford-view-detail";
import { useQueryParams, StringParam } from "use-query-params";
import React from "react";

export default function OxfordViewsWithFolder() {
  const router = useRouter();
  const projectId = router.query.projectId as string;
  const routeSegments = router.query.folder;
  const [queryParams] = useQueryParams({ folder: StringParam });
  const folderQueryParam = queryParams.folder || "";

  const segmentsArray = Array.isArray(routeSegments) ? routeSegments : [];
  const viewNameFromRoute =
    segmentsArray.length > 0 ? segmentsArray.join("/") : "";

  const capture = usePostHogClientCapture();
  const hasCUDAccess = useHasProjectAccess({
    projectId,
    scope: "prompts:CUD",
  });

  const { data: hasAnyView, isLoading } = api.oxfordViews.hasAny.useQuery(
    { projectId },
    {
      enabled: !!projectId,
      trpc: { context: { skipBatch: true } },
    },
  );

  if (viewNameFromRoute.length > 0) {
    return <OxfordViewDetail promptName={viewNameFromRoute} />;
  }

  return (
    <Page
      headerProps={{
        title: "Oxford Views",
        help: {
          description:
            "Manage and version your Oxford Views in Langfuse. Read and write them via the UI and SDK.",
          href: "https://langfuse.com/docs/prompt-management/get-started",
        },
        actionButtonsRight: (
          <ActionButton
            icon={<PlusIcon className="h-4 w-4" aria-hidden="true" />}
            hasAccess={hasCUDAccess}
            href={`/project/${projectId}/oxford-views/new${folderQueryParam ? `?folder=${encodeURIComponent(folderQueryParam)}` : ""}`}
            variant="default"
            onClick={() => capture("prompts:new_form_open")}
          >
            New Oxford View
          </ActionButton>
        ),
      }}
    >
      {!isLoading && !hasAnyView ? (
        <div className="flex h-full flex-col items-center justify-center gap-4">
          <p className="text-muted-foreground text-sm">
            No Oxford Views yet. Create your first one!
          </p>
          <ActionButton
            icon={<PlusIcon className="h-4 w-4" aria-hidden="true" />}
            hasAccess={hasCUDAccess}
            href={`/project/${projectId}/oxford-views/new`}
            variant="default"
          >
            New Oxford View
          </ActionButton>
        </div>
      ) : (
        <OxfordViewsTable key={folderQueryParam} />
      )}
    </Page>
  );
}
