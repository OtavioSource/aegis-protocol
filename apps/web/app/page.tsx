import Link from 'next/link';
import { Zap, Shield, CreditCard, Bot, ArrowRight, CheckCircle, ExternalLink } from 'lucide-react';

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-gray-950 text-white">
      {/* Nav */}
      <nav className="border-b border-gray-800 px-6 py-4">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Zap className="h-5 w-5 text-violet-400" />
            <span className="font-bold text-lg tracking-tight">Aegis Protocol</span>
          </div>
          <div className="flex items-center gap-4">
            <a
              href="https://github.com/aegis-protocol/aegis-protocol"
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-gray-400 hover:text-white transition-colors flex items-center gap-1.5"
            >
              GitHub <ExternalLink className="h-3 w-3" />
            </a>
            <Link
              href="/dashboard"
              className="bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
            >
              Open Dashboard
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="max-w-6xl mx-auto px-6 py-24 text-center">
        <div className="inline-flex items-center gap-2 bg-violet-950 border border-violet-800 text-violet-300 text-xs font-medium px-3 py-1.5 rounded-full mb-6">
          <span className="h-1.5 w-1.5 rounded-full bg-violet-400 animate-pulse" />
          Built for Solana Frontier Hackathon
        </div>
        <h1 className="text-5xl sm:text-6xl font-bold tracking-tight leading-tight mb-6">
          Economic governance<br />
          <span className="text-violet-400">for AI agents</span>
        </h1>
        <p className="text-xl text-gray-400 max-w-2xl mx-auto mb-8 leading-relaxed">
          Aegis Protocol is the control plane between your AI agents and your treasury.
          Agents request spend. Policies decide. Solana executes. Everything is audited.
        </p>
        <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
          <Link
            href="/dashboard"
            className="flex items-center gap-2 bg-violet-600 hover:bg-violet-700 text-white font-semibold px-6 py-3 rounded-lg transition-colors"
          >
            View Live Demo <ArrowRight className="h-4 w-4" />
          </Link>
          <a
            href="#how-it-works"
            className="text-gray-400 hover:text-white font-medium px-6 py-3 transition-colors"
          >
            How it works
          </a>
        </div>
      </section>

      {/* Core loop */}
      <section id="how-it-works" className="border-t border-gray-800 bg-gray-900/50 py-20">
        <div className="max-w-6xl mx-auto px-6">
          <h2 className="text-3xl font-bold text-center mb-4">The core loop</h2>
          <p className="text-gray-400 text-center mb-12">Every economic action from an AI agent goes through this pipeline</p>
          <div className="flex flex-col md:flex-row items-center justify-center gap-2 md:gap-0">
            {[
              { icon: Bot, label: 'Agent', sub: 'requests spend' },
              { icon: Shield, label: 'Policy Engine', sub: 'evaluates rules' },
              { icon: CheckCircle, label: 'Decision', sub: 'approve / reject / escalate' },
              { icon: CreditCard, label: 'Solana', sub: 'executes transfer' },
              { icon: Zap, label: 'Audit Log', sub: 'immutable record' },
            ].map((step, i, arr) => (
              <div key={step.label} className="flex items-center">
                <div className="flex flex-col items-center text-center px-4 py-5 bg-gray-800 rounded-xl border border-gray-700 w-36">
                  <step.icon className="h-7 w-7 text-violet-400 mb-2" />
                  <p className="font-semibold text-sm">{step.label}</p>
                  <p className="text-xs text-gray-400 mt-0.5">{step.sub}</p>
                </div>
                {i < arr.length - 1 && (
                  <ArrowRight className="h-5 w-5 text-gray-600 mx-2 shrink-0 hidden md:block" />
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Demo scenarios */}
      <section className="py-20 max-w-6xl mx-auto px-6">
        <h2 className="text-3xl font-bold text-center mb-4">Demo scenarios</h2>
        <p className="text-gray-400 text-center mb-12">See Aegis Protocol in action with a Marketing Bot agent</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[
            {
              badge: 'EXECUTED',
              badgeColor: 'bg-green-900 text-green-300',
              title: 'Auto-approved spend',
              desc: 'Agent requests 7 USDC from DataVendorX. Under threshold. Policy approves instantly. SPL transfer executes on Solana devnet.',
            },
            {
              badge: 'REQUIRES APPROVAL',
              badgeColor: 'bg-yellow-900 text-yellow-300',
              title: 'Human approval flow',
              desc: 'Agent requests 30 USDC — above the 10 USDC auto-approve threshold. Request held. Admin reviews in dashboard. Approves. Transfer executes.',
            },
            {
              badge: 'REJECTED',
              badgeColor: 'bg-red-900 text-red-300',
              title: 'Blocked vendor',
              desc: 'Agent tries an unknown vendor not on the allowList. Policy engine rejects instantly. No funds leave the treasury. Audit log updated.',
            },
            {
              badge: 'KILL SWITCH',
              badgeColor: 'bg-red-900 text-red-400 font-bold',
              title: 'Emergency stop',
              desc: 'Admin activates kill switch. All subsequent requests from the agent are rejected immediately, regardless of amount or vendor. Treasury protected.',
            },
          ].map((s) => (
            <div key={s.title} className="bg-gray-900 border border-gray-800 rounded-xl p-6 hover:border-gray-700 transition-colors">
              <span className={`inline-block text-xs font-semibold px-2.5 py-1 rounded-full mb-3 ${s.badgeColor}`}>
                {s.badge}
              </span>
              <h3 className="font-bold text-lg mb-2">{s.title}</h3>
              <p className="text-gray-400 text-sm leading-relaxed">{s.desc}</p>
            </div>
          ))}
        </div>
        <div className="text-center mt-8">
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-2 bg-violet-600 hover:bg-violet-700 text-white font-semibold px-6 py-3 rounded-lg transition-colors"
          >
            Open live dashboard <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </section>

      {/* Policy rules */}
      <section className="border-t border-gray-800 bg-gray-900/50 py-20">
        <div className="max-w-6xl mx-auto px-6">
          <h2 className="text-3xl font-bold text-center mb-4">Policy rules</h2>
          <p className="text-gray-400 text-center mb-12">Composable rules evaluated in priority order. Pure logic, zero I/O.</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 max-w-4xl mx-auto">
            {[
              'Kill switch — blocks all requests instantly',
              'Max transaction amount — per-request ceiling',
              'Daily budget — rolling 24h spend limit',
              'Monthly budget — rolling 30d spend limit',
              'Vendor allow list — approved vendors only',
              'Vendor deny list — explicitly blocked vendors',
              'Approval threshold — escalate above $ amount',
              'Allowed action types — restrict what agents can do',
              'Agent status — disabled agents are always blocked',
            ].map((rule) => (
              <div key={rule} className="flex items-start gap-2.5 bg-gray-800/50 border border-gray-700 rounded-lg p-3.5">
                <CheckCircle className="h-4 w-4 text-violet-400 mt-0.5 shrink-0" />
                <span className="text-sm text-gray-300">{rule}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Tech stack */}
      <section className="py-20 max-w-6xl mx-auto px-6">
        <h2 className="text-3xl font-bold text-center mb-12">Built with</h2>
        <div className="flex flex-wrap justify-center gap-3">
          {[
            'Solana (devnet SPL transfers)',
            '@solana/web3.js',
            '@solana/spl-token',
            'Fastify + TypeScript',
            'Prisma + PostgreSQL',
            'Next.js 16 App Router',
            'Turborepo + pnpm',
            'Zod validation',
            'shadcn/ui + Tailwind',
          ].map((tech) => (
            <span key={tech} className="bg-gray-800 border border-gray-700 text-gray-300 text-sm px-3.5 py-1.5 rounded-full">
              {tech}
            </span>
          ))}
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-gray-800 py-8 px-6 text-center text-sm text-gray-600">
        <div className="flex items-center justify-center gap-2 mb-2">
          <Zap className="h-4 w-4 text-violet-600" />
          <span className="font-semibold text-gray-500">Aegis Protocol</span>
        </div>
        <p>Submitted to the Solana Frontier Hackathon · 2026</p>
      </footer>
    </div>
  );
}
