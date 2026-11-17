# Wiki validation and publishing

The source of the help pages is the tracked `wiki/` directory. The **Publish
Wiki** workflow validates and renders those pages on pushes to `main` that change
the wiki, its renderer or this workflow, and on manual runs. To validate locally:

```sh
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/sync-wiki.mts --dry-run
```

Forks validate without publishing by default. GitHub does not copy the upstream
wiki into a fork, so attempting to clone `<owner>/<repo>.wiki.git` before creating
the fork's wiki fails with **Repository not found**. This is a publishing setup
problem; it does not mean the Markdown or the application build is broken.

## Enable publishing for a fork

1. In the repository's **Settings → General → Features**, enable **Wikis**.
2. Open the repository's **Wiki** tab and create and save the first page, named
   **Home**. Enabling the feature alone does not initialise the wiki Git
   repository. The publisher will replace the initial page with `wiki/index.md`.
3. In **Settings → Secrets and variables → Actions → Secrets**, add `WIKI_TOKEN`
   with a token that can push to this repository's wiki. The workflow otherwise
   falls back to `GITHUB_TOKEN`; if that token is rejected, configure `WIKI_TOKEN`.
   Do not commit a token to the repository.
4. In the same settings under **Variables**, add a repository variable named
   `PUBLISH_WIKI` with the value `true`.
5. Under **Actions → Publish Wiki**, choose **Run workflow** on `main`.

The publisher targets the current repository's wiki, never the upstream wiki.
Publishing replaces the wiki contents with the rendered pages and `_Sidebar.md`,
so edit the tracked `wiki/` files for future changes. Restrict wiki editing to
collaborators to avoid edits diverging from those files.

Remove `PUBLISH_WIKI` or set it to `false` to return a fork to validation only.
Repositories that are not forks retain automatic publishing.

## Troubleshooting

- **Repository not found** during `git clone`: create and save the first wiki
  page, check that Wikis are enabled, and check the publishing token's access.
- **403** or a rejected push: configure or renew `WIKI_TOKEN` with wiki write
  access. A successful validation only checks the source pages, not credentials.
- **Wiki validation failed**: fix the indicated file's frontmatter in `wiki/`
  and rerun the validation command above.

GitHub documents the first-page requirement in
[Adding or editing wiki pages](https://docs.github.com/en/communities/documenting-your-project-with-wikis/adding-or-editing-wiki-pages#cloning-wikis-to-your-computer).
