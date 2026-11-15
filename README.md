# Blue Line Visa CRM

An offline-first Windows desktop application built with Electron, React, TypeScript, SQLite, and local Tesseract OCR.

## Development

Requirements: Node.js 20 or newer and npm.

```powershell
npm.cmd install
npm.cmd install-scripts approve electron better-sqlite3 esbuild
npm.cmd run rebuild:electron
npm run dev
npm start
npm test
npm run build
```

The `postinstall` script rebuilds `better-sqlite3` for this project's Electron version. Node and Electron use different native-module ABIs, so use `npm run rebuild:electron` to restore the Electron binding after running tests or rebuilding SQLite for Node. The app start commands intentionally do not rebuild native modules: rebuilding while the app is already open locks `better_sqlite3.node` on Windows and causes `node-gyp` to fail. Close all Blue Line app windows before running `npm.cmd run rebuild:electron`, `npm.cmd test`, installing dependencies, or packaging. Use `npm run dev` for development or `npm start` to launch the built app. `npm test` temporarily rebuilds SQLite for Node.js tests and then attempts to restore the Electron-compatible binding. If restoration fails because the app is open, close it and run `npm.cmd run rebuild:electron`. Do not run `npm rebuild better-sqlite3` manually for Electron: it targets the installed Node.js runtime.

Approve the listed dependency lifecycle scripts if your npm version gates dependency install scripts; Electron's runtime and SQLite's native binding need them.

The Electron main process owns SQLite and local document storage. The renderer uses a restricted preload API with context isolation and no Node integration. The app creates its database under `%APPDATA%\BlueLineVisaCRM\database\blueline.db`; uploaded documents are copied under `%APPDATA%\BlueLineVisaCRM\documents`.

## Office LAN: shared workspace

Office clients use the host's Dashboard, My Attendance, CRM/Customers/DATA, Visa Pipeline, catalogs, Documents, Human Resources, Reports, and Settings, subject to account permissions. Settings includes shared company details, branding, pipelines and catalogs; only administrators may manage application users. HR includes departments, employees, profiles and photos, attendance and calendars, leave, payroll, documents, CVs Bank, HR password administration, and HR CSV exports. Customer records are created with an application, as in the local app. Clients can select and upload application/customer documents, customer photos, employee photos, HR documents, CVs and company logos; the host stores them. Clients also suggest CV names using local offline OCR for images or the filename for PDFs. Opening a server file asks where to save a local copy before launching it; CSV exports and backups are also saved on the client. Protect and remove local copies as appropriate.

Standalone Smart Scanner runs offline OCR on the client; its application-file controls additionally require Documents or Visa Pipeline permission. Passport inspection in the new-application form offers local OCR or, after explicit confirmation, Gemini via the host. Gemini sends the original passport and personal information to Google: use it only when authorized. The host must configure the key and model locally; configuration, model listing, connection tests and usage administration remain host-only, and the key is never sent to clients. Clients default to OCR on each sign-in and their provider choice does not change the host's default. Only one shared Gemini scan runs at a time; cancelling after the host starts a request cannot cancel an already-running Google request. The host temporarily stages the image under `lan-gemini-scans`; it is removed after completion or at the next host startup following an interruption. PDF OCR is unavailable locally; Gemini can inspect PDFs, and all extracted data requires manual review.

Unsupported operations fail explicitly and never fall back to a client database. Files outside the host's managed document directories and files larger than 25 MB cannot be downloaded by clients; customer and employee photos are limited to 10 MB and logos to 5 MB. The document library rejects more than 5,000 records rather than silently omitting records, and server responses, including CSV exports, over 4 MB fail explicitly. Shared branding is refreshed when the client reloads workspace data or signs in; it is not pushed instantly. The server rechecks the relevant permission on each request and file chunk. HR requires a separate password unlock for each client sign-in; inactivity expires that unlock after 12 hours, and HR password changes or resets invalidate other sessions. Only administrators can administer the HR password or assign app users. Incomplete uploads expire after five minutes; staged passports and CVs expire after ten. If a connection fails during final upload or record confirmation, check the host records before retrying because the operation might already have completed.

The host uses its existing SQLite database, employee assignments and accounts. A client does not open or initialize a SQLite database. No data is migrated or merged: an older database and files on a client remain separate and untouched. Attendance uses the host's clock. The host app must remain open; the service stops when the app exits.

### Host setup (Windows)

