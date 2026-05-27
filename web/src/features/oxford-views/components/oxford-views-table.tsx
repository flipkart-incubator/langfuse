import { useEffect, useMemo } from "react";
import { DataTable } from "@/src/components/table/data-table";
import {
  DataTableControlsProvider,
  DataTableControls,
} from "@/src/components/table/data-table-controls";
import { ResizableFilterLayout } from "@/src/components/table/resizable-filter-layout";
import TableLink from "@/src/components/table/table-link";
import { type LangfuseColumnDef } from "@/src/components/table/types";
import { useDetailPageLists } from "@/src/features/navigate-detail-pages/context";
import { DeleteOxfordView } from "@/src/features/oxford-views/components/delete-oxford-view";
import { DeleteOxfordViewFolder } from "@/src/features/oxford-views/components/delete-oxford-view-folder";
import useProjectIdFromURL from "@/src/hooks/useProjectIdFromURL";
import { api } from "@/src/utils/api";
import { type RouterOutput } from "@/src/utils/types";
import { DataTableToolbar } from "@/src/components/table/data-table-toolbar";
import { useQueryFilterState } from "@/src/features/filters/hooks/useFilterState";
import { useSidebarFilterState } from "@/src/features/filters/hooks/useSidebarFilterState";
import { promptFilterConfig } from "@/src/features/filters/config/prompts-config";
import { useOrderByState } from "@/src/features/orderBy/hooks/useOrderByState";
import { joinTableCoreAndMetrics } from "@/src/components/table/utils/joinTableCoreAndMetrics";
import { useDebounce } from "@/src/hooks/useDebounce";
import { LocalIsoDate } from "@/src/components/LocalIsoDate";
import { useFullTextSearch } from "@/src/components/table/use-cases/useFullTextSearch";
import { useFolderPagination } from "@/src/features/folders/hooks/useFolderPagination";
import { buildFullPath } from "@/src/features/folders/utils";
import { FolderBreadcrumb } from "@/src/features/folders/components/FolderBreadcrumb";
import { FolderBreadcrumbLink } from "@/src/features/folders/components/FolderBreadcrumbLink";
import { TagPromptPopover } from "@/src/features/tag/components/TagPromptPopover";

type OxfordViewTableRow = {
  id: string;
  name: string;
  fullPath: string;
  type: "folder" | "text" | "chat";
  version?: number;
  createdAt?: Date;
  labels?: string[];
  tags?: string[];
};

function createRow(
  data: Partial<OxfordViewTableRow> & {
    id: string;
    name: string;
    fullPath: string;
    type: "folder" | "text" | "chat";
  },
): OxfordViewTableRow {
  return {
    version: undefined,
    createdAt: undefined,
    labels: [],
    tags: [],
    ...data,
  };
}

