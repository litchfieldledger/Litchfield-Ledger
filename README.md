# Litchfield Ledger

Astro site for The Litchfield Ledger, including the homepage, zine-style page, Beehiiv post feed, newsletter signup embeds, and Netlify redirects.

## Local Development

```sh
npm install
npm run dev
```

The local dev server usually runs at [http://localhost:4321](http://localhost:4321).

## Build

```sh
npm run build
```

Astro writes the production build to `dist/`. The `dist/` folder is generated and should not be edited directly.

## Project Structure

```text
public/
  images/          Static site images served from /images/...
  zine-assets/     Texture and collage assets for the zine page
  _redirects       Netlify redirects and Beehiiv proxy routes
src/
  components/      Shared Astro components such as nav and footer
  lib/             Beehiiv API helpers
  pages/           Astro routes
  styles/          Page stylesheets
```

## Environment Variables

Copy `.env.example` to `.env` for local Beehiiv API builds:

```sh
cp .env.example .env
```

Required values:

- `BEEHIIV_PUBLICATION_ID`
- `BEEHIIV_API_KEY`

The browser-side feed refresher also uses the Netlify `/feed` redirect in `public/_redirects`.

## Common Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start Astro locally |
| `npm run build` | Build the production site |
| `npm run preview` | Preview the built site locally |

## Notes

- Put reusable images in `public/images/` and reference them with paths like `/images/orange-logo.png`.
- Do not commit generated folders such as `dist/`, `.astro/`, or `node_modules/`.
