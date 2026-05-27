import router from "next/router";
import { useState } from "react";
import { useFieldArray, useForm } from "react-hook-form";
import { z } from "zod";
import { Button } from "@/src/components/ui/button";
import { Checkbox } from "@/src/components/ui/checkbox";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/src/components/ui/form";
import { Input } from "@/src/components/ui/input";
import { Textarea } from "@/src/components/ui/textarea";
import useProjectIdFromURL from "@/src/hooks/useProjectIdFromURL";
import { api } from "@/src/utils/api";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  PRODUCTION_LABEL,
  PromptNameSchema,
  COMMIT_MESSAGE_MAX_LENGTH,
} from "@langfuse/shared";
import Link from "next/link";
import { SquareArrowOutUpRight, Plus, Trash2 } from "lucide-react";
import { usePostHogClientCapture } from "@/src/features/posthog-analytics/usePostHogClientCapture";
import { useQueryParam } from "use-query-params";
import { usePromptNameValidation } from "@/src/features/prompts/hooks/usePromptNameValidation";

// Internal form schema — prompt stored as array of {value} objects for useFieldArray
const FormSchema = z.object({
  name: PromptNameSchema,
  isActive: z.boolean(),
  entries: z
    .array(z.object({ value: z.string().min(1, "Entry cannot be empty") }))
    .min(1, "Add at least one entry"),
  commitMessage: z
    .string()
    .trim()
    .max(COMMIT_MESSAGE_MAX_LENGTH)
    .transform((val) => (val === "" ? undefined : val))
    .optional(),
});
type FormValues = z.infer<typeof FormSchema>;

type OxfordViewLike = {
  id: string;
  name: string;
  version: number;
  prompt: unknown;
  labels: string[];
};

type NewOxfordViewFormProps = {
  initialPrompt?: OxfordViewLike | null;
  onFormSuccess?: () => void;
};

