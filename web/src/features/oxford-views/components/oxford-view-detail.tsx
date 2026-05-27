import Link from "next/link";
import { useRouter } from "next/router";
import {
  NumberParam,
  StringParam,
  useQueryParam,
  withDefault,
} from "use-query-params";
import type { z } from "zod";
import { OpenAiMessageView } from "@/src/components/trace/components/IOPreview/components/ChatMessageList";
import {
  TabsBar,
  TabsBarList,
  TabsBarContent,
  TabsBarTrigger,
} from "@/src/components/ui/tabs-bar";
import { Badge } from "@/src/components/ui/badge";
import { CodeView, JSONView } from "@/src/components/ui/CodeJsonViewer";
import useProjectIdFromURL from "@/src/hooks/useProjectIdFromURL";
import { api } from "@/src/utils/api";
import {
  extractVariables,
  PRODUCTION_LABEL,
  PromptType,
} from "@langfuse/shared";
import { OxfordViewHistoryNode } from "@/src/features/oxford-views/components/oxford-view-history";
import { ChatMlArraySchema } from "@/src/components/schemas/ChatMlSchema";
import { MoreVertical, Plus } from "lucide-react";
import { Button } from "@/src/components/ui/button";
import { useMemo, useState } from "react";
import { DuplicateOxfordViewButton } from "@/src/features/oxford-views/components/duplicate-oxford-view";
import Page from "@/src/components/layouts/page";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/src/components/ui/dropdown-menu";
import { DeleteOxfordViewVersion } from "@/src/features/oxford-views/components/delete-oxford-view-version";
import { SetOxfordViewVersionLabels } from "@/src/features/oxford-views/components/SetOxfordViewVersionLabels";
import { Command, CommandInput } from "@/src/components/ui/command";
import { PromptVariableListPreview } from "@/src/features/prompts/components/PromptVariableListPreview";
import { createBreadcrumbItems } from "@/src/features/folders/utils";

const getPythonCode = (
  name: string,
  version: number,
  labels: string[],
) => `from langfuse import Langfuse

langfuse = Langfuse()

# Get production view
prompt = langfuse.get_prompt("${name}")

# Get by label
${labels.length > 0 ? labels.map((label) => `prompt = langfuse.get_prompt("${name}", label="${label}")`).join("\n") : ""}

# Get by version
langfuse.get_prompt("${name}", version=${version})
`;

const getJsCode = (
  name: string,
  version: number,
  labels: string[],
) => `import { LangfuseClient } from "@langfuse/client";

const langfuse = new LangfuseClient();

// Get production view
const prompt = await langfuse.prompt.get("${name}");

// Get by label
${labels.length > 0 ? labels.map((label) => `const prompt = await langfuse.prompt.get("${name}", { label: "${label}" })`).join("\n") : ""}

// Get by version
await langfuse.prompt.get("${name}", { version: ${version} })
`;

