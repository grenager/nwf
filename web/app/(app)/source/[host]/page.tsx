import { SourceView } from "@/components/source-view";

export default async function SourcePage({
  params,
}: {
  params: Promise<{ host: string }>;
}) {
  const { host } = await params;
  return (
    <div className="mx-auto max-w-2xl py-4">
      <SourceView host={decodeURIComponent(host)} />
    </div>
  );
}
