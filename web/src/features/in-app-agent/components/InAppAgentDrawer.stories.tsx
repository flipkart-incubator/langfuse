import preview from "../../../../.storybook/preview";
import { fn } from "storybook/test";
import { InAppAgentDrawer } from "./InAppAgentDrawer";

const meta = preview.meta({
  component: InAppAgentDrawer,
  parameters: {
    layout: "fullscreen",
  },
  decorators: [
    (Story) => (
      <div className="h-screen w-full">
        <Story />
      </div>
    ),
  ],
  args: {
    isRunning: false,
    onClose: fn(),
    onSubmit: fn(),
    showCloseButton: true,
  },
});

export const Empty = meta.story({
  args: {
    messages: [],
  },
});

export const Conversation = meta.story({
  args: {
    messages: [
      {
        id: "user-1",
        role: "user",
        content: [
          {
            type: "text",
            text: "Which traces had the highest latency today?",
          },
        ],
      },
      {
        id: "assistant-1",
        role: "assistant",
        content: [
          {
            type: "text",
            text: "Start by filtering traces by timestamp, then sort by latency. Open the slowest traces to inspect long-running observations.",
          },
        ],
      },
      {
        id: "user-2",
        role: "user",
        content: [
          {
            type: "text",
            text: "Can I compare that with scores?",
          },
        ],
      },
      {
        id: "assistant-2",
        role: "assistant",
        content: [
          {
            type: "text",
            text: "Yes. Add score filters or group the traces by score name to see whether latency correlates with lower quality.",
          },
        ],
      },
    ],
  },
});

export const LoadingResponse = meta.story({
  args: {
    messages: [
      {
        id: "user-1",
        role: "user",
        content: [
          {
            type: "text",
            text: "Summarize recent ingestion errors.",
          },
        ],
      },
      {
        id: "assistant-1",
        role: "assistant",
        content: [
          {
            type: "loading",
          },
        ],
      },
    ],
  },
});
