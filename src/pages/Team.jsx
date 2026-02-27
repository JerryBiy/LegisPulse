import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/apiClient";
import { useAuth } from "@/lib/AuthContext";
import {
  Users,
  UserPlus,
  Trash2,
  Star,
  Mail,
  UserCheck,
  CheckCircle,
  XCircle,
  LogOut,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import BillCard from "@/components/bills/BillCard";
import BillDetailsModal from "@/components/bills/BillDetailsModal";
import TeamChat from "@/components/TeamChat";

export default function Team() {
  const queryClient = useQueryClient();
  const { user: authUser } = useAuth();
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteError, setInviteError] = useState("");
  const [selectedBill, setSelectedBill] = useState(null);

  // Load (or auto-create) the current user's team
  const {
    data: team,
    isLoading: loadingTeam,
    refetch: refetchTeam,
  } = useQuery({
    queryKey: ["team"],
    queryFn: () => api.entities.Team.getOrCreate(),
    staleTime: 0,
    retry: 1,
  });

  const hasPendingInvite = team?.__pendingInvite === true;

  // Pending invites for this user (shown when hasPendingInvite)
  const { data: pendingInvites = [], refetch: refetchPending } = useQuery({
    queryKey: ["pendingInvites"],
    queryFn: () => api.entities.Team.getPendingInvites(),
    enabled: hasPendingInvite,
    staleTime: 0,
  });

  const [isAccepting, setIsAccepting] = useState(false);
  const [acceptError, setAcceptError] = useState("");

  const handleAcceptInvite = async () => {
    setIsAccepting(true);
    setAcceptError("");
    try {
      await api.entities.Team.acceptPendingInvites();
      // Force refetch team query — don't just invalidate, wait for fresh data
      await queryClient.refetchQueries({ queryKey: ["team"] });
      await queryClient.invalidateQueries({ queryKey: ["pendingInvites"] });
    } catch (err) {
      console.error("[Accept invite]", err);
      setAcceptError(
        err?.message ??
          "Failed to accept invite. Make sure the RLS SQL has been run in Supabase.",
      );
    } finally {
      setIsAccepting(false);
    }
  };

  const handleDeclineInvite = async (invite) => {
    try {
      await api.entities.Team.declineInvite(invite.id);
      await queryClient.refetchQueries({ queryKey: ["team"] });
      await queryClient.invalidateQueries({ queryKey: ["pendingInvites"] });
    } catch (err) {
      console.error("[Decline invite]", err);
    }
  };

  const teamId = team?.id;

  const { data: members = [] } = useQuery({
    queryKey: ["teamMembers", teamId],
    queryFn: () => api.entities.Team.getMembers(teamId),
    enabled: !!teamId,
  });

  const { data: teamBillNumbers = [] } = useQuery({
    queryKey: ["teamBills", teamId],
    queryFn: () => api.entities.Team.getBillNumbers(teamId),
    enabled: !!teamId,
  });

  const { data: allBills = [] } = useQuery({
    queryKey: ["bills"],
    queryFn: () => api.entities.Bill.list(),
  });

  const { data: userData } = useQuery({
    queryKey: ["profile"],
    queryFn: () => api.auth.me().catch(() => null),
  });

  const trackedBillIds = userData?.tracked_bill_ids ?? [];
  const teamBills = allBills.filter((b) =>
    teamBillNumbers.includes(b.bill_number),
  );
  const isOwner = team?.created_by === authUser?.id;

  const handleLeaveTeam = async () => {
    if (!window.confirm("Are you sure you want to leave this team?")) return;
    try {
      await api.entities.Team.leaveTeam(teamId);
      await queryClient.refetchQueries({ queryKey: ["team"] });
      queryClient.removeQueries({ queryKey: ["teamMembers", teamId] });
      queryClient.removeQueries({ queryKey: ["teamBills", teamId] });
    } catch (err) {
      console.error("[Leave team]", err);
      alert(err?.message ?? "Failed to leave team.");
    }
  };

  // ── Mutations ──────────────────────────────────────────────────────────────

  const inviteMutation = useMutation({
    mutationFn: (email) => api.entities.Team.inviteMember(teamId, email),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["teamMembers", teamId] });
      setInviteEmail("");
      setInviteError("");
    },
    onError: (err) => {
      setInviteError(err?.message ?? "Failed to invite member.");
    },
  });

  const removeMemberMutation = useMutation({
    mutationFn: (memberId) => api.entities.Team.removeMember(memberId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["teamMembers", teamId] });
    },
  });

  const removeBillMutation = useMutation({
    mutationFn: (billNumber) =>
      api.entities.Team.removeBill(teamId, billNumber),
    onMutate: async (billNumber) => {
      await queryClient.cancelQueries({ queryKey: ["teamBills", teamId] });
      const prev = queryClient.getQueryData(["teamBills", teamId]);
      queryClient.setQueryData(["teamBills", teamId], (old) =>
        (old ?? []).filter((n) => n !== billNumber),
      );
      return { prev };
    },
    onError: (_e, _b, ctx) => {
      queryClient.setQueryData(["teamBills", teamId], ctx.prev);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["teamBills", teamId] });
    },
  });

  // ── Render ─────────────────────────────────────────────────────────────────

  if (loadingTeam) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-slate-200 border-t-blue-600 rounded-full animate-spin" />
      </div>
    );
  }

  // ── Pending invite screen ──────────────────────────────────────────────────
  if (hasPendingInvite) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="max-w-md w-full space-y-4">
          <div className="text-center space-y-2">
            <div className="inline-flex p-4 bg-blue-100 rounded-full mb-2">
              <UserCheck className="w-8 h-8 text-blue-600" />
            </div>
            <h1 className="text-2xl font-bold text-slate-900">
              Team Invitation
            </h1>
            <p className="text-slate-600">
              You've been invited to join a team.
            </p>
          </div>

          {pendingInvites.map((invite) => (
            <Card key={invite.id} className="border-blue-200">
              <CardContent className="p-5 space-y-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-blue-100 rounded-lg">
                    <Users className="w-5 h-5 text-blue-600" />
                  </div>
                  <div>
                    <p className="font-semibold text-slate-900">
                      {invite.teams?.name ?? "A team"}
                    </p>
                    <p className="text-sm text-slate-500">
                      You were invited as a member
                    </p>
                  </div>
                </div>
                <div className="flex gap-3">
                  <Button
                    className="flex-1 bg-blue-600 hover:bg-blue-700 gap-2"
                    onClick={handleAcceptInvite}
                    disabled={isAccepting}
                  >
                    {isAccepting ? (
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    ) : (
                      <CheckCircle className="w-4 h-4" />
                    )}
                    Accept & Join
                  </Button>
                  <Button
                    variant="outline"
                    className="flex-1 gap-2 text-red-600 border-red-200 hover:bg-red-50"
                    onClick={() => handleDeclineInvite(invite)}
                    disabled={isAccepting}
                  >
                    <XCircle className="w-4 h-4" />
                    Decline
                  </Button>
                </div>
                {acceptError && (
                  <p className="text-sm text-red-600 mt-2">{acceptError}</p>
                )}
              </CardContent>
            </Card>
          ))}

          {pendingInvites.length === 0 && (
            <Card>
              <CardContent className="p-5 text-center text-slate-500 text-sm">
                Loading invitation details...
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-7xl mx-auto p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center gap-4">
          <div className="p-3 bg-green-100 rounded-lg">
            <Users className="w-6 h-6 text-green-600" />
          </div>
          <div>
            <h1 className="text-3xl font-bold text-slate-900">{team?.name}</h1>
            <p className="text-slate-600 mt-1">Shared bills and team members</p>
          </div>
        </div>

        {/* Members */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="w-5 h-5" />
              Team Members
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              {members.map((member) => (
                <div
                  key={member.id}
                  className="flex items-center justify-between p-3 bg-slate-50 rounded-lg"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center">
                      <span className="text-blue-600 text-sm font-semibold">
                        {member.email?.[0]?.toUpperCase()}
                      </span>
                    </div>
                    <div>
                      <p className="text-sm font-medium text-slate-900">
                        {member.email}
                      </p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <Badge variant="outline" className="text-xs capitalize">
                          {member.role}
                        </Badge>
                        {member.status === "pending" && (
                          <Badge
                            variant="outline"
                            className="text-xs text-orange-600 border-orange-200"
                          >
                            Pending invite
                          </Badge>
                        )}
                      </div>
                    </div>
                  </div>
                  {isOwner && member.user_id !== authUser?.id && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-red-500 hover:text-red-700 hover:bg-red-50"
                      onClick={() => removeMemberMutation.mutate(member.id)}
                      disabled={removeMemberMutation.isPending}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  )}
                </div>
              ))}
              {members.length === 0 && (
                <p className="text-sm text-slate-500 italic">
                  No members yet. Invite someone below.
                </p>
              )}
            </div>

            {/* Leave team (members only) */}
            {!isOwner && (
              <div className="pt-3 border-t border-slate-200">
                <Button
                  variant="outline"
                  className="gap-2 text-red-600 border-red-200 hover:bg-red-50"
                  onClick={handleLeaveTeam}
                >
                  <LogOut className="w-4 h-4" />
                  Leave Team
                </Button>
              </div>
            )}

            {/* Invite form (owner only) */}
            {isOwner && (
              <div className="pt-3 border-t border-slate-200 space-y-2">
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <Input
                      type="email"
                      placeholder="Invite by email address..."
                      value={inviteEmail}
                      onChange={(e) => {
                        setInviteEmail(e.target.value);
                        setInviteError("");
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && inviteEmail.trim()) {
                          inviteMutation.mutate(inviteEmail.trim());
                        }
                      }}
                      className="pl-10"
                    />
                  </div>
                  <Button
                    onClick={() => inviteMutation.mutate(inviteEmail.trim())}
                    disabled={!inviteEmail.trim() || inviteMutation.isPending}
                    className="bg-blue-600 hover:bg-blue-700 gap-2"
                  >
                    <UserPlus className="w-4 h-4" />
                    Invite
                  </Button>
                </div>
                {inviteError && (
                  <p className="text-sm text-red-600">{inviteError}</p>
                )}
                <p className="text-xs text-slate-500">
                  The invited person will automatically join when they log in
                  with that email.
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Team Bills */}
        <div className="space-y-4">
          <h2 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
            <Star className="w-5 h-5 text-yellow-500" />
            Team Bills ({teamBills.length})
          </h2>

          {teamBills.length > 0 ? (
            <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
              {teamBills.map((bill) => (
                <BillCard
                  key={bill.id}
                  bill={bill}
                  onViewDetails={setSelectedBill}
                  onToggleTracking={() => {}}
                  isTracked={trackedBillIds.includes(bill.bill_number)}
                  isInTeam={true}
                  onAddToTeam={() =>
                    removeBillMutation.mutate(bill.bill_number)
                  }
                  teamButtonLabel="Remove from Team"
                />
              ))}
            </div>
          ) : (
            <div className="text-center py-12 bg-white rounded-xl border border-slate-200">
              <Star className="w-12 h-12 text-slate-400 mx-auto mb-4" />
              <h3 className="text-xl font-semibold text-slate-900 mb-2">
                No team bills yet
              </h3>
              <p className="text-slate-600">
                Use the "Add to Team" button on any bill in the Dashboard to
                share it with your team.
              </p>
            </div>
          )}
        </div>

        {/* Team Chat */}
        <TeamChat teamId={teamId} />
      </div>

      <BillDetailsModal
        bill={selectedBill}
        isOpen={!!selectedBill}
        onClose={() => setSelectedBill(null)}
        isTracked={
          selectedBill
            ? trackedBillIds.includes(selectedBill.bill_number)
            : false
        }
        onToggleTracking={() => {}}
        isInTeam={
          selectedBill
            ? teamBillNumbers.includes(selectedBill.bill_number)
            : false
        }
        onAddToTeam={() => {
          if (selectedBill) removeBillMutation.mutate(selectedBill.bill_number);
        }}
      />
    </div>
  );
}
