# xitee Careers integration

The `xitee` provider monitors all vacancy links on the official [career listing](https://career.xitee.com/cs/volna-mista/). It needs no search queries, company tokens, or additional dependencies. Manual runs and the daily scheduler use the existing automation runner, CV matching, thresholds, persistence, Discovered Jobs, Run History, and Automation Logs. No database migration is required.

## Verify in JobSync

1. Start the local app with `npm run dev` and open `http://localhost:3737`.
2. Open **Automations → Create Automation**. Enter a name and select **xitee Careers** as the Job Board.
3. Leave target titles, keywords, and locations empty to discover every current vacancy and rank using the selected CV's skills. Alternatively, set optional preferences. Keep strict location filtering off when you want to consider positions without an explicitly published location.
4. Set jobs analyzed per run and whether to save additional relevant listings. Select your CV, match threshold, and an available daily schedule hour, then create the automation.
5. Open the automation and choose **Run Now**. Automation Logs report the number of positions found, successfully parsed details, failures, duplicate/rejection reasons, AI analysis, and saved jobs. Run History retains the counts and named reasons; hover or focus underlined counts to see details.
6. Inspect **Discovered Jobs**. Only relevant listings above the AI threshold, plus the optional additional relevant listings, are saved. A successful run can save zero jobs when no positions match your CV/preferences. Follow a job's original xitee link to review or apply yourself.
7. Run it again. Previously saved vacancies should appear as duplicates and generate no additional saved jobs or AI calls for those vacancies.
8. Edit the automation, change optional preferences or the analysis budget, save, and reopen it to check persisted settings. The existing scheduler runs it daily at the selected hour while the application is running.

## Parsing and identity

- The HTML parser uses the listing's Breakdance post loop and the detail page's position-specific rich-text block. It retains Czech/English requirements and responsibilities, removes navigation/forms/cookies/shared benefits, and removes generic benefits written inside the position editor while retaining explicit working terms.
- Location is extracted only from explicit labels in the role content. General Prague/Brno office descriptions do not establish job location. A home-office benefit does not establish a remote workplace. Employment type remains blank in the existing non-null database field when the posting does not specify it.
- Canonical URLs remove query strings/fragments and normalize Czech/English representations. Publisher-provided alternate URLs and WordPress post IDs also cover renamed/localized slugs.
- Teamio `advId` values supply equivalent Jobs.cz advert URLs. These aliases and the optional application URL/date/employment metadata are retained in existing `matchData`; published salary uses the existing `salaryRange` column. Aliases support deduplication in either import order.
- Missing vacancies are never deleted or automatically closed. Fetch/parser failures do not modify historical jobs or AI matches.

## Network behavior

Each run fetches robots rules, one listing page, then only the discovered vacancy detail pages. The observed robots URL redirects to `/cs/robots.txt/`, which returns 404; missing robots files are handled as unavailable rules. Successful HTML challenge responses, robots restrictions, and slower unsupported crawl delays fail closed.

Requests are serialized across automations with a one-second minimum interval, a 15-second timeout per request/redirect, a 2 MiB decoded response limit, and at most three redirects. Requests use HTTPS and an explicit host/path allowlist. Authentication, CAPTCHA, and anti-bot challenges are never bypassed. HTTP 403/429 stop further detail requests; Retry-After also suppresses requests from other automations in the current process. HTTP/parse failures retain names and reasons. No browser or external application form is fetched.

## Validation

Saved HTML fixtures come from the public listing and its Czech/English detail pages fetched on 2026-11-16. Styles, scripts, images, and unrelated attributes were stripped; content, template structure, canonical/language links, navigation, repeated benefits, and application links were retained so tests exercise actual boundaries.

```text
npx vitest run --maxWorkers=2
npx tsc --noEmit
npm run lint
npm run build
```

Final verification on 2026-11-17: 326 test files passed and one was skipped; 3,929 tests passed and 12 were skipped. The focused integration/regression run passed all 177 tests. TypeScript, ESLint, production build, and `git diff --check` passed. The build reported an existing `unpdf` dependency warning concerning `import.meta`; no xitee compilation errors occurred.

Tests cover discovery, both languages, requirements/responsibilities, boilerplate removal, missing/explicit fields, safe URLs/redirects, stable identities, duplicate imports in both source orders, genuine empty lists, changed HTML, HTTP errors, robots rules, Retry-After, response limits, timeouts/cancellation, configuration create/edit/reload, Run Now, scheduler dispatch, and the real AI matching/persistence pipeline with mocked AI/database boundaries.

A limited live run of the actual provider on 2026-11-16 found and parsed two vacancies without errors. It correctly left both locations unknown, retained full-time employment evidence for the controlling role, and classified only the QA role as hybrid. The live check performed no AI calls, database writes, application submissions, or CV uploads.

## Limitations

- Future site template changes fail visibly and may require a parser update. The adapter follows the current single-page vacancy list, rather than adding browser automation or a general-purpose crawler.
- Cross-source identity requires an exact publisher-provided advert alias. Unrelated postings with similar titles are deliberately retained. The existing unique-URL database constraint handles concurrent saves of the same canonical URL; simultaneous runs from different sources with different URLs retain the existing snapshot-deduplication race.
- Default pre-ranking uses structured skills from the selected CV. If these are absent, provide optional titles/keywords to supply a ranking signal. Strict location filtering drops jobs without a matching explicit location.
- Optional application URL and posting-date metadata are preserved for historical use; the existing job link remains the original career page.

## Changed files

- Provider: `src/lib/scraper/xitee/{index,http,parser,urls}.ts`.
- Shared integration: `src/lib/scraper/ats/{registry,types}.ts`, `src/lib/scraper/automation-run/{atsRun,config,persist}.ts`, `src/lib/scraper/{types,utils,mapper,robots}.ts`, `src/lib/jobs/jobDedupe.ts`. StartupJobs' existing robots parser delegates to the extracted, behavior-preserving shared helper in `src/lib/scraper/startupjobs/http.ts`.
- Models and schemas: `src/models/{automation.model,automation.schema,ai.schemas}.ts`.
- UI: `src/components/automations/{XiteeSearchStep,AutomationWizard,AutomationList}.tsx`, `ats-search-step/TargetingFields.tsx`, `automation-wizard/{StepBasics,StepReview,useWizardForm,wizardConfig}`, and `automation-detail-container/{AutomationSearchConfig,AutomationSummaryCard}.tsx`.
- Tests: `tests/unit/lib/scraper/xitee/{xitee-provider,xitee-config,xitee-execution}.spec.ts` and adjacent HTML fixtures, `tests/component/components/automations/XiteeAutomationForm.spec.tsx`, and expanded `ats-runner.spec.ts`, `automationSchedule.actions.spec.ts`, and `jobDedupe.spec.ts`.
- Documentation: this file and `changes/xitee-careers.feat.md`.