export function OxfordViewsTable() {
  const projectId = useProjectIdFromURL() ?? "";
  const { setDetailPageList } = useDetailPageLists();

  const [filterState] = useQueryFilterState([], "prompts", projectId);

  const [orderByState, setOrderByState] = useOrderByState({
    column: "createdAt",
    order: "DESC",
  });

  const {
    paginationState,
    currentFolderPath,
    navigateToFolder,
    resetPaginationAndFolder,
    setPaginationAndFolderState,
  } = useFolderPagination();

  const { searchQuery, searchType, setSearchQuery, setSearchType } =
    useFullTextSearch();

  useEffect(() => {
    resetPaginationAndFolder();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery]);

  const views = api.oxfordViews.all.useQuery(
    {
      page: paginationState.pageIndex,
      limit: paginationState.pageSize,
      projectId,
      filter: filterState,
      orderBy: orderByState,
      pathPrefix: currentFolderPath,
      searchQuery: searchQuery || undefined,
      searchType: searchType,
    },
    {
      enabled: Boolean(projectId),
      trpc: { context: { skipBatch: true } },
    },
  );

  type CoreOutput = RouterOutput["oxfordViews"]["all"]["prompts"][number];
  type CoreType = Omit<CoreOutput, "name"> & { id: string };

  const viewsRowData = joinTableCoreAndMetrics<CoreType, CoreType>(
    views.data?.prompts.map((v) => ({
      ...v,
      id: buildFullPath(currentFolderPath, v.name),
    })),
    undefined,
  );

  const processedRowData = useMemo(() => {
    if (!viewsRowData.rows) return { ...viewsRowData, rows: [] };

    const combinedRows: OxfordViewTableRow[] = [];

    for (const view of viewsRowData.rows) {
      const isFolder = view.row_type === "folder";
      const fullPath = view.id;
      const itemName = fullPath.split("/").pop() ?? fullPath;
      const type =
        isFolder || view.type === "folder"
          ? "folder"
          : view.type === "chat"
            ? "chat"
            : "text";

      combinedRows.push(
        createRow({
          id: `${type}-${fullPath}`,
          name: itemName,
          fullPath,
          type,
          ...(isFolder
            ? {}
            : {
                version: view.version,
                createdAt: view.createdAt,
                labels: view.labels,
                tags: view.tags,
              }),
        }),
      );
    }

    return { ...viewsRowData, rows: combinedRows };
  }, [viewsRowData]);

  const filterOptions = api.oxfordViews.filterOptions.useQuery(
    { projectId },
    {
      trpc: { context: { skipBatch: true } },
      refetchOnMount: false,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      staleTime: Infinity,
    },
  );

  const filterOptionTags = filterOptions.data?.tags ?? [];
  const allTags = filterOptionTags.map((t) => t.value);
  const totalCount = views.data?.totalCount ?? null;

  const newFilterOptions = useMemo(
    () => ({
      type: ["text", "chat"],
      labels:
        filterOptions.data?.labels?.map((l) => ({ value: l.value })) ??
        undefined,
      tags:
        filterOptions.data?.tags?.map((t) => ({ value: t.value })) ?? undefined,
      version: [],
    }),
    [filterOptions.data],
  );

  const queryFilter = useSidebarFilterState(
    promptFilterConfig,
    newFilterOptions,
    {
      loading: filterOptions.isPending,
      stateLocation: "urlAndSessionStorage",
      sessionFilterContextId: projectId ?? null,
    },
  );

  useEffect(() => {
    if (views.isSuccess) {
      setDetailPageList(
        "oxfordViews",
        views.data.prompts.map((v) => ({ id: v.name })),
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [views.isSuccess, views.data]);

  const columns: LangfuseColumnDef<OxfordViewTableRow>[] = [
    {
      accessorKey: "name",
      header: "Name",
      id: "name",
      enableSorting: true,
      size: 250,
      cell: ({ getValue, row }) => {
        const name = getValue<string>();
        const rowData = row.original;

        if (rowData.type === "folder") {
          return (
            <FolderBreadcrumbLink
              name={name}
              onClick={() => navigateToFolder(rowData.fullPath)}
            />
          );
        }

        return name ? (
          <TableLink
            path={`/project/${projectId}/oxford-views/${encodeURIComponent(rowData.fullPath)}`}
            value={name}
            title={rowData.fullPath}
          />
        ) : undefined;
      },
    },
    {
      accessorKey: "version",
      header: "Versions",
      id: "version",
      enableSorting: true,
      size: 70,
      cell: ({ getValue, row }) => {
        if (row.original.type === "folder") return null;
        return getValue<number | undefined>();
      },
    },
    {
      accessorKey: "type",
      header: "Type",
      id: "type",
      enableSorting: true,
      size: 60,
    },
    {
      accessorKey: "createdAt",
      header: "Latest Version Created At",
      id: "createdAt",
      enableSorting: true,
      size: 200,
      cell: ({ getValue, row }) => {
        if (row.original.type === "folder") return null;
        const createdAt = getValue<Date | undefined>();
        return createdAt ? <LocalIsoDate date={createdAt} /> : null;
      },
    },
    {
      accessorKey: "tags",
      header: "Tags",
      id: "tags",
      enableSorting: true,
      size: 120,
      cell: ({ getValue, row }) => {
        if (row.original.type === "folder") return <div className="h-6" />;
        const tags = getValue<string[] | undefined>();
        const viewPath = row.original.fullPath;
        return (
          <TagPromptPopover
            tags={tags ?? []}
            availableTags={allTags}
            projectId={projectId}
            promptName={viewPath}
            promptsFilter={{
              page: 0,
              limit: 50,
              projectId,
              filter: filterState,
              orderBy: orderByState,
            }}
          />
        );
      },
      enableHiding: true,
    },
    {
      accessorKey: "id",
      id: "actions",
      header: "Actions",
      size: 70,
      enableSorting: false,
      cell: ({ row }) => {
        const rowData = row.original;
        if (rowData.type === "folder") {
          return (
            <div className="flex gap-1">
              <DeleteOxfordViewFolder folderPath={rowData.fullPath} />
            </div>
          );
        }

        return <DeleteOxfordView promptName={rowData.fullPath} />;
      },
    },
  ];

  return (
    <DataTableControlsProvider
      tableName={promptFilterConfig.tableName}
      defaultSidebarCollapsed={promptFilterConfig.defaultSidebarCollapsed}
    >
      <div className="flex h-full w-full flex-col">
        {currentFolderPath && (
          <FolderBreadcrumb
            currentFolderPath={currentFolderPath}
            navigateToFolder={navigateToFolder}
          />
        )}
        <DataTableToolbar
          columns={columns}
          filterState={queryFilter.filterState}
          columnsWithCustomSelect={["labels", "tags"]}
          searchConfig={{
            metadataSearchFields: ["Name", "Tags", "Content"],
            updateQuery: useDebounce(setSearchQuery, 300),
            currentQuery: searchQuery ?? undefined,
            tableAllowsFullTextSearch: true,
            setSearchType,
            searchType,
            customDropdownLabels: {
              metadata: "Names, Tags",
              fullText: "Full Text",
            },
            hidePerformanceWarning: true,
            availableSearchTypes: {
              content: true,
              input: false,
              output: false,
            },
          }}
        />

        <ResizableFilterLayout>
          <DataTableControls queryFilter={queryFilter} />

          <div className="flex flex-1 flex-col overflow-hidden">
            <DataTable
              tableName={"prompts"}
              columns={columns}
              data={
                views.isLoading
                  ? { isLoading: true, isError: false }
                  : views.isError
                    ? {
                        isLoading: false,
                        isError: true,
                        error: views.error.message,
                      }
                    : {
                        isLoading: false,
                        isError: false,
                        data: processedRowData.rows?.map((item) => ({
                          id: item.id,
                          name: item.name,
                          fullPath: item.fullPath,
                          version: item.version,
                          createdAt: item.createdAt,
                          type: item.type,
                          labels: item.labels,
                          tags: item.tags,
                        })),
                      }
              }
              orderBy={orderByState}
              setOrderBy={setOrderByState}
              pagination={{
                totalCount,
                onChange: setPaginationAndFolderState,
                state: paginationState,
              }}
              cellPadding="comfortable"
            />
          </div>
        </ResizableFilterLayout>
      </div>
    </DataTableControlsProvider>
  );
}
