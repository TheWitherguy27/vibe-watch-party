# VIBE — Watch Together

A polished Next.js + Supabase starter for synchronized YouTube watch parties.

## Included in this build
- Responsive dark/light/AMOLED landing and party UI
- Six-digit party creation and joining through Supabase RPC functions
- Shareable room URLs and copy-invite action
- YouTube IFrame Player API integration
- Host playback sync (play/pause/seek state broadcast and guest drift correction)
- Realtime room roster, chat, and video queue updates
- Guest display names without a registration flow
- Queue add/play actions and basic host role

## Setup
1. Create a Supabase project.
2. In **Authentication → Providers**, enable **Anonymous Sign-Ins**.
3. In **SQL Editor**, run `supabase/schema.sql`.
4. In Supabase **Project Settings → API**, copy the Project URL and anon/public key.
5. Copy `.env.example` to `.env.local` and fill in those two public values.
6. Install and run:

   ```bash
   npm install
   npm run dev
   ```

7. Open `http://localhost:3000`.

## Publish
Supabase is the backend, not a Next.js frontend host. Deploy this app to Vercel (or another Next.js host), add the same two `NEXT_PUBLIC_...` environment variables in the hosting dashboard, and deploy. Keep the Supabase service-role key off the client and out of source control.

## Important production hardening
This starter is an MVP foundation, not a security-audited production social platform. Guest access uses Supabase Anonymous Auth; enable it in the dashboard. The included RLS policies scope room access to the authenticated anonymous user. Add server-side validation/rate limits, abuse controls, party expiry/cleanup, moderation RPCs, and robust host-election logic.

The YouTube IFrame Player API only supports embedded videos that the uploader permits to be embedded. Some videos, ads, age/region restrictions, and browser autoplay policies can prevent playback. The client can synchronize common playback actions, but it cannot guarantee frame-perfect synchronization.

## Scope notes
The UI and backend in this starter implement the core watch-room loop. Advanced requested items such as voice chat, GIF provider integration, QR rendering, persistent user profiles, password-protected rooms, polls, soundboards, achievements, and host approval workflows are not implemented yet; add them as separate, permission-checked features rather than presenting them as live.
