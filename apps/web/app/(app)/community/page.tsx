'use client';

import {
  Bug,
  Check,
  Copy,
  Crown,
  FlaskConical,
  Link2,
  Medal,
  Trophy,
  UserPlus,
  Wallet,
  Zap,
} from 'lucide-react';
import { useState } from 'react';

import { cn, PageHeader } from '@/components/ui';

// ------------------------------------------------------------------ data ----

const ACTIONS = [
  {
    id: 'waitlist',
    icon: Zap,
    title: 'Join the waitlist',
    description: 'Be among the first users to access the Aegis Free Tier.',
    points: '+500 points',
    ptsBg: 'bg-amber-500/10 text-amber-400 border-amber-500/25',
    cta: 'Join now',
    progress: 1,
    total: 1,
    done: true,
  },
  {
    id: 'referral',
    icon: UserPlus,
    title: 'Invite builders',
    description: 'Share your referral link with developers, founders and AI agent builders.',
    points: '+1,000 pts / referral',
    ptsBg: 'bg-amber-500/10 text-amber-400 border-amber-500/25',
    cta: 'Copy link',
    progress: 3,
    total: 10,
    done: false,
  },
  {
    id: 'vendors',
    icon: FlaskConical,
    title: 'Test payment vendors',
    description: 'Help us validate up to 100 different HTTP 402-compatible API vendors.',
    points: 'Up to 10,000 pts',
    ptsBg: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/25',
    cta: 'Browse vendors',
    progress: 12,
    total: 100,
    done: false,
  },
  {
    id: 'bugs',
    icon: Bug,
    title: 'Report bugs and feedback',
    description: 'Submit bugs, UX issues, policy edge cases or product suggestions.',
    points: '+250 – 2,000 pts',
    ptsBg: 'bg-sky-500/10 text-sky-400 border-sky-500/25',
    cta: 'Submit feedback',
    progress: 2,
    total: 20,
    done: false,
  },
] as const;

const LEADERBOARD = [
  { rank: 1, handle: 'Early Builder', pts: 12400, badge: 'Top contributor', icon: Crown },
  { rank: 2, handle: 'API Tester', pts: 9800, badge: 'Vendor explorer', icon: FlaskConical },
  { rank: 3, handle: 'Bug Hunter', pts: 7600, badge: 'Feedback champion', icon: Bug },
  { rank: 4, handle: 'agent_dev42', pts: 4200, badge: 'Builder', icon: Zap },
  { rank: 5, handle: 'protocol_labs', pts: 3100, badge: 'Builder', icon: Zap },
] as const;

const MONTHLY_REWARD = '$25 USDC';
const SEMI_REWARDS = [
  { place: '1st', amount: '$150 USDC', color: 'text-amber-400' },
  { place: '2nd', amount: '$110 USDC', color: 'text-slate-300' },
  { place: '3rd', amount: '$50 USDC', color: 'text-amber-600' },
];

const ANTIFR = [
  'Qualified referrals only',
  'Duplicate accounts ignored',
  'Manual review for rewards',
  'Abuse results in disqualification',
];

// ------------------------------------------------------------------ tabs ----

type Tab = 'actions' | 'leaderboard' | 'rewards';

const TABS: { id: Tab; label: string }[] = [
  { id: 'actions', label: 'Actions' },
  { id: 'leaderboard', label: 'Leaderboard' },
  { id: 'rewards', label: 'Rewards' },
];

// ----------------------------------------------------------------- helpers ----

function ProgressBar({ value, max }: { value: number; max: number }) {
  const pct = Math.min(100, Math.round((value / max) * 100));
  return (
    <div className="mt-3">
      <div className="mb-1 flex justify-between text-[11px] text-slate-500">
        <span>{value} / {max}</span>
        <span>{pct}%</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-ink-700">
        <div
          className="h-full rounded-full bg-gradient-to-r from-amber-500 to-amber-400 transition-all duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function PointsBadge({ label, className }: { label: string; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-semibold tabular-nums',
        className,
      )}
    >
      {label}
    </span>
  );
}

// ------------------------------------------------------------------ views ----