export const NewOxfordViewForm: React.FC<NewOxfordViewFormProps> = (props) => {
  const { onFormSuccess, initialPrompt } = props;
  const projectId = useProjectIdFromURL();
  const [folderPath] = useQueryParam("folder");
  const [formError, setFormError] = useState<string | null>(null);
  const capture = usePostHogClientCapture();
  const utils = api.useUtils();

  // Parse existing prompt as string array
  let initialEntries: string[] = [""];
  try {
    const raw = initialPrompt?.prompt;
    if (Array.isArray(raw) && raw.every((v) => typeof v === "string")) {
      initialEntries = raw as string[];
    }
  } catch (_) {}

  const form = useForm<FormValues>({
    resolver: zodResolver(FormSchema),
    mode: "onTouched",
    defaultValues: {
      name: initialPrompt?.name ?? (folderPath ? `${folderPath}/` : ""),
      isActive: !Boolean(initialPrompt),
      entries: initialEntries.map((v) => ({ value: v })),
      commitMessage: undefined,
    },
  });

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "entries",
  });

  const currentName = form.watch("name");

  const createMutation = api.oxfordViews.create.useMutation({
    onSuccess: () => utils.oxfordViews.invalidate(),
    onError: (error) => setFormError(error.message),
  });

  const allViews = api.oxfordViews.filterOptions.useQuery(
    { projectId: projectId as string },
    {
      enabled: Boolean(projectId),
      refetchOnMount: false,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      staleTime: Infinity,
    },
  ).data?.name;

  usePromptNameValidation({
    currentName,
    allPrompts: allViews,
    form,
  });

  function onSubmit(values: FormValues) {
    if (!projectId) throw Error("Project ID is not defined.");

    capture(
      initialPrompt ? "prompts:update_form_submit" : "prompts:new_form_submit",
      { active: values.isActive },
    );

    createMutation
      .mutateAsync({
        projectId,
        name: values.name,
        type: "text",
        prompt: values.entries.map((e) => e.value),
        config: {},
        labels: values.isActive ? [PRODUCTION_LABEL] : [],
        tags: [],
        commitMessage: values.commitMessage,
      })
      .then((newView) => {
        onFormSuccess?.();
        form.reset();
        if ("name" in newView) {
          void router.push(
            `/project/${projectId}/oxford-views/${encodeURIComponent(newView.name)}`,
          );
        }
      })
      .catch(console.error);
  }

  const nameError = form.getFieldState("name").error?.message;

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        className="flex flex-col gap-6"
      >
        {!initialPrompt ? (
          <FormField
            control={form.control}
            name="name"
            render={({ field }) => (
              <div>
                <FormItem>
                  <FormLabel>Name</FormLabel>
                  <FormDescription>
                    Use slashes &apos;/&apos; to organize into folders.
                  </FormDescription>
                  <FormControl>
                    <Input placeholder="Name your Oxford View" {...field} />
                  </FormControl>
                  {nameError ? (
                    <div className="text-destructive flex flex-row space-x-1 text-sm font-medium">
                      <p className="text-destructive text-sm font-medium">
                        {nameError}
                      </p>
                      {nameError.includes("already exist") ? (
                        <Link
                          href={`/project/${projectId}/oxford-views/${currentName.trim()}`}
                          className="flex flex-row items-center"
                        >
                          Create a new version for it here.
                          <SquareArrowOutUpRight className="ml-1 h-3 w-3" />
                        </Link>
                      ) : null}
                    </div>
                  ) : null}
                </FormItem>
              </div>
            )}
          />
        ) : null}

        <FormItem>
          <FormLabel>Entries</FormLabel>
          <FormDescription>
            Each entry is a string in the Oxford View array.
          </FormDescription>
          <div className="flex flex-col gap-2">
            {fields.map((field, index) => (
              <div key={field.id} className="flex items-center gap-2">
                <FormField
                  control={form.control}
                  name={`entries.${index}.value`}
                  render={({ field: f, fieldState }) => (
                    <FormItem className="flex-1">
                      <FormControl>
                        <Input placeholder={`Entry ${index + 1}`} {...f} />
                      </FormControl>
                      {fieldState.error && (
                        <FormMessage>{fieldState.error.message}</FormMessage>
                      )}
                    </FormItem>
                  )}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => remove(index)}
                  disabled={fields.length === 1}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-1 w-fit"
              onClick={() => append({ value: "" })}
            >
              <Plus className="mr-1 h-4 w-4" />
              Add entry
            </Button>
          </div>
          {form.formState.errors.entries?.root && (
            <p className="text-destructive text-sm font-medium">
              {form.formState.errors.entries.root.message}
            </p>
          )}
        </FormItem>

        <FormField
          control={form.control}
          name="isActive"
          render={({ field }) => (
            <FormItem>
              <div className="flex flex-row items-center space-y-0 space-x-3 rounded-md border p-3">
                <FormControl>
                  <Checkbox
                    checked={field.value}
                    onCheckedChange={field.onChange}
                  />
                </FormControl>
                <div className="space-y-1 leading-none">
                  <FormLabel>Set the &quot;production&quot; label</FormLabel>
                </div>
              </div>
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="commitMessage"
          render={({ field }) => (
            <FormItem className="relative">
              <FormLabel>Commit message</FormLabel>
              <FormDescription>
                Describe the changes made in this version.
              </FormDescription>
              <FormControl>
                <Textarea
                  placeholder="Add commit message..."
                  {...field}
                  className="rounded-md border text-sm focus:ring-0 focus:outline-hidden focus-visible:ring-0 focus-visible:ring-offset-0 active:ring-0"
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <Button
          type="submit"
          loading={createMutation.isPending}
          className="w-full"
          disabled={Boolean(
            !initialPrompt && form.formState.errors.name?.message,
          )}
        >
          {initialPrompt ? "Save new version" : "Create Oxford View"}
        </Button>
      </form>
      {formError && (
        <p className="text-red text-center">
          <span className="font-bold">Error:</span> {formError}
        </p>
      )}
    </Form>
  );
};
