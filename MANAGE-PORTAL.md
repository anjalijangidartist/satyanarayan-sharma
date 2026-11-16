# Private photo upload portal

The public website is unchanged. A private portal at `/manage` lets an authorized person upload photos. The server commits the photos and an updated `works.json` to the GitHub repository in one commit. The existing GitHub-to-Vercel integration then deploys the website.

## Files added

- `api/portal/login.js`, `logout.js`, `session.js`, `upload.js`, `commit.js` — Vercel serverless endpoints.
- `lib/` — shared server-only authentication, rate limiting, GitHub, image validation, manifest and HTTP code.
- `manage.html`, `manage.js`, `manage.css` — portal interface.
- `tools/hash-password.js` — creates the password hash.
- `tests/portal.test.js` — automated tests with a mocked GitHub API.
- `.env.example` — environment variable template.

`server.js` also serves `/manage` and the portal API for local development.

## How it works

1. The browser sends the password to `/api/portal/login`.
2. The server checks the password against a scrypt hash from an environment variable.
3. On success the server sets an `HttpOnly`, `SameSite=Strict`, `Secure` session cookie. The cookie is signed with `SESSION_SECRET` and expires after 12 hours.
4. Every upload and commit request verifies the signed cookie and the request origin on the server.
5. Each selected photo is sent to `/api/portal/upload` as raw bytes. The server checks the size, file signature (JPEG, PNG or WebP), image dimensions, filename and existing GitHub files.
6. The photo becomes a GitHub blob. It is not committed yet.
7. After all uploads, the browser sends the successful blob IDs to `/api/portal/commit`.
8. The server checks the current branch, refuses to overwrite any existing path, updates `works.json`, creates one tree and one commit, and updates the branch without force-pushing.
9. Vercel deploys the new commit. The build runs `node build-works.js`, which rebuilds `works.json` from the files in `assets/work/` before publishing. Deleted or missing photos cannot leave stale entries. The portal tells the user that the site will update in a few minutes.

Existing photos are never modified or deleted. Files that already exist are automatically given a new suffix such as `-2`. If the branch changes during a commit, the server retries against the new branch head safely.

The GitHub token or GitHub App private key never reaches the browser. It is used only inside serverless functions.

## Required Vercel environment variables

Add these under **Vercel → Project → Settings → Environment Variables**, for Production and Preview as needed.

| Variable | Required | Purpose |
| --- | --- | --- |
| `SESSION_SECRET` | Yes | Signs session cookies. At least 32 random characters. |
| `PORTAL_PASSWORD_HASH` | Yes | Output of `npm run hash-password`. |
| `GITHUB_REPO` | Yes | `owner/repository`, for example `anjalijangidartist/satyanarayan-sharma`. |
| `GITHUB_BRANCH` | Yes | Usually `main`. |
| `GITHUB_APP_ID` | App auth | GitHub App ID. |
| `GITHUB_INSTALLATION_ID` | App auth | Installation ID for this repository. |
| `GITHUB_APP_PRIVATE_KEY` | App auth | Full private key PEM for the GitHub App. |
| `GITHUB_TOKEN` | Token auth | Alternative to the GitHub App. Fine-grained token with **Contents: Read and write** on this repository only. |
| `GIT_AUTHOR_NAME` | No | Commit author name. Defaults to `Artwork Portal`. |
| `GIT_AUTHOR_EMAIL` | No | Commit author email. Defaults to `portal@users.noreply.github.com`. |
| `UPSTASH_REDIS_REST_URL` | No | Durable rate limiting across serverless instances. |
| `UPSTASH_REDIS_REST_TOKEN` | No | Token for the Upstash Redis REST API. |

Use either the GitHub App variables or `GITHUB_TOKEN`. The GitHub App is preferred because its access is limited to the selected repository.

Generate `SESSION_SECRET` with:

```bash
openssl rand -base64 48
```

Generate `PORTAL_PASSWORD_HASH` with:

