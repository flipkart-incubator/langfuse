"use client";

import { useState } from "react";
import { api } from "@/src/utils/api";
import {
  flattenTraceToTranscript,
  type TranscriptMessage,
} from "../utils/flattenTrace";
import { DebugDialog } from "./DebugDialog";
import { JumpToPlaygroundButton } from "@/src/features/playground/page/components/JumpToPlaygroundButton";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/src/components/ui/accordion";
import { Badge } from "@/src/components/ui/badge";
import { Button } from "@/src/components/ui/button";
import { Card, CardContent } from "@/src/components/ui/card";
import { Skeleton } from "@/src/components/ui/skeleton";
import { cn } from "@/src/utils/tailwind";
import { Wrench, User, Bot, Play } from "lucide-react";
import type { RouterOutputs } from "@/src/utils/api";

type TraceObservation = RouterOutputs["observations"]["allForTrace"][number];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function safeStringify(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

// ---------------------------------------------------------------------------
// Individual message renderers
// ---------------------------------------------------------------------------

function UserMessage({ msg }: { msg: TranscriptMessage }) {
  const text = safeStringify(msg.content);
  return (
    <div className="flex gap-3">
      <div className="bg-muted mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full">
        <User className="text-muted-foreground h-4 w-4" />
      </div>
      <Card className="border-muted bg-muted/40 max-w-[80%]">
        <CardContent className="px-4 py-2">
          {msg.name && (
            <p className="text-muted-foreground mb-1 text-xs font-medium">
              {msg.name}
            </p>
          )}
          <pre className="text-sm break-words whitespace-pre-wrap">{text}</pre>
        </CardContent>
      </Card>
    </div>
  );
}

function AgentMessage({
  msg,
  observation,
  onResume,
}: {
  msg: TranscriptMessage;
  /** Full observation, used by JumpToPlaygroundButton to pre-load the Playground. */
  observation: TraceObservation;
  onResume: (obs: TraceObservation) => void;
}) {
  const text = safeStringify(msg.content);
  return (
    <div className="flex flex-row-reverse gap-3">
      <div className="bg-primary/10 mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full">
        <Bot className="text-primary h-4 w-4" />
      </div>
      <Card className="border-primary/20 bg-primary/5 max-w-[80%]">
        <CardContent className="px-4 py-2">
          <div className="mb-1 flex items-center justify-between gap-2">
            <p className="text-muted-foreground text-xs font-medium">
              {msg.name ?? msg.observationType}
            </p>

            <div className="flex items-center gap-1">
              {/* Opens the existing Playground with this generation pre-loaded.
                  The user edits the prompt and runs the real LLM there. */}
              <JumpToPlaygroundButton
                source="generation"
                generation={observation}
                analyticsEventName="trace_detail:test_in_playground_button_click"
                variant="ghost"
                size="sm"
                className="text-muted-foreground hover:text-foreground h-6 gap-1 px-2 text-xs"
              />

              {/* Optional: fires the Python webhook to continue the agent
                  after the user has their new response from the Playground. */}
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground hover:text-foreground h-6 gap-1 px-2 text-xs"
                onClick={() => onResume(observation)}
              >
                <Play className="h-3 w-3" />
                Resume agent
              </Button>
            </div>
          </div>
          <pre className="text-sm break-words whitespace-pre-wrap">{text}</pre>
        </CardContent>
      </Card>
    </div>
  );
}

function ToolMessage({ msg }: { msg: TranscriptMessage }) {
  const inputStr = safeStringify(msg.input);
  const outputStr = safeStringify(msg.output);

  return (
    <div className="flex justify-center">
      <Accordion type="single" collapsible className="w-full max-w-[85%]">
        <AccordionItem
          value={msg.id}
          className="border-border rounded-md border border-dashed"
        >
          <AccordionTrigger className="px-3 py-2 hover:no-underline">
            <span className="flex items-center gap-2 text-sm">
              <Wrench className="text-muted-foreground h-3.5 w-3.5 shrink-0" />
              <span className="font-medium">
                {msg.name ?? msg.observationType}
              </span>
              <Badge variant="outline" className="ml-1 text-xs font-normal">
                {msg.observationType}
              </Badge>
            </span>
          </AccordionTrigger>
          <AccordionContent className="px-3 pb-3">
            {inputStr && (
              <div className="mb-2">
                <p className="text-muted-foreground mb-1 text-xs font-semibold tracking-wide uppercase">
                  Input
                </p>
                <pre className="bg-muted max-h-60 overflow-auto rounded p-2 text-xs">
                  {inputStr}
                </pre>
              </div>
            )}
            {outputStr && (
              <div>
                <p className="text-muted-foreground mb-1 text-xs font-semibold tracking-wide uppercase">
                  Output
                </p>
                <pre className="bg-muted max-h-60 overflow-auto rounded p-2 text-xs">
                  {outputStr}
                </pre>
              </div>
            )}
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Skeleton loader
// ---------------------------------------------------------------------------

function TranscriptSkeleton() {
  return (
    <div className="flex flex-col gap-4 p-4">
      {[...Array(4)].map((_, i) => (
        <div
          key={i}
          className={cn("flex gap-3", i % 2 !== 0 && "flex-row-reverse")}
        >
          <Skeleton className="h-7 w-7 shrink-0 rounded-full" />
          <Skeleton className="h-16 w-64 rounded-lg" />
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export type AgentTranscriptProps = {
  traceId: string;
  projectId: string;
  /** Optional trace-level input to show as the opening User message. */
  traceInput?: unknown;
  className?: string;
};

export function AgentTranscript({
  traceId,
  projectId,
  traceInput,
  className,
}: AgentTranscriptProps) {
  const [resumeTarget, setResumeTarget] = useState<TraceObservation | null>(
    null,
  );

  const { data, isLoading, error } = api.observations.allForTrace.useQuery(
    { traceId, projectId },
    { enabled: Boolean(traceId && projectId) },
  );

  if (isLoading) return <TranscriptSkeleton />;

  if (error) {
    return (
      <div className="text-destructive p-4 text-sm">
        Failed to load transcript: {error.message}
      </div>
    );
  }

  const obsById = new Map((data ?? []).map((obs) => [obs.id, obs]));

  const messages = flattenTraceToTranscript(data ?? [], traceInput);

  if (messages.length === 0) {
    return (
      <div className="text-muted-foreground p-6 text-center text-sm">
        No observations found for this trace.
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col gap-4 p-4", className)}>
      {messages.map((msg) => {
        if (msg.role === "user") return <UserMessage key={msg.id} msg={msg} />;

        if (msg.role === "agent") {
          const obs = obsById.get(msg.id);
          if (!obs) return <UserMessage key={msg.id} msg={msg} />;
          return (
            <AgentMessage
              key={msg.id}
              msg={msg}
              observation={obs}
              onResume={setResumeTarget}
            />
          );
        }

        return <ToolMessage key={msg.id} msg={msg} />;
      })}

      {/* Resume Agent dialog — fired after the user has their new response
          from the Playground and wants to continue the Python agent. */}
      {resumeTarget && (
        <DebugDialog
          open={true}
          onOpenChange={(open) => !open && setResumeTarget(null)}
          traceId={traceId}
          observationId={resumeTarget.id}
          initialPrompt={resumeTarget.input ?? ""}
          initialResponse={resumeTarget.output ?? ""}
        />
      )}
    </div>
  );
}
