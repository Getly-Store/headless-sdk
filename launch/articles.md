# Launch articles — 3 outlines

One per platform, one per audience. The dev.to and Hashnode pieces are English;
the Habr piece is written for the Russian dev community and its outline below is
entirely in Russian (as the article itself will be).

---

## 1. dev.to — "Build a Telegram store bot in 15 minutes (no webhooks, no server)"

**Audience:** JS devs who want a weekend-project win. **Length:** ~1,800 words.
**Canonical code:** `examples/telegram-sales-bot` in this repo — the article quotes it,
never forks it (code drift = angry comments).

### Outline

1. **The pitch (150 words).** A Telegram bot that sells real products for real money,
   runs on a laptop, ~150 lines. Screenshot of the finished flow first
   (`/catalog` → button → pay link → "✅ Payment received").
2. **What you need.** Node 18+, a Telegram account, a Getly store with 1+ published
   product, an API key with the single `checkout:create` scope. Honest note: account +
   key + payout setup are manual, one-time, ~5 minutes.
3. **The three API calls that make a store bot** (the conceptual core):
   - public catalog: `GET /api/v1/public/stores/{slug}/products` — no auth;
   - `POST /api/v1/checkout-links` with `reference: chatId` — quote the dedupe
     behavior (same product+reference → same link, so button-mashing is safe);
   - `GET /api/v1/checkout-links/{id}` — the polling endpoint that exists precisely
     so laptops don't need webhooks.
4. **Code walkthrough** (quote bot.js in 4 chunks): setup + env validation → /catalog
   with InlineKeyboard → buy callback → the 30s polling loop with its 20-min TTL.
   Call out: money is integer cents, divide by 100 once at display.
5. **The money moment.** Run it, buy your own $1 test product, show the real
   confirmation message. (No test mode yet — say so.)
6. **Production upgrade.** Replace polling with the `checkout_link.completed` webhook
   (timestamped HMAC signature) via `@getly/nextjs` — 10 lines, quoted from the
   comment block in bot.js.
7. **Where to take it.** Coupons per chat, `metadata` for campaign tracking, the MCP
   server so Claude manages the catalog while the bot sells it. Link repo + docs.

**Tags:** `javascript, node, telegram, tutorial`
**CTA:** repo stars + "post your bot in SHOWCASE.md".

---

## 2. Hashnode — "Your AI assistant can run an actual store: an MCP deep dive"

**Audience:** AI-tooling crowd — people who have built or want to build MCP servers.
**Length:** ~2,200 words. **Angle:** not "look at our product" but "design notes from
putting commerce — real money — behind MCP tools".

### Outline

1. **Cold open.** Transcript of a real Cursor session: "take ./icon-pack, sell it for
   $19, write the listing, publish, give me a 20%-off link" → tool-call trace → live
   URL. Then: "here's everything that had to be true for that to be safe."
2. **What MCP actually adds** over "the model writes fetch() calls": typed tools,
   annotations (`readOnlyHint`/`destructiveHint`), env-based credentials — the model
   never sees the key, only the tool results.
3. **The 18 tools and why not 40.** Tool-count restraint as a design decision: every
   tool is a decision point for the model; overlapping tools = wrong-tool calls.
   Table of the tools grouped by products / content / money / config.
4. **Guardrails for money-touching tools** (the heart of the piece):
   - `confirm: true` required on delete/publish/high-discount — and an honest
     discussion of whether agents just cargo-cult it (invite comments);
   - no bulk-delete tool at all — some capabilities are safer as N deliberate calls;
   - coupons ≥90% need an extra acknowledgment flag end-to-end (API enforces, not
     just the tool description);
   - scopes: the MCP key should not have `webhooks:manage` unless you use it.
