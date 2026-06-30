---
Task ID: 1
Agent: Super Z (Main)
Task: Build PM Dashboard v3.0T on Next.js 16, preserving exact v2.0T Firestore data structure and business logic

Work Log:
- Analyzed original v2.0T dashboard (4,815 lines single HTML, 129 JS functions, 4 Firestore collections)
- Extracted complete Firestore data model: weeks/{id}, users/{emailKey}, presence/{emailKey}, presenceSessions/{id}
- Documented all 38 window.* functions and their business logic
- Initialized Next.js 16 project with Firebase SDK
- Created TypeScript type definitions (1:1 mapped from Firestore schema)
- Built Firebase service layer (auth, CRUD, presence, sync-core, executive-timeline-core ports)
- Built Zustand store with all state + actions (week CRUD, project CRUD, release, strategy, attention)
- Built 16 React components: LoginOverlay, DashboardShell, Loader, Toast, ProjectCard, ProjectEditModal, ProjectDetailModal, OverviewView, ProjectsView (Grid/Kanban/Table), TimelineView (Gantt), RiskMatrixView (5x5), TeamWorkloadView, RoadmapView, ActivityView, WeekManagementModal, ChangePasswordModal
- Applied LITEON color scheme to globals.css (light/dark theme support)
- Fixed import mismatches (default vs named exports)
- Verified login page renders with zero console errors via agent-browser

Stage Summary:
- v3.0T Next.js project is structurally complete with all views and Firebase integration
- Firestore data structure is 100% preserved (same collections, same document shapes, same write operations)
- All 38 original business logic functions migrated to Zustand store actions
- Preview: login page renders, awaiting Firebase auth to test dashboard views
- Files: 16 component files + 3 infrastructure files (types, services, stores) + layout + page + CSS