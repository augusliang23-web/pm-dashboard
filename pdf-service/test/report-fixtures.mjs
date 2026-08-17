export function completeProjectReportFixture() {
  return {
    week: { weekLabel: 'W28 2026', weekDate: 'Jul 6 - Jul 12' },
    sections: [
      'project-brief', 'project-update', 'milestone', 'gantt',
      'team-allocation', 'resources', 'budget'
    ],
    project: {
      name: 'Platform Modernization', code: 'PMS-001', projectLevel: 'system',
      status: 'red', progress: 62, attention: 'action',
      owner: 'Augus', deputy: 'Bonnie', customer: 'Operations', location: 'Singapore',
      highlight: 'Prototype approved\nPilot environment ready',
      risk: 'Vendor lead time',
      weeklyActions: 'Confirm alternate supplier\nComplete integration test',
      milestones: [
        { name: 'Design approval', date: '2026-07-04', status: 'done' },
        { name: 'Pilot build', date: '2026-07-18', status: 'in-progress' },
        { name: 'Launch readiness', date: '2026-08-14', status: 'at-risk' }
      ],
      quarterlyMilestones: [
        { quarter: 'Q3', name: 'Pilot complete', progress: 55, status: 'in-progress' }
      ],
      ganttWorkstreams: [
        { name: 'Design', startDate: '2026-06-20', endDate: '2026-07-08', status: 'completed', progress: 100 },
        { name: 'Integration', startDate: '2026-07-01', endDate: '2026-08-05', status: 'at-risk', progress: 48 }
      ],
      teamMembers: [
        { name: 'Bonnie', roleName: 'Firmware', effortPct: 70 },
        { name: 'Josiah', roleName: 'System Electrical', effortPct: 50 }
      ],
      resources: {
        role_firmware: { role: 'Firmware', estimated: 120, actual: 72 },
        role_system_electrical: { role: 'System Electrical', estimated: 90, actual: 40 }
      },
      budget: {
        currency: 'USD', totalEstimated: 120000,
        monthlyPlans: [{ month: '2026-07', categoryName: 'NRE', currency: 'USD', amount: 60000 }],
        actuals: [{ month: '2026-07', categoryName: 'NRE', currency: 'USD', amount: 42000 }]
      }
    }
  };
}

export function completeOverviewReportFixture() {
  const project = completeProjectReportFixture().project;
  const secondProject = {
    ...project,
    name: 'Module Refresh', code: 'MOD-002', projectLevel: 'hardware-module',
    status: 'yellow', progress: 78, attention: 'monitor', owner: 'Mia',
    risk: 'Validation capacity', weeklyActions: 'Reserve backup laboratory'
  };
  return {
    week: {
      weekLabel: 'W28 2026',
      weekDate: 'Jul 6 - Jul 12',
      executiveSummary: 'Pilot work is progressing with one supplier escalation.',
      strategyLayer: {
        executiveMilestoneTimeline: {
          title: '2026 Executive Timeline',
          quarters: ['Q1', 'Q2', 'Q3', 'Q4'],
          phases: ['Foundation', 'Validation', 'Scale', 'Commercialization'],
          rows: [
            { sectionId: 'ioe-product-portfolio', label: 'IoE Product Portfolio', cells: [[{ text: 'Architecture Q1' }], [{ text: 'Engineering Q2', sources: [{ title: 'Hidden evidence' }] }], [], []] },
            { sectionId: 'customer-engagements', label: 'Customer Engagements', cells: [[], [], [{ text: 'Customer Q3' }], []] },
            { sectionId: 'investors-strategy', label: 'Investors & Strategy', cells: [[], [], [], [{ text: 'Investor Q4' }]] }
          ]
        }
      },
      projects: [project, secondProject]
    },
    trendWeeks: [
      { weekLabel: 'W27', projects: [{ ...project, status: 'yellow', progress: 55 }, { ...secondProject, progress: 70 }] },
      { weekLabel: 'W28', projects: [project, secondProject] }
    ],
    sections: [
      'health-focus', 'weekly-trend', 'executive-summary', 'attention-matrix',
      'risk-actions', 'executive-milestones', 'quarterly-roadmap', 'project-portfolio',
      'resource-analytics', 'budget-overview'
    ],
    overviewScope: 'all',
    executiveAudienceView: 'leadership'
  };
}

