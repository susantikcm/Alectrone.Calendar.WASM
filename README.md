# Alectrone.Calendar.WASM

A Blazor WebAssembly front-end for **Alectrone Calendar** — a marketing/landing
experience for team scheduling.

Built with:
- [.NET 10](https://dotnet.microsoft.com/) (`net10.0`)
- [Blazor WebAssembly](https://learn.microsoft.com/aspnet/core/blazor/)

## Run locally

```bash
dotnet run
```

Then open the URL printed in the console (typically `https://localhost:5001`).

## Publish a production build

```bash
dotnet publish -c Release -o ./publish
```

The static site is output to `./publish/wwwroot`.

## Deploy to GitHub Pages

This repository includes a GitHub Actions workflow
([`.github/workflows/deploy.yml`](.github/workflows/deploy.yml)) that publishes
the app to GitHub Pages on every push to `main`.

### One-time setup

1. Push this repository to GitHub.
2. In the repo on GitHub, go to **Settings → Pages**.
3. Under **Build and deployment → Source**, select **GitHub Actions**.
4. Trigger the workflow (push to `main`, or run it via the **Actions** tab →
   **Run workflow**).

Once the workflow completes, the site is live at:

```
https://<your-github-username>.github.io/<repository-name>/
```

### How the deployment works

- Builds the Blazor WASM app in `Release` mode.
- Rewrites `<base href="/">` to `/<repository-name>/` so the app is served from
  the Project Pages subpath (local dev keeps `/`).
- Copies `index.html` to `404.html` as a SPA fallback for deep links.
- Adds a `.nojekyll` file so GitHub Pages serves the `_framework/` folder
  (Blazor's downloaded DLLs).