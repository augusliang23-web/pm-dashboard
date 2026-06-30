'use client';

import { useEffect, useRef } from 'react';
import { useDashboardStore } from '@/stores/dashboard';
import { subscribeWeeks, subscribePresence, onAuthChange, getAuthInstance } from '@/services/firebase';
import LoginOverlay from '@/components/auth/LoginOverlay';
import DashboardShell from '@/components/dashboard/DashboardShell';
import Loader from '@/components/dashboard/Loader';
import Toast from '@/components/dashboard/Toast';
import OverviewView from '@/components/dashboard/OverviewView';
import ProjectsView from '@/components/dashboard/ProjectsView';
import TimelineView from '@/components/dashboard/TimelineView';
import RiskMatrixView from '@/components/dashboard/RiskMatrixView';
import TeamWorkloadView from '@/components/dashboard/TeamWorkloadView';
import RoadmapView from '@/components/dashboard/RoadmapView';
import ActivityView from '@/components/dashboard/ActivityView';
import ProjectEditModal from '@/components/dashboard/ProjectEditModal';
import ProjectDetailModal from '@/components/dashboard/ProjectDetailModal';
import WeekManagementModal from '@/components/dashboard/WeekManagementModal';
import ChangePasswordModal from '@/components/dashboard/ChangePasswordModal';
import type { ViewId, DashboardRole } from '@/types/dashboard';

function ViewRouter() {
  const activeView = useDashboardStore((s) => s.activeView);
  const isOverview = useDashboardStore((s) => s.isOverview);
  const isVipPerspective = useDashboardStore((s) => s.isVipPerspective);

  if (isVipPerspective || isOverview) {
    return <OverviewView />;
  }

  switch (activeView) {
    case 'overview':
      return <OverviewView />;
    case 'projects':
      return <ProjectsView />;
    case 'timeline':
      return <TimelineView />;
    case 'risk':
      return <RiskMatrixView />;
    case 'team':
      return <TeamWorkloadView />;
    case 'roadmap':
      return <RoadmapView />;
    case 'activity':
      return <ActivityView />;
    default:
      return <OverviewView />;
  }
}

export default function DashboardPage() {
  const currentUser = useDashboardStore((s) => s.currentUser);
  const setWeeks = useDashboardStore((s) => s.setWeeks);
  const setPresence = useDashboardStore((s) => s.setPresence);
  const currentRole = useDashboardStore((s) => s.currentRole);
  const setPmList = useDashboardStore((s) => s.setPmList);

  const weeksUnsub = useRef<ReturnType<typeof subscribeWeeks> | null>(null);
  const presenceUnsub = useRef<ReturnType<typeof subscribePresence> | null>(null);

  useEffect(() => {
    const unsub = onAuthChange(async (user) => {
      if (user) {
        // Auth state is handled by the login flow in the store
        // Here we just set up the initial auth state
        const { fetchUserRole, fetchPMList, getEmailKey } = await import('@/services/firebase');
        try {
          const emailKey = getEmailKey(user);
          const role = await fetchUserRole(emailKey);
          const pmList = await fetchPMList();
          useDashboardStore.setState({
            currentUser: user,
            currentRole: role as DashboardRole,
            pmList,
            loading: false,
            loginError: null,
          });
        } catch {
          useDashboardStore.setState({ loading: false });
        }
      } else {
        // Clean up listeners
        if (weeksUnsub.current) {
          weeksUnsub.current();
          weeksUnsub.current = null;
        }
        if (presenceUnsub.current) {
          presenceUnsub.current();
          presenceUnsub.current = null;
        }
        useDashboardStore.setState({
          currentUser: null,
          currentRole: 'pm',
          allWeeks: [],
          currentWeekIdx: -1,
          loading: true,
        });
      }
    });
    return () => unsub();
  }, []);

  // Subscribe to weeks when user is logged in
  useEffect(() => {
    if (!currentUser) return;
    if (weeksUnsub.current) weeksUnsub.current();

    weeksUnsub.current = subscribeWeeks(
      currentRole,
      (weeks) => setWeeks(weeks),
      (err) => {
        console.error('Weeks subscription error:', err);
        useDashboardStore.setState({ loading: false });
      }
    );

    return () => {
      if (weeksUnsub.current) {
        weeksUnsub.current();
        weeksUnsub.current = null;
      }
    };
  }, [currentUser, currentRole, setWeeks]);

  // Subscribe to presence when user is logged in as PM
  useEffect(() => {
    if (!currentUser || currentRole !== 'pm') return;
    if (presenceUnsub.current) presenceUnsub.current();

    presenceUnsub.current = subscribePresence((docs) => setPresence(docs));

    return () => {
      if (presenceUnsub.current) {
        presenceUnsub.current();
        presenceUnsub.current = null;
      }
    };
  }, [currentUser, currentRole, setPresence]);

  // Login screen
  if (!currentUser) {
    return (
      <>
        <LoginOverlay />
        <Toast />
      </>
    );
  }

  // Dashboard
  return (
    <DashboardShell>
      <ViewRouter />
      <ProjectEditModal />
      <ProjectDetailModal />
      <WeekManagementModal />
      <ChangePasswordModal />
      <Loader />
      <Toast />
    </DashboardShell>
  );
}