export function structuredExecutiveSummaryFixture() {
  return `WEEKLY MOVEMENT
Portfolio Summary: Portfolio delivery remained stable while validation and supplier recovery received focused management attention.

- Project: Platform Modernization
  Movement: Pilot validation advanced and the integration environment is ready.
  Blocker: Alternate supplier timing remains unconfirmed.
  Next step: Complete integration testing and confirm the recovery date.

- Project: Module Refresh
  Movement: The prototype build completed and entered functional verification.
  Blocker: Laboratory capacity is constrained this week.
  Next step: Reserve backup validation capacity.

- Project: Power Controller
  Movement: Main-board design review closed with follow-up actions agreed.
  Blocker: One long-lead component remains under commercial review.
  Next step: Confirm the procurement strategy.

- Project: Battery Gateway
  Movement: Firmware messaging and diagnostic flows passed internal review.
  Blocker: None
  Next step: Begin the customer simulation cycle.

- Project: Rack Prototype
  Movement: Two prototype units entered fabrication with shipment planning active.
  Blocker: Delivery dates remain provisional.
  Next step: Lock the customer delivery windows.

- Project: Edge Platform
  Movement: The validation and commercial workstreams were separated into clear gates.
  Blocker: External confirmation of the commercial timeline remains open.
  Next step: Confirm the gate owners and dates.

MANAGEMENT ASK

- Project: Module Refresh
  Decision / Support needed: Approve priority access to backup laboratory capacity.
  Business impact: Protects the verification and release schedule.

- Project: Platform Modernization
  Decision / Support needed: Support supplier escalation and recovery-date confirmation.
  Business impact: Reduces pilot integration uncertainty.

- Project: Power Controller
  Decision / Support needed: Confirm the long-lead procurement approach.
  Business impact: Limits EVT-to-PVT schedule exposure.

- Project: Edge Platform
  Decision / Support needed: Confirm ownership of the commercial validation gate.
  Business impact: Enables reliable customer commitment planning.`;
}

export function compactExecutiveSummaryFixture() {
  return `WEEKLY MOVEMENT
Portfolio Summary: Portfolio delivery remained stable while one validation dependency needs management attention.

- Project: Platform Modernization
  Movement: Pilot validation advanced and the integration environment is ready.
  Blocker: Alternate supplier timing remains unconfirmed.
  Next step: Complete integration testing and confirm the recovery date.

- Project: Module Refresh
  Movement: The prototype build completed and entered functional verification.
  Blocker: Laboratory capacity is constrained this week.
  Next step: Reserve backup validation capacity.

MANAGEMENT ASK

- Project: Module Refresh
  Decision / Support needed: Approve priority access to backup laboratory capacity.
  Business impact: Protects the verification and release schedule.

- Project: Platform Modernization
  Decision / Support needed: Support supplier escalation and recovery-date confirmation.
  Business impact: Reduces pilot integration uncertainty.`;
}

export function packedRepairExecutiveSummaryFixture() {
  return `WEEKLY MOVEMENT
Portfolio Summary: Delivery remains stable after the packed Copilot paste.
- Project: Scenario One / Alpha
  Movement: Validation completed.
  Blocker: None
  Next step: Confirm the release date.
- Project: Scenario One / Beta
  Movement: Integration entered review.
  Blocker: Supplier timing remains open.
  Next step: Confirm recovery ownership.
MANAGEMENT ASK
- Project: Scenario One / Beta
  Decision / Support needed: Approve supplier escalation.
  Business impact: Protects the pilot date.`;
}

export function verboseExecutiveSummaryFixture() {
  return structuredExecutiveSummaryFixture();
}

