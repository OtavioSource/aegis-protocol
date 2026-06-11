import CommunityPage from '@/app/(app)/community/page';

export default function CommunityPreview({
  searchParams,
}: {
  searchParams: { tab?: string };
}) {
  const tab = (searchParams.tab as 'actions' | 'leaderboard' | 'rewards') ?? 'actions';
  return (
    <div className="min-h-dvh bg-ink-900 px-4 py-8">
      <div className="mx-auto max-w-2xl">
        <CommunityPage defaultTab={tab} />
      </div>
    </div>
  );
}
