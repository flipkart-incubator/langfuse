import { z } from "zod";
import { PromptNameSchema, COMMIT_MESSAGE_MAX_LENGTH } from "@langfuse/shared";

export const NewOxfordViewFormSchema = z.object({
  name: PromptNameSchema,
  isActive: z.boolean({ error: "Enter whether the view should go live" }),
  prompt: z
    .array(z.string().min(1, "Entry cannot be empty"))
    .min(1, "Add at least one entry"),
  commitMessage: z
    .string()
    .trim()
    .max(COMMIT_MESSAGE_MAX_LENGTH)
    .transform((val) => (val === "" ? undefined : val))
    .optional(),
});

export type NewOxfordViewFormSchemaType = z.infer<
  typeof NewOxfordViewFormSchema
>;
