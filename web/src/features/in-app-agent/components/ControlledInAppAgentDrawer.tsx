"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { HttpAgent } from "@ag-ui/client";
import { z } from "zod";
import { env } from "@/src/env.mjs";
import {
  InAppAgentDrawer,
  type InAppAgentDrawerMessage,
} from "./InAppAgentDrawer";

const AgUiInAppAgentContentPartSchema = z.object({
  type: z.string(),
  text: z.string().optional(),
});

const AgUiInAppAgentContentSchema = z
  .union([
    z.string(),
    z.array(z.unknown()).transform((parts) =>
      parts.flatMap((part) => {
        const result = AgUiInAppAgentContentPartSchema.safeParse(part);

        return result.success ? [result.data] : [];
      }),
    ),
  ])
  .optional()
  .catch(undefined);

const AgUiInAppAgentMessageSchema = z.object({
  id: z.string(),
  role: z.string(),
  content: AgUiInAppAgentContentSchema,
});

type AgUiInAppAgentMessage = z.infer<typeof AgUiInAppAgentMessageSchema>;

type ControlledInAppAgentDrawerProps =
  | {
      showCloseButton: false;
      onClose?: () => void;
    }
  | {
      showCloseButton?: true;
      onClose: () => void;
    };

function parseAgUiInAppAgentMessages(
  messages: readonly unknown[],
): AgUiInAppAgentMessage[] {
  return messages.flatMap((message): AgUiInAppAgentMessage[] => {
    const result = AgUiInAppAgentMessageSchema.safeParse(message);

    return result.success ? [result.data] : [];
  });
}

export function ControlledInAppAgentDrawer(
  props: ControlledInAppAgentDrawerProps,
) {
  const [agent] = useState(() => {
    return new HttpAgent({
      url: `${env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/in-app-agent`,
    });
  });

  const [isRunning, setIsRunning] = useState(agent.isRunning);
  const [messages, setMessages] = useState<AgUiInAppAgentMessage[]>(() =>
    parseAgUiInAppAgentMessages(agent.messages),
  );

  useEffect(() => {
    const subscription = agent.subscribe({
      onMessagesChanged: ({ messages }) => {
        setMessages(parseAgUiInAppAgentMessages(messages));
      },
    });

    return () => {
      subscription.unsubscribe();
      agent.abortRun();
    };
  }, [agent]);

  const submit = useCallback(
    (content: string) => {
      if (!content || agent.isRunning) {
        return;
      }

      const userMessage = {
        id: crypto.randomUUID(),
        role: "user",
        content,
      } satisfies AgUiInAppAgentMessage;

      agent.addMessage(userMessage);
      setIsRunning(true);

      void agent
        .runAgent()
        .catch((error) => {
          console.error("In-app agent drawer error", error);
        })
        .finally(() => {
          setIsRunning(false);
        });
    },
    [agent],
  );

  const drawerMessages = useMemo(
    () =>
      messages.flatMap((message): InAppAgentDrawerMessage[] => {
        if (message.role === "system") {
          return [];
        }

        const role = message.role === "user" ? "user" : "assistant";
        const isLoading = message.role === "reasoning";

        if (isLoading) {
          return [
            {
              id: message.id,
              role,
              content: [{ type: "loading" }],
            },
          ];
        }

        return [
          {
            id: message.id,
            role,
            content: [
              {
                type: "text",
                text:
                  typeof message.content === "string"
                    ? message.content
                    : Array.isArray(message.content)
                      ? message.content
                          .flatMap((part) =>
                            part.type === "text" &&
                            typeof part.text === "string"
                              ? [part.text]
                              : [],
                          )
                          .join("")
                      : "",
              },
            ],
          },
        ];
      }),
    [messages],
  );

  const closeButtonProps =
    props.showCloseButton === false
      ? ({ showCloseButton: false } as const)
      : ({ showCloseButton: true, onClose: props.onClose } as const);

  return (
    <InAppAgentDrawer
      isRunning={isRunning}
      messages={drawerMessages}
      onSubmit={submit}
      {...closeButtonProps}
    />
  );
}
