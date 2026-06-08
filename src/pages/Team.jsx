import React, { useState, useCallback, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/apiClient";
import {
  Users,
  UserPlus,
  UserCheck,
  CheckCircle,
  XCircle,
  Hash,
  Plus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import TeamSection from "@/components/TeamSection";

export default function Team() {
  const queryClient = useQueryClient();

  // ── Create / Join form state ───────────────────────────────────────────────
  const [newTeamName, setNewTeamName] = useState("");
  const [creatingTeam, setCreatingTeam] = useState(false);
  const [createTeamError, setCreateTeamError] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [joiningTeam, setJoiningTeam] = useState(false);
  const [joinError, setJoinError] = useState("");
  const [showCreateJoin, setShowCreateJoin] = useState(false);

  // ── Scroll persistence ─────────────────────────────────────────────────────
  const scrollRestored = useRef(false);
  const pageRef = useRef(null);

  const getScrollContainer = useCallback(() => {
    let el = pageRef.current;
    while (el) {
      const style = getComputedStyle(el);
      if (style.overflow === "auto" || style.overflowY === "auto") return el;
      el = el.parentElement;
    }
    return null;
  }, []);

  useEffect(() => {
    const container = getScrollContainer();
    if (!container) return;
    const handleScroll = () => {
      sessionStorage.setItem("team-scroll-y", String(container.scrollTop));
    };
    container.addEventListener("scroll", handleScroll, { passive: true });
    return () => container.removeEventListener("scroll", handleScroll);
  }, [getScrollContainer]);

  useEffect(() => {
    if (scrollRestored.current) return;
    scrollRestored.current = true;
    const savedY = parseInt(sessionStorage.getItem("team-scroll-y") || "0", 10);
    if (savedY > 0) {
      requestAnimationFrame(() => {
        const container = getScrollContainer();
        if (container) container.scrollTop = savedY;
      });
    }
  }, [getScrollContainer]);

  // ── Mark team page visit (for unread chat badge in nav) ────────────────────
  useEffect(() => {
    localStorage.setItem("team-page-last-visit", new Date().toISOString());
    // Refresh the notification badge since we're now on the page
    queryClient.invalidateQueries({ queryKey: ["teamNotifications"] });
  }, [queryClient]);

  // ── Load ALL teams + pending invites ───────────────────────────────────────
  const { data: allTeamData, isLoading } = useQuery({
    queryKey: ["allTeams"],
    queryFn: () => api.entities.Team.getAll(),
    staleTime: 0,
    retry: 1,
  });

  const teams = allTeamData?.teams ?? [];
  const pendingInvites = allTeamData?.__pendingInvites ?? [];

  // ── Pending join requests (for teams I own) ────────────────────────────────
  const { data: pendingJoinRequests = [] } = useQuery({
    queryKey: ["pendingJoinRequests"],
    queryFn: () => api.entities.Team.getPendingJoinRequests(),
    staleTime: 0,
    retry: 1,
  });

  const approveJoinMutation = useMutation({
    mutationFn: (memberId) => api.entities.Team.approveJoinRequest(memberId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pendingJoinRequests"] });
      queryClient.invalidateQueries({ queryKey: ["teamNotifications"] });
      // Invalidate teamMembers for all teams so the member list updates
      teams.forEach((t) =>
        queryClient.invalidateQueries({ queryKey: ["teamMembers", t.id] }),
      );
    },
  });

  const declineJoinMutation = useMutation({
    mutationFn: (memberId) => api.entities.Team.declineJoinRequest(memberId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pendingJoinRequests"] });
      queryClient.invalidateQueries({ queryKey: ["teamNotifications"] });
      teams.forEach((t) =>
        queryClient.invalidateQueries({ queryKey: ["teamMembers", t.id] }),
      );
    },
  });

  // ── Accept / Decline invites ───────────────────────────────────────────────
  const [isAccepting, setIsAccepting] = useState(false);
  const [acceptError, setAcceptError] = useState("");

  const handleAcceptInvite = async () => {
    setIsAccepting(true);
    setAcceptError("");
    try {
      await api.entities.Team.acceptPendingInvites();
      await queryClient.refetchQueries({ queryKey: ["allTeams"] });
      queryClient.invalidateQueries({ queryKey: ["teamNotifications"] });
    } catch (err) {
      console.error("[Accept invite]", err);
      setAcceptError(err?.message ?? "Failed to accept invite.");
    } finally {
      setIsAccepting(false);
    }
  };

  const handleDeclineInvite = async (invite) => {
    try {
      await api.entities.Team.declineInvite(invite.id);
      await queryClient.refetchQueries({ queryKey: ["allTeams"] });
      queryClient.invalidateQueries({ queryKey: ["teamNotifications"] });
    } catch (err) {
      console.error("[Decline invite]", err);
    }
  };

  // ── Create team ────────────────────────────────────────────────────────────
  const handleCreateTeam = async () => {
    if (!newTeamName.trim()) {
      setCreateTeamError("Please enter a team name.");
      return;
    }
    setCreatingTeam(true);
    setCreateTeamError("");
    try {
      await api.entities.Team.createTeam(newTeamName);
      await queryClient.refetchQueries({ queryKey: ["allTeams"] });
      setNewTeamName("");
      setShowCreateJoin(false);
    } catch (err) {
      setCreateTeamError(err?.message ?? "Failed to create team.");
    } finally {
      setCreatingTeam(false);
    }
  };

  // ── Join by code ───────────────────────────────────────────────────────────
  const [joinSuccess, setJoinSuccess] = useState("");
  const handleJoinByCode = async () => {
    if (!joinCode.trim()) {
      setJoinError("Please enter a team code.");
      return;
    }
    setJoiningTeam(true);
    setJoinError("");
    setJoinSuccess("");
    try {
      await api.entities.Team.joinByCode(joinCode);
      await queryClient.refetchQueries({ queryKey: ["allTeams"] });
      setJoinCode("");
      setJoinSuccess(
        "Join request sent! The team owner will review your request.",
      );
    } catch (err) {
      setJoinError(err?.message ?? "Invalid code or unable to join.");
    } finally {
      setJoiningTeam(false);
    }
  };

  // ── Loading ────────────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-slate-200 border-t-blue-600 rounded-full animate-spin" />
      </div>
    );
  }

  const hasTeams = teams.length > 0;

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div ref={pageRef} className="min-h-full bg-slate-50">
      <div className="max-w-7xl mx-auto p-4 sm:p-6 space-y-6">
        {/* Page header */}
        <div className="flex flex-wrap items-center gap-3 sm:gap-4">
          <div className="p-3 bg-blue-100 rounded-lg shrink-0">
            <Users className="w-6 h-6 text-blue-600" />
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-2xl sm:text-3xl font-bold text-slate-900">
              Teams
            </h1>
            <p className="text-slate-600 mt-1">
              {hasTeams
                ? `You are in ${teams.length} team${teams.length !== 1 ? "s" : ""}`
                : "Create a new team or join an existing one"}
            </p>
          </div>
          {hasTeams && (
            <Button
              size="sm"
              variant={showCreateJoin ? "secondary" : "default"}
              className="gap-2 shrink-0"
              onClick={() => setShowCreateJoin((v) => !v)}
            >
              <Plus className="w-4 h-4" />
              {showCreateJoin ? "Cancel" : "Create / Join Team"}
            </Button>
          )}
        </div>

        {/* Pending invites banner */}
        {pendingInvites.length > 0 && (
          <div className="space-y-3">
            {pendingInvites.map((invite) => (
              <Card key={invite.id} className="border-blue-200 bg-blue-50/50">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                      <div className="p-2 bg-blue-100 rounded-lg shrink-0">
                        <UserCheck className="w-4 h-4 text-blue-600" />
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-slate-900">
                          Invitation to join{" "}
                          <span className="text-blue-700">
                            {invite.teams?.name ?? "a team"}
                          </span>
                        </p>
                      </div>
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <Button
                        size="sm"
                        className="bg-blue-600 hover:bg-blue-700 gap-1"
                        onClick={handleAcceptInvite}
                        disabled={isAccepting}
                      >
                        {isAccepting ? (
                          <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        ) : (
                          <CheckCircle className="w-3 h-3" />
                        )}
                        Accept
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-1 text-red-600 border-red-200 hover:bg-red-50"
                        onClick={() => handleDeclineInvite(invite)}
                        disabled={isAccepting}
                      >
                        <XCircle className="w-3 h-3" />
                        Decline
                      </Button>
                    </div>
                  </div>
                  {acceptError && (
                    <p className="text-sm text-red-600 mt-2">{acceptError}</p>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Pending join requests (owner view) */}
        {pendingJoinRequests.length > 0 && (
          <div className="space-y-3">
            {pendingJoinRequests.map((req) => (
              <Card key={req.id} className="border-amber-200 bg-amber-50/50">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                      <div className="p-2 bg-amber-100 rounded-lg shrink-0">
                        <UserPlus className="w-4 h-4 text-amber-600" />
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-slate-900">
                          <span className="text-amber-700">{req.email}</span>{" "}
                          wants to join{" "}
                          <span className="text-amber-700">{req.teamName}</span>
                        </p>
                      </div>
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <Button
                        size="sm"
                        className="bg-green-600 hover:bg-green-700 gap-1"
                        onClick={() => approveJoinMutation.mutate(req.id)}
                        disabled={
                          approveJoinMutation.isPending ||
                          declineJoinMutation.isPending
                        }
                      >
                        <CheckCircle className="w-3 h-3" />
                        Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-1 text-red-600 border-red-200 hover:bg-red-50"
                        onClick={() => declineJoinMutation.mutate(req.id)}
                        disabled={
                          approveJoinMutation.isPending ||
                          declineJoinMutation.isPending
                        }
                      >
                        <XCircle className="w-3 h-3" />
                        Decline
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Create / Join forms — shown when no teams, or when user clicks button */}
        {(!hasTeams || showCreateJoin) && (
          <div className={hasTeams ? "" : "flex items-center justify-center"}>
            <div className={`space-y-5 ${hasTeams ? "" : "max-w-lg w-full"}`}>
              {!hasTeams && (
                <div className="text-center space-y-2">
                  <div className="inline-flex p-4 bg-slate-100 rounded-full mb-2">
                    <Users className="w-8 h-8 text-slate-500" />
                  </div>
                  <h2 className="text-2xl font-bold text-slate-900">
                    No Team Yet
                  </h2>
                  <p className="text-slate-500 text-sm">
                    Create a new team or join an existing one with a team code.
                  </p>
                </div>
              )}

              <div
                className={`grid ${hasTeams ? "grid-cols-1 md:grid-cols-2" : "grid-cols-1"} gap-4`}
              >
                {/* Create team */}
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base flex items-center gap-2">
                      <UserPlus className="w-4 h-4 text-blue-600" />
                      Create a New Team
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <Input
                      placeholder="Team name"
                      value={newTeamName}
                      onChange={(e) => {
                        setNewTeamName(e.target.value);
                        setCreateTeamError("");
                      }}
                      onKeyDown={(e) => e.key === "Enter" && handleCreateTeam()}
                    />
                    <Button
                      className="w-full bg-blue-600 hover:bg-blue-700 gap-2"
                      onClick={handleCreateTeam}
                      disabled={creatingTeam}
                    >
                      {creatingTeam ? (
                        <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      ) : (
                        <UserPlus className="w-4 h-4" />
                      )}
                      Create Team
                    </Button>
                    {createTeamError && (
                      <p className="text-sm text-red-600">{createTeamError}</p>
                    )}
                  </CardContent>
                </Card>

                {/* Join by code */}
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base flex items-center gap-2">
                      <Hash className="w-4 h-4 text-green-600" />
                      Join with a Team Code
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <Input
                      placeholder="5-character code (e.g. A3K7P)"
                      value={joinCode}
                      maxLength={5}
                      className="uppercase tracking-widest font-mono"
                      onChange={(e) => {
                        setJoinCode(e.target.value.toUpperCase());
                        setJoinError("");
                        setJoinSuccess("");
                      }}
                      onKeyDown={(e) => e.key === "Enter" && handleJoinByCode()}
                    />
                    <Button
                      className="w-full bg-green-600 hover:bg-green-700 gap-2"
                      onClick={handleJoinByCode}
                      disabled={joiningTeam}
                    >
                      {joiningTeam ? (
                        <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      ) : (
                        <CheckCircle className="w-4 h-4" />
                      )}
                      Join Team
                    </Button>
                    {joinError && (
                      <p className="text-sm text-red-600">{joinError}</p>
                    )}
                    {joinSuccess && (
                      <div className="flex items-start gap-2 p-3 bg-green-50 border border-green-200 rounded-lg">
                        <CheckCircle className="w-4 h-4 text-green-600 mt-0.5 shrink-0" />
                        <p className="text-sm text-green-700">{joinSuccess}</p>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>
            </div>
          </div>
        )}

        {/* Team sections */}
        {teams.map((team) => (
          <TeamSection
            key={team.id}
            team={team}
            onLeave={() =>
              queryClient.refetchQueries({ queryKey: ["allTeams"] })
            }
            defaultOpen={teams.length === 1}
          />
        ))}
      </div>
    </div>
  );
}
