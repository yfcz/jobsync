# E2B Careers in JobSync

Monitor [E2B's open positions](https://e2b.dev/careers) using the existing **Ashby** source in Automations. E2B is already in the company directory with token `e2b`. Manual and daily runs use the shared ranking, CV matching, deduplication, persistence and run history.

## Configure an automation

1. Open **Automations → Create Automation** and choose **Ashby (company boards)**.
2. Search for **E2B**, or paste `https://e2b.dev/careers`, `https://jobs.ashbyhq.com/e2b`, a specific E2B Ashby posting URL, or `e2b` into the board URL/token input.
3. Choose your CV. Leave titles, keywords and locations empty to rank the board using the CV's skills, or add preferences. To restrict results to Prague, add `Prague` and enable strict location filtering.
4. Set the AI analysis budget, whether to save additional relevant listings, match threshold and an available daily hour. Save the automation.
5. Choose **Run Now** and inspect **Automation Logs**, **Run History** and **Discovered Jobs**. A successful run can save zero jobs when nothing meets the selected preferences or threshold.
6. Reopen the automation to edit settings. Daily execution uses the same saved configuration while JobSync is running.

Previously saved postings are removed before AI matching on later runs. Listings that were not saved, including those below the AI threshold, can be considered again. Missing postings do not delete or close historical jobs.

## Published data

One public Ashby API request per board includes descriptions and compensation with `includeCompensation=true`. The adapter retains full HTML descriptions, with plain text as a fallback, and joins primary and secondary locations. The original job link opens the specific Ashby posting.

Salary is saved in the existing `salaryRange` field. Structured salary components take precedence and retain their currency and interval. A published salary summary or named salary tiers supply a fallback. Different currencies and periods stay separate; equity and bonuses are not treated as base salary. Missing salary data stays empty.

For example, the E2B API on 2026-11-20 supplied monthly CZK amounts for Platform Engineer and Support Engineer even though their simple salary summaries were null. It supplied an annual CZK interval for Engineering Team Lead, Platform. JobSync preserves the publisher's interval rather than correcting it based on the amount.

`workplaceType` supplies the structured workplace label. An on-site posting remains on-site even if its description mentions occasional work from home. Ashby's `isRemote` flag does not override this label.

The publisher's posting ID, application link, last-publication date and employment type are retained in existing `matchData`, alongside AI results. The application link is metadata; the normal job link remains the posting detail. JobSync does not submit applications or send CVs to Ashby. No database migration or historical backfill is needed.

## Network behavior and validation

Discovery uses the existing 25-second timeout and bounded Ashby concurrency. Resolving the E2B careers alias probes only the fixed Ashby API host, with a timeout and without following redirects. The alias accepts exactly the HTTPS `e2b.dev` host and `/careers` path, with an optional trailing slash, query or fragment.

Discovery does not fetch individual posting pages or application forms. Invalid JSON, missing or malformed job lists, HTTP errors and timeouts surface through existing board diagnostics. A valid empty `jobs` array is a successful empty board. A failed board does not prevent other boards in the automation from being processed.

The captured fixture at `tests/unit/lib/scraper/ashby/fixtures/e2b-board.json` contains six complete public postings fetched on 2026-11-20: the five Prague roles and an uncompensated San Francisco role. Tests use this fixture with mocked network, AI and database boundaries; they do not depend on the current live vacancy count.

Coverage includes salary fallbacks and units, missing compensation, safe alias resolution, timeouts, complete metadata persistence, CV matching and thresholds, strict Prague filtering, analysis budgets, repeat-run deduplication, configuration create/edit, Run Now and scheduler dispatch. Existing xitee coverage checks that its metadata is retained.
