import { CanonicalDetail } from "@/components/ingest/canonical-detail";

export default async function QuestionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <CanonicalDetail id={id} />;
}
