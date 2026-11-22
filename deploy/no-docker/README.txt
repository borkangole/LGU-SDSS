LGU-SDSS - run WITHOUT Docker (Windows 10/11)
=============================================

Install these two programs once (default options):

1. Python 3.12   https://www.python.org/downloads/windows/
   - On the first screen tick "Add python.exe to PATH".
2. PostgreSQL 18  https://www.enterprisedb.com/downloads/postgres-postgresql-downloads
   - Remember the password you type for the "postgres" user.
   - Skip "Stack Builder" at the end.

Then:

3. Unzip LGU-SDSS-package.zip to a simple folder, e.g.  C:\LGU-SDSS
4. Double-click  SETUP-NO-DOCKER.bat  (once, needs internet, 5-15 minutes).
   It asks for the PostgreSQL password and an optional Gemini key.
5. From then on, double-click  RUN-NO-DOCKER.bat  and keep its window open.
   The browser opens http://localhost:8080  - log in with the accounts you were given.

Problems: send a screenshot of the window (do not include passwords).
