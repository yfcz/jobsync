---
type: how-to
title: StartupJobs.cz
description: Nastavení automatizací StartupJobs.cz, pravidla lokalit, omezení veřejného vyhledávání, ověření a nasazení Docker image.
feature: automations
tags: [startupjobs, automations, brno, prague, remote, sitemap, docker, ghcr]
aliases: [StartupJobs.cz integrace, StartupJobs automatizace]
status: stable
stale_after: 2027-02-10
---

# StartupJobs.cz v JobSyncu

## Jaký veřejný zdroj integrace používá?

Ověřeno 10. 11. 2026:

- [robots.txt](https://www.startupjobs.cz/robots.txt) povoluje veřejné cesty a odkazuje na [index sitemap](https://www.startupjobs.cz/sitemap_index.xml). Index obsahuje [sitemapu aktivních nabídek](https://www.startupjobs.cz/sitemap/offers.xml).
- [Podmínky pro uchazeče](https://www.startupjobs.cz/vop) byly zkontrolovány; veřejné čtení není v prohlédnuté části výslovně zakázané. To není licence k další publikaci obsahu. JobSync používá data pro osobní vyhledávání, zachovává původní odkazy a neposílá přihlášky.
- [Oficiální Public API](https://www.startupjobs.cz/for-companies/dev) vyžaduje firemní Bearer token a poskytuje nabídky dané firmy. Není použito jako celotržní vyhledávač.
- Veřejné HTML vyhledávání `/nabidky?klicove-slovo=java` uvádí parametr v `SearchAction`, ale při ověření neobsahovalo výsledky. JobSync nevolá interní backend a nespouští prohlížeč.
- Detaily obsahují veřejný Nuxt JSON v `script#__NUXT_DATA__`. Parser čte JSON a odkazy v jeho tabulce; nespouští skripty. Kontroluje identitu dotazu a stav `published`. Nabídka `108443/java-fintech-developer` poskytla lokalitu Brno, pracovní režimy a technologie; starší nabídka `106101/backend-developer` již měla stav `expired`.

**Pokrytí vyhledávání je omezené:** OR výrazy vybírají celé normalizované výrazy v názvu obsaženém v URL sitemapy. Detaily následně musí obsahovat alespoň jeden výraz. Nabídka zmiňující technologii pouze v těle, ale bez výrazu v URL názvu, se nemusí objevit. Sitemapové kandidáty řadíme sestupně podle číselného ID, což není zaručené pořadí posledních aktualizací. Z nejvýše deseti detailů pak mohou všechny nevyhovovat lokalitě. Počet nalezených výsledků se nerovná úplnému počtu výsledků portálu.

Pro úplné plnotextové pokrytí je vhodnou alternativou dohodnout s provozovatelem autorizovaný agregovaný feed či vyhledávací rozhraní. Firemní API samo tento problém neřeší. Při změně veřejné struktury se chyba objeví v Logs a Run History; prázdná/challenge stránka se nepovažuje za úspěšné prázdné hledání.

## Jak automatizaci vytvořím a spustím v GUI?

1. V **Settings → AI Provider** nastavte dostupný model. V **Profile** připravte CV alespoň se dvěma sekcemi, ideálně včetně dovedností. Na VPS s 1 GB RAM použijte vzdálený AI endpoint nebo Ollama na jiném stroji.
2. Otevřete **Automations → Create Automation**. Zadejte název a **Job Board → StartupJobs.cz**.
3. V kroku **Search** ověřte výchozí `java`, `backend` a povinnou **Search location → Brno**. Další možnosti jsou **Prague** a **Remote – Czech Republic**. Lze použít nejvýše tři OR výrazy.
4. Nastavte **Maximum detail pages per run** (1–10), **Target job titles**, **Keywords / skills**, **Jobs analyzed per run** a **Save additional relevant listings**. Zvolte CV, **Match Threshold** a volný **Daily Run Time**. Dokončete **Review → Create**.
5. Otevřete detail automatizace a klikněte **Run Now**. Sledujte **Logs**. Zkontrolujte počty a výsledek v **Run History**, uložené výsledky v **Discovered Jobs**. U podtržených počtů odmítnutí v historii najeďte myší pro název, identifikátor a důvod. Uložená nabídka obsahuje původní odkaz, režim a dostupnou odměnu/dovednosti v popisu.

## Jak ověřím duplicity, editaci, plánování a pravidla lokalit?

1. Spusťte znovu. Již uložené nabídky se mají vyřadit jako duplicity, i když se změnil URL slug. Nízká AI skóre se neukládají; dodatečné relevantní neanalyzované nabídky se řídí přepínačem. Odmítnuté nabídky se při dalším běhu mohou znovu vyhodnotit.
2. Pomocí **Edit** změňte lokalitu na **Prague**, uložte a znovu otevřete editaci. Ověřte zachování lokality, výrazů i limitů. Totéž proveďte pro **Remote – Czech Republic**. Každý režim spouštějte samostatně; remote může legitimně vrátit nulu.
3. U aktivní automatizace ověřte **Next Run**, počkejte na zvolenou hodinu v časové zóně serveru a zkontrolujte nový záznam historie. Ruční i plánované běhy používají tentýž registr poskytovatelů a runner.

Brno a Praha se ověřují vůči strukturovanému městu pracoviště, včetně nabídek s více lokalitami a libovolným pracovním režimem. Remote vyžaduje explicitní možnost `remote` a českou zemi ve strukturovaném pracovišti; samotné sídlo firmy, název pozice, benefit Homeoffice ani obecný text o Česku nestačí. Povinná kancelářská docházka remote vyloučí. Nejasnou geografii odmítáme konzervativně; globální/evropské nabídky bez explicitního českého pracoviště mohou být vyřazeny.

## Jaké jsou provozní limity a kde uvidím důvody odmítnutí?

Každý běh načte robots.txt, index sitemapy, sitemapu nabídek a nejvýše nastavený počet detailů. Nejvýše jedno spojení za celý proces, odstup alespoň 1 sekunda včetně přesměrování, timeout 12 sekund na požadavek a limit 2 MB na odpověď. Žádné automatické retry. Při 401/403/429 se další detaily již nenačítají; 429 uchovává Retry-After v logu. Přesměrování je omezené na tři a na přesný HTTPS origin a povolené veřejné cesty bez přihlašovacích údajů, vlastního portu či query. Robots se kontrolují i na cíli přesměrování; pomalejší Crawl-delay vyvolá blokování místo jeho porušení.

Historie používá existující `funnelStats`: načtené detaily, odstraněné duplicity, odmítnutí lokality/režimu, neplatné detaily, vyřazení před AI, AI analýzy, nízká AI skóre a skutečně uložené nabídky. U odmítnutí zůstává identifikátor, název a důvod i po vypršení hodinové paměťové retence Logs. Počet Fetched details znamená úspěšně načtené odpovědi detailů před parsováním; neúspěšné HTTP požadavky se vykazují jako chyby. Sloupec New v historii nadále znamená počet po deduplikaci.

Zdroj používá existující deduplikaci, relevance ranking, CV matching, databázi a scheduler. Není potřeba databázová migrace, nová knihovna ani trvalá služba. `maxResults` omezuje HTTP provoz a paměť; neomezuje celkový počet řádků existující uživatelské databáze, které načítá společná deduplikace.

## Jak bylo ověřeno načítání a jak spustím offline testy?

Živý smoke test poskytovatele 10. 11. 2026 načetl pět detailů pro `java OR backend`: pro Brno přijal nabídky `108443` a `108231` (druhá má více českých lokalit), tři odmítl kvůli lokalitě, bez síťových a parsovacích chyb. Smoke test nevolal AI a nezapisoval do databáze; AI matching a ukládání jsou ověřeny přes společný runner s mockovanými závislostmi. Celý průchod přihlášeným GUI proti uživatelské databázi tímto testem ověřen nebyl.

`__tests__/fixtures/startupjobs-*` pocházejí z uvedených veřejných odpovědí z 10. 11. 2026. HTML fixtures uchovávají skutečný Nuxt offer query a jeho referenční graf; analytika, styly a ostatní katalogy byly odstraněny. Fixture nabídky `40052` ověřuje skutečný remote s volitelnou kanceláří a mzdu 130–160 tisíc CZK měsíčně; HTML používá pole `minimum`/`maximum`, odlišně od firemní API dokumentace. Sitemapový výřez zachovává všechny tehdejší Java/backend URL a jeden nesouvisející záznam. Další varianty lokalit/režimů/mzdy jsou v testech explicitně upravená data se stejnou strukturou. Testy nevolají StartupJobs ani AI.

```sh
npm test -- --maxWorkers=2
npm run lint
npm run build
```

## Jak sestavím a nasadím image přes GitHub Actions a GHCR?

Build provádějte na GitHub runneru, nikoli na VPS s 1 GB RAM. Stávající `.github/workflows/build-docker.yml` spouštěný ručně sestavuje `linux/amd64` a publikuje `ghcr.io/<owner>/<repository>:jobs-cz` pomocí `GITHUB_TOKEN` s `packages: write`. Název tagu zůstává kvůli kompatibilitě `jobs-cz`, image obsahuje i novou integraci. Ve zdejším forku je cílem `ghcr.io/yfcz/jobsync:jobs-cz`.

1. Pushněte commity do svého repozitáře. V GitHub **Actions → Build JobSync Docker image → Run workflow** vyberte větev obsahující změny. Počkejte na úspěšný krok **Build and push**. Případně použijte `gh workflow run build-docker.yml --ref <branch>`.
2. Nastavte viditelnost balíčku nebo se na VPS přihlaste k GHCR pomocí tokenu s `read:packages`. Pro soukromý balíček například `printf '%s' "$GHCR_TOKEN" | docker login ghcr.io -u <owner> --password-stdin`.
3. Na VPS použijte aktualizovaný Compose a přidejte do `.env`:

   ```dotenv
   JOBSYNC_IMAGE=ghcr.io/yfcz/jobsync:jobs-cz
   TZ=Europe/Prague
   ```

   Proměnná `JOBSYNC_IMAGE` je volitelná; původní výchozí upstream image zůstává stejný. Pro reprodukovatelné nasazení lze místo pohyblivého tagu použít digest `ghcr.io/yfcz/jobsync@sha256:<digest>` z výsledku buildu.
4. Zálohujte databázi a zachovejte `.env`, klíče i datové volumes. Aktualizujte pouze aplikaci:

   ```sh
   docker compose pull app
   docker compose up -d --no-deps app
   docker compose ps
   docker compose logs --tail=100 app
   ```

5. Ověřte zdraví aplikace a výše uvedený GUI postup. Návrat na předchozí digest provedete změnou `JOBSYNC_IMAGE` a stejnými příkazy. Nepoužívejte `docker compose down -v`.

Samostatný upstream `release.yml` má pevně nastavený balíček `gsync/jobsync` a publikuje verze i `latest`; ve forku použijte uvedený ruční build, pokud nemáte upravené oprávnění a namespace release workflow. Tato implementace nic nepublikuje ani nenasazuje automaticky.