export function legacyExecutiveSummaryFixture() {
  return `WEEKLY MOVEMENT Portfolio Summary: Portfolio delivery remains stable while validation and supply decisions need attention.
PMS: Startup review completed and integration preparation advanced.
Master Controller: Main-board review completed with procurement follow-up.
Zettabyte: Parallel validation and commercial workstreams were defined.
Phone Booth Rack: Prototype fabrication and shipment planning progressed.
Container: Water-leakage improvements completed while commissioning remains blocked.
Battery Gateway: Diagnostic workflow review completed and simulation is next.
MANAGEMENT ASK
PMS: Support cross-functional resource alignment for the next validation cycle.
Master Controller: Confirm the long-lead procurement strategy.
Zettabyte: Confirm the external commercial timeline owner.
Container: Support the site commissioning recovery decision.`;
}

export function week28DenseExecutiveSummaryFixture() {
  return `WEEKLY MOVEMENT Portfolio Summary: Overall portfolio execution remained stable with project counts unchanged, while focus shifted to commissioning recovery on Aston Labs 33kW Container, rolling planning and control enhancement assessment for PMS, hardware design progression in Master Controller, and plan restructuring for Zettabyte.
33kW Aston Labs Container: Water leakage improvements were completed, but the available validation evidence does not yet demonstrate compliance with the required IP55 test criteria. A generator was deployed for commissioning; however, the chiller and in-row systems have not been powered up, leaving testing activities and key milestones at risk. Aston also provided clarification regarding enclosure IP protection, which has been submitted for internal review.
PMS: Progress advanced from 55% to 60% through startup flowchart review, source state machine review, and alignment with the US team covering battery messaging, control strategy, operation ownership, UI/UX planning, and firmware testing. The project has adopted a rolling planning approach, with execution plans reviewed weekly to reflect evolving customer requirements. Additional analysis is underway to define the development effort and schedule impact of the parallel protection loop and PMS operation enhancements.
Master Controller: Progress increased from 20% to 25% with agreement to release the main board Gerber, completion of the module base board and extension board BOMs for factory review, and planned PLC board BOM release next week. Project execution is advancing into the next hardware preparation stage, while long lead-time component planning remains under review.
Zettabyte 10kW UltraEdge: Project planning was restructured from phase-based milestones into parallel technology validation and commercial architecture tracks. The revised framework provides clearer separation between technical validation and commercial engagement activities, while dependency on an externally confirmed timeline remains unresolved.
Phone Booth Rack: Fabrication of two prototype samples is progressing, and shipment by sea has been arranged. Current delivery expectations are late August for Utah and early September for Plano, reflecting an updated prototype delivery schedule.
MANAGEMENT ASK
33kW Aston Labs Container: Support continued executive engagement with Enetek and ACIS to accelerate installation and commissioning completion, as container power-up and validation activities remain blocked and schedule risk continues. A decision on whether Enetek should continue its remaining scope may be required early next week following review of the latest site progress.
PMS: Support prioritization and cross-functional resource alignment once the simulation analysis is completed. The estimated development effort and schedule impact of the protection loop and PMS operation enhancements will be incorporated into the next rolling plan update to maintain visibility of upcoming delivery milestones.
Master Controller: Support early cross-functional review of long lead-time components to confirm the procurement strategy and reduce potential EVT-to-PVT schedule exposure.`;
}

export function stressExecutiveSummaryFixture() {
  const paragraph = 'Validation evidence is progressing through cross-functional review while the recovery plan, supplier timing, laboratory capacity, commissioning sequence, commercial dependencies, and customer delivery commitments remain under coordinated management review.';
  const project = name => `- Project: ${name}\n  Movement: ${paragraph} ${paragraph}\n  Blocker: ${paragraph}\n  Next step: ${paragraph}`;
  const ask = name => `- Project: ${name}\n  Decision / Support needed: ${paragraph} ${paragraph}\n  Business impact: ${paragraph}`;
  return `WEEKLY MOVEMENT\nPortfolio Summary: ${paragraph}\n\n${['PMS', 'Master Controller', 'Zettabyte', 'Phone Booth Rack', 'Container', 'Battery Gateway'].map(project).join('\n\n')}\n\nMANAGEMENT ASK\n\n${['PMS', 'Master Controller', 'Zettabyte', 'Container'].map(ask).join('\n\n')}`;
}
