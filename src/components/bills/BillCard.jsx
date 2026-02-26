import { useState } from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  FileText,
  Calendar,
  User,
  Building2,
  AlertCircle,
  ExternalLink,
  Plus,
  Check,
  Users,
} from "lucide-react";
import { format } from "date-fns";

const getStatusColor = (status) => {
  const colors = {
    introduced: "bg-blue-100 text-blue-800 border-blue-200",
    in_committee: "bg-yellow-100 text-yellow-800 border-yellow-200",
    passed_first_reading: "bg-purple-100 text-purple-800 border-purple-200",
    passed_second_reading: "bg-purple-100 text-purple-800 border-purple-200",
    passed_third_reading: "bg-green-100 text-green-800 border-green-200",
    sent_to_other_chamber: "bg-indigo-100 text-indigo-800 border-indigo-200",
    passed_both_chambers: "bg-green-100 text-green-800 border-green-200",
    sent_to_governor: "bg-orange-100 text-orange-800 border-orange-200",
    signed: "bg-emerald-100 text-emerald-800 border-emerald-200",
    vetoed: "bg-red-100 text-red-800 border-red-200",
    dead: "bg-gray-100 text-gray-800 border-gray-200",
  };
  return colors[status] || colors.introduced;
};

const getChamberIcon = (chamber) => {
  return chamber === "house" ? Building2 : Building2;
};

const PARTY_CONFIG = {
  D: {
    label: "Democrat",
    dot: "bg-indigo-500",
    pill: "bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200",
  },
  R: {
    label: "Republican",
    dot: "bg-rose-500",
    pill: "bg-rose-50 text-rose-700 ring-1 ring-rose-200",
  },
  I: {
    label: "Independent",
    dot: "bg-slate-400",
    pill: "bg-slate-50 text-slate-600 ring-1 ring-slate-200",
  },
  G: {
    label: "Green",
    dot: "bg-green-500",
    pill: "bg-green-50 text-green-700 ring-1 ring-green-200",
  },
  L: {
    label: "Libertarian",
    dot: "bg-yellow-500",
    pill: "bg-yellow-50 text-yellow-700 ring-1 ring-yellow-200",
  },
};

const PartyBadge = ({ party }) => {
  if (!party) return null;
  const config = PARTY_CONFIG[party] ?? {
    label: party,
    dot: "bg-slate-400",
    pill: "bg-slate-50 text-slate-600 ring-1 ring-slate-200",
  };
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${config.pill}`}
    >
      <span
        className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${config.dot}`}
      />
      {config.label}
    </span>
  );
};

