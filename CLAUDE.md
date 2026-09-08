# Yandex Games Development Guidelines & Project Rules

Check README.md for more details

When writing or refactoring code, always strictly adhere to Yandex Games requirements:

1. **Focus & Sound (`visibilitychange` / `blur` / `focus`):**
   - Mute ALL audio instantly when the tab loses focus or `document.hidden` is true.
   - Pause the game loop and timers on tab blur or when showing ads.
   - Restore audio and state properly upon regaining focus.

2. **SDK & Loading:**
   - Call `ysdk.features.LoadingAPI?.ready()` ONLY after all assets, bundles, and initial scenes are completely loaded.
   - Keep SDK initialization clean and handle fallback if SDK fails to load.

3. **Ads Integration:**
   - Always mute sound and pause gameplay during Fullscreen and Rewarded ads (`onClose`, `onError`, `onOpen`).
   - Grant rewards STRICTLY inside the `onRewarded` callback.
   - Respect ad cooldowns and avoid invoking ads during active gameplay or on initial game boot.

4. **Input & UI Controls:**
   - Prevent default browser behaviors: right-click context menu (`contextmenu`), text selection, and scroll keys (Arrows, Space).
   - Ensure UI layout respects mobile safe areas (notches) and scales properly across touch/desktop inputs.

5. **Code Hygiene:**
   - Do not include external links to websites, Telegram channels, or unauthorized third-party services.
   - Ensure clean console output without unhandled errors or missing asset references.