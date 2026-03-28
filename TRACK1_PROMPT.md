Integrate the DogEar Kobe logo and build the beautiful splash/onboarding screen.

LOGO: /public/logo.png (already placed)

TASK 1 - Update src/app/auth/login/page.tsx:
Replace the 🐾 emoji with an <img src="/logo.png" /> (80x80px, rounded-2xl)
Same for signup page.

TASK 2 - Create src/app/onboarding/page.tsx:
Beautiful first-run screen for new users with empty libraries.

Design:
- Full dark screen (#0a0a0a)
- Top: Kobe logo (128x128, centered, rounded-3xl, subtle amber glow shadow)
- Below logo: "DogEar" in bold white 36px
- Tagline: "Your audiobook life, organized." in slate-400 16px
- Spacer
- Feature list (3 items, each with amber dot):
  • Sync your full Audible library
  • Track what you've listened to  
  • Rate, review, discover what's next
- Spacer
- Big amber CTA button: "Connect Your Audible Account →" → links to /settings/connect-audible
- Small text below: "Already have an account? Sign in" → /auth/login
- Bottom padding for safe area

TASK 3 - Update src/app/library/page.tsx:
When user is logged in but has 0 books (empty user_books), redirect to /onboarding instead of showing empty state inline.

TASK 4 - Update src/components/BottomNav.tsx:
Replace the 📚 emoji with a small Kobe logo SVG or img tag (24x24).

Run npm run build — must pass 0 errors.
When done: openclaw system event --text "Done: DogEar Kobe logo integrated + splash onboarding screen" --mode now
