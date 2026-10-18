# Meta Platform Integration Research

Researched against official Meta developer documentation on 2026-10-06.

## Feature: launch another installed Quest app from a backgrounded CafeQuest agent

- Official documentation: https://developers.meta.com/horizon/documentation/android-apps/ps-platform-sdk-application/
- Exact current API (Android-Kotlin Platform SDK v0.2.2 reference, last updated 2026-09-04):

```kotlin
suspend fun Application.launchOtherApp(
    appId: String,
    deeplinkOptions: ApplicationOptions? = null
): String
```

- Documented failure status codes: `TargetAppBlocked`, `ApplabNotAllowed`,
  `FailToLaunch`, `MissingLaunchParameters` (plus common status codes).
- Package coordinates (public Maven Central, no credentials needed to compile):
  `com.meta.horizon.platform.sdk:application-kotlin:0.2.2`
  `com.meta.horizon.platform.sdk:core-kotlin:0.2.2`
- Initialization (official setup guide, last updated 2026-09-03):

```kotlin
HorizonServiceConnection.connect(APPLICATION_ID, context)
```

`APPLICATION_ID` is a Meta Horizon Developer Dashboard App ID. Without it the
SDK compiles but cannot initialize at runtime.

## Restrictions / decisions

| Item | Decision |
|---|---|
| Meta App ID | User records it in `cafequest.config.json` and enters the same value in each headset's setup screen; the agent persists it locally (never invented here) |
| Game Meta App IDs | Placeholders in the same config file until sourced from official data (§19) |
| Foreground-game detection | Not implemented: no supported public API documented; package-inspection permissions are prohibited (§6/§18). We track `expectedCurrentGame` only. |
| Quest 2 support | UNVERIFIED: the current SDK setup guide samples minSdk API 35; whether this SDK version runs on Quest 2's Horizon OS base must be confirmed on hardware (or via the legacy Oculus Platform SDK fallback). |
| Root/private APIs | Not used; POC relies only on normal supported behavior (§6). |

## Sources

- https://developers.meta.com/horizon/documentation/android-apps/ps-setup-kotlin/
- https://developers.meta.com/horizon/reference/horizon-platform-sdk-android-kotlin/v0.2.2/horizon_platform_application_application/
- https://developers.meta.com/horizon/documentation/android-apps/ps-platform-sdk-application/