5. **Errors written for models.** The error envelope (`code`, `message`, `hint`,
   `docsUrl`): a 422 that says *what to do next* ("upload a file first:
   POST .../files") turns a dead-end into a self-correcting loop. Before/after
   transcript showing an agent recovering from `publish_requires_file` unaided.
6. **Moderation and provenance.** API-created products from fresh stores go to
   review; `created_via='api'` is stored. Being honest with the agent ("published,
   pending review — will go live after moderation") beats pretending.
7. **Setup section.** `claude mcp add getly --env GETLY_API_KEY=… -- npx -y @getly/mcp`
   + Cursor/Windsurf configs via `npx @getly/mcp init`. Short demo GIF.
8. **Closing.** What we'd standardize in MCP itself: a confirmation *protocol* (not a
   convention), scoped-credential hints. Link repo, invite PRs.

**Tags:** `AI, MCP, developer-tools, typescript`

---

## 3. Habr (RU) — «Магазин цифровых товаров, которым управляет ИИ-ассистент: полный туториал»

**Аудитория:** русскоязычные разработчики; Habr не прощает маркетинга — только
техника, честность и работающий код. **Объём:** ~3,000 слов. Вся статья — на русском;
код и комментарии в коде — на английском (как в репозитории).

### План

1. **Зачем это всё.** Короткая честная предыстория: продавцы цифровых товаров всё
   чаще просят Cursor или Claude «выложи мой набор иконок на продажу» — а у ИИ нет
   рук. Мы сделали руки: открытый SDK (MIT), MCP-сервер и API. Сразу оговорка, что
   Getly — коммерческая площадка (комиссия 20%, первые 3 месяца продавец получает
   90%), а сам SDK и MCP-сервер — бесплатные и открытые.
2. **Архитектура за 5 минут.** Схема: платформа (checkout картой и USDT/USDC,
   доставка файлов, лицензионные ключи, выплаты 1-го и 15-го числа) ↔ REST API v1 ↔
   три клиента: `@getly/sdk` (TypeScript, без зависимостей), `@getly/mcp`
   (18 инструментов), `npx @getly/auto-store` (герой демо).
3. **Три ручных шага — честно.** Регистрация, создание API-ключа
   (`getly_sk_live_…`, скоупы по принципу минимальных привилегий), подключение
   выплат (Stripe Connect или крипто-кошелёк). Всё остальное — через API.
   Важно для РФ-аудитории: выплаты в стейблкоинах (USDT/USDC) работают без Stripe —
   это реальная причина, почему туториал интересен именно на Хабре.
4. **Туториал, часть 1: продукт через SDK.** Пять строк кода: create →
   uploadFile → publish. Разбор конвенций: деньги ТОЛЬКО в целых центах
   (`priceCents: 1900`), ошибки с машиночитаемым `code` и полем `hint`,
   автоматический `Idempotency-Key` на создание.
5. **Туториал, часть 2: продажи в чате.** Checkout-ссылки: `POST /v1/checkout-links`
   с `reference` (id чата) → покупатель платит картой или криптой без регистрации,
   файлы приходят на email (guest checkout). Разбор Telegram-бота из
   `examples/telegram-sales-bot`: каталог → кнопка → ссылка → опрос статуса раз в
   30 секунд (без вебхуков, работает на ноутбуке).
6. **Туториал, часть 3: MCP — магазин внутри Cursor/Claude.** Установка одной
   командой, транскрипт реальной сессии («создай купон 20% и дай ссылку со скидкой»),
   защитные механизмы: `confirm: true` на удаление и публикацию, отсутствие
   bulk-delete, ключ только из переменной окружения.
7. **Гвоздь программы: `npx @getly/auto-store ./папка`.** Полный лог реального
   запуска с `--dry-run` и без: Claude читает файлы, пишет листинг и статью,
   загружает, публикует. Честно: товары новых магазинов уходят на модерацию —
   инструмент так и сообщает.
8. **Безопасность и подводные камни.** Подписи вебхуков (`t=…,v1=…`, HMAC-SHA256,
   окно 5 минут, timing-safe сравнение); ленивое создание Stripe-сессии по клику
   как защита от card testing; лимиты создания (20 товаров/день на ключ); что
   будет, если ключ утёк, и почему скоупы это смягчают.
9. **Чего пока нет.** Тестового режима (проверяйте на своём товаре за $1),
   Python-SDK (issue «help wanted»), hosted MCP (в роадмапе). Habr ценит этот
   раздел больше любого другого.
10. **Итог + ссылки.** Репозиторий, OpenAPI-спека, документация, приглашение в
    SHOWCASE.md. Вопросы в комментариях — отвечаем.

**Хабы:** «Программирование», «TypeScript», «Искусственный интеллект», «Электронная коммерция»
**Формат:** туториал; все листинги проверяемы против репозитория — хабровчане проверят.
