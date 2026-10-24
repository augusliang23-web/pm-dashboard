# Product Contract / scoped implementation plan

Owner issue: Admin cannot select self as Deputy; project status overlaps Edit/More. Owner clarification in this chat: Admin may select only self, not another Admin, as Deputy. Existing Primary PM Admin-self rule remains.

Expected: Admin self and active PM selectable once; Unassigned retained. Existing assignments render without mutation, and unavailable current assignments remain visible but not selectable as new targets. PM cannot submit assignment changes. Trusted backend must reject other Admin/disabled/unknown targets. Role/permissions/ownership meanings do not change. Google SSO and PR79/80 remain untouched.

Implementation: one small shared eligibility contract shipped in browser/Functions, consuming trusted user-directory records and current actor; normalize roles/email, omit disabled/inactive and deduplicate IDs. Apply it to both Admin selectors and authoritative assignment validation. Keep legacy non-draft editor behavior and query scope unchanged. Move card actions into normal header flow with flex wrapping and readable long text.

Validation: reproduce baseline with synthetic browser/emulator data and screenshots; add failing focused eligibility/backend tests; minimal fix; exact-delta source guards retaining historical hashes; Admin-self and S01 affected browser regressions; both Hosting builds. No unrelated PDF/SSO suites. Verify local commit parent/base, clean worktree and unchanged remote PR79/80. No push, PR, merge, cloud action or live data writes.

Non-goals: other-Admin assignment, PM delegation, role redesign, new framework, SSO/migration/deployment. Antigravity/Control Plane acceptance remains separate.
