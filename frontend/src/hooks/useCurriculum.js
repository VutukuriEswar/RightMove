import { useEffect } from 'react';
import { useCurriculumStore } from '../store/curriculumStore';
import { useAuthStore } from '../store/authStore';

export function useCurriculum() {
  const token = useAuthStore((s) => s.token);
  const clusters = useCurriculumStore((s) => s.clusters);
  const pendingDrills = useCurriculumStore((s) => s.pendingDrills);
  const unreadReports = useCurriculumStore((s) => s.unreadReports);
  const profileLoading = useCurriculumStore((s) => s.profileLoading);
  const error = useCurriculumStore((s) => s.error);
  const activeReports = useCurriculumStore((s) => s.activeReports);
  const progressData = useCurriculumStore((s) => s.progressData);
  const fetchProfile = useCurriculumStore((s) => s.fetchProfile);
  const fetchReportForCluster = useCurriculumStore((s) => s.fetchReportForCluster);
  const acknowledgeReport = useCurriculumStore((s) => s.acknowledgeReport);
  const fetchProgress = useCurriculumStore((s) => s.fetchProgress);

  useEffect(() => {
    if (!token) return;
    fetchProfile();
    const interval = setInterval(() => {
      fetchProfile();
    }, 45000);
    return () => clearInterval(interval);
  }, [token, fetchProfile]);

  const totalBadgeCount = (pendingDrills || 0) + (unreadReports || 0);

  return {
    clusters,
    pendingDrills,
    unreadReports,
    totalBadgeCount,
    profileLoading,
    error,
    activeReports,
    progressData,
    refreshProfile: fetchProfile,
    fetchReportForCluster,
    acknowledgeReport,
    fetchProgress,
  };
}
