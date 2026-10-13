import { listPlaybookRules } from "@/lib/playbook/store";
import { PlaybookView } from "@/components/playbook/PlaybookView";

export const dynamic = "force-dynamic";

export default async function PlaybookPage() {
  const rules = await listPlaybookRules();
  return <PlaybookView initialRules={rules} />;
}
