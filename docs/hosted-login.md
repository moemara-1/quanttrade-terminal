# Hosted QuantTrade login

Open https://quanttrade.azurestore.shop/login and use the existing QuantTrade username and password. Keep me signed in remembers this browser for 30 days; unchecked sessions last 12 hours. Sessions survive bridge restarts and deployments. Browser private mode or clearing cookies removes the remembered login.

Manage this device and sign out at https://quanttrade.azurestore.shop/login?manage=1. Logout revokes this session immediately. Changing the configured password invalidates sessions. The login does not alter exchange account mode or authorize AI trade proposals.

The protected bridge reads WEB_LOGIN_FILE; the deployment copies the existing root-only web-access.json to shared/data/web-login.json with owner quanttrade and permissions0600. WEB_SESSION_FILE defaults to shared/data/web-sessions.sqlite. Only SHA256 session-token hashes are persisted; browser cookies are Secure, HttpOnly, SameSite=Strict and scoped to /. Public nginx navigation uses an internal auth_request; API rejection never sends a Basic challenge. Operator/agent bearer roles remain separate. Exact Origin is required for login, logout and cookie-authenticated writes.
