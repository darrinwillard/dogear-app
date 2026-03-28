import Link from 'next/link'

export default function OnboardingPage() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-between px-6 py-12 pb-safe" style={{ backgroundColor: '#0a0a0a' }}>
      {/* Top section: logo + name + tagline */}
      <div className="flex-1 flex flex-col items-center justify-center w-full max-w-sm">
        <div
          className="rounded-3xl mb-6"
          style={{ boxShadow: '0 0 40px 8px rgba(251, 191, 36, 0.25)' }}
        >
          <img
            src="/logo.png"
            alt="DogEar"
            width={128}
            height={128}
            className="rounded-3xl"
          />
        </div>

        <h1 className="text-4xl font-bold text-white mb-2 tracking-tight">DogEar</h1>
        <p className="text-slate-400 text-base text-center">Your audiobook life, organized.</p>

        {/* Feature list */}
        <div className="mt-12 w-full space-y-4">
          {[
            'Sync your full Audible library',
            'Track what you\'ve listened to',
            'Rate, review, discover what\'s next',
          ].map((feature) => (
            <div key={feature} className="flex items-center gap-3">
              <span className="w-2 h-2 rounded-full bg-amber-400 flex-shrink-0" />
              <span className="text-slate-300 text-base">{feature}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Bottom CTA */}
      <div className="w-full max-w-sm space-y-4 pt-12">
        <Link
          href="/settings/connect-audible"
          className="block w-full py-4 px-6 bg-amber-400 hover:bg-amber-300 text-slate-900 font-semibold text-center rounded-2xl text-base transition-colors"
        >
          Connect Your Audible Account →
        </Link>
        <p className="text-center text-sm text-slate-500">
          Already have an account?{' '}
          <Link href="/auth/login" className="text-amber-400 hover:text-amber-300">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  )
}