1. Back up the host's existing data before starting. The built-in backup does not include every data directory (such as customer photos and branding); with the app closed, securely back up the entire `%APPDATA%\BlueLineVisaCRM` directory as well. Protect backups and the private key from other users.
2. Choose a stable IPv4 address assigned to the host's office network adapter (e.g. use `ipconfig`). Bind to that **specific** address, not `0.0.0.0`. Restrict access to trusted office PCs using Windows Firewall's private-network profile and remote-address subnet rules; never forward the port from the internet. Wireless client isolation and firewall rules must permit connections between PCs.
3. Open the app on the host and select **Office Connection → Server — central company for the office**. Select the host's reserved LAN address and port, leave **Create a new server certificate** checked for first setup, then choose **Save & Restart**. The app creates and protects the certificate on the host; it does not require OpenSSL or manual config-file edits. Keep the certificate across restarts. Creating a replacement changes the fingerprint, so every client must be reconfigured.
4. After restart, verify the host address and SHA-256 fingerprint on the sign-in screen. From the app menu, choose **Help → Copy Client Setup Code** and transfer it to staff **through a separate trusted channel**. The code contains only the address and public fingerprint, never a password.
5. Assign each user to an active employee in Human Resources. Use unique accounts and strong passwords; change any default credentials before enabling the service. Keep the host app running while clients are connected.

### Client setup

Install the same app version on each office PC. On its sign-in screen select **Office Connection → Client — connect to the office server**. Paste the setup code copied from the host, or enter the `https://host:port` address and fingerprint manually. Choose **Test Connection** and confirm the certificate matches, then select **Save & Restart**. Sign in with an account on the host. The address, port and public fingerprint are saved locally; passwords are held only in memory until sign-out or exit. The certificate pin is checked before credentials are sent; a mismatch fails closed. Requests are encrypted and reauthenticate against the host's current account and module permissions. Failed sign-ins are rate limited per network address. The `https://host:port` value is the app's connection format; the host is a certificate-pinned TLS service, not a browser-facing website.

If the host is unavailable, the client reports an error and does not use a local database as a substitute. To return to that PC's separate local workspace, sign out, select **Office Connection → Standalone — existing local company**, and restart. Neither direction copies or merges databases. To disable the service on the host, select **Office Connection → Standalone — existing local company** and restart. This is a certificate-pinned private LAN service, not an internet-facing service; it has no automatic discovery or remote server configuration or certificate enrollment/rotation.

## Windows installer

On Windows, run:

```powershell
npm.cmd run package:win
```

The packaging command rebuilds SQLite for Electron before creating the installer and leaves the Electron-compatible binding in place. The NSIS installer is written to `release\BlueLine-Visa-CRM-Setup-1.0.2.exe`. User data is stored outside the installation directory and is not removed by uninstall.

### Fixing a `better_sqlite3.node` ABI mismatch

From the project directory in PowerShell, rebuild specifically for the Electron version resolved by this project (currently Electron 37.10.3):

```powershell
Set-Location -LiteralPath 'C:\Users\lenovo\OneDrive\Desktop\New folder (2)'
npm.cmd exec -- electron-rebuild --which-module better-sqlite3 --version 37.10.3
```

Or use the project script, which automatically detects the locally installed Electron version:

```powershell
npm.cmd run rebuild:electron
```

`npm.cmd rebuild better-sqlite3` rebuilds against Node.js, not Electron. The project keeps this as `rebuild:node` for tests that run SQLite directly under Node; always run `npm.cmd run rebuild:electron` afterward before launching Electron or creating an installer. Reinstalling dependencies runs the Electron-targeted `postinstall` rebuild automatically.

Native compilation and package extraction can conflict with OneDrive file syncing or locks. If rebuilding reports access, rename, or file-in-use errors, pause OneDrive syncing and work from a local non-synced directory such as `C:\dev\blue-line-visa-crm`. Copy or clone the project source there, install dependencies in that copy with `npm.cmd ci`, then run `npm.cmd run rebuild:electron`. Do not copy, remove, or reset `%APPDATA%\BlueLineVisaCRM`; that is where the existing customer database and documents are stored.

## Diagnostics

Startup failures, database initialization errors, renderer load failures, and process crashes are recorded under `%APPDATA%\BlueLineVisaCRM\logs`. Daily logs rotate when they reach 2 MB. Common email, phone-number, and passport-like identifiers are redacted; customer records and document contents are not logged. Include the relevant log file when reporting a launch problem.

## Current functionality