export const OxfordViewDetail = ({
  promptName: promptNameProp,
}: { promptName?: string } = {}) => {
  const projectId = useProjectIdFromURL();
  const router = useRouter();

  const promptName =
    promptNameProp ||
    (router.query.promptName
      ? decodeURIComponent(router.query.promptName as string)
      : "");
  const [currentVersion, setCurrentVersion] = useQueryParam(
    "version",
    NumberParam,
  );
  const [currentLabel, setCurrentLabel] = useQueryParam("label", StringParam);
  const [currentTab, setCurrentTab] = useQueryParam(
    "tab",
    withDefault(StringParam, "content"),
  );
  const [isLabelPopoverOpen, setIsLabelPopoverOpen] = useState(false);

  const viewHistory = api.oxfordViews.allVersions.useQuery(
    { name: promptName, projectId: projectId as string },
    { enabled: Boolean(projectId) },
  );

  const view = currentVersion
    ? viewHistory.data?.promptVersions.find((v) => v.version === currentVersion)
    : currentLabel
      ? viewHistory.data?.promptVersions.find((v) =>
          v.labels.includes(currentLabel),
        )
      : viewHistory.data?.promptVersions[0];

  let chatMessages: z.infer<typeof ChatMlArraySchema> | null = null;
  try {
    chatMessages = ChatMlArraySchema.parse(view?.prompt);
  } catch (error) {
    if (PromptType.Chat === view?.type) {
      console.warn("Could not parse chat view", error);
    }
  }

  const { pythonCode, jsCode } = useMemo(() => {
    if (!view?.id) return { pythonCode: null, jsCode: null };
    const sortedLabels = [...view.labels].sort((a, b) => {
      if (a === PRODUCTION_LABEL) return -1;
      if (b === PRODUCTION_LABEL) return 1;
      return a.localeCompare(b);
    });
    return {
      pythonCode: getPythonCode(view.name, view.version, sortedLabels),
      jsCode: getJsCode(view.name, view.version, sortedLabels),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view?.id]);

  if (!viewHistory.data || !view) {
    return <div className="p-3">Loading...</div>;
  }

  const extractedVariables = view
    ? extractVariables(
        view.type === PromptType.Text
          ? (view.prompt?.toString() ?? "")
          : JSON.stringify(view.prompt),
      )
    : [];

  const segments = promptName.split("/").filter((s) => s.trim());
  const folderPath = segments.length > 1 ? segments.slice(0, -1).join("/") : "";
  const breadcrumbItems = folderPath ? createBreadcrumbItems(folderPath) : [];

  return (
    <Page
      headerProps={{
        title: view.name,
        titleTooltip:
          "View names cannot be changed. Duplicate this view to use a different name.",
        itemType: "PROMPT",
        help: {
          description:
            "Oxford Views are versioned content templates managed in Langfuse.",
          href: "https://langfuse.com/docs/prompt-management/get-started",
        },
        breadcrumb: [
          {
            name: "Oxford Views",
            href: `/project/${projectId}/oxford-views/`,
          },
          ...breadcrumbItems.map((item) => ({
            name: item.name,
            href: `/project/${projectId}/oxford-views?folder=${encodeURIComponent(item.folderPath)}`,
          })),
        ],
        actionButtonsRight: (
          <>
            {projectId && (
              <DuplicateOxfordViewButton
                viewId={view.id}
                projectId={projectId}
                viewName={view.name}
                viewVersion={view.version}
              />
            )}
          </>
        ),
      }}
    >
      <div className="grid flex-1 grid-cols-3 gap-4 overflow-hidden px-3 md:grid-cols-4">
        <Command className="flex flex-col gap-2 overflow-y-auto rounded-none border-r pr-3 font-medium focus:ring-0 focus:outline-hidden focus-visible:ring-0 focus-visible:ring-offset-0 focus-visible:outline-hidden data-focus:ring-0">
          <div className="mt-3 flex items-center justify-between">
            <CommandInput
              showBorder={false}
              placeholder="Search..."
              className="text-muted-foreground h-fit border-none py-0 text-sm font-light focus:ring-0"
            />
            <Button className="h-6 w-6 shrink-0 px-1 lg:h-8 lg:w-fit lg:px-3">
              <Link
                className="grid w-full place-items-center md:grid-flow-col"
                href={`/project/${projectId}/oxford-views/new?promptId=${encodeURIComponent(view.id)}`}
              >
                <Plus className="h-4 w-4 md:mr-2" />
                <span className="hidden lg:inline">New version</span>
              </Link>
            </Button>
          </div>
          <div className="flex flex-col overflow-y-auto">
            <OxfordViewHistoryNode
              views={viewHistory.data.promptVersions}
              currentVersion={view.version}
              setCurrentVersion={(version) => {
                setCurrentVersion(version);
                setCurrentLabel(null);
              }}
            />
          </div>
        </Command>

        <div className="col-span-2 mt-3 flex max-h-full min-h-0 flex-col md:col-span-3">
          <div className="flex flex-col items-start gap-2">
            <div className="grid w-full min-w-0 grid-cols-[auto_auto] items-center justify-between">
              <div className="flex max-w-full min-w-0 shrink flex-col">
                <div className="flex max-w-full min-w-0 flex-wrap items-start gap-1">
                  <SetOxfordViewVersionLabels
                    title={
                      <div
                        className="contents cursor-default!"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <Badge
                          variant="outline"
                          className="mr-1 h-6 text-nowrap"
                        >
                          # {view.version}
                        </Badge>
                        <span className="mb-0 line-clamp-2 min-w-0 text-lg font-medium break-all md:break-normal md:wrap-break-word">
                          {view.commitMessage ?? view.name}
                        </span>
                      </div>
                    }
                    promptLabels={view.labels}
                    prompt={view}
                    isOpen={isLabelPopoverOpen}
                    setIsOpen={setIsLabelPopoverOpen}
                  />
                </div>
                <div className="min-h-1 flex-1" />
              </div>

              <div className="flex h-full flex-wrap content-start items-start justify-end gap-1 lg:flex-nowrap">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="icon">
                      <MoreVertical className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    align="end"
                    className="flex flex-col *:w-full *:justify-start"
                  >
                    <DropdownMenuItem asChild>
                      <DeleteOxfordViewVersion
                        promptVersionId={view.id}
                        version={view.version}
                        countVersions={viewHistory.data.totalCount}
                      />
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          </div>

          <TabsBar
            value={currentTab}
            className="min-h-0"
            onValueChange={(value) => setCurrentTab(value)}
          >
            <TabsBarList className="max-w-full min-w-0 justify-start overflow-x-auto">
              <TabsBarTrigger value="content">Content</TabsBarTrigger>
              <TabsBarTrigger value="config">Config</TabsBarTrigger>
              <TabsBarTrigger value="use-view">Use View</TabsBarTrigger>
            </TabsBarList>

            <TabsBarContent
              value="content"
              className="mt-0 flex max-h-full min-h-0 flex-1 overflow-hidden"
            >
              <div className="mb-2 flex max-h-full min-h-0 w-full flex-col gap-2 overflow-y-auto">
                {view.type === PromptType.Chat && chatMessages ? (
                  <div className="w-full">
                    {/* eslint-disable-next-line @typescript-eslint/no-deprecated */}
                    <OpenAiMessageView
                      messages={chatMessages}
                      shouldRenderMarkdown={true}
                      currentView="pretty"
                      messageToToolCallNumbers={new Map()}
                      collapseLongHistory={false}
                    />
                  </div>
                ) : typeof view.prompt === "string" ? (
                  <CodeView content={view.prompt} title="Text Content" />
                ) : (
                  <JSONView json={view.prompt} title="Content" />
                )}
                <PromptVariableListPreview variables={extractedVariables} />
              </div>
            </TabsBarContent>

            <TabsBarContent
              value="config"
              className="mt-0 flex max-h-full min-h-0 flex-1 overflow-hidden"
            >
              <div className="flex max-h-full min-h-0 w-full flex-col overflow-y-auto pb-4">
                <JSONView json={view.config} title="Config" className="pb-2" />
              </div>
            </TabsBarContent>

            <TabsBarContent
              value="use-view"
              className="mt-0 flex max-h-full min-h-0 flex-1 overflow-hidden"
            >
              <div className="flex h-full min-h-0 w-full flex-col gap-2 overflow-y-auto pb-4">
                {pythonCode && <CodeView content={pythonCode} title="Python" />}
                {jsCode && <CodeView content={jsCode} title="JS/TS" />}
                <p className="text-muted-foreground pl-1 text-xs">
                  See{" "}
                  <a
                    href="https://langfuse.com/docs/prompts"
                    className="underline"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    documentation
                  </a>{" "}
                  for more details.
                </p>
              </div>
            </TabsBarContent>
          </TabsBar>
        </div>
      </div>
    </Page>
  );
};
