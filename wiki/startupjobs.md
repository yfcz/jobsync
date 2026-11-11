---
type: how-to
title: StartupJobs.cz
description: Nastavení automatizací StartupJobs.cz, pravidla lokalit, omezení veřejného vyhledávání, ověření a nasazení Docker image.
feature: automations
tags: [startupjobs, automations, brno, prague, remote, search, docker, ghcr]
aliases: [StartupJobs.cz integrace, StartupJobs automatizace]
status: stable
stale_after: 2027-02-10
---

# StartupJobs.cz v JobSyncu

## Jaký veřejný zdroj integrace používá?

Ověřeno 11. 11. 2026:

- [robots.txt webu](https://www.startupjobs.cz/robots.txt) i [robots.txt vyhledávacího backendu](https://back.startupjobs.cz/robots.txt) povolují používané veřejné cesty. Každý běh kontroluje obě pravidla samostatně.
- [Podmínky pro uchazeče](https://www.startupjobs.cz/vop) byly zkontrolovány; veřejné čtení není v prohlédnuté části výslovně zakázané. To není licence k další publikaci obsahu. JobSync používá data pro osobní vyhledávání, zachovává původní odkazy a neposílá přihlášky.
- [Oficiální Public API](https://www.startupjobs.cz/for-companies/dev) vyžaduje firemní Bearer token a poskytuje nabídky dané firmy. Není použito jako celotržní vyhledávač.
- Veřejné HTML stránky `/nabidky?klicove-slovo=java` neobsahuje výsledky. Její veřejný JavaScript používá anonymní `POST https://back.startupjobs.cz/api/search-offers?page=1` s JSON-LD tělem. Tento požadavek byl ověřen bez přihlášení, cookies či tokenu a JobSync nyní používá stejné vyhledávání. Sitemapu nepoužívá a nespouští prohlížeč.
- Skutečné tělo obsahuje `query` a pro město `locations: [{ locationId, radiusKm: 0 }]`; remote používá `locationPreferences: ["remote"]` bez omezení na město. ID Brna a Prahy pocházejí ze strukturovaných dat portálu a funkčnost filtrů byla ověřena živými dotazy. Stránkování používá `page` a ověřená pole `view.next`.
- Detaily obsahují veřejný Nuxt JSON v `script#__NUXT_DATA__`. Parser čte JSON a odkazy v jeho tabulce; nespouští skripty. Kontroluje identitu dotazu a stav `published`. Nabídka `108443/java-fintech-developer` poskytla lokalitu Brno, pracovní režimy a technologie; starší nabídka `106101/backend-developer` již měla stav `expired`.

Každý výraz spouští samostatné hledání, výsledky se spojí se sémantikou OR a odstraní se duplicity. Zachovává se pořadí portálu uvnitř každého dotazu; mezi dotazy se nabídky střídají, aby první výraz nespotřeboval celý limit detailů. Název ani URL nemusí obsahovat zadané slovo. Širší výsledky vyhledávače dále hodnotí společná relevance a AI pipeline.

Jde o veřejné anonymní rozhraní frontendu, odlišné od firemního Public API; jeho stabilita není garantovaná. Pořadí se může lišit od přihlášeného či personalizovaného formuláře. Při 401/403/429 nebo změně odpovědi se chyba objeví v Logs a Run History; nepoužíváme obcházení ochrany ani skrytý návrat k sitemapě.

## Proč mohu dostat méně nabídek než ve formuláři?

Načítají se nejvýše dvě stránky pro každý výraz a celkem nejvýše deset detailů. Další stránka se načítá jen tehdy, když dosud získané unikátní výsledky nenaplnily limit detailů. Neprochází se celý portál. Počty výsledků jednotlivých výrazů se kvůli překryvům nedají sčítat jako počet unikátních nabídek.

Filtry Brna/Prahy či remote se už posílají vyhledávači před výběrem detailů. Konečná kontrola pracovního režimu a české dostupnosti ale zůstává nad detailními daty: portál může vrátit nabídku s pravidelnou docházkou či nejasnou geografií. Po ní následuje deduplikace proti databázi, předběžné hodnocení, nastavený AI rozpočet a práh shody. Nulový počet uložených nabídek proto neznamená, že portál neobsahuje žádnou další vhodnou nabídku.

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

Každý běh načte dva robots.txt, nejvýše dvě stránky pro každý ze tří výrazů a nejvýše nastavený počet detailů (1–10). Bez přesměrování tedy nejvýše 18 požadavků. Nejvýše jedno spojení za celý proces, odstup alespoň 1 sekunda včetně přesměrování, timeout 12 sekund na požadavek a limit 2 MB na odpověď. Žádné automatické retry. Při 401/403/429 se zastaví i zbývající vyhledávací dotazy; 429 uchovává Retry-After v logu.

Přesměrování GET je omezené na tři a stejný přesný HTTPS origin. Přesměrování vyhledávacího POST se odmítá. Povoleny jsou pouze robots.txt, veřejné detaily a přesný endpoint vyhledávání s jediným číselným parametrem `page` v mezích limitu. Žádné přihlašovací údaje, vlastní porty, jiné backendové endpointy ani další query parametry. Robots se kontrolují i na cíli přesměrování; pomalejší Crawl-delay vyvolá blokování místo jeho porušení. Cookies se neuchovávají a neposílají.

Historie používá existující `funnelStats`: načtené detaily, odstraněné duplicity, odmítnutí lokality/režimu, neplatné detaily, vyřazení před AI, AI analýzy, nízká AI skóre a skutečně uložené nabídky. U odmítnutí zůstává identifikátor, název a důvod i po vypršení hodinové paměťové retence Logs. Počet Fetched details znamená úspěšně načtené odpovědi detailů před parsováním; neúspěšné HTTP požadavky se vykazují jako chyby. Sloupec New v historii nadále znamená počet po deduplikaci.

Zdroj používá existující deduplikaci, relevance ranking, CV matching, databázi a scheduler. Není potřeba databázová migrace, nová knihovna ani trvalá služba. `maxResults` omezuje HTTP provoz a paměť; neomezuje celkový počet řádků existující uživatelské databáze, které načítá společná deduplikace.

## Jak bylo ověřeno načítání a jak spustím offline testy?

Živé anonymní vyhledávání 11. 11. 2026 vrátilo pro `java` v Brně 45 výsledků, pro `backend` v Brně 9, pro `java` v Praze 223 a pro `java` s remote filtrem 56. Neexistující kontrolní výraz vrátil nulu. Byla ověřena také druhá stránka Java/Brno. Tato čísla jsou stavem v okamžiku ověření, nikoli počtem unikátních či AI doporučených nabídek.

Následný smoke test skutečného poskytovatele pro `java OR backend` použil v každém režimu limit dva detaily: Brno přijalo dvě nabídky, Praha dvě a Remote CZ jednu; druhou remote nabídku správně odmítl kvůli požadované docházce. Všechny tři běhy proběhly bez síťových či parsovacích chyb, vždy se dvěma samostatnými vyhledávacími POST. AI ani databáze se při smoke testu nevolaly.

JSON fixtures `startupjobs-search-*` obsahují skutečné kolekce z těchto dotazů včetně stránkování. HTML fixtures pocházejí z 10. 11. 2026 a uchovávají skutečný Nuxt offer query a referenční graf; analytika, styly a ostatní katalogy byly odstraněny. Nabídka `40052` ověřuje skutečný remote s volitelnou kanceláří a mzdu 130–160 tisíc CZK měsíčně. Další varianty dat jsou explicitně upravené se stejnou strukturou. Testy pokrývají OR, střídání a deduplikaci výsledků, filtr před detaily, omezené stránkování, chyby, oba robots.txt a regresi Jobs.cz. Nevolají StartupJobs ani AI.

AI matching a ukládání ověřují testy společného runneru s mockovanými závislostmi. Celý průchod přihlášeným GUI proti uživatelské databázi tímto ověřen nebyl.

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
