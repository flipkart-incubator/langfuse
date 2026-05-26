import capitalize from "lodash/capitalize";
import router from "next/router";
import { useState, useEffect, useRef } from "react";
import { useForm } from "react-hook-form";
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
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/src/components/ui/tabs";
import { Textarea } from "@/src/components/ui/textarea";
import useProjectIdFromURL from "@/src/hooks/useProjectIdFromURL";
import { api } from "@/src/utils/api";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  type CreatePromptTRPCType,
  PRODUCTION_LABEL,
  PromptType,
  extractVariables,
  getIsCharOrUnderscore,
} from "@langfuse/shared";

type OxfordViewLike = {
  id: string;
  type: string;
  name: string;
  version: number;
  prompt: unknown;
  config: unknown;
  labels: string[];
};
import { PromptChatMessages } from "@/src/features/prompts/components/NewPromptForm/PromptChatMessages";
import { ReviewPromptDialog } from "@/src/features/prompts/components/NewPromptForm/ReviewPromptDialog";
import {
  NewOxfordViewFormSchema,
  type NewOxfordViewFormSchemaType,
  OxfordViewVariantSchema,
  type OxfordViewVariant,
} from "./validation";
import { Input } from "@/src/components/ui/input";
import Link from "next/link";
import { SquareArrowOutUpRight } from "lucide-react";
import { PromptVariableListPreview } from "@/src/features/prompts/components/PromptVariableListPreview";
import { CodeMirrorEditor } from "@/src/components/editor/CodeMirrorEditor";
import { usePostHogClientCapture } from "@/src/features/posthog-analytics/usePostHogClientCapture";
import { useQueryParam } from "use-query-params";
import { useFormPersistence } from "@/src/hooks/useFormPersistence";
import { usePromptNameValidation } from "@/src/features/prompts/hooks/usePromptNameValidation";

type NewOxfordViewFormProps = {
  initialPrompt?: OxfordViewLike | null;
  onFormSuccess?: () => void;
};

