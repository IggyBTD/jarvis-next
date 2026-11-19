# Connecting a Microsoft school or work account

JARVIS reads Outlook mail, the calendar and OneDrive search (read only) through Microsoft Graph. Code: `server/accounts/microsoft-accounts.js` (sign-in), `server/core/microsoft-tools.js` (the `microsoft_*` tools). Sign-in is the same as Google: a browser tab, a one-shot listener on this PC, an encrypted refresh token per account.

No admin rights are needed to connect. What is needed is an **app ID** (client ID) that your school's tenant lets you sign in with. No secret is used.

## Route 1: register your own app (the proper way)

1. Open https://entra.microsoft.com and sign in with the school account. App registrations, New registration.
2. Name: `JARVIS`. Supported account types: this organizational directory only. Redirect URI: platform **Mobile and desktop applications**, value `http://localhost`.
3. Authentication: set **Allow public client flows** to Yes.
4. API permissions, Add, Microsoft Graph, **Delegated**: `User.Read`, `Mail.Read`, `Calendars.Read`, `Files.Read`, `offline_access`. None of these needs admin consent by default.
5. Copy the **Application (client) ID** from the Overview page.

It can fail in two places, both school settings: "Users can register applications" may be off (the New registration button is greyed or errors), or user consent may be restricted (sign-in says "Need admin approval"). Then only IT can fix it; ask for "a Graph app registration for read-only mail and calendar".

## Route 2: a client ID that is already allowed

Some Microsoft-published client IDs are pre-approved in most tenants, so no registration or consent is needed. That sidesteps your school's app-approval setting, so check its acceptable-use rules first. It is not set up here.

## Finish

Save the ID in `data/tokens/microsoft-client.json` (git-ignored):

```json
{ "client_id": "00000000-0000-0000-0000-000000000000", "tenant": "organizations" }
```

`tenant` is optional; use your school's domain (for example `uni.edu`) if `organizations` is refused. Then restart the server (`scripts/jarvis.ps1`, Restart-Jarvis), open Accounts, Microsoft, Add account, pick School, and approve in the browser tab. `JARVIS_TOKEN_KEY` must be set, as for Google.

To disconnect: Remove on the Accounts page (deletes the token here), and optionally remove JARVIS at https://myapps.microsoft.com. Microsoft has no revoke call for this.
