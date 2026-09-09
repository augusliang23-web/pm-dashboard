# pm-dashboard
DCDC PM dashboard for PMs status update

## Production security handoff

The client authorization checks are defense-in-depth only. Business-data writes use authenticated Callable Functions, while Firestore Security Rules deny direct browser writes to weeks, Gantt settings, and Executive milestone collections. Before release, deploy and verify Functions before deploying the matching restrictive Rules so the dashboard does not enter a read-only gap.

The legacy `team-2/` source and deployment entrypoint is retired. Historical plans under `docs/superpowers/` may still describe that former layout, but they are not active runtime, test, configuration, or deployment instructions.

The root dashboard intentionally retains `team2.portfolioScope`,
`team2.overviewScope.*`, and `dashboardSettings/team-2-portfolio`. These are
data-compatibility identifiers, not source paths or deployment dependencies.
Renaming them requires a separately reviewed data migration so existing user
preferences and Gantt settings do not appear to disappear.
