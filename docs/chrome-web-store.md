# Chrome Web Store submission

Everything needed to publish **YouTube AI Reader**.

## What's ready

| Item | Where |
|---|---|
| Store package | `cd extension && npm run package` → `extension/store/youtube-ai-reader-<version>.zip` (dev-only `localhost` hosts stripped) |
| Privacy policy | https://youtube-ai-reader-mt4h.vercel.app/privacy |
| Terms | https://youtube-ai-reader-mt4h.vercel.app/terms |
| Homepage | https://youtube-ai-reader-mt4h.vercel.app |
| Support email | yashbijlani2004@gmail.com |
| Icons | `extension/public/icons/` (16/32/48/128) |
| Screenshots (1280×800) | `docs/store-assets/*.png` (regenerate: `node scripts/transcript-rnd/gen-store-screenshots.mjs`) |

The package build bakes in the production API (`https://youtube-ai-reader.onrender.com`)
and Supabase URL/key from `extension/.env` (git-ignored).

## Listing copy

**Name:** YouTube AI Reader

**Summary (≤132 chars):**
> Read any YouTube video with AI: summaries, key ideas, chapters and timestamped answers — without watching it all.

**Category:** Productivity. **Language:** English.

**Detailed description:**

> Turn any YouTube video into something you can actually read, search and ask about.
>
> YouTube AI Reader opens a side panel on any watch page. It reads the video's own transcript (captions) using your session, then builds:
> - a plain-language **overview** and **key ideas**
> - **chapters** with timestamps you can click to jump around
> - a full **reading view** of the transcript
> - **Ask** — grounded questions answered with timestamps and citations
>
> It works on podcasts, lectures, talks, interviews and tutorials. Create a free account to save your usage and, if you want more, upgrade for longer videos and higher limits.
>
> **Privacy:** your sign-in, transcript and questions are only used to provide the product. We don't sell your data or use it for advertising. See the privacy policy.

## Permission justifications (for the review form)

- **storage** — keep the sign-in session, settings and cached conversations on your device.
- **sidePanel** — show the reading/ask UI in Chrome's side panel.
- **scripting** — run a narrow MAIN-world interceptor that reads the caption (timedtext) response the page's own player already fetched. Used only to obtain the transcript from your session.
- **identity** — Google sign-in via Chrome's web-auth flow (`launchWebAuthFlow`).
- **Host `www.youtube.com` / `m.youtube.com`** — read the video id, player state and the captions on watch pages only.
- **Host `*.supabase.co`** — authentication and account/usage API.
- **Host `youtube-ai-reader.onrender.com`** — our backend (transcript processing, AI, usage).
- **Host `api.razorpay.com` / `checkout.razorpay.com`** — payment checkout for Pro.

**Remote code:** none. All JavaScript is bundled in the extension; the extension never loads or executes remote code. Network calls only send the transcript/questions to our backend.

## Privacy practices (dashboard answers)

- **Single purpose:** read a YouTube video's transcript and turn it into an AI reading experience.
- **Data collected:** personally identifiable information (email), authentication information, user activity (videos processed, questions asked), website content (transcript of videos you choose to process).
- **Use:** provide the product (summaries, chapters, answers), enforce plan limits, operate billing.
- **Not sold; not used for advertising; no unrelated use.** Certify limited use.

## Submission steps (order matters)

1. Register the developer account (one-time US$5), verify email, enable 2-step verification.
2. Build the package: `cd extension && npm run package`.
3. Create the listing and upload the zip. Upload as **Unlisted / draft** first so it gets a permanent extension ID.
4. Note the **published extension ID**, then add the OAuth redirect in **Supabase → Authentication → URL Configuration → Redirect URLs**:
   `https://<published-id>.chromiumapp.org/supabase`
5. Publish the **Google OAuth consent screen** to **Production** (in the Google Cloud project behind Supabase's Google provider). While it's in "Testing", only test users can sign in.
6. (Recommended) Tighten the backend CORS to the published id: set `CORS_ALLOW_ORIGIN_REGEX=^chrome-extension://<published-id>/$` on Render.
7. Fill in the listing: description, category, screenshots (`docs/store-assets/`), icon (128), privacy policy URL, homepage URL.
8. Complete the Privacy practices tab and the permission justifications above.
9. Submit for review.

> Tip: after you have the published ID, you can pin it in dev by adding the
> `"key"` field to `manifest.json`, so the unpacked ID matches the store ID and
> the OAuth redirect is identical in both.

## Policy risk

Chrome review (and YouTube) may scrutinise reading a video's caption responses.
Mitigations already in place: single narrow purpose, no video/audio download, no
ad or tracking bypass, the interceptor is scoped to caption responses only, and
the transcript is only ever the user's own session data. Be ready to answer a
reviewer question and to point at the privacy policy. If asked, emphasising
"reads the transcript the user's own player already fetched, for accessibility
and productivity" is the accurate framing.

## Screenshot specs

- 1–5 images, exactly **1280×800** (or 640×400).
- Generated from the live landing site; replace with real side-panel captures later if you want.
