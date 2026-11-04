import { ReplayWorkspace } from "@/components/replay-workspace";
import { defaultExecutionMode } from "@/lib/demo-mode";
export const dynamic = "force-dynamic";
export default function Home() { return <ReplayWorkspace initialMode={defaultExecutionMode(process.env)} />; }
