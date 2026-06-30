# RetailOS — deployment & security (Hostinger-ready)

Internal readiness checklist: configuration, authorization behavior, Hostinger operations, dependency audit, and retest notes. This is not a formal penetration test.

---

## 1. Production environment variables


| Variable        | Required                                         | Purpose                                                                                                                                                                                                                                          |
| --------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `JWT_SECRET`    | **Yes** in production                            | HS256 signing key for session cookie. Server **exits** if missing when `NODE_ENV=production`. Use a long random value; never commit it.                                                                                                          |
| `NODE_ENV`      | **Yes** for real deploy                          | Set to `production` so cookies use `secure: true` (with HTTPS) and 5xx responses are generic.                                                                                                                                                    |
| `PORT`          | Optional                                         | Listen port (default `3001`). Match reverse proxy upstream.                                                                                                                                                                                      |
| `DATA_DIR`      | Optional                                         | Directory for `retailos.db` and `photos/`. Default: app root. Keep **outside** a public web root, not world-writable, and include in **encrypted backups**.                                                                                      |
| `CORS_ORIGINS`  | **Yes** if browsers call API from another origin | Comma-separated list, e.g. `https://app.example.com,https://www.example.com`. In production, requests with an `Origin` header are rejected unless listed. Same-origin SPA (served by the same Node app) often sends no `Origin` and still works. |
| `COOKIE_SECURE` | Optional                                         | Set to `1` to force `secure` cookies even when not in production (e.g. HTTPS staging).                                                                                                                                                           |
| `LISTEN_HOST`   | Optional                                         | Default `0.0.0.0`. Use `127.0.0.1` when Node sits behind nginx on the same host and must not bind on all interfaces.                                                                                                                             |


**Verify before go-live**

- `JWT_SECRET` set in hosting panel / process env (not in git).
- `NODE_ENV=production`.
- TLS enabled; users reach the app only over HTTPS.
- `CORS_ORIGINS` matches your real browser origins (if applicable).
- `DATA_DIR` path, permissions, and backup/restore procedure agreed.

---

## 2. Authorization matrix (API)

Legend: **Auth** = valid session cookie. **Exec** = `role === 'executive'`.


| Method          | Path                                                           | Auth | Notes                                                                                                                                                |
| --------------- | -------------------------------------------------------------- | ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET             | `/api/health`                                                  | No   | Liveness.                                                                                                                                            |
| POST            | `/api/auth/login`                                              | No   | Rate-limited (`loginLimiter`).                                                                                                                       |
| POST            | `/api/auth/logout`                                             | Yes  | Clears cookie.                                                                                                                                       |
| GET             | `/api/auth/me`                                                 | Yes  | Current user.                                                                                                                                        |
| GET             | `/api/skus`                                                    | Yes  |                                                                                                                                                      |
| POST            | `/api/skus`                                                    | Yes  | Exec only.                                                                                                                                           |
| DELETE          | `/api/skus/import/:importId`                                   | Yes  | Exec only.                                                                                                                                           |
| GET             | `/api/sku-import-totals`                                       | Yes  |                                                                                                                                                      |
| GET             | `/api/product-report`                                          | Yes  |                                                                                                                                                      |
| GET             | `/api/import-history`                                          | Yes  |                                                                                                                                                      |
| POST            | `/api/import-history`                                          | Yes  | Exec only.                                                                                                                                           |
| DELETE          | `/api/import-history/:id`                                      | Yes  | Exec only.                                                                                                                                           |
| GET             | `/api/users`                                                   | Yes  | Exec: full list including `user_code`. Non-exec: directory **without** login codes (`user_code: null`).                                              |
| POST/PUT/DELETE | `/api/users`, `/api/users/:id`                                 | Yes  | Exec only.                                                                                                                                           |
| GET             | `/api/assignments`                                             | Yes  | Filtered by visibility (shop / assignee / assigner).                                                                                                 |
| POST            | `/api/assignments`                                             | Yes  | `assignedBy` forced to caller; non-exec: `shop` forced to caller’s shop, `assignedTo` must be same shop.                                             |
| PUT             | `/api/assignments/:id`                                         | Yes  | Row must be visible to caller (same rules as GET filter).                                                                                            |
| GET             | `/api/outlet-transfers`                                        | Yes  | Filtered: exec all; others `createdBy` or `assignedTo`.                                                                                              |
| POST            | `/api/outlet-transfers`                                        | Yes  | `createdBy` forced; non-exec: `assignedTo` only self or empty.                                                                                       |
| PUT             | `/api/outlet-transfers/:id`                                    | Yes  | Row visible to caller.                                                                                                                               |
| GET             | `/api/store-transfers`                                         | Yes  | Filtered by shop / creator / assignee.                                                                                                               |
| POST            | `/api/store-transfers`                                         | Yes  | `createdBy` forced; non-exec: must involve caller’s shop.                                                                                            |
| PUT             | `/api/store-transfers/:id`                                     | Yes  | Row visible to caller.                                                                                                                               |
| GET             | `/api/snapshots`                                               | Yes  |                                                                                                                                                      |
| POST            | `/api/snapshots`                                               | Yes  | Exec only.                                                                                                                                           |
| GET             | `/api/skus/sold-map`, `/api/sales/by-sku`, `/api/sales/weekly` | Yes  |                                                                                                                                                      |
| POST            | `/api/sales-events`                                            | Yes  | Exec only.                                                                                                                                           |
| GET             | `/api/photos`, `/api/photos/:skuCode`                          | Yes  |                                                                                                                                                      |
| POST/DELETE     | `/api/photos/:skuCode`                                         | Yes  | Exec only (upload/delete).                                                                                                                           |
| GET/POST        | `/api/shifts/`*                                                | Yes  | Clock-in restricted to self; clock-out owner or exec.                                                                                                |
| GET             | `/api/notifications`                                           | Yes  | Filtered by visibility.                                                                                                                              |
| POST            | `/api/notifications`                                           | Yes  | Validated: non-exec cannot target arbitrary users (same shop, transfer-related rules, `alert_assigned` outlet↔manager, `all` / `executives` / self). |
| PUT             | `/api/notifications/read-all`, `/:id/read`                     | Yes  | Read uses visibility checks on `/:id/read`.                                                                                                          |


