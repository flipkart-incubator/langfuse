import {
  createContext,
  useContext,
  useState,
  type PropsWithChildren,
  type Dispatch,
  type SetStateAction,
} from "react";

type InAppAiAgentContextType = {
  open: boolean;
  setOpen: Dispatch<SetStateAction<boolean>>;
};

const InAppAiAgentContext = createContext<InAppAiAgentContextType | null>(null);

export interface InAppAiAgentProviderProps extends PropsWithChildren {
  defaultOpen?: boolean;
}

export function InAppAiAgentProvider({
  children,
  defaultOpen = false,
}: InAppAiAgentProviderProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <InAppAiAgentContext.Provider value={{ open, setOpen }}>
      {children}
    </InAppAiAgentContext.Provider>
  );
}

export function useInAppAiAgent() {
  const ctx = useContext(InAppAiAgentContext);
  if (!ctx) {
    throw new Error("useInAppAiAgent must be used within InAppAiAgentProvider");
  }
  return ctx;
}