export default function BillCard({
  bill,
  onViewDetails,
  onToggleTracking,
  isTracked,
  isInTeam,
  onAddToTeam,
  teamButtonLabel,
}) {
  const ChamberIcon = getChamberIcon(bill.chamber);
  const [showAllSponsors, setShowAllSponsors] = useState(false);
  const allSponsors =
    Array.isArray(bill.sponsors) && bill.sponsors.length
      ? bill.sponsors
      : [bill.sponsor, ...(bill.co_sponsors || [])].filter(Boolean);
  const sponsorsText = allSponsors.length ? allSponsors.join(", ") : "Unknown";
  const sponsorCharLimit = 28;
  const isSponsorTruncated = sponsorsText.length > sponsorCharLimit;
  const visibleSponsors =
    showAllSponsors || !isSponsorTruncated
      ? sponsorsText
      : sponsorsText.slice(0, sponsorCharLimit).trimEnd();

  return (
    <Card className="hover:shadow-lg transition-all duration-300 border border-slate-200 bg-white group">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div
              className={`p-2 rounded-lg ${
                bill.chamber === "house"
                  ? "bg-blue-100 text-blue-600"
                  : "bg-purple-100 text-purple-600"
              }`}
            >
              <ChamberIcon className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-lg text-slate-900">
                {bill.bill_number}
              </h3>
              <p className="text-sm text-slate-500 font-medium">
                {bill.chamber === "house" ? "House" : "Senate"} •{" "}
                {bill.session_year}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant={isTracked ? "default" : "outline"}
              size="sm"
              onClick={() => onToggleTracking(bill.id, bill.bill_number)}
              className={
                isTracked
                  ? "bg-blue-600 hover:bg-blue-700 text-white gap-1"
                  : "border-blue-200 text-blue-600 hover:bg-blue-50 gap-1"
              }
            >
              {isTracked ? (
                <>
                  <Check className="w-3 h-3" />
                  Tracking
                </>
              ) : (
                <>
                  <Plus className="w-3 h-3" />
                  Track
                </>
              )}
            </Button>
            {(bill.pdf_url || bill.url) && (
              <Button
                variant="ghost"
                size="icon"
                asChild
                className="opacity-60 group-hover:opacity-100 transition-opacity"
              >
                <a
                  href={bill.pdf_url || bill.url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <ExternalLink className="w-4 h-4" />
                </a>
              </Button>
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        <div>
          <h4 className="font-semibold text-slate-900 mb-2 line-clamp-2">
            {bill.title}
          </h4>
          {bill.lc_number && (
            <p className="text-sm text-slate-500 font-mono">
              LC: {bill.lc_number}
            </p>
          )}
        </div>

        <div className="flex items-center gap-2 text-sm">
          <User className="w-4 h-4 text-slate-400" />
          {bill.sponsor_party && <PartyBadge party={bill.sponsor_party} />}
          <span className="text-slate-600 font-medium break-all">
            {visibleSponsors}
            {isSponsorTruncated && (
              <button
                type="button"
                className="ml-1 text-blue-600 hover:text-blue-700"
                onClick={() => setShowAllSponsors((prev) => !prev)}
              >
                {showAllSponsors ? "less" : "..."}
              </button>
            )}
          </span>
        </div>

        {bill.last_action_date && (
          <div className="flex items-center gap-2 text-sm">
            <Calendar className="w-4 h-4 text-slate-400" />
            <span className="text-slate-600">
              {format(new Date(bill.last_action_date), "MMM d, yyyy")}
            </span>
          </div>
        )}

        <div className="flex items-center gap-2">
          <Badge className={getStatusColor(bill.status)} variant="outline">
            {bill.status
              .replace(/_/g, " ")
              .replace(/\b\w/g, (l) => l.toUpperCase())}
          </Badge>
          <Badge variant="outline" className="text-xs">
            {bill.bill_type.replace(/_/g, " ")}
          </Badge>
        </div>

        {bill.current_committee && (
          <div className="flex items-center gap-2 text-sm">
            <AlertCircle className="w-4 h-4 text-orange-500" />
            <span className="text-slate-600">{bill.current_committee}</span>
          </div>
        )}

        {bill.summary && (
          <p className="text-sm text-slate-600 line-clamp-2">{bill.summary}</p>
        )}

        {bill.last_action && (
          <div className="bg-slate-50 border border-slate-200 rounded-lg p-3">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">
              Latest Update
            </p>
            <p className="text-sm text-slate-700 font-medium">
              {bill.last_action}
            </p>
          </div>
        )}

        <div className="flex justify-end pt-2 gap-2">
          {onAddToTeam && (
            <Button
              variant={isInTeam ? "default" : "outline"}
              size="sm"
              onClick={onAddToTeam}
              className={
                isInTeam
                  ? "bg-green-600 hover:bg-green-700 text-white gap-1"
                  : "border-green-200 text-green-600 hover:bg-green-50 gap-1"
              }
            >
              <Users className="w-3 h-3" />
              {teamButtonLabel ?? (isInTeam ? "In Team" : "Add to Team")}
            </Button>
          )}
          <Button
            variant="outline"
            onClick={() => onViewDetails(bill)}
            className="text-blue-600 border-blue-200 hover:bg-blue-50"
          >
            <FileText className="w-4 h-4 mr-2" />
            View Details
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