```bash
npm run hash-password
```

The command asks for the password twice and prints one line. Paste the whole value after `PORTAL_PASSWORD_HASH=` into Vercel. Do not put the password itself in Vercel.

## Configure GitHub authentication with a GitHub App

1. Open GitHub **Settings → Developer settings → GitHub Apps → New GitHub App**.
2. Set a name, for example `Satyanarayan Artwork Portal`.
3. Set the homepage to the website URL.
4. Disable the webhook. It is not used.
5. Under **Repository permissions**, set **Contents** to **Read and write**. Leave **Metadata** at **Read-only**.
6. Create the app.
7. Copy the **App ID** from the app settings into `GITHUB_APP_ID`.
8. In the app settings, generate a private key and download the `.pem` file.
9. Paste the complete PEM contents into `GITHUB_APP_PRIVATE_KEY`. Keep the `-----BEGIN ...` and `-----END ...` lines.
10. Open **Install App**, install it on only this repository.
11. Find the installation ID in the installation URL, which looks like `https://github.com/settings/installations/12345678`. Put `12345678` into `GITHUB_INSTALLATION_ID`.
12. Add `GITHUB_REPO` and `GITHUB_BRANCH`.
13. Redeploy the Vercel project so the new variables are available.

Alternative token setup: create a fine-grained personal access token limited to this repository with **Contents: Read and write**, set it as `GITHUB_TOKEN`, and leave the GitHub App variables unset.

## Configure the authorized account

This portal has one shared password, not individual user accounts. To authorize your sister, give her the password. To revoke access, generate a new password hash, update `PORTAL_PASSWORD_HASH` in Vercel and redeploy. Rotating `SESSION_SECRET` also signs out every active session.

To change the password:

```bash
npm run hash-password
```

Then replace `PORTAL_PASSWORD_HASH` in Vercel and redeploy.

## Deploy

1. Commit the new files and push to the branch connected to Vercel.
2. Add the environment variables in Vercel.
3. Redeploy the project.
4. Open `https://your-site.example/manage`.
5. Sign in with the password used to create `PORTAL_PASSWORD_HASH`.
6. Upload one test photo and confirm that the commit appears in GitHub and that the photo appears on the public site after the deployment finishes.

## Local development

Create `.env.local` from `.env.example`, fill in the values, then run:

```bash
npm run dev
```

Open `http://localhost:4173/manage`.

Local uploads use the configured GitHub repository and will create real commits. Use a test repository or a separate branch while developing if you do not want test photos in production.

## What your sister does

1. Open the private upload link and enter the password.
2. Click **Choose photos** or drag photos onto the page.
3. Check the previews and remove anything selected by mistake.
4. Click **Upload photos**.
5. Keep the page open until the success message appears.
6. Wait a few minutes. The photos appear on the website automatically.

If some photos fail, the page says which ones failed and offers **Retry failed**. Already-uploaded photos are not uploaded again.

## Limits and behaviour

- Up to 100 photos per batch.
- Each upload is limited to 4 MB because Vercel rejects larger serverless request bodies. Larger phone photos are resized and compressed in the browser before upload.
- JPEG, PNG and WebP only. The server checks the actual file signature, not just the filename.
- Photos go to `assets/work/` only.
- `works.json` is updated automatically. On the first real upload, the sample placeholders are removed from the manifest, matching the existing `build-works.js` behaviour. Placeholder image files and `.placeholders.json` are not deleted.
- Login attempts are limited to 8 per 15 minutes per client address. Without Upstash configured, this limit is best-effort per serverless instance.
- Session cookies expire after 12 hours. Signing out clears the cookie.

## Tests

Run:

```bash
npm test
```

The tests cover unauthenticated access, wrong passwords, secure cookie attributes, logout clearing, invalid files, oversized files, filename sanitisation, overwrite protection, one-commit batch uploads, manifest updates, conflict detection and login rate limiting. GitHub is mocked; no real repository is changed by the tests.
