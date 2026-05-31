"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/src/components/ui/dialog";
import { Button } from "@/src/components/ui/button";
import { Label } from "@/src/components/ui/label";
import { Textarea } from "@/src/components/ui/textarea";
import { Badge } from "@/src/components/ui/badge";
import { Loader2 } from "lucide-react";
import { useToast } from "@/src/components/ui/use-toast";

export type DebugDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  traceId: string;
  observationId: string;
  initialPrompt: string;
  initialResponse: string;
};

export function DebugDialog({
  open,
  onOpenChange,
  traceId,
  observationId,
  initialPrompt,
  initialResponse,
}: DebugDialogProps) {
  const { toast } = useToast();
  const [modifiedPrompt, setModifiedPrompt] = useState(initialPrompt);
  const [mockedResponse, setMockedResponse] = useState(initialResponse);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleResume() {
    setIsSubmitting(true);
    try {
      const res = await fetch("/api/custom/agent-resume", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          traceId,
          observationId,
          modifiedPrompt,
          mockedResponse,
        }),
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }

      toast({
        title: "Agent workflow resumed",
        description: "The resume webhook was dispatched successfully.",
      });
      onOpenChange(false);
    } catch (err) {
      toast({
        title: "Resume failed",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Debug from here
            <Badge variant="secondary" className="font-mono text-xs">
              {observationId.slice(0, 8)}
            </Badge>
          </DialogTitle>
          <DialogDescription>
            Edit the prompt and mock the LLM response, then click &ldquo;Resume
            Agent&rdquo; to re-run the workflow from this step.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="debug-prompt">Modified prompt</Label>
            <Textarea
              id="debug-prompt"
              className="min-h-[120px] font-mono text-sm"
              value={modifiedPrompt}
              onChange={(e) => setModifiedPrompt(e.target.value)}
            />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="debug-response">Mocked LLM response</Label>
            <Textarea
              id="debug-response"
              className="min-h-[120px] font-mono text-sm"
              value={mockedResponse}
              onChange={(e) => setMockedResponse(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isSubmitting}
          >
            Cancel
          </Button>
          <Button onClick={handleResume} disabled={isSubmitting}>
            {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Resume Agent
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
