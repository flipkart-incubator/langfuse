import { type RouterOutputs } from "@/src/utils/api";
import { useState, useRef, useEffect } from "react";
import { Timeline, TimelineItem } from "@/src/components/ui/timeline";
import { Badge } from "@/src/components/ui/badge";
import { CommandItem } from "@/src/components/ui/command";
import { SetOxfordViewVersionLabels } from "@/src/features/oxford-views/components/SetOxfordViewVersionLabels";
import { PromptVersionDiffDialog } from "@/src/features/prompts/components/PromptVersionDiffDialog";

type OxfordViewVersion =
  RouterOutputs["oxfordViews"]["allVersions"]["promptVersions"][number];

const OxfordViewHistoryItem = (props: {
  index: number;
  view: OxfordViewVersion;
  currentView?: OxfordViewVersion;
  currentVersion: number | undefined;
  setCurrentVersion: (version: number | undefined) => void;
}) => {
  const [isHovered, setIsHovered] = useState(false);
  const [isDiffOpen, setIsDiffOpen] = useState(false);
  const [isLabelPopoverOpen, setIsLabelPopoverOpen] = useState(false);
  const { view } = props;

  const currentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (
      props.currentVersion &&
      currentRef.current &&
      props.currentVersion === view.version
    ) {
      currentRef.current.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentRef.current]);

  return (
    <CommandItem
      ref={currentRef}
      value={`# ${view.version};${view.commitMessage ?? ""};${view.labels.join(",")}`}
      style={{
        ["--selected-bg" as string]: "none",
        backgroundColor: "var(--selected-bg)",
        paddingLeft: 0,
        paddingRight: 0,
        paddingTop: 0,
        paddingBottom: 0,
        cursor: "pointer",
      }}
    >
      <TimelineItem
        key={view.id}
        isActive={props.currentVersion === view.version}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        onClick={(e) => {
          const target = e.target as HTMLElement;
          if (
            target.closest('[role="button"]') ||
            target.closest('[data-version-trigger="true"]')
          ) {
            return;
          }
          props.index === 0
            ? props.setCurrentVersion(undefined)
            : props.setCurrentVersion(view.version);
        }}
      >
        <div
          className="items-start gap-1 space-y-1 rounded-none"
          style={{ cursor: "pointer" }}
        >
          <div className="flex flex-wrap items-start gap-1">
            <SetOxfordViewVersionLabels
              title={
                <Badge
                  onClick={(e) => {
                    e.stopPropagation();
                    props.index === 0
                      ? props.setCurrentVersion(undefined)
                      : props.setCurrentVersion(view.version);
                  }}
                  variant="outline"
                  className="bg-background/50 h-6 shrink-0"
                  data-version-trigger="false"
                >
                  # {view.version}
                </Badge>
              }
              promptLabels={view.labels}
              prompt={view}
              isOpen={isLabelPopoverOpen}
              setIsOpen={setIsLabelPopoverOpen}
              showOnlyOnHover
            />
          </div>

          <div className="grid w-full grid-cols-1 items-start justify-between gap-1 md:grid-cols-[1fr_auto]">
            <div className="min-h-7 min-w-0">
              {view.commitMessage && (
                <div className="flex flex-1 flex-nowrap gap-2">
                  <span
                    className="text-muted-foreground max-w-full min-w-0 truncate text-xs"
                    title={view.commitMessage}
                  >
                    {view.commitMessage}
                  </span>
                </div>
              )}
              <div className="text-muted-foreground flex flex-wrap gap-1 text-xs">
                {view.createdAt.toLocaleString()} by{" "}
                {view.creator || view.createdBy}
              </div>
            </div>
            <div className="flex flex-row justify-end space-x-1">
              {(isHovered ||
                props.currentVersion === view.version ||
                isDiffOpen) &&
                (props.currentView && props.currentVersion !== view.version ? (
                  <PromptVersionDiffDialog
                    isOpen={isDiffOpen}
                    setIsOpen={(open) => setIsDiffOpen(open)}
                    leftPrompt={{ ...view, isActive: null }}
                    rightPrompt={{ ...props.currentView, isActive: null }}
                  />
                ) : null)}
            </div>
          </div>
        </div>
      </TimelineItem>
    </CommandItem>
  );
};

export const OxfordViewHistoryNode = (props: {
  views: OxfordViewVersion[];
  currentVersion: number | undefined;
  setCurrentVersion: (id: number | undefined) => void;
}) => {
  const currentView = props.views.find(
    (v) => v.version === props.currentVersion,
  );

  return (
    <Timeline>
      {props.views.map((view, index) => (
        <OxfordViewHistoryItem
          key={view.id}
          index={index}
          view={view}
          currentView={currentView}
          currentVersion={props.currentVersion}
          setCurrentVersion={props.setCurrentVersion}
        />
      ))}
    </Timeline>
  );
};
