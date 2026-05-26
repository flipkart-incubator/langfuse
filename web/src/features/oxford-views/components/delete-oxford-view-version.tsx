import { Button } from "@/src/components/ui/button";
import { useHasProjectAccess } from "@/src/features/rbac/utils/checkProjectAccess";
import { api } from "@/src/utils/api";
import { Trash } from "lucide-react";
import { useState } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/src/components/ui/popover";
import { useRouter } from "next/router";
import useProjectIdFromURL from "@/src/hooks/useProjectIdFromURL";

export function DeleteOxfordViewVersion({
  promptVersionId,
  version,
  countVersions,
}: {
  promptVersionId: string;
  version: number;
  countVersions: number;
}) {
  const projectId = useProjectIdFromURL();
  const utils = api.useUtils();
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hasAccess = useHasProjectAccess({ projectId, scope: "prompts:CUD" });

  const mutDelete = api.oxfordViews.deleteVersion.useMutation({
    onSuccess: () => {
      void utils.oxfordViews.invalidate();
      setError(null);
      setIsOpen(false);
      if (countVersions > 1) {
        void router.replace(
          {
            pathname: router.pathname,
            query: { ...router.query, version: undefined },
          },
          undefined,
          { shallow: true },
        );
      } else {
        void router.push(`/project/${projectId}/oxford-views`);
      }
    },
    onError: (e) => setError(e.message),
  });

  return (
    <Popover
      key={promptVersionId}
      open={isOpen}
      onOpenChange={() => setIsOpen(!isOpen)}
    >
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          type="button"
          disabled={!hasAccess}
          onClick={(e) => e.stopPropagation()}
        >
          <Trash className="mr-2 h-4 w-4" />
          Delete version
        </Button>
      </PopoverTrigger>
      <PopoverContent>
        <h2 className="text-md mb-3 font-semibold">Please confirm</h2>
        <p className="mb-3 text-sm">
          This action deletes version{" "}
          <code className="bg-muted relative rounded px-[0.3rem] py-[0.2rem] font-mono text-sm font-semibold">
            {version}
          </code>{" "}
          of this Oxford View.
        </p>
        {error && (
          <div className="mb-3 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            <p className="font-medium">Error:</p>
            <p className="whitespace-pre-wrap">{error}</p>
          </div>
        )}
        <div className="flex justify-end space-x-4">
          <Button
            type="button"
            variant="destructive"
            loading={mutDelete.isPending}
            onClick={() => {
              if (!projectId) return;
              setError(null);
              void mutDelete.mutate({ promptVersionId, projectId });
            }}
          >
            Delete Version
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