export const NewOxfordViewForm: React.FC<NewOxfordViewFormProps> = (props) => {
  const { onFormSuccess, initialPrompt } = props;
  const projectId = useProjectIdFromURL();
  const [folderPath] = useQueryParam("folder");
  const [formError, setFormError] = useState<string | null>(null);
  const [initialMessages, setInitialMessages] = useState<unknown>([]);

  const utils = api.useUtils();
  const capture = usePostHogClientCapture();

  let initialVariant: OxfordViewVariant | null;
  try {
    initialVariant = OxfordViewVariantSchema.parse({
      type: initialPrompt?.type,
      prompt: initialPrompt?.prompt?.valueOf(),
    });
  } catch (_err) {
    initialVariant = null;
  }

  const defaultValues = {
    type: initialVariant?.type ?? PromptType.Text,
    chatPrompt:
      initialVariant?.type === PromptType.Chat ? initialVariant?.prompt : [],
    textPrompt:
      initialVariant?.type === PromptType.Text ? initialVariant?.prompt : "",
    name: initialPrompt?.name ?? (folderPath ? `${folderPath}/` : ""),
    config: JSON.stringify(initialPrompt?.config?.valueOf(), null, 2) || "{}",
    isActive: !Boolean(initialPrompt),
    commitMessage: undefined,
  };

  const form = useForm({
    resolver: zodResolver(NewOxfordViewFormSchema),
    mode: "onTouched",
    defaultValues,
  });

  const currentName = form.watch("name");
  const currentType = form.watch("type");
  const currentExtractedVariables = extractVariables(
    currentType === PromptType.Text
      ? form.watch("textPrompt")
      : JSON.stringify(form.watch("chatPrompt"), null, 2),
  ).filter(getIsCharOrUnderscore);

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

  function onSubmit(values: NewOxfordViewFormSchemaType) {
    capture(
      initialPrompt ? "prompts:update_form_submit" : "prompts:new_form_submit",
      { type: values.type, active: values.isActive },
    );

    if (!projectId) throw Error("Project ID is not defined.");

    const { type, textPrompt, chatPrompt } = values;

    let newView: CreatePromptTRPCType;
    if (type === PromptType.Chat) {
      newView = {
        ...values,
        projectId,
        type,
        prompt: chatPrompt,
        config: JSON.parse(values.config),
        labels: values.isActive ? [PRODUCTION_LABEL] : [],
      };
    } else {
      newView = {
        ...values,
        projectId,
        type,
        prompt: textPrompt,
        config: JSON.parse(values.config),
        labels: values.isActive ? [PRODUCTION_LABEL] : [],
      };
    }

    createMutation
      .mutateAsync(newView)
      .then((newView) => {
        clearDraft();
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

  const hasInitializedMessages = useRef(false);
  useEffect(() => {
    if (hasInitializedMessages.current) return;
    hasInitializedMessages.current = true;

    if (initialPrompt?.type === PromptType.Chat) {
      setInitialMessages(initialPrompt.prompt);
    }
  }, [initialPrompt, form]);

  usePromptNameValidation({
    currentName,
    allPrompts: allViews,
    form,
  });

  const formId = initialPrompt
    ? `oxford-view-edit:${initialPrompt.id}`
    : "oxford-view-new";

  const { hadDraft, clearDraft } = useFormPersistence({
    formId,
    projectId: projectId ?? "",
    form,
    enabled: Boolean(projectId),
    onDraftRestored: (draft) => {
      if (
        draft.chatPrompt &&
        Array.isArray(draft.chatPrompt) &&
        draft.chatPrompt.length > 0
      ) {
        setInitialMessages(draft.chatPrompt);
      }
      if (folderPath && !initialPrompt) {
        form.setValue("name", `${folderPath}/`);
      }
    },
  });

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
            render={({ field }) => {
              const errorMessage = form.getFieldState("name").error?.message;
              return (
                <div>
                  <FormItem>
                    <FormLabel>Name</FormLabel>
                    <FormDescription>
                      Use slashes &apos;/&apos; to organize into folders.
                    </FormDescription>
                    <FormControl>
                      <Input placeholder="Name your Oxford View" {...field} />
                    </FormControl>
                    {form.getFieldState("name").error ? (
                      <div className="text-destructive flex flex-row space-x-1 text-sm font-medium">
                        <p className="text-destructive text-sm font-medium">
                          {errorMessage}
                        </p>
                        {errorMessage?.includes("already exist") ? (
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
              );
            }}
          />
        ) : null}

        <>
          <FormItem>
            <FormLabel>Content</FormLabel>
            <FormDescription>
              Define your Oxford View content. You can use{" "}
              <code className="text-xs">{"{{variable}}"}</code> to insert
              variables.
            </FormDescription>
            <Tabs
              value={form.watch("type")}
              onValueChange={(e) => form.setValue("type", e as PromptType)}
            >
              {!initialPrompt ? (
                <TabsList className="flex w-full">
                  <TabsTrigger
                    disabled={
                      Boolean(initialVariant) &&
                      initialVariant?.type !== PromptType.Text
                    }
                    className="flex-1"
                    value={PromptType.Text}
                  >
                    {capitalize(PromptType.Text)}
                  </TabsTrigger>
                  <TabsTrigger
                    disabled={
                      Boolean(initialVariant) &&
                      initialVariant?.type !== PromptType.Chat
                    }
                    className="flex-1"
                    value={PromptType.Chat}
                  >
                    {capitalize(PromptType.Chat)}
                  </TabsTrigger>
                </TabsList>
              ) : null}
              {hadDraft && (
                <p
                  className={`text-muted-foreground mb-1 text-right text-xs ${initialPrompt ? "-mt-2" : "mt-1"}`}
                >
                  Draft restored.{" "}
                  <button
                    type="button"
                    className="hover:text-foreground underline"
                    onClick={() => {
                      clearDraft();
                      form.reset(defaultValues);
                      setInitialMessages(
                        initialPrompt?.type === PromptType.Chat
                          ? initialPrompt.prompt
                          : [],
                      );
                    }}
                  >
                    Discard
                  </button>
                </p>
              )}
              <TabsContent value={PromptType.Text}>
                <FormField
                  control={form.control}
                  name="textPrompt"
                  render={({ field }) => (
                    <>
                      <FormControl>
                        <CodeMirrorEditor
                          value={field.value}
                          onChange={field.onChange}
                          onBlur={field.onBlur}
                          editable
                          mode="text"
                          minHeight={200}
                        />
                      </FormControl>
                      <FormMessage />
                    </>
                  )}
                />
              </TabsContent>
              <TabsContent value={PromptType.Chat}>
                <FormField
                  control={form.control}
                  name="chatPrompt"
                  render={({ field }) => (
                    <>
                      <PromptChatMessages
                        {...field}
                        initialMessages={initialMessages}
                        projectId={projectId}
                      />
                      <FormMessage />
                    </>
                  )}
                />
              </TabsContent>
            </Tabs>
          </FormItem>
          <PromptVariableListPreview variables={currentExtractedVariables} />
        </>

        <FormField
          control={form.control}
          name="config"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Config</FormLabel>
              <FormDescription>
                Arbitrary JSON configuration attached to the view.
              </FormDescription>
              <CodeMirrorEditor
                value={field.value}
                onChange={field.onChange}
                onBlur={field.onBlur}
                editable
                mode="json"
              />
              <FormMessage />
            </FormItem>
          )}
        />

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

        {initialPrompt ? (
          <div className="flex flex-col gap-2">
            <ReviewPromptDialog
              initialPrompt={{ ...initialPrompt, isActive: null }}
              getNewPromptValues={form.getValues}
              isLoading={createMutation.isPending}
              onConfirm={form.handleSubmit(onSubmit)}
            >
              <Button
                disabled={!form.formState.isValid}
                variant="secondary"
                className="w-full"
              >
                Review changes
              </Button>
            </ReviewPromptDialog>
            <Button
              type="submit"
              loading={createMutation.isPending}
              className="w-full"
              disabled={!form.formState.isValid}
            >
              Save new version
            </Button>
          </div>
        ) : (
          <Button
            type="submit"
            loading={createMutation.isPending}
            className="w-full"
            disabled={Boolean(
              !initialPrompt && form.formState.errors.name?.message,
            )}
          >
            Create Oxford View
          </Button>
        )}
      </form>
      {formError && (
        <p className="text-red text-center">
          <span className="font-bold">Error:</span> {formError}
        </p>
      )}
    </Form>
  );
};