function ActionsView() {
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        {ACTIONS.map((a) => {
          const Icon = a.icon;
          return (
            <div
              key={a.id}
              className={cn(
                'relative overflow-hidden rounded-xl border bg-ink-850 p-5 transition-colors',
                a.done
                  ? 'border-amber-500/30 bg-amber-500/5'
                  : 'border-ink-700 hover:border-ink-600',
              )}
            >
              {a.done && (
                <span className="absolute right-3 top-3 flex h-5 w-5 items-center justify-center rounded-full bg-amber-500/20 text-amber-400">
                  <Check size={11} strokeWidth={2.5} />
                </span>
              )}
              <div className="flex items-start gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-ink-600 bg-ink-800 text-slate-400">
                  <Icon size={16} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-semibold text-slate-100">{a.title}</p>
                    <PointsBadge label={a.points} className={a.ptsBg} />
                  </div>
                  <p className="mt-1 text-xs leading-relaxed text-slate-400">{a.description}</p>
                </div>
              </div>
              <ProgressBar value={a.progress} max={a.total} />
              {!a.done && (
                <button className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-ink-700 px-3 py-1.5 text-xs font-medium text-slate-200 transition-colors hover:bg-ink-600">
                  {a.cta}
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* Referral block */}
      <ReferralBlock />
    </div>
  );
}

function ReferralBlock() {
  const [copied, setCopied] = useState(false);
  const link = 'https://useaegisprotocol.com/ref/your-code';

  function handleCopy() {
    navigator.clipboard.writeText(link).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-5">
      <div className="mb-3 flex items-center gap-2">
        <Link2 size={15} className="text-amber-400" />
        <p className="text-sm font-semibold text-slate-100">Your referral link</p>
      </div>
      <p className="mb-3 text-xs text-slate-400">
        Invite builders and move up the leaderboard.
      </p>
      <div className="flex items-center gap-2">
        <code className="flex-1 truncate rounded-lg border border-ink-600 bg-ink-900 px-3 py-2 text-xs text-slate-400">
          {link}
        </code>
        <button
          onClick={handleCopy}
          className={cn(
            'flex shrink-0 items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium transition-all',
            copied
              ? 'border-amber-500/40 bg-amber-500/10 text-amber-400'
              : 'border-ink-600 bg-ink-800 text-slate-300 hover:border-ink-500 hover:text-slate-100',
          )}
        >
          {copied ? <Check size={12} /> : <Copy size={12} />}
          {copied ? 'Copied!' : 'Copy referral link'}
        </button>
      </div>
    </div>
  );
}

function LeaderboardView() {
  const rankColors = ['text-amber-400', 'text-slate-300', 'text-amber-600'];

  return (
    <div className="space-y-4">
      <div className="overflow-hidden rounded-xl border border-ink-700 bg-ink-850">
        <div className="flex items-center justify-between border-b border-ink-700 px-5 py-3">
          <p className="text-sm font-semibold text-slate-100">Community leaderboard</p>
          <span className="rounded-md border border-emerald-500/25 bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-400">
            Live
          </span>
        </div>

        <div className="divide-y divide-ink-700">
          {LEADERBOARD.map((row) => {
            const Icon = row.icon;
            const isTop3 = row.rank <= 3;
            return (
              <div
                key={row.rank}
                className={cn(
                  'flex items-center gap-4 px-5 py-3.5 transition-colors hover:bg-ink-800/60',
                  row.rank === 1 && 'bg-amber-500/5',
                )}
              >
                <span
                  className={cn(
                    'w-6 shrink-0 text-center text-sm font-bold tabular-nums',
                    isTop3 ? rankColors[row.rank - 1] : 'text-slate-600',
                  )}
                >
                  {row.rank === 1 ? '👑' : `#${row.rank}`}
                </span>

                <span className={cn(
                  'flex h-8 w-8 shrink-0 items-center justify-center rounded-full border',
                  isTop3 ? 'border-amber-500/30 bg-amber-500/10 text-amber-400' : 'border-ink-600 bg-ink-800 text-slate-500',
                )}>
                  <Icon size={14} />
                </span>

                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-slate-100">{row.handle}</p>
                  <p className="text-xs text-slate-500">{row.badge}</p>
                </div>

                <span className={cn(
                  'shrink-0 text-sm font-semibold tabular-nums',
                  isTop3 ? rankColors[row.rank - 1] : 'text-slate-400',
                )}>
                  {row.pts.toLocaleString()} pts
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Anti-fraud */}
      <div className="rounded-xl border border-ink-700 bg-ink-850 p-5">
        <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-500">
          Anti-fraud system
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          {ANTIFR.map((rule) => (
            <div key={rule} className="flex items-center gap-2 text-xs text-slate-400">
              <Check size={11} className="shrink-0 text-emerald-400" strokeWidth={2.5} />
              {rule}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function RewardsView() {
  return (
    <div className="space-y-4">
      {/* Monthly */}
      <div className="rounded-xl border border-amber-500/20 bg-ink-850 p-5">
        <div className="mb-1 flex items-center gap-2">
          <Medal size={15} className="text-amber-400" />
          <p className="text-sm font-semibold text-slate-100">Monthly reward</p>
        </div>
        <p className="text-xs text-slate-400">Every month, the top contributor wins</p>
        <p className="mt-2 text-2xl font-bold text-amber-400">{MONTHLY_REWARD}</p>
      </div>

      {/* Semiannual */}
      <div className="rounded-xl border border-ink-700 bg-ink-850 p-5">
        <div className="mb-4 flex items-center gap-2">
          <Trophy size={15} className="text-amber-400" />
          <p className="text-sm font-semibold text-slate-100">Semiannual rewards</p>
        </div>
        <div className="space-y-3">
          {SEMI_REWARDS.map((r, i) => (
            <div
              key={r.place}
              className={cn(
                'flex items-center justify-between rounded-lg border px-4 py-3',
                i === 0
                  ? 'border-amber-500/30 bg-amber-500/5'
                  : 'border-ink-700 bg-ink-800',
              )}
            >
              <div className="flex items-center gap-3">
                <span className={cn('text-sm font-bold', r.color)}>{r.place}</span>
                <span className="text-xs text-slate-400">place</span>
              </div>
              <span className={cn('text-base font-semibold tabular-nums', r.color)}>
                {r.amount}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Payout method */}
      <div className="rounded-xl border border-ink-700 bg-ink-850 p-5">
        <div className="mb-3 flex items-center gap-2">
          <Wallet size={15} className="text-slate-400" />
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            Payout method
          </p>
        </div>
        <p className="text-sm text-slate-300">
          All rewards are paid in{' '}
          <span className="font-medium text-slate-100">USDC on Stellar</span>. Winners are
          contacted via the email registered at sign-up.
        </p>
      </div>

      {/* Anti-fraud */}
      <div className="rounded-xl border border-ink-700 bg-ink-850 p-5">
        <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-500">
          Anti-fraud system
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          {ANTIFR.map((rule) => (
            <div key={rule} className="flex items-center gap-2 text-xs text-slate-400">
              <Check size={11} className="shrink-0 text-emerald-400" strokeWidth={2.5} />
              {rule}
            </div>
          ))}
        </div>
      </div>

      {/* Disclaimer */}
      <p className="text-center text-[11px] leading-relaxed text-slate-600">
        Rewards are subject to eligibility, verification, anti-fraud checks and local legal
        requirements. Not a lottery, sweepstake or game of chance — rewards are based solely
        on verified contribution.
      </p>
    </div>
  );
}

// ------------------------------------------------------------------- page ----

export default function CommunityPage({ defaultTab }: { defaultTab?: Tab }) {
  const [tab, setTab] = useState<Tab>(defaultTab ?? 'actions');

  return (
    <>
      <PageHeader
        title="Community"
        description="Earn points, climb the leaderboard and win real rewards."
      />

      {/* Points summary */}
      <div className="mb-6 flex items-center gap-3 rounded-xl border border-amber-500/20 bg-amber-500/5 px-5 py-4">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-amber-500/30 bg-amber-500/10">
          <Trophy size={18} className="text-amber-400" />
        </div>
        <div>
          <p className="text-xs text-slate-500">Your total points</p>
          <p className="text-xl font-bold tabular-nums text-amber-400">500 pts</p>
        </div>
        <div className="ml-auto text-right">
          <p className="text-xs text-slate-500">Current rank</p>
          <p className="text-sm font-semibold text-slate-300">#42</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="mb-5 flex gap-1 rounded-lg border border-ink-700 bg-ink-850 p-1">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              'flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
              tab === t.id
                ? 'bg-ink-700 text-slate-100 shadow-sm'
                : 'text-slate-500 hover:text-slate-300',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'actions' && <ActionsView />}
      {tab === 'leaderboard' && <LeaderboardView />}
      {tab === 'rewards' && <RewardsView />}
    </>
  );
}