- Persistent local SQLite customer and application records.
- Multiple applications linked to a customer by passport number, with a name-and-phone duplicate match.
- Customer DATA profiles with passport and personal details, profile photos, linked applications, and customer-wide document history.
- Configurable application pipelines and stages, plus manageable country and visa-type catalogs.
- Kanban stages, drag-and-drop transitions, editable application details, soft deletion, and a permanent stage-change activity log.
- Local document upload, listing, and opening for PDF/JPG/PNG files; passport scans are retained with the customer record.
- Dashboard counts, country distribution, CSV export, and a SQLite-plus-documents ZIP backup.
- Company name and logo settings, English/Arabic interface toggle, and offline English/Arabic OCR for passport images.
- TD3 passport MRZ parsing and check-digit validation with image/PDF preview and a required manual review before saving extracted fields.
- HR workflows for department and employee records, a searchable employee directory with List and Kanban views, profiles and private employee photos, daily attendance, payroll periods, employee documents, and audit history. Leave and employee documents are no longer top-level HR pages; their employee-profile tabs and stored records remain intact.
- The CVs Bank provides a department-column candidate pipeline with editable candidate details, private PDF/image storage, and a star for strong candidates. Image files use offline OCR to suggest a name for confirmation; PDFs use the filename as the editable suggestion. Media is seeded as an HR department; Office Boy and Manager remain HR departments but are excluded from CVs Bank, and existing CV candidates/files in those departments are removed once during migration. HR requires its own password; Karam creates and changes it from the HR section, and can reset a forgotten HR password from the locked HR screen after verifying the administrator sign-in password.
- Application users can be added, edited, and deleted in Settings by an administrator, who can assign module access per user. Granted modules provide their normal actions; application-user and account-security controls remain administrator-only. Employee profiles can be explicitly assigned to application users; deleting an account removes its assignment but preserves the employee record.
- Attendance has a monthly calendar beside the employee list that can show all employees or an individual employee's records, manual check-in/check-out times, and a Day off action that highlights the date in yellow. Employee schedules can be set individually; the attendance CSV reports overtime minutes after scheduled end and late-arrival deduction minutes. The My Attendance app is available to every application user, opens automatically on that user's first login each day, and shows only their assigned employee's calendar and check-in/check-out controls. Self-attendance actions do not require unlocking HR and are recorded against the assigned employee. Completed attendance hours continue to drive payroll calculations.
- The dashboard greets Mustafa by name when he signs in.
- HR records use additive SQLite tables with foreign keys, unique employee codes, hourly-rate and worked-minute snapshots, transactional payroll generation/approval, and per-action audit entries.
- HR employee documents and candidate CVs are copied to private local application storage and included with the existing database-and-documents backup.
- HR directory, attendance, leave, payroll, document-expiration, and audit reports can be exported as CSV.

## Limitations

The optional centralized LAN service supports the shared modules and workflows described above. Gemini configuration remains host-only. Module access is assigned per application user, while HR also requires its separate password; account and security controls remain administrator-only. HR payroll supports draft bonuses, allowances, deductions, advance repayment entries, and adjustments, but there is no advances ledger, payslip generation, or posting to Accounting. Check-in/out uses the host computer's local clock and does not support overnight shifts. CRM/Operations employee links are not implemented. HR provides six CSV exports without date filters; PDF/XLSX exports are not implemented. HR document expiration alerts currently use a 30-day window. Leave policies and balances must be configured by an administrator; requests spanning calendar years must be split. The HR interface is currently English-only.

The application also does not yet support restore-from-backup, document rename/delete, PDF OCR, visa-layout extraction, date-filtered CRM reports, or automated scheduled backups. The MRZ review parses TD3 passports only; OCR output must be manually verified. Application deletion is soft deletion so existing customer records and uploaded files are retained. The Windows installer must be built and verified for each release.

## Data backup

Use **Settings → Create workspace backup** on a LAN client. An administrator must first unlock HR in that same sign-in session. The host builds a ZIP containing a SQLite-consistent database snapshot, the managed `documents`, `customer-photos` and `branding` directories, and metadata; the client verifies a SHA-256 digest before saving it. The shared backup rejects more than 1 GiB of database and managed files, more than 100,000 files, or unsupported filesystem entries such as symlinks. It excludes server certificates/private keys, Gemini configuration and transient files. Only one shared backup can run at a time.

The database snapshot and files are **not a single transactional snapshot**: stop edits and uploads on all PCs while taking it. Temporary unencrypted archives exist on the host during creation/download; incomplete client downloads can remain after a crash. Restrict access to both PCs and protect the final ZIP. The host's **Create database backup** includes only the database and `documents`, not branding or customer photos. Restore is not implemented and database file references use host paths; keep a full host-directory backup with the app closed and do not assume the ZIP can be restored automatically.
