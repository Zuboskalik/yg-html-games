# Yandex Games Development Guidelines & Project Rules

Check README.md for more details.

When writing, generating, or refactoring code for games, **always strictly treat the published reference game structure (`index.html`, `script.js`, `style.css`) as the primary blueprint/sample for API usage and SDK workflows.**

Adhere strictly to Yandex Games requirements:

1. **Architecture & Reference Blueprint (IMPORTANT):**
   - **Use the provided reference codebase as a sample/template** for all Yandex SDK calls, event bindings, and UI state loops.
   - Bind SDK pause/resume events using `ysdk.on('game_api_pause', ...)` and `ysdk.on('game_api_resume', ...)`.
   - Maintain localized UI text objects (`locales = { ru: {...}, en: {...} }`) driven by `ysdk.environment.i18n.lang`.
   - Handle player progress with `player.getData()` and `player.setData(data, true)`.
   - Handle in-app purchases with `payments.getCatalog()`, `payments.purchase()`, and consuming unhandled purchases via `payments.consumePurchase()`.

2. **Focus & Sound (`visibilitychange` / `blur` / `focus` / Platform Events):**
   - Mute ALL audio instantly and pause timers/loops when the tab loses focus, `document.hidden` is true, or `game_api_pause` fires.
   - Restore audio/game state properly upon regaining focus or receiving `game_api_resume` (unless ad is currently showing).

3. **SDK & Loading:**
   - Call `ysdk.features.LoadingAPI?.ready()` ONLY after all assets, bundles, audio contexts, and scenes are fully ready.
   - Wrap `YaGames.init()` in `try...catch...finally` or `.then().catch()` to ensure the game works gracefully offline or when blocked by AdBlock.

4. **Ads Integration:**
   - Always mute sound and pause gameplay during Fullscreen and Rewarded ads (`onOpen`, `onClose`, `onError`).
   - Grant rewards **STRICTLY** inside the `onRewarded` callback (NEVER in `onClose` or on button click).
   - Track ad timers to avoid calling fullscreen ads too frequently or during active core gameplay.

5. **Input & UI Controls:**
   - Prevent default browser behaviors: right-click context menu (`contextmenu`), text selection (`user-select: none`), and scrolling via Space/Arrows.
   - Ensure UI layouts scale responsively across Mobile (touch/notches) and Desktop.

6. **Code Hygiene:**
   - Do not include external links to websites, Telegram channels, or unauthorized third-party services.
   - Ensure clean console output without unhandled errors or missing asset references.