**Residual / accepted risks**

- Helmet `contentSecurityPolicy` remains disabled; tighten CSP when you have a stable asset list for the SPA.
- JSON body limit is `50mb` in Express; **nginx** defaults to **1mb** — large CSV imports need `client_max_body_size 50m` and longer `proxy_read_timeout` (see section 3).
- Service worker (`public/sw.js`) caching: review after deploy for stale shell / cache behavior (operational, not auth).

---

## 3. Hostinger runbook (summary)

1. **TLS** — Enable SSL in Hostinger; redirect HTTP → HTTPS.
2. **Node process** — Prefer Node behind **nginx** (or Hostinger’s Node integration): proxy to `http://127.0.0.1:PORT`; set `LISTEN_HOST=127.0.0.1` if the platform does not require `0.0.0.0`.
3. **Secrets** — Set `JWT_SECRET`, `NODE_ENV`, `CORS_ORIGINS`, and optional `DATA_DIR` in the panel; do not store secrets in the repo.
4. **SQLite** — Restrict file permissions on `retailos.db`; schedule encrypted backups; test a restore on a copy.
5. **Firewall** — Do not expose the Node port publicly if the proxy handles external traffic.
6. **Logging** — Avoid logging PINs, raw cookies, or JWTs; rotate logs as needed.

### nginx (required for CSV imports)

RetailOS uploads CSV archives as **multipart** (not JSON). nginx must allow large bodies and long-running import requests:

```nginx
server {
    # ...
    client_max_body_size 50m;
    proxy_read_timeout 300s;
    proxy_send_timeout 300s;

    location /api/ {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Ensure `DATA_DIR` (or the app root) is **writable** for `retailos.db`, `photos/`, and `imports/` — import failures with `EACCES` in server logs mean fix directory permissions.

---

## 4. Dependency audit (npm)

- **Command:** `npm audit` in the `retailos` directory.
- **2026-04-09:** `npm audit fix` was applied; reported issues (including `vite`, `path-to-regexp`, `picomatch`, `brace-expansion`) were addressed; audit reported **0 vulnerabilities** afterward.
- Re-run before each release; if a fix is unavailable, document the CVE and risk acceptance here.

---

## 5. Retest checklist (post-remediation)

Use two accounts (e.g. Manager A / Manager B different shops, plus one Executive).

1. **JWT / boot** — With `NODE_ENV=production` and no `JWT_SECRET`, server must refuse to start.
2. **CORS** — From a browser origin **not** in `CORS_ORIGINS`, credentialed API calls should fail; from an allowed origin, succeed.
3. **Users** — Non-exec: `GET /api/users` returns no usable `user_code` for others. Exec: full list. Non-exec cannot POST users.
4. **Assignments** — Non-exec cannot set `assignedTo` outside own shop; cannot PUT another shop’s assignment by id.
5. **Outlet transfers** — User A must not GET/PUT B’s transfer unless `createdBy`/`assignedTo` matches.
6. **Store transfers** — Same as above for shop-scoped rows; POST must not create transfers that do not involve caller’s shop (non-exec).
7. **Photos** — Non-exec POST/DELETE photo → 403.
8. **Notifications** — Non-exec cannot POST a notification to an arbitrary `userId` (expect 403); valid transfer/alert flows still succeed.
9. **Optional** — OWASP ZAP or Burp passive scan against staging after the above pass.

Record date, tester, and pass/fail per row when you run this.