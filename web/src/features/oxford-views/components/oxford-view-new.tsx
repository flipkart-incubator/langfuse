import { StringParam, useQueryParam } from "use-query-params";
import { NewOxfordViewForm } from "@/src/features/oxford-views/components/NewOxfordViewForm";
import useProjectIdFromURL from "@/src/hooks/useProjectIdFromURL";
import { api } from "@/src/utils/api";
import Page from "@/src/components/layouts/page";

export const NewOxfordView = () => {
  const projectId = useProjectIdFromURL();
  const [initialViewId] = useQueryParam("promptId", StringParam);

  const { data: initialView, isLoading } = api.oxfordViews.byId.useQuery(
    {
      projectId: projectId as string,
      id: initialViewId ?? "",
    },
    {
      enabled: Boolean(initialViewId && projectId),
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
    },
  );

  if (isLoading) {
    return <div className="p-3">Loading...</div>;
  }

  const breadcrumb: { name: string; href?: string }[] = [
    {
      name: "Oxford Views",
      href: `/project/${projectId}/oxford-views/`,
    },
    { name: "New Oxford View" },
  ];

  if (initialView) {
    breadcrumb.pop();
    breadcrumb.push(
      {
        name: initialView.name,
        href: `/project/${projectId}/oxford-views/${encodeURIComponent(initialView.name)}`,
      },
      { name: "New version" },
    );
  }

  return (
    <Page
      withPadding
      scrollable
      headerProps={{
        title: initialView
          ? `${initialView.name} — New version`
          : "Create new Oxford View",
        help: {
          description:
            "Oxford Views are versioned content templates managed in Langfuse.",
          href: "https://langfuse.com/docs/prompt-management/get-started",
        },
        breadcrumb,
      }}
    >
      {initialView ? (
        <p className="text-muted-foreground text-sm">
          Oxford Views are immutable. To update, create a new version.
        </p>
      ) : null}
      <div className="my-8">
        <NewOxfordViewForm initialPrompt={initialView} />
      </div>
    </Page>
  );
};
