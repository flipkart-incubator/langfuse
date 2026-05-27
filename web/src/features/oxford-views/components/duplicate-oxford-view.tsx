import { useRouter } from "next/router";
import { Button } from "@/src/components/ui/button";
import { api } from "@/src/utils/api";
import { Copy } from "lucide-react";
import { useHasProjectAccess } from "@/src/features/rbac/utils/checkProjectAccess";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/src/components/ui/dialog";
import { useState } from "react";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/src/components/ui/form";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Input } from "@/src/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/src/components/ui/radio-group";
enum CopySettings {
  SINGLE_VERSION = "single_version",
  ALL_VERSIONS = "all_versions",
}

const formSchema = z.object({
  name: z.string().min(1, "Name is required"),
  isCopySingleVersion: z.enum(CopySettings),
});

export function DuplicateOxfordViewButton({
  viewId,
  projectId,
  viewName,
  viewVersion,
}: {
  viewId: string;
  projectId: string;
  viewName: string;
  viewVersion: number;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const hasAccess = useHasProjectAccess({ projectId, scope: "prompts:CUD" });

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" disabled={!hasAccess}>
          <Copy className="mr-2 h-4 w-4" />
          Duplicate
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Duplicate Oxford View</DialogTitle>
        </DialogHeader>
        <DuplicateOxfordViewForm
          projectId={projectId}
          viewId={viewId}
          viewName={viewName}
          viewVersion={viewVersion}
          onFormSuccess={() => setIsOpen(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

const DuplicateOxfordViewForm: React.FC<{
  projectId: string;
  viewId: string;
  viewName: string;
  viewVersion: number;
  onFormSuccess: () => void;
}> = ({ projectId, viewId, viewName, viewVersion, onFormSuccess }) => {
  const router = useRouter();
  const utils = api.useUtils();
  const [error, setError] = useState<string | null>(null);

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: `${viewName}-copy`,
      isCopySingleVersion: CopySettings.SINGLE_VERSION,
    },
  });

  const mutDuplicate = api.oxfordViews.duplicateView.useMutation({
    onSuccess: (data) => {
      void utils.oxfordViews.invalidate();
      onFormSuccess();
      if (data?.name) {
        void router.push(
          `/project/${projectId}/oxford-views/${encodeURIComponent(data.name)}`,
        );
      }
    },
    onError: (e) => setError(e.message),
  });

  function onSubmit(values: z.infer<typeof formSchema>) {
    setError(null);
    mutDuplicate.mutate({
      projectId,
      viewId,
      name: values.name,
      isSingleVersion:
        values.isCopySingleVersion === CopySettings.SINGLE_VERSION,
    });
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)}>
        <DialogBody className="flex flex-col gap-4">
          <FormField
            control={form.control}
            name="name"
            render={({ field }) => (
              <FormItem>
                <FormLabel>New name</FormLabel>
                <FormControl>
                  <Input {...field} placeholder="Oxford View name" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="isCopySingleVersion"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Versions to copy</FormLabel>
                <FormControl>
                  <RadioGroup
                    value={field.value}
                    onValueChange={field.onChange}
                    className="flex flex-col gap-2"
                  >
                    <div className="flex items-center space-x-2">
                      <RadioGroupItem
                        value={CopySettings.SINGLE_VERSION}
                        id="single"
                      />
                      <label htmlFor="single" className="text-sm">
                        Current version only (v{viewVersion})
                      </label>
                    </div>
                    <div className="flex items-center space-x-2">
                      <RadioGroupItem
                        value={CopySettings.ALL_VERSIONS}
                        id="all"
                      />
                      <label htmlFor="all" className="text-sm">
                        All versions
                      </label>
                    </div>
                  </RadioGroup>
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          {error && <p className="text-sm text-red-600">{error}</p>}
        </DialogBody>
        <DialogFooter>
          <Button type="submit" loading={mutDuplicate.isPending}>
            Duplicate
          </Button>
        </DialogFooter>
      </form>
    </Form>
  );
};
